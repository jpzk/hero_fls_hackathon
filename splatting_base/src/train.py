"""3D Gaussian Splatting trainer using gsplat."""

import math
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from tqdm import tqdm


def build_rotation(quats):
    """Convert quaternions (N, 4) [w,x,y,z] to rotation matrices (N, 3, 3)."""
    norm = torch.sqrt((quats * quats).sum(dim=-1, keepdim=True))
    q = quats / norm
    w, x, y, z = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    R = torch.zeros((q.shape[0], 3, 3), device=quats.device)
    R[:, 0, 0] = 1 - 2 * (y*y + z*z)
    R[:, 0, 1] = 2 * (x*y - w*z)
    R[:, 0, 2] = 2 * (x*z + w*y)
    R[:, 1, 0] = 2 * (x*y + w*z)
    R[:, 1, 1] = 1 - 2 * (x*x + z*z)
    R[:, 1, 2] = 2 * (y*z - w*x)
    R[:, 2, 0] = 2 * (x*z - w*y)
    R[:, 2, 1] = 2 * (y*z + w*x)
    R[:, 2, 2] = 1 - 2 * (x*x + y*y)
    return R


@dataclass
class TrainConfig:
    iterations: int = 30_000
    lr_position: float = 0.00016
    lr_feature: float = 0.0025
    lr_opacity: float = 0.05
    lr_scaling: float = 0.005
    lr_rotation: float = 0.001
    densify_from: int = 500
    densify_until: int = 15_000
    densify_every: int = 100
    densify_grad_thresh: float = 0.0002
    opacity_reset_every: int = 3000
    prune_opacity_thresh: float = 0.01
    sh_degree: int = 3
    sh_degree_interval: int = 1000
    ssim_weight: float = 0.2
    resolution_scale: float = 1.0


def load_colmap_scene(model_dir: str, image_dir: str):
    """Load cameras and initial points from COLMAP sparse model."""
    from src.colmap_reader import read_colmap_model
    return read_colmap_model(model_dir, image_dir)


class GaussianModel(nn.Module):
    def __init__(self, points: np.ndarray, colors: np.ndarray, device: str = "cuda"):
        super().__init__()
        n = len(points)
        self.device = device

        self.means = nn.Parameter(torch.tensor(points, dtype=torch.float32, device=device))
        # KNN-based scale initialization: initial scale = distance to nearest neighbor
        pts = torch.tensor(points, dtype=torch.float32, device=device)
        dists = torch.cdist(pts, pts)
        dists.fill_diagonal_(float('inf'))
        nn_dist = dists.min(dim=1).values.clamp(min=1e-7)
        self.scales = nn.Parameter(
            torch.log(nn_dist).unsqueeze(-1).repeat(1, 3)
        )
        self.quats = nn.Parameter(
            torch.tensor(
                np.tile([1, 0, 0, 0], (n, 1)), dtype=torch.float32, device=device
            )
        )
        self.opacities_raw = nn.Parameter(
            torch.full((n,), fill_value=math.log(0.1 / (1 - 0.1)), dtype=torch.float32, device=device)
        )

        # SH coefficients: degree 0 only initially
        sh_dc = (colors - 0.5) / 0.2821  # inverse SH basis for DC
        self.sh_dc = nn.Parameter(
            torch.tensor(sh_dc, dtype=torch.float32, device=device).unsqueeze(1)
        )
        self.sh_rest = nn.Parameter(
            torch.zeros(n, 15, 3, dtype=torch.float32, device=device)
        )

        self.max_radii2d = torch.zeros(n, device=device)
        self.xyz_gradient_accum = torch.zeros(n, 1, device=device)
        self.denom = torch.zeros(n, 1, device=device)

    @property
    def num_gaussians(self):
        return self.means.shape[0]

    @property
    def opacities(self):
        return torch.sigmoid(self.opacities_raw)

    @property
    def scales_activated(self):
        return torch.exp(self.scales)

    @property
    def quats_normalized(self):
        return torch.nn.functional.normalize(self.quats, dim=-1)

    def get_shs(self, active_sh_degree: int):
        n_coeffs = (active_sh_degree + 1) ** 2 - 1
        if n_coeffs == 0:
            return self.sh_dc
        return torch.cat([self.sh_dc, self.sh_rest[:, :n_coeffs, :]], dim=1)


def train(
    model_dir: str,
    image_dir: str,
    output_path: str,
    config: TrainConfig | None = None,
):
    """Train 3D Gaussian Splatting model.

    Args:
        model_dir: Path to COLMAP sparse model
        image_dir: Path to undistorted images
        output_path: Where to save the trained .ply
        config: Training configuration
    """
    if config is None:
        config = TrainConfig()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        print("WARNING: Training on CPU will be extremely slow. GPU strongly recommended.")

    try:
        from gsplat.rendering import rasterization
        print("Using gsplat rasterizer")
        use_gsplat = True
    except ImportError:
        print("gsplat not available, using fallback rasterizer (slower)")
        use_gsplat = False

    # Load scene
    cameras, points3d, colors3d = load_colmap_scene(model_dir, image_dir)
    print(f"Loaded {len(cameras)} cameras, {len(points3d)} points")

    # Preload all images to GPU and precompute camera tensors
    print("Preloading images to GPU...")
    gt_images = []
    viewmats = []
    Ks = []
    for cam in cameras:
        gt_images.append(cam.load_image().to(device))
        viewmats.append(torch.tensor(cam.world_to_camera, dtype=torch.float32, device=device))
        Ks.append(torch.tensor(cam.K, dtype=torch.float32, device=device))

    # Compute scene extent for scale-aware densification
    scene_center = points3d.mean(axis=0)
    scene_extent = np.linalg.norm(points3d - scene_center, axis=1).max()
    print(f"Scene extent: {scene_extent:.3f}")

    # Initialize gaussian model
    model = GaussianModel(points3d, colors3d, device=device)

    # Optimizers - separate learning rates per parameter group
    # Position LR scaled by scene extent (matching reference impl)
    optimizer = torch.optim.Adam([
        {"params": [model.means], "lr": config.lr_position * scene_extent, "name": "means"},
        {"params": [model.sh_dc], "lr": config.lr_feature, "name": "sh_dc"},
        {"params": [model.sh_rest], "lr": config.lr_feature / 20.0, "name": "sh_rest"},
        {"params": [model.opacities_raw], "lr": config.lr_opacity, "name": "opacity"},
        {"params": [model.scales], "lr": config.lr_scaling, "name": "scaling"},
        {"params": [model.quats], "lr": config.lr_rotation, "name": "rotation"},
    ], eps=1e-15)

    # Position LR schedule: exponential decay, scaled by scene extent
    lr_init = config.lr_position * scene_extent
    lr_final = lr_init * 0.01

    def update_lr(step):
        t = step / config.iterations
        lr = lr_init * (lr_final / lr_init) ** t
        for pg in optimizer.param_groups:
            if pg["name"] == "means":
                pg["lr"] = lr

    active_sh_degree = 0
    l1_loss = nn.L1Loss()

    # Precompute SSIM window (reused every iteration)
    ssim_window = _make_ssim_window(window_size=11, channels=3, device=device)

    pbar = tqdm(range(1, config.iterations + 1), desc="Training")
    for step in pbar:
        # Random camera
        cam_idx = np.random.randint(len(cameras))
        gt_image = gt_images[cam_idx]
        H, W = gt_image.shape[:2]

        # Use precomputed camera matrices
        viewmat = viewmats[cam_idx]
        K = Ks[cam_idx]

        means2d = None
        radii_info = None
        if use_gsplat:
            renders, alphas, info = rasterization(
                means=model.means,
                quats=model.quats_normalized,
                scales=model.scales_activated,
                opacities=model.opacities,
                colors=model.get_shs(active_sh_degree),
                viewmats=viewmat.unsqueeze(0),
                Ks=K.unsqueeze(0),
                width=W,
                height=H,
                sh_degree=active_sh_degree,
                packed=False,
            )
            rendered = renders[0]
            # Track 2D means for viewspace gradient accumulation
            means2d = info.get("means2d", None)
            if means2d is not None and means2d.requires_grad:
                means2d.retain_grad()
            radii_info = info.get("radii", None)
        else:
            rendered = fallback_render(
                model, viewmat, K, W, H, active_sh_degree
            )

        # Loss: L1 + SSIM
        loss = (1 - config.ssim_weight) * l1_loss(rendered, gt_image)
        if config.ssim_weight > 0:
            loss = loss + config.ssim_weight * (1 - ssim(rendered, gt_image, window=ssim_window))

        loss.backward()

        with torch.no_grad():
            # Densification
            if config.densify_from < step < config.densify_until and use_gsplat:
                # Track max screen-space radii for pruning
                if radii_info is not None:
                    radii_flat = radii_info[0]  # remove batch dim
                    visible = radii_flat > 0
                    model.max_radii2d[visible] = torch.max(
                        model.max_radii2d[visible], radii_flat[visible].float()
                    )

                # Accumulate 2D viewspace gradients (matching reference impl)
                if means2d is not None and means2d.grad is not None:
                    grad_norms = means2d.grad[0].norm(dim=-1, keepdim=True)
                    if radii_info is not None:
                        model.xyz_gradient_accum[visible] += grad_norms[visible]
                        model.denom[visible] += 1
                    else:
                        model.xyz_gradient_accum += grad_norms
                        model.denom += 1
                else:
                    # Fallback to 3D gradients if 2D not available
                    grads = model.means.grad
                    if grads is not None:
                        grad_norms = grads.norm(dim=-1, keepdim=True)
                        model.xyz_gradient_accum += grad_norms
                        model.denom += 1

                # Densify/prune periodically using accumulated gradients
                if step % config.densify_every == 0:
                    avg_grads = model.xyz_gradient_accum / (model.denom + 1e-7)
                    mask = (avg_grads.squeeze() > config.densify_grad_thresh)

                    if mask.any():
                        densify(model, optimizer, mask, scene_extent)

                    # Prune low opacity, oversized, or screen-bloated gaussians
                    max_scales = model.scales_activated.max(dim=-1).values
                    prune_mask = (
                        (model.opacities < config.prune_opacity_thresh).squeeze()
                        | (max_scales > scene_extent * 0.1)
                    )
                    if step > config.opacity_reset_every:
                        prune_mask = prune_mask | (model.max_radii2d > 20)
                    if prune_mask.any():
                        prune_gaussians(model, optimizer, ~prune_mask)

                    model.xyz_gradient_accum.zero_()
                    model.denom.zero_()

            # Opacity reset: cap at 0.01, preserve lower values, reset Adam state
            if step % config.opacity_reset_every == 0 and step < config.densify_until:
                clamped = torch.min(model.opacities, torch.ones_like(model.opacities) * 0.01)
                model.opacities_raw.data.copy_(torch.log(clamped / (1 - clamped)))
                for group in optimizer.param_groups:
                    if group["name"] == "opacity":
                        param = group["params"][0]
                        if param in optimizer.state:
                            optimizer.state[param]["exp_avg"].zero_()
                            optimizer.state[param]["exp_avg_sq"].zero_()

            update_lr(step)
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)

            # Increase SH degree
            if step % config.sh_degree_interval == 0 and active_sh_degree < config.sh_degree:
                active_sh_degree += 1

        if step % 500 == 0:
            pbar.set_postfix(
                loss=f"{loss.item():.4f}",
                n_gaussians=model.num_gaussians,
                sh_deg=active_sh_degree,
            )

        # Checkpoint at 25%, 50%, 75% of training
        if step in (config.iterations // 4, config.iterations // 2, config.iterations * 3 // 4):
            ckpt_path = str(Path(output_path).parent / f"checkpoint_{step}.ply")
            save_ply(model, ckpt_path)
            print(f"\nCheckpoint saved: {ckpt_path} ({model.num_gaussians} gaussians)")

    # Save final
    save_ply(model, output_path)
    print(f"Saved trained model to {output_path} ({model.num_gaussians} gaussians)")
    return output_path


def densify(model, optimizer, grad_mask, scene_extent):
    """Densify gaussians: clone small ones, split large ones."""
    if not grad_mask.any():
        return

    # Separate into split (large) and clone (small) based on scale
    max_scales = model.scales_activated.data.max(dim=-1).values
    split_thresh = scene_extent * 0.01
    is_large = max_scales > split_thresh

    split_mask = grad_mask & is_large
    clone_mask = grad_mask & ~is_large

    all_new = []

    # Split: remove originals, add 2 smaller copies with rotation-aware noise
    if split_mask.any():
        means = model.means.data[split_mask]
        stds = model.scales_activated.data[split_mask]
        n_split = means.shape[0]
        # Sample noise in local frame, then rotate to world frame
        samples = torch.randn(n_split * 2, 3, device=model.device) * stds.repeat(2, 1)
        rots = build_rotation(model.quats.data[split_mask]).repeat(2, 1, 1)
        rotated_samples = torch.bmm(rots, samples.unsqueeze(-1)).squeeze(-1)
        all_new.append({
            "means": means.repeat(2, 1) + rotated_samples,
            "scales": model.scales.data[split_mask].repeat(2, 1) - math.log(1.6),
            "quats": model.quats.data[split_mask].repeat(2, 1),
            "opacities_raw": model.opacities_raw.data[split_mask].repeat(2),
            "sh_dc": model.sh_dc.data[split_mask].repeat(2, 1, 1),
            "sh_rest": model.sh_rest.data[split_mask].repeat(2, 1, 1),
        })

    # Clone: keep originals, add 1 copy at same scale
    if clone_mask.any():
        all_new.append({
            "means": model.means.data[clone_mask],
            "scales": model.scales.data[clone_mask],
            "quats": model.quats.data[clone_mask],
            "opacities_raw": model.opacities_raw.data[clone_mask],
            "sh_dc": model.sh_dc.data[clone_mask],
            "sh_rest": model.sh_rest.data[clone_mask],
        })

    if not all_new:
        return

    # Merge all new params
    merged = {}
    for key in all_new[0]:
        merged[key] = torch.cat([p[key] for p in all_new], dim=0)

    # Remove only split originals (keep clone originals)
    keep = ~split_mask
    _prune_and_append(model, optimizer, keep, merged)


def prune_gaussians(model, optimizer, keep_mask):
    """Remove gaussians by boolean mask."""
    _prune_and_append(model, optimizer, keep_mask, {})


def _prune_and_append(model, optimizer, keep_mask, new_params):
    """Helper to prune and optionally append new gaussians."""
    device = model.device

    # Map optimizer group names to model attribute names
    GROUP_TO_ATTR = {
        "means": "means",
        "sh_dc": "sh_dc",
        "sh_rest": "sh_rest",
        "opacity": "opacities_raw",
        "scaling": "scales",
        "rotation": "quats",
    }

    for group in optimizer.param_groups:
        name = group["name"]
        attr = GROUP_TO_ATTR[name]
        param = getattr(model, attr)
        stored = optimizer.state.get(param, {})

        new_data = param.data[keep_mask]
        if attr in new_params:
            new_data = torch.cat([new_data, new_params[attr]], dim=0)

        new_param = nn.Parameter(new_data)
        setattr(model, attr, new_param)
        group["params"] = [new_param]

        # Update optimizer state
        if stored:
            new_state = {}
            for k, v in stored.items():
                if isinstance(v, torch.Tensor) and v.dim() > 0 and v.shape[0] == keep_mask.shape[0]:
                    new_v = v[keep_mask]
                    if attr in new_params:
                        new_v = torch.cat([new_v, torch.zeros_like(new_params.get(attr, new_v[:0]))], dim=0)
                    new_state[k] = new_v
                else:
                    # Preserve scalars (e.g. step count)
                    new_state[k] = v
            optimizer.state[new_param] = new_state

    # Update auxiliary buffers
    n = model.means.shape[0]
    model.max_radii2d = torch.zeros(n, device=device)
    model.xyz_gradient_accum = torch.zeros(n, 1, device=device)
    model.denom = torch.zeros(n, 1, device=device)


def fallback_render(model, viewmat, K, W, H, active_sh_degree):
    """Simple point-based splatting fallback when gsplat is unavailable."""
    # Project points to screen
    means_h = torch.cat([model.means, torch.ones(model.num_gaussians, 1, device=model.device)], dim=-1)
    cam_points = (viewmat @ means_h.T).T[:, :3]  # Nx3

    # Filter points behind camera
    valid = cam_points[:, 2] > 0.1
    cam_points = cam_points[valid]
    opacities = model.opacities[valid]
    sh = model.get_shs(active_sh_degree)[valid]

    # Project to pixel coords
    fx, fy, cx, cy = K[0, 0], K[1, 1], K[0, 2], K[1, 2]
    px = (cam_points[:, 0] * fx / cam_points[:, 2] + cx).long()
    py = (cam_points[:, 1] * fy / cam_points[:, 2] + cy).long()

    # Simple splat: DC color only
    colors = sh[:, 0, :] * 0.2821 + 0.5  # SH DC to RGB
    colors = colors.clamp(0, 1)

    # Render via scatter (very basic, no proper splatting)
    image = torch.zeros(H, W, 3, device=model.device)
    mask = (px >= 0) & (px < W) & (py >= 0) & (py < H)
    px, py = px[mask], py[mask]
    c = colors[mask] * opacities[mask].unsqueeze(-1)
    image[py, px] = c

    return image


def _make_ssim_window(window_size: int = 11, channels: int = 3, device: str = "cuda"):
    """Create gaussian window for SSIM (call once, reuse every iteration)."""
    sigma = 1.5
    coords = torch.arange(window_size, dtype=torch.float32, device=device) - window_size // 2
    gauss = torch.exp(-coords ** 2 / (2 * sigma ** 2))
    gauss = gauss / gauss.sum()
    window_2d = gauss.unsqueeze(1) @ gauss.unsqueeze(0)
    return window_2d.unsqueeze(0).unsqueeze(0).expand(channels, 1, -1, -1).contiguous()


def ssim(img1, img2, window=None, window_size=11):
    """Compute SSIM between two images [H,W,3]. Pass precomputed window for speed."""
    img1 = img1.permute(2, 0, 1).unsqueeze(0)
    img2 = img2.permute(2, 0, 1).unsqueeze(0)
    C = img1.shape[1]

    if window is None:
        window = _make_ssim_window(window_size, C, img1.device)

    pad = window.shape[-1] // 2
    mu1 = torch.nn.functional.conv2d(img1, window, padding=pad, groups=C)
    mu2 = torch.nn.functional.conv2d(img2, window, padding=pad, groups=C)
    mu1_sq, mu2_sq = mu1 ** 2, mu2 ** 2
    mu1_mu2 = mu1 * mu2
    sigma1_sq = torch.nn.functional.conv2d(img1 * img1, window, padding=pad, groups=C) - mu1_sq
    sigma2_sq = torch.nn.functional.conv2d(img2 * img2, window, padding=pad, groups=C) - mu2_sq
    sigma12 = torch.nn.functional.conv2d(img1 * img2, window, padding=pad, groups=C) - mu1_mu2

    C1, C2 = 0.01 ** 2, 0.03 ** 2
    ssim_map = ((2 * mu1_mu2 + C1) * (2 * sigma12 + C2)) / \
               ((mu1_sq + mu2_sq + C1) * (sigma1_sq + sigma2_sq + C2))
    return ssim_map.mean()


def save_ply(model, path):
    """Save gaussian model as PLY file."""
    from plyfile import PlyData, PlyElement

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    means = model.means.detach().cpu().numpy()
    scales = model.scales.detach().cpu().numpy()
    quats = model.quats_normalized.detach().cpu().numpy()
    opacities = model.opacities_raw.detach().cpu().numpy()
    sh_dc = model.sh_dc.detach().cpu().numpy().squeeze(1)
    sh_rest = model.sh_rest.detach().cpu().numpy().reshape(len(means), -1)

    n = len(means)
    dtype = [
        ("x", "f4"), ("y", "f4"), ("z", "f4"),
        ("nx", "f4"), ("ny", "f4"), ("nz", "f4"),
    ]
    dtype += [(f"f_dc_{i}", "f4") for i in range(3)]
    dtype += [(f"f_rest_{i}", "f4") for i in range(sh_rest.shape[1])]
    dtype += [("opacity", "f4")]
    dtype += [(f"scale_{i}", "f4") for i in range(3)]
    dtype += [(f"rot_{i}", "f4") for i in range(4)]

    elements = np.empty(n, dtype=dtype)
    elements["x"] = means[:, 0]
    elements["y"] = means[:, 1]
    elements["z"] = means[:, 2]
    elements["nx"] = 0
    elements["ny"] = 0
    elements["nz"] = 0
    for i in range(3):
        elements[f"f_dc_{i}"] = sh_dc[:, i]
    for i in range(sh_rest.shape[1]):
        elements[f"f_rest_{i}"] = sh_rest[:, i]
    elements["opacity"] = opacities
    for i in range(3):
        elements[f"scale_{i}"] = scales[:, i]
    for i in range(4):
        elements[f"rot_{i}"] = quats[:, i]

    el = PlyElement.describe(elements, "vertex")
    PlyData([el]).write(str(path))

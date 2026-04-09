"""Export trained .ply to .splat format for the web viewer."""

from pathlib import Path

import numpy as np
from plyfile import PlyData


def ply_to_splat(ply_path: str, splat_path: str):
    """Convert gaussian splatting .ply to compact .splat binary format.

    .splat format (32 bytes per gaussian):
        position:  3 x float32 (12 bytes)
        scale:     3 x float32 (12 bytes)
        color:     4 x uint8 RGBA (4 bytes)
        rotation:  4 x uint8 normalized quaternion (4 bytes)
    """
    ply = PlyData.read(ply_path)
    vertex = ply["vertex"]
    n = len(vertex)

    # Extract fields
    x = vertex["x"].astype(np.float32)
    y = vertex["y"].astype(np.float32)
    z = vertex["z"].astype(np.float32)

    # Scales (log space in ply, convert to linear)
    sx = np.exp(vertex["scale_0"].astype(np.float32))
    sy = np.exp(vertex["scale_1"].astype(np.float32))
    sz = np.exp(vertex["scale_2"].astype(np.float32))

    # Rotation quaternion (w,x,y,z)
    rw = vertex["rot_0"].astype(np.float32)
    rx = vertex["rot_1"].astype(np.float32)
    ry = vertex["rot_2"].astype(np.float32)
    rz = vertex["rot_3"].astype(np.float32)
    # Normalize
    norm = np.sqrt(rw**2 + rx**2 + ry**2 + rz**2)
    rw /= norm; rx /= norm; ry /= norm; rz /= norm

    # SH DC to RGB color
    SH_C0 = 0.28209479177387814
    r = (0.5 + SH_C0 * vertex["f_dc_0"]).clip(0, 1)
    g = (0.5 + SH_C0 * vertex["f_dc_1"]).clip(0, 1)
    b = (0.5 + SH_C0 * vertex["f_dc_2"]).clip(0, 1)

    # Opacity (inverse sigmoid)
    opacity_raw = vertex["opacity"].astype(np.float32)
    a = (1.0 / (1.0 + np.exp(-opacity_raw))).clip(0, 1)

    # Filter out oversized or near-invisible gaussians
    max_scale = np.maximum(sx, np.maximum(sy, sz))
    scale_thresh = np.percentile(max_scale, 99) * 3  # adaptive threshold
    keep = (max_scale < scale_thresh) & (a > 5 / 255)
    n_removed = n - keep.sum()
    if n_removed > 0:
        print(f"Filtered {n_removed} outlier gaussians (oversized or invisible)")
        x, y, z = x[keep], y[keep], z[keep]
        sx, sy, sz = sx[keep], sy[keep], sz[keep]
        r, g, b, a = r[keep], g[keep], b[keep], a[keep]
        rw, rx, ry, rz = rw[keep], rx[keep], ry[keep], rz[keep]
        n = keep.sum()

    # Sort by scale (largest first) for better rendering order
    scale_mag = sx * sy * sz
    order = np.argsort(-scale_mag)

    # Apply sort order once
    x, y, z = x[order], y[order], z[order]
    sx, sy, sz = sx[order], sy[order], sz[order]
    r, g, b, a = r[order], g[order], b[order], a[order]
    rw, rx, ry, rz = rw[order], rx[order], ry[order], rz[order]

    # Build output buffer (32 bytes per gaussian) using structured numpy array
    dtype = np.dtype([
        ("px", "<f4"), ("py", "<f4"), ("pz", "<f4"),
        ("sx", "<f4"), ("sy", "<f4"), ("sz", "<f4"),
        ("r", "u1"), ("g", "u1"), ("b", "u1"), ("a", "u1"),
        ("qw", "u1"), ("qx", "u1"), ("qy", "u1"), ("qz", "u1"),
    ])
    buf = np.empty(n, dtype=dtype)
    buf["px"] = x; buf["py"] = y; buf["pz"] = z
    buf["sx"] = sx; buf["sy"] = sy; buf["sz"] = sz
    buf["r"] = np.clip(r * 255, 0, 255).astype(np.uint8)
    buf["g"] = np.clip(g * 255, 0, 255).astype(np.uint8)
    buf["b"] = np.clip(b * 255, 0, 255).astype(np.uint8)
    buf["a"] = np.clip(a * 255, 0, 255).astype(np.uint8)
    buf["qw"] = np.clip(rw * 128 + 128, 0, 255).astype(np.uint8)
    buf["qx"] = np.clip(rx * 128 + 128, 0, 255).astype(np.uint8)
    buf["qy"] = np.clip(ry * 128 + 128, 0, 255).astype(np.uint8)
    buf["qz"] = np.clip(rz * 128 + 128, 0, 255).astype(np.uint8)

    out = Path(splat_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    buf.tofile(str(out))

    print(f"Exported {n} gaussians to {out} ({out.stat().st_size / 1024 / 1024:.1f} MB)")

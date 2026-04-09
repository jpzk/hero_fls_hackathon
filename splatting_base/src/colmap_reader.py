"""Read COLMAP binary/text model files."""

import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image


@dataclass
class Camera:
    id: int
    width: int
    height: int
    K: np.ndarray  # 3x3 intrinsic matrix
    world_to_camera: np.ndarray  # 4x4 extrinsic matrix
    image_path: str

    def load_image(self):
        import torch
        img = Image.open(self.image_path).convert("RGB")
        return torch.tensor(np.array(img), dtype=torch.float32) / 255.0


def read_colmap_model(model_dir: str, image_dir: str):
    """Read COLMAP sparse model and return cameras + 3D points.

    Supports both binary and text format.
    """
    model_dir = Path(model_dir)
    image_dir = Path(image_dir)

    # Detect format
    if (model_dir / "cameras.bin").exists():
        cameras_raw = _read_cameras_binary(model_dir / "cameras.bin")
        images_raw = _read_images_binary(model_dir / "images.bin")
        points_raw = _read_points3d_binary(model_dir / "points3D.bin")
    elif (model_dir / "cameras.txt").exists():
        cameras_raw = _read_cameras_text(model_dir / "cameras.txt")
        images_raw = _read_images_text(model_dir / "images.txt")
        points_raw = _read_points3d_text(model_dir / "points3D.txt")
    else:
        raise FileNotFoundError(f"No COLMAP model found in {model_dir}")

    # Build Camera objects
    cameras = []
    for img_id, img_data in images_raw.items():
        cam_data = cameras_raw[img_data["camera_id"]]
        qvec = img_data["qvec"]
        tvec = img_data["tvec"]

        R = _qvec2rotmat(qvec)
        W2C = np.eye(4)
        W2C[:3, :3] = R
        W2C[:3, 3] = tvec

        K = _build_intrinsic(cam_data)

        img_path = image_dir / img_data["name"]
        if not img_path.exists():
            # Try images subfolder
            img_path = image_dir / "images" / img_data["name"]

        cameras.append(Camera(
            id=img_id,
            width=cam_data["width"],
            height=cam_data["height"],
            K=K,
            world_to_camera=W2C,
            image_path=str(img_path),
        ))

    # Extract 3D points and colors
    points = []
    colors = []
    for pt in points_raw.values():
        points.append(pt["xyz"])
        colors.append(pt["rgb"] / 255.0)

    points = np.array(points, dtype=np.float32)
    colors = np.array(colors, dtype=np.float32)

    return cameras, points, colors


def _build_intrinsic(cam):
    """Build 3x3 intrinsic matrix from COLMAP camera params."""
    model = cam["model"]
    params = cam["params"]
    w, h = cam["width"], cam["height"]
    K = np.eye(3)

    if model in ("SIMPLE_PINHOLE", "SIMPLE_RADIAL"):
        f, cx, cy = params[0], params[1], params[2]
        K[0, 0] = K[1, 1] = f
        K[0, 2] = cx
        K[1, 2] = cy
    elif model in ("PINHOLE", "OPENCV"):
        fx, fy, cx, cy = params[0], params[1], params[2], params[3]
        K[0, 0] = fx
        K[1, 1] = fy
        K[0, 2] = cx
        K[1, 2] = cy
    else:
        # Fallback: assume first param is focal length
        K[0, 0] = K[1, 1] = params[0]
        K[0, 2] = w / 2
        K[1, 2] = h / 2

    return K


def _qvec2rotmat(qvec):
    """Convert quaternion (w,x,y,z) to rotation matrix."""
    w, x, y, z = qvec
    return np.array([
        [1 - 2*y*y - 2*z*z, 2*x*y - 2*w*z, 2*x*z + 2*w*y],
        [2*x*y + 2*w*z, 1 - 2*x*x - 2*z*z, 2*y*z - 2*w*x],
        [2*x*z - 2*w*y, 2*y*z + 2*w*x, 1 - 2*x*x - 2*y*y],
    ])


# --- Binary readers ---

CAMERA_MODELS = {
    0: "SIMPLE_PINHOLE", 1: "PINHOLE", 2: "SIMPLE_RADIAL",
    3: "RADIAL", 4: "OPENCV", 5: "OPENCV_FISHEYE",
    6: "FULL_OPENCV", 7: "FOV", 8: "SIMPLE_RADIAL_FISHEYE",
    9: "RADIAL_FISHEYE", 10: "THIN_PRISM_FISHEYE",
}
CAMERA_NUM_PARAMS = {
    "SIMPLE_PINHOLE": 3, "PINHOLE": 4, "SIMPLE_RADIAL": 4,
    "RADIAL": 5, "OPENCV": 8, "OPENCV_FISHEYE": 8,
    "FULL_OPENCV": 12, "FOV": 5, "SIMPLE_RADIAL_FISHEYE": 4,
    "RADIAL_FISHEYE": 5, "THIN_PRISM_FISHEYE": 12,
}


def _read_cameras_binary(path):
    cameras = {}
    with open(path, "rb") as f:
        num = struct.unpack("<Q", f.read(8))[0]
        for _ in range(num):
            cam_id, model_id, width, height = struct.unpack("<IiQQ", f.read(24))
            model_name = CAMERA_MODELS[model_id]
            num_params = CAMERA_NUM_PARAMS[model_name]
            params = struct.unpack(f"<{num_params}d", f.read(8 * num_params))
            cameras[cam_id] = {
                "model": model_name, "width": width, "height": height,
                "params": list(params),
            }
    return cameras


def _read_images_binary(path):
    images = {}
    with open(path, "rb") as f:
        num = struct.unpack("<Q", f.read(8))[0]
        for _ in range(num):
            img_id = struct.unpack("<I", f.read(4))[0]
            qvec = struct.unpack("<4d", f.read(32))
            tvec = struct.unpack("<3d", f.read(24))
            cam_id = struct.unpack("<I", f.read(4))[0]
            name = b""
            while True:
                c = f.read(1)
                if c == b"\x00":
                    break
                name += c
            num_pts = struct.unpack("<Q", f.read(8))[0]
            f.read(num_pts * 24)  # skip 2D points
            images[img_id] = {
                "qvec": qvec, "tvec": tvec,
                "camera_id": cam_id, "name": name.decode("utf-8"),
            }
    return images


def _read_points3d_binary(path):
    points = {}
    with open(path, "rb") as f:
        num = struct.unpack("<Q", f.read(8))[0]
        for _ in range(num):
            pt_id = struct.unpack("<Q", f.read(8))[0]
            xyz = struct.unpack("<3d", f.read(24))
            rgb = struct.unpack("<3B", f.read(3))
            _error = struct.unpack("<d", f.read(8))[0]
            track_len = struct.unpack("<Q", f.read(8))[0]
            f.read(track_len * 8)  # skip track
            points[pt_id] = {"xyz": np.array(xyz), "rgb": np.array(rgb, dtype=np.float64)}
    return points


# --- Text readers ---

def _read_cameras_text(path):
    cameras = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            cam_id = int(parts[0])
            model = parts[1]
            width, height = int(parts[2]), int(parts[3])
            params = [float(p) for p in parts[4:]]
            cameras[cam_id] = {
                "model": model, "width": width, "height": height, "params": params,
            }
    return cameras


def _read_images_text(path):
    images = {}
    with open(path) as f:
        lines = [l.strip() for l in f if l.strip() and not l.startswith("#")]
    for i in range(0, len(lines), 2):
        parts = lines[i].split()
        img_id = int(parts[0])
        qvec = tuple(float(x) for x in parts[1:5])
        tvec = tuple(float(x) for x in parts[5:8])
        cam_id = int(parts[8])
        name = parts[9]
        images[img_id] = {
            "qvec": qvec, "tvec": tvec, "camera_id": cam_id, "name": name,
        }
    return images


def _read_points3d_text(path):
    points = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            pt_id = int(parts[0])
            xyz = np.array([float(parts[1]), float(parts[2]), float(parts[3])])
            rgb = np.array([float(parts[4]), float(parts[5]), float(parts[6])])
            points[pt_id] = {"xyz": xyz, "rgb": rgb}
    return points

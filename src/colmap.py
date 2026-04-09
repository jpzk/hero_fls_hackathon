"""COLMAP Structure-from-Motion wrapper."""

import shutil
import subprocess
from pathlib import Path


def _colmap_cmd(args: list[str]):
    """Run COLMAP, using xvfb-run if available for headless GPU support."""
    if shutil.which("xvfb-run"):
        cmd = ["xvfb-run", "-a"] + args
    else:
        cmd = args
    subprocess.run(cmd, check=True)


def run_colmap(image_dir: str, workspace: str, gpu_index: str = "0") -> str:
    """Run COLMAP feature extraction, matching, and sparse reconstruction.

    Returns path to the sparse model directory.
    """
    ws = Path(workspace)
    db_path = ws / "database.db"
    sparse_dir = ws / "sparse"
    sparse_dir.mkdir(parents=True, exist_ok=True)

    print("COLMAP: Feature extraction (GPU)...")
    _colmap_cmd([
        "colmap", "feature_extractor",
        "--database_path", str(db_path),
        "--image_path", image_dir,
        "--ImageReader.single_camera", "1",
        "--ImageReader.camera_model", "OPENCV",
        "--SiftExtraction.use_gpu", "1",
        "--SiftExtraction.gpu_index", gpu_index,
    ])

    print("COLMAP: Feature matching (GPU)...")
    _colmap_cmd([
        "colmap", "sequential_matcher",
        "--database_path", str(db_path),
        "--SiftMatching.use_gpu", "1",
        "--SiftMatching.gpu_index", gpu_index,
    ])

    print("COLMAP: Sparse reconstruction...")
    _colmap_cmd([
        "colmap", "mapper",
        "--database_path", str(db_path),
        "--image_path", image_dir,
        "--output_path", str(sparse_dir),
    ])

    # Pick the reconstruction with the most images (largest images.bin)
    candidates = sorted(sparse_dir.iterdir())
    if not candidates:
        raise RuntimeError("COLMAP reconstruction failed - no model produced")

    model_dir = candidates[0]
    best_size = 0
    for c in candidates:
        img_bin = c / "images.bin"
        img_txt = c / "images.txt"
        sz = img_bin.stat().st_size if img_bin.exists() else (img_txt.stat().st_size if img_txt.exists() else 0)
        if sz > best_size:
            best_size = sz
            model_dir = c

    print(f"COLMAP: Sparse model at {model_dir}")
    return str(model_dir)


def undistort_images(image_dir: str, sparse_model: str, workspace: str) -> str:
    """Undistort images using COLMAP camera model.

    Returns path to undistorted images directory.
    """
    output = Path(workspace) / "undistorted"
    output.mkdir(parents=True, exist_ok=True)

    _colmap_cmd([
        "colmap", "image_undistorter",
        "--image_path", image_dir,
        "--input_path", sparse_model,
        "--output_path", str(output),
        "--output_type", "COLMAP",
    ])

    print(f"COLMAP: Undistorted images at {output}")
    return str(output)

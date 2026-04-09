#!/usr/bin/env python3
"""Gaussian Splatting Pipeline: Video -> 3D Gaussian Splat.

Usage:
    python pipeline.py <video_path> [--output <dir>] [--fps 2] [--iterations 30000]

Steps:
    1. Extract frames from video (ffmpeg)
    2. Run COLMAP Structure-from-Motion
    3. Train 3D Gaussian Splatting
    4. Export to .ply and .splat formats
"""

import argparse
import shutil
import sys
from datetime import datetime
from pathlib import Path


def check_dependencies():
    missing = []
    if not shutil.which("ffmpeg"):
        missing.append("ffmpeg")
    if not shutil.which("colmap"):
        missing.append("colmap (install via apt or build from source)")
    try:
        import torch
        if not torch.cuda.is_available():
            print("WARNING: CUDA not available. Training will be extremely slow.")
    except ImportError:
        missing.append("torch (pip install torch)")
    try:
        import numpy
    except ImportError:
        missing.append("numpy")

    if missing:
        print("Missing dependencies:")
        for m in missing:
            print(f"  - {m}")
        print("\nRun: pip install -r requirements.txt")
        print("For COLMAP, see Dockerfile or install from https://colmap.github.io/")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Video to Gaussian Splat pipeline")
    parser.add_argument("video", help="Path to input video")
    parser.add_argument("--output", "-o", default="output", help="Output directory")
    parser.add_argument("--fps", type=int, default=2, help="Frames per second to extract")
    parser.add_argument("--max-frames", type=int, default=300, help="Max frames to extract")
    parser.add_argument("--iterations", type=int, default=30_000, help="Training iterations")
    parser.add_argument("--resolution", type=int, default=1600, help="Max image resolution")
    parser.add_argument("--skip-frames", action="store_true", help="Skip frame extraction")
    parser.add_argument("--skip-colmap", action="store_true", help="Skip COLMAP (use existing)")
    parser.add_argument("--skip-train", action="store_true", help="Skip training")
    args = parser.parse_args()

    check_dependencies()

    video_path = Path(args.video).resolve()
    if not video_path.exists():
        print(f"Video not found: {video_path}")
        sys.exit(1)

    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%H%M")
    frames_dir = out / "frames"
    colmap_ws = out / "colmap"
    model_path = out / f"output_{timestamp}.ply"
    splat_path = out / f"output_{timestamp}.splat"

    # Step 1: Extract frames
    if not args.skip_frames:
        print("\n=== Step 1/4: Extracting frames ===")
        from src.frames import extract_frames
        extract_frames(
            str(video_path), str(frames_dir),
            fps=args.fps, max_frames=args.max_frames,
            resolution=args.resolution,
        )
    else:
        print("Skipping frame extraction")

    # Step 2: COLMAP SfM
    if not args.skip_colmap:
        print("\n=== Step 2/4: Running COLMAP SfM ===")
        from src.colmap import run_colmap, undistort_images
        sparse_model = run_colmap(str(frames_dir), str(colmap_ws))
        undistorted = undistort_images(str(frames_dir), sparse_model, str(colmap_ws))
    else:
        print("Skipping COLMAP")
        sparse_model = str(colmap_ws / "sparse" / "0")
        undistorted = str(colmap_ws / "undistorted")

    # Step 3: Train
    if not args.skip_train:
        print("\n=== Step 3/4: Training 3D Gaussian Splatting ===")
        from src.train import train, TrainConfig
        config = TrainConfig(iterations=args.iterations)
        # Use the undistorted sparse model (has correct intrinsics for undistorted images)
        undistorted_sparse = str(Path(undistorted) / "sparse")
        train_model_dir = undistorted_sparse if Path(undistorted_sparse).exists() else sparse_model
        image_dir = str(Path(undistorted) / "images") if Path(undistorted, "images").exists() else str(frames_dir)
        train(train_model_dir, image_dir, str(model_path), config)
    else:
        print("Skipping training")

    # Step 4: Export to .splat
    print("\n=== Step 4/4: Exporting to .splat format ===")
    if model_path.exists():
        from src.export import ply_to_splat
        ply_to_splat(str(model_path), str(splat_path))
    else:
        print(f"No model found at {model_path}, skipping export")

    print(f"\n=== Done ===")
    print(f"PLY:   {model_path}")
    print(f"Splat: {splat_path}")
    print(f"\nTo view: cd viewer && bun dev")
    print(f"Then drag & drop the .ply or .splat file into the viewer")


if __name__ == "__main__":
    main()

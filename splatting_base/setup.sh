#!/bin/bash
set -e

echo "=== Gaussian Splatting Pipeline Setup ==="

# Check system dependencies
echo ""
echo "Checking system tools..."
for cmd in ffmpeg python3 pip3; do
    if command -v $cmd &>/dev/null; then
        echo "  [ok] $cmd"
    else
        echo "  [!!] $cmd not found"
    fi
done

if command -v colmap &>/dev/null; then
    echo "  [ok] colmap"
else
    echo "  [!!] colmap not found (needed for SfM, or use Docker)"
fi

if command -v nvidia-smi &>/dev/null; then
    echo "  [ok] GPU: $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
else
    echo "  [!!] No GPU detected (training requires CUDA - use RunPod)"
fi

# Python dependencies
echo ""
echo "Installing Python dependencies..."
pip3 install -r requirements.txt

# Viewer dependencies
echo ""
echo "Setting up viewer..."
cd viewer
bun install
cd ..

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To run the full pipeline (requires GPU + COLMAP):"
echo "  python3 pipeline.py path/to/video.mp4 --output output/"
echo ""
echo "To run on RunPod (recommended):"
echo "  docker build -t gsplat ."
echo "  # Push to registry, create RunPod pod, run pipeline"
echo ""
echo "To launch the viewer:"
echo "  cd viewer && bun dev"
echo "  # Open http://localhost:3000 and drop in a .ply or .splat file"

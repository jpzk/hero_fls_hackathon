# Gaussian Splatting Pipeline

Video-to-3D-gaussian-splat pipeline with a WebGL viewer.

## Architecture

```
video.mp4 --> [ffmpeg] --> frames/ --> [COLMAP SfM] --> sparse model --> [gsplat training] --> .ply --> .splat
                                                                                                        |
                                                                                         viewer (bun + WebGL)
```

### Pipeline (Python, GPU)

4-stage pipeline orchestrated by `pipeline.py`:

| Stage | Module | Tool | Output |
|-------|--------|------|--------|
| 1. Frame extraction | `src/frames.py` | ffmpeg | `output/frames/frame_*.jpg` |
| 2. Structure-from-Motion | `src/colmap.py` | COLMAP (GPU) | `output/colmap/sparse/0/` |
| 3. 3DGS training | `src/train.py` | gsplat + PyTorch CUDA | `output/point_cloud.ply` |
| 4. Export | `src/export.py` | plyfile | `output/point_cloud.splat` |

Supporting module: `src/colmap_reader.py` -- reads COLMAP binary/text model formats (cameras, images, points3D).

### Viewer (TypeScript, Bun)

WebGL gaussian splat renderer in `viewer/`.

| File | Role |
|------|------|
| `viewer/src/main.ts` | Entry point, drag-drop/file-picker/URL loading |
| `viewer/src/renderer.ts` | WebGL splat renderer |
| `viewer/src/loader.ts` | .ply and .splat file parsers |
| `viewer/src/camera.ts` | Orbit camera controls |
| `viewer/src/dev.ts` | Bun dev server with hot rebuild (port 3000) |

## Infrastructure

### Local requirements

- Python 3.10+, CUDA GPU, ffmpeg, COLMAP
- Bun (viewer)

### Docker

`Dockerfile` builds on `nvidia/cuda:12.1.1-devel-ubuntu22.04`:
- Compiles COLMAP 3.9.1 from source with CUDA arch 70-90
- Installs ffmpeg, Python deps
- Entrypoint: `python3 pipeline.py`

### RunPod deployment

`runpod.py` provisions a GPU pod (default RTX 4090) and prints SSH/SCP commands to:
1. Upload video to pod
2. Run pipeline
3. Download .ply/.splat results

Requires `RUNPOD_API_KEY` env var. Docker image must be pushed to a registry first (placeholder: `your-registry/gsplat:latest`).

### GPU types supported

RTX 4090, RTX 4080, RTX 3090, RTX A6000, A100 80GB

## Commands

```sh
# Setup
./setup.sh

# Run pipeline (needs GPU + COLMAP)
python3 pipeline.py video.mp4 -o output/ --fps 2 --iterations 30000

# Run on RunPod
python runpod.py video.mp4 --gpu 4090

# Viewer
cd viewer && bun dev   # http://localhost:3000

# Docker
docker build -t gsplat .
```

## Key details

- Training uses gsplat rasterizer with fallback to naive point projection if gsplat unavailable
- SH degree ramps from 0 to 3 during training (1000-step intervals)
- Densification: split high-gradient gaussians, prune low-opacity ones (steps 500-15000)
- .splat format: 32 bytes/gaussian (pos + scale + RGBA + quat), sorted by scale magnitude
- COLMAP reader supports both binary and text model formats
- Viewer supports loading via drag-drop, file picker, or `?url=` query param

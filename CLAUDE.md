# Splatting — 3D Job Site Documentation

Multi-experiment repo for video-to-3D gaussian splatting with AI object detection for trades businesses.

## Structure

- `3dgs/` — main 3D Gaussian Splatting codebase (original Inria code + customizations)
- `viewer_overlays/` — WebGL2 splat viewer with 3D overlays and AI detection (TypeScript/Bun)
- `detect_server/` — Python FastAPI server running YOLOv8 for object detection + 3D back-projection

## Running Locally

```bash
# Terminal 1: Detection server
cd detect_server
source venv/bin/activate
uvicorn server:app --host 0.0.0.0 --port 8100

# Terminal 2: Viewer
cd viewer_overlays
PORT=3002 bun run src/dev.ts
```

Open `http://localhost:3002`, load a `.splat` file, click the detect button (magnifying glass icon) in the toolbar.

## Architecture

```
Browser (viewer_overlays)          Bun Dev Server (:3002)         Python (:8100)
───────────────────────           ─────────────────────          ──────────────
Click "Detect" button
 → capture current view    →     POST /api/detect        →     YOLOv8 inference
   (canvas PNG + matrices)        (proxy to Python)             Back-project 2D→3D
                                                                Trade suggestions
 ← 3D boxes + labels      ←     JSON response            ←    Return detections
   rendered as overlays
```

## Key Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Viewer server port |
| `DETECT_SERVER` | `http://localhost:8100` | Python YOLO server URL |
| `API_PROXY` | (empty) | Remote API proxy (e.g. RunPod URL) |
| `SPLAT_DIR` | `/root/splatting/3dgs/output` | Directory to scan for .splat/.ply files |
| `PIPELINE_DIR` | `/root/splatting/3dgs` | Path to 3dgs/ with Makefile for training |

## Important Notes

- **NEVER delete or `rm -rf` the `output/` folder on production** — it contains previous training results
- Output files use `output_HHMM.{ply,splat}` naming to avoid overwriting
- The `/api/detect` route always goes to the local Python server, even when `API_PROXY` is set
- Detection uses the current camera view — what you see is what gets detected
- Box sizes are clamped to 40% of scene radius to prevent oversized boxes

## Production

- Host: `root@103.196.86.242` (SSH port 19620)
- SSH: `ssh root@103.196.86.242 -p 19620 -i ~/.ssh/id_ed25519`
- Repo: `/root/splatting`
- Deploy key: `~/.ssh/splatting_deploy_key` (read-only)
- Pull: `cd /root/splatting && git pull`
- Viewer: `https://ldk7adzmca00ve-3002.proxy.runpod.net/`

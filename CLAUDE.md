# Splatting

Multi-experiment repo for video-to-3D gaussian splatting.

## Structure

- `3dgs/` — main 3D Gaussian Splatting codebase (original Inria code + customizations)

## Production

- Host: `root@103.196.86.242` (SSH port 19620)
- SSH: `ssh root@103.196.86.242 -p 19620 -i ~/.ssh/id_ed25519`
- Repo: `/workspace/splatting`
- Deploy key: `~/.ssh/splatting_deploy_key` (read-only)
- Pull: `cd /workspace/splatting && git pull`
- Viewer: `https://ldk7adzmca00ve-3002.proxy.runpod.net/`
- **NEVER delete or `rm -rf` the `output/` folder on production** — it contains previous training results. Output files use `output_HHMM.{ply,splat}` naming to avoid overwriting.

## Required Environment Variables (Production)

Add to `/root/.bashrc` (does not persist across pod reprovisions):

```sh
export PYTHONPATH=/workspace/libs:$PYTHONPATH
export PIP_TARGET=/workspace/libs
```

- `PYTHONPATH` — Python packages are stored in `/workspace/libs` (persists across restarts)
- `PIP_TARGET` — ensures `pip install` installs to `/workspace/libs`

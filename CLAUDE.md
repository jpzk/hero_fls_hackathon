# Splatting

Multi-experiment repo for video-to-3D gaussian splatting.

## Structure

- `splatting_base/` — canonical template with the full pipeline + viewer
- Experiments are copies of `splatting_base/` run independently

See `splatting_base/CLAUDE.md` for pipeline architecture, commands, and key details.

## Production

- Host: `root@103.196.86.242` (SSH port 19965)
- SSH: `ssh root@103.196.86.242 -p 19965 -i ~/.ssh/id_ed25519`
- Repo: `/opt/splatting`
- Deploy key: `~/.ssh/splatting_deploy_key` (read-only)
- Pull: `cd /opt/splatting && git pull`

"""Extract frames from video using ffmpeg."""

import subprocess
import os
from pathlib import Path


def extract_frames(
    video_path: str,
    output_dir: str,
    fps: int = 2,
    max_frames: int = 300,
    resolution: int = 1600,
) -> list[str]:
    """Extract frames from video at given fps, capped at max_frames.

    Returns list of extracted frame paths.
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    # Probe video duration/fps to estimate total frames
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", video_path],
        capture_output=True, text=True
    )

    # Extract at target fps, resize longest edge, limit frame count
    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-vf", f"fps={fps},scale='if(gt(iw,ih),{resolution},-2)':'if(gt(iw,ih),-2,{resolution})'",
        "-frames:v", str(max_frames),
        "-q:v", "1",
        str(out / "frame_%05d.jpg"),
    ]
    subprocess.run(cmd, check=True, capture_output=True)

    frames = sorted(out.glob("frame_*.jpg"))
    print(f"Extracted {len(frames)} frames to {out}")
    return [str(f) for f in frames]

"""Export trained .ply to .splat format for the web viewer."""

import struct
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

    # Sort by scale (largest first) for better rendering order
    scale_mag = sx * sy * sz
    order = np.argsort(-scale_mag)

    out = Path(splat_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    clamp = lambda v: max(0, min(255, int(v)))

    with open(out, "wb") as f:
        for i in order:
            f.write(struct.pack("<fff", x[i], y[i], z[i]))
            f.write(struct.pack("<fff", sx[i], sy[i], sz[i]))
            f.write(struct.pack("<BBBB",
                clamp(r[i] * 255), clamp(g[i] * 255),
                clamp(b[i] * 255), clamp(a[i] * 255)))
            f.write(struct.pack("<BBBB",
                clamp(rw[i] * 128 + 128), clamp(rx[i] * 128 + 128),
                clamp(ry[i] * 128 + 128), clamp(rz[i] * 128 + 128)))

    print(f"Exported {n} gaussians to {out} ({out.stat().st_size / 1024 / 1024:.1f} MB)")

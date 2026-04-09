/**
 * Gaussian Splat file loaders (.ply and .splat formats)
 *
 * .splat format: 32 bytes per gaussian
 *   position:  3 x f32  (12 bytes)
 *   scale:     3 x f32  (12 bytes)
 *   color:     4 x u8   (4 bytes) RGBA
 *   rotation:  4 x u8   (4 bytes) quaternion mapped [0,255] -> [-1,1]
 *
 * .ply format: Standard 3DGS output with SH coefficients
 */

export interface SplatData {
  count: number;
  positions: Float32Array;   // 3 * count
  scales: Float32Array;      // 3 * count
  colors: Uint8Array;        // 4 * count (RGBA)
  rotations: Float32Array;   // 4 * count (quaternion wxyz)
}

export function loadSplat(buffer: ArrayBuffer): SplatData {
  const count = buffer.byteLength / 32;
  const f32 = new Float32Array(buffer);
  const u8 = new Uint8Array(buffer);

  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 4);
  const rotations = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    const fOff = i * 8; // 32 bytes / 4 = 8 floats per splat
    const bOff = i * 32;

    // Position
    positions[i * 3] = f32[fOff];
    positions[i * 3 + 1] = f32[fOff + 1];
    positions[i * 3 + 2] = f32[fOff + 2];

    // Scale
    scales[i * 3] = f32[fOff + 3];
    scales[i * 3 + 1] = f32[fOff + 4];
    scales[i * 3 + 2] = f32[fOff + 5];

    // Color RGBA
    colors[i * 4] = u8[bOff + 24];
    colors[i * 4 + 1] = u8[bOff + 25];
    colors[i * 4 + 2] = u8[bOff + 26];
    colors[i * 4 + 3] = u8[bOff + 27];

    // Rotation: uint8 [0,255] -> float [-1,1]
    rotations[i * 4] = (u8[bOff + 28] - 128) / 128;
    rotations[i * 4 + 1] = (u8[bOff + 29] - 128) / 128;
    rotations[i * 4 + 2] = (u8[bOff + 30] - 128) / 128;
    rotations[i * 4 + 3] = (u8[bOff + 31] - 128) / 128;
  }

  return { count, positions, scales, colors, rotations };
}

export function loadPly(buffer: ArrayBuffer): SplatData {
  const text = new TextDecoder();
  const bytes = new Uint8Array(buffer);

  // Parse header
  let headerEnd = 0;
  for (let i = 0; i < bytes.length - 10; i++) {
    if (bytes[i] === 0x65 && bytes[i + 1] === 0x6e && bytes[i + 2] === 0x64 &&
        bytes[i + 3] === 0x5f && bytes[i + 4] === 0x68 && bytes[i + 5] === 0x65 &&
        bytes[i + 6] === 0x61 && bytes[i + 7] === 0x64 && bytes[i + 8] === 0x65 &&
        bytes[i + 9] === 0x72) {
      // Find newline after "end_header"
      headerEnd = i + 10;
      while (headerEnd < bytes.length && bytes[headerEnd] !== 0x0a) headerEnd++;
      headerEnd++;
      break;
    }
  }

  const header = text.decode(bytes.slice(0, headerEnd));
  const lines = header.split("\n").map(l => l.trim());

  let vertexCount = 0;
  const properties: { name: string; type: string }[] = [];

  for (const line of lines) {
    if (line.startsWith("element vertex")) {
      vertexCount = parseInt(line.split(" ")[2]);
    } else if (line.startsWith("property")) {
      const parts = line.split(" ");
      properties.push({ type: parts[1], name: parts[2] });
    }
  }

  // Map property names to indices
  const propIndex: Record<string, number> = {};
  properties.forEach((p, i) => propIndex[p.name] = i);

  // Calculate stride
  let stride = 0;
  for (const p of properties) {
    stride += p.type === "double" ? 8 : 4;
  }

  const data = new DataView(buffer, headerEnd);
  const positions = new Float32Array(vertexCount * 3);
  const scales = new Float32Array(vertexCount * 3);
  const colors = new Uint8Array(vertexCount * 4);
  const rotations = new Float32Array(vertexCount * 4);

  const SH_C0 = 0.28209479177387814;

  // Build offset map
  const offsets: number[] = [];
  let off = 0;
  for (const p of properties) {
    offsets.push(off);
    off += p.type === "double" ? 8 : 4;
  }

  const getFloat = (vertexOffset: number, propName: string): number => {
    const idx = propIndex[propName];
    if (idx === undefined) return 0;
    const o = vertexOffset + offsets[idx];
    return properties[idx].type === "double"
      ? data.getFloat64(o, true)
      : data.getFloat32(o, true);
  };

  for (let i = 0; i < vertexCount; i++) {
    const vo = i * stride;

    // Position
    positions[i * 3] = getFloat(vo, "x");
    positions[i * 3 + 1] = getFloat(vo, "y");
    positions[i * 3 + 2] = getFloat(vo, "z");

    // Scale (stored as log in ply)
    scales[i * 3] = Math.exp(getFloat(vo, "scale_0"));
    scales[i * 3 + 1] = Math.exp(getFloat(vo, "scale_1"));
    scales[i * 3 + 2] = Math.exp(getFloat(vo, "scale_2"));

    // Color from SH DC coefficients
    const r = Math.max(0, Math.min(255, (0.5 + SH_C0 * getFloat(vo, "f_dc_0")) * 255));
    const g = Math.max(0, Math.min(255, (0.5 + SH_C0 * getFloat(vo, "f_dc_1")) * 255));
    const b = Math.max(0, Math.min(255, (0.5 + SH_C0 * getFloat(vo, "f_dc_2")) * 255));

    // Opacity from raw sigmoid input
    const opacityRaw = getFloat(vo, "opacity");
    const a = 1.0 / (1.0 + Math.exp(-opacityRaw));

    colors[i * 4] = r;
    colors[i * 4 + 1] = g;
    colors[i * 4 + 2] = b;
    colors[i * 4 + 3] = a * 255;

    // Rotation quaternion (w,x,y,z)
    const qw = getFloat(vo, "rot_0");
    const qx = getFloat(vo, "rot_1");
    const qy = getFloat(vo, "rot_2");
    const qz = getFloat(vo, "rot_3");
    const qlen = Math.sqrt(qw * qw + qx * qx + qy * qy + qz * qz);
    rotations[i * 4] = qw / qlen;
    rotations[i * 4 + 1] = qx / qlen;
    rotations[i * 4 + 2] = qy / qlen;
    rotations[i * 4 + 3] = qz / qlen;
  }

  return { count: vertexCount, positions, scales, colors, rotations };
}

export function detectAndLoad(buffer: ArrayBuffer, filename: string): SplatData {
  if (filename.endsWith(".splat")) {
    return loadSplat(buffer);
  }
  if (filename.endsWith(".ply")) {
    return loadPly(buffer);
  }
  // Try to detect by checking for PLY magic
  const header = new TextDecoder().decode(new Uint8Array(buffer, 0, 4));
  if (header === "ply\n" || header === "ply\r") {
    return loadPly(buffer);
  }
  // Default to splat
  return loadSplat(buffer);
}

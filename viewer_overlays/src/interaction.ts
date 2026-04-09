import type { OrbitCamera } from "./camera";
import type { Overlay } from "./overlays";

export interface Ray {
  origin: [number, number, number];
  dir: [number, number, number];
}

export function screenToRay(
  x: number, y: number,
  width: number, height: number,
  camera: OrbitCamera,
): Ray {
  const ndcX = (x / width) * 2 - 1;
  const ndcY = 1 - (y / height) * 2;

  const aspect = width / height;
  const proj = camera.getProjectionMatrix(aspect);
  const view = camera.getViewMatrix();

  const vp = mat4Mul(proj, view);
  const ivp = mat4Invert(vp);

  const near = transformPoint(ivp, [ndcX, ndcY, -1]);
  const far = transformPoint(ivp, [ndcX, ndcY, 1]);

  const dir: [number, number, number] = [
    far[0] - near[0], far[1] - near[1], far[2] - near[2],
  ];
  const len = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2);
  dir[0] /= len; dir[1] /= len; dir[2] /= len;

  return { origin: near, dir };
}

export function rayBoxIntersect(
  ray: Ray,
  center: [number, number, number],
  halfExtents: [number, number, number],
): number | null {
  const min = [center[0] - halfExtents[0], center[1] - halfExtents[1], center[2] - halfExtents[2]];
  const max = [center[0] + halfExtents[0], center[1] + halfExtents[1], center[2] + halfExtents[2]];

  let tmin = -Infinity;
  let tmax = Infinity;

  for (let i = 0; i < 3; i++) {
    if (Math.abs(ray.dir[i]) < 1e-8) {
      if (ray.origin[i] < min[i] || ray.origin[i] > max[i]) return null;
    } else {
      let t1 = (min[i] - ray.origin[i]) / ray.dir[i];
      let t2 = (max[i] - ray.origin[i]) / ray.dir[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }

  return tmin > 0 ? tmin : (tmax > 0 ? tmax : null);
}

export function rayBoxFace(
  ray: Ray,
  center: [number, number, number],
  halfExtents: [number, number, number],
): { face: number; t: number } | null {
  const faces = [
    { axis: 0, sign:  1 },
    { axis: 0, sign: -1 },
    { axis: 1, sign:  1 },
    { axis: 1, sign: -1 },
    { axis: 2, sign:  1 },
    { axis: 2, sign: -1 },
  ];

  let bestT = Infinity;
  let bestFace = -1;

  for (let fi = 0; fi < 6; fi++) {
    const { axis, sign } = faces[fi];
    const planeVal = center[axis] + sign * halfExtents[axis];
    const denom = ray.dir[axis];
    if (Math.abs(denom) < 1e-8) continue;

    const t = (planeVal - ray.origin[axis]) / denom;
    if (t < 0 || t >= bestT) continue;

    const hitPoint = [
      ray.origin[0] + ray.dir[0] * t,
      ray.origin[1] + ray.dir[1] * t,
      ray.origin[2] + ray.dir[2] * t,
    ];

    let inside = true;
    for (let i = 0; i < 3; i++) {
      if (i === axis) continue;
      if (Math.abs(hitPoint[i] - center[i]) > halfExtents[i] + 1e-4) {
        inside = false;
        break;
      }
    }

    if (inside) {
      bestT = t;
      bestFace = fi;
    }
  }

  return bestFace >= 0 ? { face: bestFace, t: bestT } : null;
}

export function pickOverlay(
  overlays: Overlay[],
  ray: Ray,
): number {
  let bestDist = Infinity;
  let bestIdx = -1;

  for (let i = 0; i < overlays.length; i++) {
    const o = overlays[i];
    if (o.type !== "box") continue;

    const t = rayBoxIntersect(ray, o.center, o.halfExtents);
    if (t !== null && t < bestDist) {
      bestDist = t;
      bestIdx = i;
    }
  }

  return bestIdx;
}

export type DragMode = "none" | "move" | "resize";

export interface DragState {
  mode: DragMode;
  overlayIndex: number;
  face: number;
  startPoint: [number, number, number];
  startCenter: [number, number, number];
  startHalfExtents: [number, number, number];
}

export function beginDrag(
  overlays: Overlay[],
  ray: Ray,
  selectedIndex: number,
): DragState | null {
  if (selectedIndex < 0) return null;
  const o = overlays[selectedIndex];
  if (o.type !== "box") return null;

  const faceHit = rayBoxFace(ray, o.center, o.halfExtents);
  if (!faceHit) return null;

  const hitPoint: [number, number, number] = [
    ray.origin[0] + ray.dir[0] * faceHit.t,
    ray.origin[1] + ray.dir[1] * faceHit.t,
    ray.origin[2] + ray.dir[2] * faceHit.t,
  ];

  return {
    mode: "resize",
    overlayIndex: selectedIndex,
    face: faceHit.face,
    startPoint: hitPoint,
    startCenter: [...o.center] as [number, number, number],
    startHalfExtents: [...o.halfExtents] as [number, number, number],
  };
}

export function updateDrag(
  drag: DragState,
  overlays: Overlay[],
  ray: Ray,
): void {
  const o = overlays[drag.overlayIndex];
  if (o.type !== "box") return;

  const axis = drag.face >> 1;
  const sign = (drag.face & 1) ? -1 : 1;

  const denom = ray.dir[axis];
  if (Math.abs(denom) < 1e-8) return;
  const t = (drag.startPoint[axis] - ray.origin[axis]) / denom;
  if (t < 0) return;

  const currentPoint = ray.origin[axis] + ray.dir[axis] * t;
  const delta = currentPoint - drag.startPoint[axis];

  const newHalfExtent = Math.max(0.01, drag.startHalfExtents[axis] + delta * sign);
  const centerShift = (newHalfExtent - drag.startHalfExtents[axis]) * sign * 0.5;

  o.halfExtents[axis] = newHalfExtent;
  o.center[axis] = drag.startCenter[axis] + centerShift;
}

function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      out[j * 4 + i] =
        a[0 * 4 + i] * b[j * 4 + 0] +
        a[1 * 4 + i] * b[j * 4 + 1] +
        a[2 * 4 + i] * b[j * 4 + 2] +
        a[3 * 4 + i] * b[j * 4 + 3];
  return out;
}

function mat4Invert(m: Float32Array): Float32Array {
  const out = new Float32Array(16);
  const [
    m00, m01, m02, m03,
    m10, m11, m12, m13,
    m20, m21, m22, m23,
    m30, m31, m32, m33,
  ] = m;

  const b00 = m00 * m11 - m01 * m10;
  const b01 = m00 * m12 - m02 * m10;
  const b02 = m00 * m13 - m03 * m10;
  const b03 = m01 * m12 - m02 * m11;
  const b04 = m01 * m13 - m03 * m11;
  const b05 = m02 * m13 - m03 * m12;
  const b06 = m20 * m31 - m21 * m30;
  const b07 = m20 * m32 - m22 * m30;
  const b08 = m20 * m33 - m23 * m30;
  const b09 = m21 * m32 - m22 * m31;
  const b10 = m21 * m33 - m23 * m31;
  const b11 = m22 * m33 - m23 * m32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-10) return new Float32Array(16);
  det = 1 / det;

  out[0]  = (m11 * b11 - m12 * b10 + m13 * b09) * det;
  out[1]  = (m02 * b10 - m01 * b11 - m03 * b09) * det;
  out[2]  = (m31 * b05 - m32 * b04 + m33 * b03) * det;
  out[3]  = (m22 * b04 - m21 * b05 - m23 * b03) * det;
  out[4]  = (m12 * b08 - m10 * b11 - m13 * b07) * det;
  out[5]  = (m00 * b11 - m02 * b08 + m03 * b07) * det;
  out[6]  = (m32 * b02 - m30 * b05 - m33 * b01) * det;
  out[7]  = (m20 * b05 - m22 * b02 + m23 * b01) * det;
  out[8]  = (m10 * b10 - m11 * b08 + m13 * b06) * det;
  out[9]  = (m01 * b08 - m00 * b10 - m03 * b06) * det;
  out[10] = (m30 * b04 - m31 * b02 + m33 * b00) * det;
  out[11] = (m21 * b02 - m20 * b04 - m23 * b00) * det;
  out[12] = (m11 * b07 - m10 * b09 - m12 * b06) * det;
  out[13] = (m00 * b09 - m01 * b07 + m02 * b06) * det;
  out[14] = (m31 * b01 - m30 * b03 - m32 * b00) * det;
  out[15] = (m20 * b03 - m21 * b01 + m22 * b00) * det;

  return out;
}

function transformPoint(mat: Float32Array, p: [number, number, number]): [number, number, number] {
  const w = mat[3] * p[0] + mat[7] * p[1] + mat[11] * p[2] + mat[15];
  return [
    (mat[0] * p[0] + mat[4] * p[1] + mat[8]  * p[2] + mat[12]) / w,
    (mat[1] * p[0] + mat[5] * p[1] + mat[9]  * p[2] + mat[13]) / w,
    (mat[2] * p[0] + mat[6] * p[1] + mat[10] * p[2] + mat[14]) / w,
  ];
}

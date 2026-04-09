# Viewer Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve the gaussian splat viewer with interactive box overlays, alpha/scale heatmap diagnostics, visual polish, and splat data repair.

**Architecture:** Six tasks, roughly ordered by dependency and impact. Tasks 1-2 are foundational (fix data, improve rendering). Task 3-4 add interactivity via a new `interaction.ts` module that handles raycasting and drag. Task 5 adds heatmap mode via shader uniforms. Task 6 adds load-time anomaly warnings. All changes stay within the existing Bun + WebGL2 stack.

**Tech Stack:** TypeScript, WebGL2, Bun dev server (no build framework, no test framework)

---

### Task 1: Splat Data Repair & Load-Time Warnings

Fix the `better_pov.splat` issue (all alphas = 2, huge scales) by detecting anomalies at load time and auto-repairing.

**Files:**
- Modify: `src/loader.ts` (add `repairSplatData` function)
- Modify: `src/main.ts:45-66` (call repair after load, show warnings)
- Modify: `index.html` (add toast notification CSS)

**Step 1: Add anomaly detection and repair to loader.ts**

Add after the `SplatData` interface (line 19):

```typescript
export interface SplatWarnings {
  constantAlpha: number | null;  // if all alphas are same value
  hugeScaleCount: number;        // gaussians with scale > 10
  zeroAlphaCount: number;        // invisible gaussians
}

export function analyzeSplatData(data: SplatData): SplatWarnings {
  const colors = data.colors;
  const scales = data.scales;
  const count = data.count;

  let firstAlpha = colors[3];
  let allSameAlpha = true;
  let hugeScaleCount = 0;
  let zeroAlphaCount = 0;

  for (let i = 0; i < count; i++) {
    const a = colors[i * 4 + 3];
    if (a !== firstAlpha) allSameAlpha = false;
    if (a === 0) zeroAlphaCount++;

    const sx = scales[i * 3];
    const sy = scales[i * 3 + 1];
    const sz = scales[i * 3 + 2];
    if (Math.max(Math.abs(sx), Math.abs(sy), Math.abs(sz)) > 10) hugeScaleCount++;
  }

  return {
    constantAlpha: allSameAlpha ? firstAlpha : null,
    hugeScaleCount,
    zeroAlphaCount,
  };
}

export function repairSplatData(data: SplatData, warnings: SplatWarnings): void {
  const count = data.count;

  // Fix constant low alpha: remap to full range
  if (warnings.constantAlpha !== null && warnings.constantAlpha < 10) {
    for (let i = 0; i < count; i++) {
      data.colors[i * 4 + 3] = 200; // reasonable default opacity
    }
  }

  // Fix huge scales: clamp to reasonable range
  if (warnings.hugeScaleCount > 0) {
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 3; c++) {
        const idx = i * 3 + c;
        if (Math.abs(data.scales[idx]) > 5) {
          data.scales[idx] = Math.sign(data.scales[idx]) * 5;
        }
      }
    }
  }
}
```

**Step 2: Wire up warnings and repair in main.ts**

Replace `loadFile` function (lines 45-66) with:

```typescript
function loadFile(buffer: ArrayBuffer, filename: string) {
  const overlay = document.getElementById("overlay")!;
  overlay.style.display = "none";

  const statusEl = document.getElementById("status")!;
  statusEl.textContent = "Loading...";
  statusEl.style.display = "block";

  setTimeout(() => {
    try {
      const data = detectAndLoad(buffer, filename);
      const warnings = analyzeSplatData(data);

      // Show warnings and auto-repair
      const msgs: string[] = [];
      if (warnings.constantAlpha !== null && warnings.constantAlpha < 10) {
        msgs.push(`All alphas = ${warnings.constantAlpha}/255 (nearly invisible) — auto-repaired`);
      }
      if (warnings.hugeScaleCount > 0) {
        msgs.push(`${warnings.hugeScaleCount} gaussians with scale > 10 — clamped`);
      }
      if (warnings.zeroAlphaCount > 0) {
        msgs.push(`${warnings.zeroAlphaCount} fully transparent gaussians`);
      }

      if (msgs.length > 0) {
        repairSplatData(data, warnings);
        showToast(msgs.join("\n"), "warning");
      }

      renderer.loadSplatData(data);
      stats.gaussians = data.count;
      statusEl.style.display = "none";
      updateStats();
      addSceneOverlays(data);
    } catch (e: any) {
      statusEl.textContent = `Error: ${e.message}`;
      console.error(e);
    }
  }, 16);
}
```

Add import for `analyzeSplatData, repairSplatData` from `./loader`.

**Step 3: Add toast notification system**

Add to main.ts:

```typescript
function showToast(message: string, type: "warning" | "info" = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.whiteSpace = "pre-line";
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}
```

Add CSS to index.html:

```css
.toast {
  position: fixed;
  top: 60px;
  left: 50%;
  transform: translateX(-50%) translateY(-20px);
  background: rgba(30, 30, 40, 0.95);
  border: 1px solid rgba(255, 200, 50, 0.4);
  color: #ffd666;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 0.85em;
  z-index: 100;
  opacity: 0;
  transition: opacity 0.3s, transform 0.3s;
  max-width: 500px;
  text-align: center;
  backdrop-filter: blur(10px);
}
.toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
.toast-warning { border-color: rgba(255, 200, 50, 0.4); color: #ffd666; }
.toast-info { border-color: rgba(80, 120, 255, 0.4); color: #7aa2ff; }
```

**Step 4: Run and verify**

```bash
bun dev
```

Load `better_pov.splat` — should see warning toast and the splat should now be visible.

**Step 5: Commit**

```bash
git add src/loader.ts src/main.ts index.html
git commit -m "feat: add splat data analysis, auto-repair, and load-time warnings"
```

---

### Task 2: Visual Polish for Box Overlays (Filled Faces + Better Edges)

Upgrade wireframe-only boxes to have semi-transparent filled faces, making them look like proper 3D volumes.

**Files:**
- Modify: `src/overlays.ts:264-293` (buildBox method — add triangle faces)
- Modify: `src/overlays.ts:120-158` (render method — enable depth test for overlays)

**Step 1: Add filled faces to buildBox**

Replace the `buildBox` method in overlays.ts:

```typescript
private buildBox(o: OverlayBox, lineVerts: number[], lineColors: number[],
                 triVerts: number[], triColors: number[]) {
  const [cx, cy, cz] = o.center;
  const [hx, hy, hz] = o.halfExtents;
  const rot = o.rotationY ?? 0;

  let corners: [number, number, number][] = [
    [cx - hx, cy - hy, cz - hz], // 0: left  bottom front
    [cx + hx, cy - hy, cz - hz], // 1: right bottom front
    [cx + hx, cy + hy, cz - hz], // 2: right top    front
    [cx - hx, cy + hy, cz - hz], // 3: left  top    front
    [cx - hx, cy - hy, cz + hz], // 4: left  bottom back
    [cx + hx, cy - hy, cz + hz], // 5: right bottom back
    [cx + hx, cy + hy, cz + hz], // 6: right top    back
    [cx - hx, cy + hy, cz + hz], // 7: left  top    back
  ];

  if (rot !== 0) {
    corners = corners.map(p => this.rotateY(p, rot, o.center));
  }

  // 12 wireframe edges
  const edges = [
    [0,1],[1,2],[2,3],[3,0],
    [4,5],[5,6],[6,7],[7,4],
    [0,4],[1,5],[2,6],[3,7],
  ];
  for (const [a, b] of edges) {
    this.pushLine(lineVerts, lineColors, corners[a], corners[b], o.color);
  }

  // 6 filled faces (semi-transparent)
  const fc: [number, number, number, number] = [
    o.color[0], o.color[1], o.color[2], o.color[3] * 0.15
  ];
  const faces = [
    [0,1,2,3], // front
    [5,4,7,6], // back
    [4,0,3,7], // left
    [1,5,6,2], // right
    [3,2,6,7], // top
    [4,5,1,0], // bottom
  ];
  for (const [a,b,c,d] of faces) {
    this.pushTri(triVerts, triColors, corners[a], corners[b], corners[c], fc);
    this.pushTri(triVerts, triColors, corners[a], corners[c], corners[d], fc);
  }
}
```

**Step 2: Update buildBox call site to pass tri arrays**

In `buildGeometry()` (line 170), change the box case from:
```typescript
this.buildBox(o, lineVerts, lineColors);
```
to:
```typescript
this.buildBox(o, lineVerts, lineColors, triVerts, triColors);
```

**Step 3: Run and verify**

```bash
bun dev
```

Boxes should now show semi-transparent faces with wireframe edges on top.

**Step 4: Commit**

```bash
git add src/overlays.ts
git commit -m "feat: add filled semi-transparent faces to box overlays"
```

---

### Task 3: Box Selection via Raycasting

Add click-to-select for box overlays. Selected box gets a highlight.

**Files:**
- Create: `src/interaction.ts` (raycasting, hit testing, selection state)
- Modify: `src/overlays.ts` (add `selected` flag, highlight color)
- Modify: `src/main.ts` (wire up click handler)
- Modify: `src/camera.ts` (expose inverse view-proj for unprojection)

**Step 1: Create interaction.ts with ray-box intersection**

```typescript
import type { OrbitCamera } from "./camera";
import type { Overlay, OverlayBox } from "./overlays";

export interface Ray {
  origin: [number, number, number];
  dir: [number, number, number];
}

/** Unproject screen pixel to world-space ray */
export function screenToRay(
  x: number, y: number,
  width: number, height: number,
  camera: OrbitCamera,
): Ray {
  // Normalized device coords
  const ndcX = (x / width) * 2 - 1;
  const ndcY = 1 - (y / height) * 2; // flip Y

  const aspect = width / height;
  const proj = camera.getProjectionMatrix(aspect);
  const view = camera.getViewMatrix();

  // Invert view-projection
  const vp = mat4Mul(proj, view);
  const ivp = mat4Invert(vp);

  // Near and far points
  const near = transformPoint(ivp, [ndcX, ndcY, -1]);
  const far = transformPoint(ivp, [ndcX, ndcY, 1]);

  const dir: [number, number, number] = [
    far[0] - near[0], far[1] - near[1], far[2] - near[2],
  ];
  const len = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2);
  dir[0] /= len; dir[1] /= len; dir[2] /= len;

  return { origin: near, dir };
}

/** Ray-AABB intersection, returns distance or null */
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

/** Returns which face of an AABB the ray hits first: +x,-x,+y,-y,+z,-z or null */
export function rayBoxFace(
  ray: Ray,
  center: [number, number, number],
  halfExtents: [number, number, number],
): { face: number; t: number } | null {
  const faces = [
    { axis: 0, sign:  1 }, // +X (right)
    { axis: 0, sign: -1 }, // -X (left)
    { axis: 1, sign:  1 }, // +Y (top)
    { axis: 1, sign: -1 }, // -Y (bottom)
    { axis: 2, sign:  1 }, // +Z (back)
    { axis: 2, sign: -1 }, // -Z (front)
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

    // Check if hit point is within the face bounds
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

/** Hit-test all overlays, return index of closest hit box or -1 */
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

// --- Matrix utilities ---

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
  if (Math.abs(det) < 1e-10) return new Float32Array(16); // degenerate
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
```

**Step 2: Add selected state to overlay rendering**

In overlays.ts, add a `selectedIndex` field to `OverlayRenderer`:

```typescript
// Add to OverlayRenderer class
selectedIndex: number = -1;
```

Modify `buildBox` to emit brighter wireframe and more opaque fill when `selectedIndex` matches:

Check `this.overlays.indexOf(o) === this.selectedIndex` to determine if the current box should render as selected (thicker-looking edges via doubled lines, brighter fill alpha of 0.3 instead of 0.15).

**Step 3: Wire up click handler in main.ts**

```typescript
import { screenToRay, pickOverlay } from "./interaction";

// In init(), after setupOverlayPanel():
canvas.addEventListener("click", (e) => {
  if (e.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const x = (e.clientX - rect.left) * dpr;
  const y = (e.clientY - rect.top) * dpr;
  const ray = screenToRay(x, y, canvas.width, canvas.height, renderer.camera);
  const idx = pickOverlay(renderer.overlayRenderer.overlays, ray);
  renderer.overlayRenderer.selectedIndex = idx;
});

// ESC to deselect
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    renderer.overlayRenderer.selectedIndex = -1;
  }
});
```

**Step 4: Run and verify**

Click on a box overlay. It should highlight. Click empty space or ESC to deselect.

**Step 5: Commit**

```bash
git add src/interaction.ts src/overlays.ts src/main.ts
git commit -m "feat: add box selection via raycasting"
```

---

### Task 4: Interactive Box Dragging (Move + Resize)

Drag selected box faces to resize, drag center region to move.

**Files:**
- Modify: `src/interaction.ts` (add drag state machine)
- Modify: `src/main.ts` (wire up mousedown/mousemove/mouseup for drag)
- Modify: `src/camera.ts:32-58` (prevent camera orbit during box drag)

**Step 1: Add drag state to interaction.ts**

```typescript
export type DragMode = "none" | "move" | "resize";

export interface DragState {
  mode: DragMode;
  overlayIndex: number;
  face: number;         // which face for resize (0-5: +x,-x,+y,-y,+z,-z)
  startPoint: [number, number, number]; // world hit point at drag start
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

/** Project current mouse ray onto the drag plane, update overlay */
export function updateDrag(
  drag: DragState,
  overlays: Overlay[],
  ray: Ray,
): void {
  const o = overlays[drag.overlayIndex];
  if (o.type !== "box") return;

  // Drag plane: the plane of the face being dragged
  // face 0,1 => axis 0 (X), face 2,3 => axis 1 (Y), face 4,5 => axis 2 (Z)
  const axis = drag.face >> 1;          // 0,1,2
  const sign = (drag.face & 1) ? -1 : 1; // even=+, odd=-

  // Intersect ray with the plane perpendicular to the drag axis through the start point
  const denom = ray.dir[axis];
  if (Math.abs(denom) < 1e-8) return;
  const t = (drag.startPoint[axis] - ray.origin[axis]) / denom;
  if (t < 0) return;

  const currentPoint = ray.origin[axis] + ray.dir[axis] * t;
  const delta = currentPoint - drag.startPoint[axis];

  // Resize: move the face along its axis
  const newHalfExtent = Math.max(0.01, drag.startHalfExtents[axis] + delta * sign);
  // Shift center so opposite face stays fixed
  const centerShift = (newHalfExtent - drag.startHalfExtents[axis]) * sign * 0.5;

  o.halfExtents[axis] = newHalfExtent;
  o.center[axis] = drag.startCenter[axis] + centerShift;
}
```

**Step 2: Wire up drag events in main.ts**

```typescript
import { screenToRay, pickOverlay, beginDrag, updateDrag, type DragState } from "./interaction";

let dragState: DragState | null = null;

// Replace the click handler with mousedown/mousemove/mouseup:
canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const x = (e.clientX - rect.left) * dpr;
  const y = (e.clientY - rect.top) * dpr;
  const ray = screenToRay(x, y, canvas.width, canvas.height, renderer.camera);

  // If we have a selected box, try to start drag
  const sel = renderer.overlayRenderer.selectedIndex;
  if (sel >= 0) {
    dragState = beginDrag(renderer.overlayRenderer.overlays, ray, sel);
    if (dragState) {
      renderer.camera.enabled = false; // prevent orbit during drag
      return;
    }
  }

  // Otherwise, try to select
  const idx = pickOverlay(renderer.overlayRenderer.overlays, ray);
  renderer.overlayRenderer.selectedIndex = idx;
});

canvas.addEventListener("mousemove", (e) => {
  if (!dragState) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const x = (e.clientX - rect.left) * dpr;
  const y = (e.clientY - rect.top) * dpr;
  const ray = screenToRay(x, y, canvas.width, canvas.height, renderer.camera);
  updateDrag(dragState, renderer.overlayRenderer.overlays, ray);
});

canvas.addEventListener("mouseup", () => {
  if (dragState) {
    dragState = null;
    renderer.camera.enabled = true;
  }
});
```

**Step 3: Add `enabled` flag to camera.ts**

Add to OrbitCamera class:

```typescript
enabled = true;
```

Guard all mouse handlers:

```typescript
private onMouseDown = (e: MouseEvent) => {
  if (!this.enabled) return;
  // ... existing code
};
private onMouseMove = (e: MouseEvent) => {
  if (!this.enabled) return;
  // ... existing code
};
```

**Step 4: Change cursor on hover over selected box face**

In the mousemove handler, when not dragging, check if hovering over a selected box face and set cursor to `ew-resize` / `ns-resize` / `grab`.

**Step 5: Run and verify**

Select a box, then drag a face to resize it. The opposite face should stay fixed.

**Step 6: Commit**

```bash
git add src/interaction.ts src/main.ts src/camera.ts
git commit -m "feat: add interactive box drag-to-resize"
```

---

### Task 5: Alpha/Scale Heatmap Mode

Add a shader-based heatmap that color-codes gaussians by their alpha or scale values.

**Files:**
- Modify: `src/renderer.ts:263-399` (vertex + fragment shaders — add heatmap uniform and color ramp)
- Modify: `src/renderer.ts:652-671` (render — set heatmap uniform)
- Modify: `src/main.ts` (add heatmap toggle buttons to UI)
- Modify: `index.html` (heatmap button CSS)

**Step 1: Modify vertex shader to pass raw alpha/scale to fragment**

In VERTEX_SHADER, add:

```glsl
uniform int u_heatmapMode; // 0=off, 1=alpha, 2=scale
out float v_heatValue;
```

In main() of vertex shader, after fetching `rgba` and `scale`:

```glsl
if (u_heatmapMode == 1) {
    v_heatValue = rgba.a;  // alpha [0,1] in u8 -> [0,255]/255
} else if (u_heatmapMode == 2) {
    v_heatValue = clamp(length(scale) / 2.0, 0.0, 1.0); // normalized scale magnitude
} else {
    v_heatValue = -1.0;
}
```

**Step 2: Modify fragment shader to use heatmap color ramp**

In FRAGMENT_SHADER, add:

```glsl
in float v_heatValue;

vec3 heatmapColor(float t) {
    // Blue -> Cyan -> Green -> Yellow -> Red
    t = clamp(t, 0.0, 1.0);
    if (t < 0.25) return mix(vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 1.0), t * 4.0);
    if (t < 0.5)  return mix(vec3(0.0, 1.0, 1.0), vec3(0.0, 1.0, 0.0), (t - 0.25) * 4.0);
    if (t < 0.75) return mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), (t - 0.5) * 4.0);
    return mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), (t - 0.75) * 4.0);
}
```

In fragment main(), replace the final color computation:

```glsl
vec3 rgb = v_heatValue >= 0.0 ? heatmapColor(v_heatValue) : v_color.rgb;
fragColor = vec4(rgb * alpha, alpha);
```

**Step 3: Set uniform in render()**

Add to SplatRenderer class:

```typescript
heatmapMode: number = 0; // 0=off, 1=alpha, 2=scale
```

In render(), after setting other uniforms:

```typescript
gl.uniform1i(loc("u_heatmapMode"), this.heatmapMode);
```

**Step 4: Add heatmap toggle buttons to UI**

In main.ts, add heatmap controls to the overlay panel:

```typescript
function setupHeatmapControls() {
  const panel = document.getElementById("overlay-panel-wrap")!;
  const section = document.createElement("div");
  section.style.cssText = "margin-top:12px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08)";

  const header = document.createElement("div");
  header.textContent = "HEATMAP";
  header.style.cssText = "font-size:0.8em;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px";
  section.appendChild(header);

  const modes = [
    { label: "Off", value: 0 },
    { label: "Alpha", value: 1 },
    { label: "Scale", value: 2 },
  ];

  for (const mode of modes) {
    const btn = document.createElement("button");
    btn.textContent = mode.label;
    btn.className = "heatmap-btn" + (mode.value === 0 ? " active" : "");
    btn.addEventListener("click", () => {
      renderer.heatmapMode = mode.value;
      section.querySelectorAll(".heatmap-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
    section.appendChild(btn);
  }

  panel.appendChild(section);
}
```

Add CSS for heatmap buttons in index.html:

```css
.heatmap-btn {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  color: #999;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.8em;
  cursor: pointer;
  margin-right: 4px;
}
.heatmap-btn.active {
  background: rgba(80, 120, 255, 0.25);
  border-color: rgba(80, 120, 255, 0.5);
  color: #7aa2ff;
}
```

**Step 5: Run and verify**

Load bonsai.splat, toggle Alpha heatmap — should see color variations. Load better_pov.splat (before repair) — should be uniform blue (all alpha=2).

**Step 6: Commit**

```bash
git add src/renderer.ts src/main.ts index.html
git commit -m "feat: add alpha/scale heatmap visualization mode"
```

---

### Task 6: UI Polish and Cursor Feedback

Final polish: cursor changes, better overlay panel, keyboard shortcuts.

**Files:**
- Modify: `src/main.ts` (cursor logic, keyboard shortcuts)
- Modify: `index.html` (updated CSS)
- Modify: `src/overlays.ts` (selected box visual: doubled edges for thickness)

**Step 1: Add cursor feedback for box interaction**

In the mousemove handler (non-drag case), check if hovering over a selected box:

```typescript
// In mousemove, after drag check:
if (renderer.overlayRenderer.selectedIndex >= 0) {
  const ray = screenToRay(x, y, canvas.width, canvas.height, renderer.camera);
  const o = renderer.overlayRenderer.overlays[renderer.overlayRenderer.selectedIndex];
  if (o.type === "box") {
    const faceHit = rayBoxFace(ray, o.center, o.halfExtents);
    if (faceHit) {
      const axis = faceHit.face >> 1;
      canvas.style.cursor = axis === 1 ? "ns-resize" : "ew-resize";
    } else {
      canvas.style.cursor = "grab";
    }
  }
} else {
  canvas.style.cursor = "grab";
}
```

**Step 2: Add keyboard shortcut hints**

Update the controls-hint div to include: `Click: select | Drag face: resize | ESC: deselect`

**Step 3: Selected box rendering with doubled edges**

In overlays.ts `buildBox`, when `this.selectedIndex` matches the overlay index, add a small offset copy of each edge line to create a "thicker" wireframe effect:

```typescript
const isSelected = this.overlays.indexOf(o) === this.selectedIndex;
const lineColor: [number, number, number, number] = isSelected
  ? [1, 0.8, 0.2, 1]   // gold highlight
  : o.color;
const fillAlpha = isSelected ? 0.25 : 0.15;
```

**Step 4: Run full integration test**

```bash
bun dev
```

1. Load bonsai.splat — should render with box overlay
2. Click box — should highlight gold
3. Drag face — should resize
4. Toggle heatmap — should color-code by alpha
5. Load better_pov.splat — should show warning toast, auto-repair, render visible
6. ESC — should deselect

**Step 5: Commit**

```bash
git add src/main.ts src/overlays.ts index.html
git commit -m "feat: add cursor feedback, keyboard shortcuts, and selection highlight"
```

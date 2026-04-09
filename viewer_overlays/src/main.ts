/**
 * Gaussian Splat Viewer with Overlay Support
 *
 * Extends the base viewer with 3D visual indicators:
 * rectangles, boxes, circles, lines, and points.
 */

import { SplatRenderer } from "./renderer";
import { detectAndLoad, analyzeSplatData, repairSplatData, type SplatData } from "./loader";
import type { Overlay } from "./overlays";

let renderer: SplatRenderer;
let stats: { fps: number; gaussians: number } = { fps: 0, gaussians: 0 };
let frameCount = 0;
let lastFpsTime = performance.now();

function init() {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  renderer = new SplatRenderer(canvas);

  // Render loop
  function frame() {
    renderer.render();

    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime > 1000) {
      stats.fps = Math.round(frameCount * 1000 / (now - lastFpsTime));
      frameCount = 0;
      lastFpsTime = now;
      updateStats();
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Setup file loading
  setupDragDrop(canvas);
  setupFilePicker();
  setupOverlayPanel();
  checkUrlParam();
}

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
      const msgs: string[] = [];
      if (warnings.constantAlpha !== null && warnings.constantAlpha < 10) {
        msgs.push(`All alpha = ${warnings.constantAlpha}/255 — boosted to 200`);
      }
      if (warnings.hugeScaleCount > 0) {
        msgs.push(`${warnings.hugeScaleCount} splats with scale > 10 — clamped to 5`);
      }
      if (warnings.zeroAlphaCount > 0) {
        msgs.push(`${warnings.zeroAlphaCount} splats with zero alpha`);
      }

      if (msgs.length > 0) {
        repairSplatData(data, warnings);
        showToast("Auto-repaired:\n" + msgs.join("\n"), "warning");
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

/** Add default overlays based on loaded scene bounds */
function addSceneOverlays(data: SplatData) {
  const count = data.count;
  const pos = data.positions;

  // Compute bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const hx = (maxX - minX) / 2;
  const hy = (maxY - minY) / 2;
  const hz = (maxZ - minZ) / 2;

  const overlays: Overlay[] = [
    // Bounding box of the entire scene
    {
      type: "box",
      center: [cx, cy, cz],
      halfExtents: [hx, hy, hz],
      color: [0.3, 0.8, 1.0, 0.6],
    },
    // Ground plane rectangle
    {
      type: "rect",
      center: [cx, minY, cz],
      size: [hx * 2.2, hz * 2.2],
      color: [0.2, 1.0, 0.4, 0.4],
      filled: true,
      plane: "xz",
    },
    // Center point marker
    {
      type: "point",
      position: [cx, cy, cz],
      color: [1.0, 1.0, 0.0, 1.0],
      size: Math.max(hx, hy, hz) * 0.15,
    },
    // Horizontal ring around center
    {
      type: "circle",
      center: [cx, cy, cz],
      radius: Math.max(hx, hz) * 0.5,
      color: [1.0, 0.4, 0.8, 0.7],
      axis: "y",
    },
  ];

  renderer.overlayRenderer.overlays = overlays;

  // Update panel checkboxes
  syncPanelToOverlays();
}

// Overlay panel state
const overlayVisibility: Record<string, boolean> = {
  "Bounding Box": true,
  "Ground Plane": true,
  "Center Point": true,
  "Center Ring": true,
};

function syncPanelToOverlays() {
  const panel = document.getElementById("overlay-panel");
  if (!panel) return;
  // Re-render checkboxes
  const items = panel.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
  items.forEach(cb => {
    const label = cb.dataset.label!;
    cb.checked = overlayVisibility[label] ?? true;
  });
}

function applyVisibility() {
  if (!renderer) return;
  const all = renderer.overlayRenderer.overlays;
  const labels = Object.keys(overlayVisibility);
  // Each overlay corresponds to a label by index
  for (let i = 0; i < labels.length && i < all.length; i++) {
    // We store all overlays but filter when rendering
    // Simpler: just set color alpha to 0 for hidden ones
  }
  // Rebuild the visible list
  const fullSet = (renderer as any)._allOverlays as Overlay[] | undefined;
  if (fullSet) {
    const labels = Object.keys(overlayVisibility);
    renderer.overlayRenderer.overlays = fullSet.filter((_, i) =>
      overlayVisibility[labels[i]] !== false
    );
  }
}

function setupOverlayPanel() {
  const panel = document.getElementById("overlay-panel")!;
  const labels = Object.keys(overlayVisibility);

  for (const label of labels) {
    const row = document.createElement("label");
    row.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 0";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.dataset.label = label;
    cb.addEventListener("change", () => {
      overlayVisibility[label] = cb.checked;
      // Save full set on first toggle
      if (!(renderer as any)._allOverlays) {
        (renderer as any)._allOverlays = [...renderer.overlayRenderer.overlays];
      }
      applyVisibility();
    });
    row.appendChild(cb);
    row.appendChild(document.createTextNode(label));
    panel.appendChild(row);
  }
}

function updateStats() {
  const el = document.getElementById("stats")!;
  if (stats.gaussians > 0) {
    const countStr = stats.gaussians > 1_000_000
      ? `${(stats.gaussians / 1_000_000).toFixed(1)}M`
      : stats.gaussians > 1_000
        ? `${(stats.gaussians / 1_000).toFixed(0)}K`
        : `${stats.gaussians}`;
    el.textContent = `${countStr} splats | ${stats.fps} fps`;
    el.style.display = "block";
  }
}

function setupDragDrop(canvas: HTMLCanvasElement) {
  const overlay = document.getElementById("overlay")!;

  document.addEventListener("dragover", (e) => {
    e.preventDefault();
    overlay.classList.add("drag-active");
  });
  document.addEventListener("dragleave", () => {
    overlay.classList.remove("drag-active");
  });
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    overlay.classList.remove("drag-active");
    const file = e.dataTransfer?.files[0];
    if (file) {
      const buffer = await file.arrayBuffer();
      loadFile(buffer, file.name);
    }
  });
}

function setupFilePicker() {
  const btn = document.getElementById("file-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".ply,.splat";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (file) {
          const buffer = await file.arrayBuffer();
          loadFile(buffer, file.name);
        }
      };
      input.click();
    });
  }
}

async function checkUrlParam() {
  const params = new URLSearchParams(window.location.search);
  const url = params.get("url");
  if (url) {
    const overlay = document.getElementById("overlay")!;
    overlay.innerHTML = `<div class="loading-text">Loading from URL...</div>`;

    try {
      const resp = await fetch(url);
      const buffer = await resp.arrayBuffer();
      const filename = url.split("/").pop() || "model.splat";
      loadFile(buffer, filename);
    } catch (e: any) {
      overlay.innerHTML = `<div class="error-text">Failed to load: ${e.message}</div>`;
    }
  }
}

// Start when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

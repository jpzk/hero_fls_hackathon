/**
 * Gaussian Splat Viewer - Entry Point
 *
 * Supports drag-and-drop of .ply and .splat files,
 * URL loading via ?url= query parameter,
 * and file picker.
 */

import { SplatRenderer } from "./renderer";
import { detectAndLoad, type SplatData } from "./loader";

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
  checkUrlParam();
}

function loadFile(buffer: ArrayBuffer, filename: string) {
  const overlay = document.getElementById("overlay")!;
  overlay.style.display = "none";

  const statusEl = document.getElementById("status")!;
  statusEl.textContent = "Loading...";
  statusEl.style.display = "block";

  // Use setTimeout to let the UI update
  setTimeout(() => {
    try {
      const data = detectAndLoad(buffer, filename);
      renderer.loadSplatData(data);
      stats.gaussians = data.count;
      statusEl.style.display = "none";
      updateStats();
    } catch (e: any) {
      statusEl.textContent = `Error: ${e.message}`;
      console.error(e);
    }
  }, 16);
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

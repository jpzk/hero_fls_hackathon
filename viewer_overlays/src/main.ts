/**
 * Gaussian Splat Viewer with Overlay Support
 *
 * Extends the base viewer with 3D visual indicators:
 * rectangles, boxes, circles, lines, and points.
 */

import { SplatRenderer } from "./renderer";
import { detectAndLoad, analyzeSplatData, repairSplatData, type SplatData } from "./loader";
import type { Overlay } from "./overlays";
import { screenToRay, pickOverlay, rayBoxFace, beginDrag, updateDrag, type DragState } from "./interaction";

let renderer: SplatRenderer;
let dragState: DragState | null = null;
let stats: { fps: number; gaussians: number } = { fps: 0, gaussians: 0 };
let frameCount = 0;
let lastFpsTime = performance.now();

// UI state
let viewerActive = false;
let drawerOpen = true;
let heatmapMode = 0;
const heatmapModes = ["Off", "Alpha", "Scale"];

function init() {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  renderer = new SplatRenderer(canvas);

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

  setupDragDrop(canvas);
  setupDropTarget();
  setupDrawer();
  setupToolbar();
  setupTrainToggle();
  setupTraining();
  checkUrlParam();
  loadFileList();

  // Canvas interaction
  let mouseDownPos = { x: 0, y: 0 };

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    mouseDownPos = { x: e.clientX, y: e.clientY };
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const x = (e.clientX - rect.left) * dpr;
    const y = (e.clientY - rect.top) * dpr;
    const ray = screenToRay(x, y, canvas.width, canvas.height, renderer.camera);

    const sel = renderer.overlayRenderer.selectedIndex;
    if (sel >= 0) {
      dragState = beginDrag(renderer.overlayRenderer.overlays, ray, sel);
      if (dragState) {
        renderer.camera.enabled = false;
        return;
      }
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    if (dragState) {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const x = (e.clientX - rect.left) * dpr;
      const y = (e.clientY - rect.top) * dpr;
      const ray = screenToRay(x, y, canvas.width, canvas.height, renderer.camera);
      updateDrag(dragState, renderer.overlayRenderer.overlays, ray);
      return;
    }

    const sel = renderer.overlayRenderer.selectedIndex;
    if (sel >= 0) {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const x = (e.clientX - rect.left) * dpr;
      const y = (e.clientY - rect.top) * dpr;
      const ray = screenToRay(x, y, canvas.width, canvas.height, renderer.camera);
      const o = renderer.overlayRenderer.overlays[sel];
      if (o && o.type === "box") {
        const faceHit = rayBoxFace(ray, o.center, o.halfExtents);
        if (faceHit) {
          const axis = faceHit.face >> 1;
          canvas.style.cursor = axis === 1 ? "ns-resize" : "ew-resize";
        } else {
          canvas.style.cursor = "grab";
        }
        return;
      }
    }
    canvas.style.cursor = "grab";
  });

  canvas.addEventListener("mouseup", (e) => {
    if (dragState) {
      dragState = null;
      renderer.camera.enabled = true;
      return;
    }
    const dx = e.clientX - mouseDownPos.x;
    const dy = e.clientY - mouseDownPos.y;
    if (dx * dx + dy * dy < 9) {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const x = (e.clientX - rect.left) * dpr;
      const y = (e.clientY - rect.top) * dpr;
      const ray = screenToRay(x, y, canvas.width, canvas.height, renderer.camera);
      const idx = pickOverlay(renderer.overlayRenderer.overlays, ray);
      renderer.overlayRenderer.selectedIndex = idx;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      renderer.overlayRenderer.selectedIndex = -1;
      canvas.style.cursor = "grab";
    }
  });
}

// ─── UI State ───

function enterViewingState() {
  viewerActive = true;
  setDrawerOpen(false);
  document.getElementById("toolbar")!.classList.add("visible");
  document.getElementById("stats")!.classList.add("visible");
  document.getElementById("controls-hint")!.classList.add("visible");
}

function setDrawerOpen(open: boolean) {
  drawerOpen = open;
  const drawer = document.getElementById("drawer")!;
  const backdrop = document.getElementById("drawer-backdrop")!;

  if (open) {
    drawer.classList.remove("hidden");
    if (viewerActive) {
      backdrop.classList.add("active");
    }
  } else {
    drawer.classList.add("hidden");
    backdrop.classList.remove("active");
  }
}

function setupDrawer() {
  const backdrop = document.getElementById("drawer-backdrop")!;
  backdrop.addEventListener("click", () => {
    if (viewerActive) setDrawerOpen(false);
  });
}

function setupDropTarget() {
  const dropTarget = document.getElementById("drop-target")!;
  dropTarget.addEventListener("click", () => {
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

function setupToolbar() {
  // Overlay toggles
  const overlayBtns = ["tb-bbox", "tb-ground", "tb-center", "tb-ring"];
  for (const id of overlayBtns) {
    const btn = document.getElementById(id)!;
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      const label = btn.dataset.overlay!;
      overlayVisibility[label] = btn.classList.contains("active");
      if (!(renderer as any)._allOverlays) {
        (renderer as any)._allOverlays = [...renderer.overlayRenderer.overlays];
      }
      applyVisibility();
    });
  }

  // Heatmap cycle
  const heatBtn = document.getElementById("tb-heatmap")!;
  const heatLabel = document.getElementById("tb-heatmap-label")!;
  heatBtn.addEventListener("click", () => {
    heatmapMode = (heatmapMode + 1) % 3;
    renderer.heatmapMode = heatmapMode;
    heatLabel.textContent = `Heatmap: ${heatmapModes[heatmapMode]}`;
    heatBtn.classList.toggle("active", heatmapMode !== 0);
  });

  // Open drawer
  document.getElementById("tb-drawer")!.addEventListener("click", () => {
    setDrawerOpen(!drawerOpen);
  });
}

function setupTrainToggle() {
  const toggle = document.getElementById("train-toggle")!;
  const section = document.getElementById("train-section")!;
  toggle.addEventListener("click", () => {
    const expanded = section.classList.toggle("expanded");
    toggle.classList.toggle("expanded", expanded);
  });
}

// ─── Loading ───

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
      enterViewingState();
    } catch (e: any) {
      statusEl.textContent = `Error: ${e.message}`;
      console.error(e);
    }
  }, 16);
}

function addSceneOverlays(data: SplatData) {
  const count = data.count;
  const pos = data.positions;

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
    {
      type: "box",
      center: [cx, cy, cz],
      halfExtents: [hx, hy, hz],
      color: [0.3, 0.8, 1.0, 0.6],
    },
    {
      type: "rect",
      center: [cx, minY, cz],
      size: [hx * 2.2, hz * 2.2],
      color: [0.2, 1.0, 0.4, 0.4],
      filled: true,
      plane: "xz",
    },
    {
      type: "point",
      position: [cx, cy, cz],
      color: [1.0, 1.0, 0.0, 1.0],
      size: Math.max(hx, hy, hz) * 0.15,
    },
    {
      type: "circle",
      center: [cx, cy, cz],
      radius: Math.max(hx, hz) * 0.5,
      color: [1.0, 0.4, 0.8, 0.7],
      axis: "y",
    },
  ];

  renderer.overlayRenderer.overlays = overlays;
}

// Overlay visibility
const overlayVisibility: Record<string, boolean> = {
  "Bounding Box": true,
  "Ground Plane": true,
  "Center Point": true,
  "Center Ring": true,
};

function applyVisibility() {
  if (!renderer) return;
  const fullSet = (renderer as any)._allOverlays as Overlay[] | undefined;
  if (fullSet) {
    const labels = Object.keys(overlayVisibility);
    renderer.overlayRenderer.overlays = fullSet.filter((_, i) =>
      overlayVisibility[labels[i]] !== false
    );
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
    el.textContent = `${countStr} splats · ${stats.fps} fps`;
  }
}

// ─── Drag & Drop ───

function setupDragDrop(canvas: HTMLCanvasElement) {
  const dragOverlay = document.getElementById("drag-overlay")!;
  const dropTarget = document.getElementById("drop-target")!;

  document.addEventListener("dragover", (e) => {
    e.preventDefault();
    dragOverlay.style.display = "block";
    dropTarget.classList.add("drag-over");
    // If drawer is hidden (viewing state), show it for the drop
    if (viewerActive && !drawerOpen) {
      setDrawerOpen(true);
    }
  });
  document.addEventListener("dragleave", (e) => {
    // Only hide if leaving the window
    if (e.relatedTarget === null) {
      dragOverlay.style.display = "none";
      dropTarget.classList.remove("drag-over");
    }
  });
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    dragOverlay.style.display = "none";
    dropTarget.classList.remove("drag-over");
    const file = e.dataTransfer?.files[0];
    if (file) {
      if (/\.(ply|splat)$/i.test(file.name)) {
        const buffer = await file.arrayBuffer();
        loadFile(buffer, file.name);
      } else if (/\.(mp4|mov|avi|mkv)$/i.test(file.name)) {
        // Auto-expand training and select video
        const toggle = document.getElementById("train-toggle")!;
        const section = document.getElementById("train-section")!;
        if (!section.classList.contains("expanded")) {
          section.classList.add("expanded");
          toggle.classList.add("expanded");
        }
        selectVideoFile(file);
      }
    }
  });
}

// ─── Training ───

interface TrainingJob {
  status: "idle" | "running" | "completed" | "failed";
  stage: "uploading" | "frames" | "colmap" | "training" | "export";
  iteration: number;
  totalIterations: number;
  loss: number;
  startedAt: number | null;
  logs: string[];
  outputFile: string | null;
  config: { iterations: number; fps: number };
  error: string | null;
}

let selectedVideo: File | null = null;
let ws: WebSocket | null = null;
let trainingStartTime: number | null = null;

const STAGES = ["frames", "colmap", "training", "export"] as const;

function selectVideoFile(file: File) {
  selectedVideo = file;
  const uploadArea = document.getElementById("train-upload")!;
  const filenameEl = document.getElementById("train-filename")!;
  const trainBtn = document.getElementById("train-btn") as HTMLButtonElement;
  uploadArea.classList.add("has-file");
  filenameEl.textContent = `${file.name} (${formatSize(file.size)})`;
  trainBtn.disabled = false;
}

function setupTraining() {
  const uploadArea = document.getElementById("train-upload")!;
  const fileInput = document.getElementById("train-file-input") as HTMLInputElement;
  const trainBtn = document.getElementById("train-btn") as HTMLButtonElement;

  uploadArea.addEventListener("click", () => fileInput.click());
  uploadArea.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); });
  uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = (e as DragEvent).dataTransfer?.files[0];
    if (file && /\.(mp4|mov|avi|mkv)$/i.test(file.name)) {
      selectVideoFile(file);
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files?.[0]) selectVideoFile(fileInput.files[0]);
  });

  trainBtn.addEventListener("click", startTraining);

  const loadResultBtn = document.getElementById("load-result-btn")!;
  loadResultBtn.addEventListener("click", () => {
    const outputFile = loadResultBtn.dataset.outputFile;
    if (outputFile) loadFromServer(outputFile, outputFile.split("/").pop() || "output.splat");
  });

  checkTrainingStatus();
}

async function startTraining() {
  if (!selectedVideo) return;

  const trainBtn = document.getElementById("train-btn") as HTMLButtonElement;
  trainBtn.disabled = true;
  trainBtn.textContent = "Uploading...";

  const iterations = parseInt((document.getElementById("train-iterations") as HTMLInputElement).value) || 30000;
  const fps = parseInt((document.getElementById("train-fps") as HTMLInputElement).value) || 6;

  const formData = new FormData();
  formData.append("video", selectedVideo);
  formData.append("iterations", String(iterations));
  formData.append("fps", String(fps));

  try {
    const resp = await fetch("/api/train", { method: "POST", body: formData });
    if (!resp.ok) {
      const err = await resp.json();
      showToast(err.error || "Failed to start training", "warning");
      trainBtn.disabled = false;
      trainBtn.textContent = "Start Training";
      return;
    }

    trainBtn.textContent = "Training...";
    trainingStartTime = Date.now();
    showProgressUI();
    connectWebSocket();
  } catch (e: any) {
    showToast(`Upload failed: ${e.message}`, "warning");
    trainBtn.disabled = false;
    trainBtn.textContent = "Start Training";
  }
}

async function checkTrainingStatus() {
  try {
    const resp = await fetch("/api/status");
    if (!resp.ok) return;
    const job: TrainingJob = await resp.json();
    if (job.status === "running" || job.status === "completed" || job.status === "failed") {
      trainingStartTime = job.startedAt;

      // Auto-expand training section
      const toggle = document.getElementById("train-toggle")!;
      const section = document.getElementById("train-section")!;
      section.classList.add("expanded");
      toggle.classList.add("expanded");

      showProgressUI();
      updateProgressUI(job);
      if (job.status === "running") {
        const trainBtn = document.getElementById("train-btn") as HTMLButtonElement;
        trainBtn.disabled = true;
        trainBtn.textContent = "Training...";
        connectWebSocket();
      }
    }
  } catch {}
}

function connectWebSocket() {
  if (ws && ws.readyState <= 1) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onmessage = (e) => {
    const job: TrainingJob = JSON.parse(e.data);
    updateProgressUI(job);
  };
  ws.onclose = () => {
    setTimeout(() => checkTrainingStatus(), 2000);
  };
}

function showProgressUI() {
  const el = document.getElementById("training-progress")!;
  el.style.display = "block";
}

function updateProgressUI(job: TrainingJob) {
  const stageOrder = STAGES;
  const currentIdx = stageOrder.indexOf(job.stage);

  for (let i = 0; i < stageOrder.length; i++) {
    const stage = stageOrder[i];
    const dot = document.querySelector(`.stage-dot[data-stage="${stage}"]`) as HTMLElement;
    const label = document.querySelector(`.stage-label[data-stage="${stage}"]`) as HTMLElement;
    if (!dot || !label) continue;

    dot.classList.remove("active", "done");
    label.classList.remove("active", "done");

    if (job.status === "completed") {
      dot.classList.add("done");
      label.classList.add("done");
      dot.textContent = "\u2713";
    } else if (i < currentIdx) {
      dot.classList.add("done");
      label.classList.add("done");
      dot.textContent = "\u2713";
    } else if (i === currentIdx && job.status === "running") {
      dot.classList.add("active");
      label.classList.add("active");
    }
  }

  const bar = document.getElementById("progress-bar")!;
  const iterEl = document.getElementById("progress-iter")!;
  const lossEl = document.getElementById("progress-loss")!;
  const etaEl = document.getElementById("progress-eta")!;

  if (job.stage === "training" && job.totalIterations > 0) {
    const pct = Math.min(100, (job.iteration / job.totalIterations) * 100);
    bar.style.width = `${pct}%`;
    iterEl.textContent = `${job.iteration.toLocaleString()} / ${job.totalIterations.toLocaleString()}`;
    lossEl.textContent = job.loss > 0 ? `Loss: ${job.loss.toFixed(5)}` : "";

    if (job.startedAt && job.iteration > 0) {
      const elapsed = (Date.now() - job.startedAt) / 1000;
      const iterPerSec = job.iteration / elapsed;
      const remaining = (job.totalIterations - job.iteration) / iterPerSec;
      if (remaining > 60) {
        etaEl.textContent = `~${Math.ceil(remaining / 60)} min left`;
      } else {
        etaEl.textContent = `~${Math.ceil(remaining)}s left`;
      }
    }
  } else if (job.status === "completed") {
    bar.style.width = "100%";
    iterEl.textContent = "Complete!";
    lossEl.textContent = job.loss > 0 ? `Final loss: ${job.loss.toFixed(5)}` : "";
    etaEl.textContent = "";
  } else {
    const stageNames: Record<string, string> = {
      frames: "Extracting frames...",
      colmap: "Running COLMAP (this takes a while)...",
      training: "Starting training...",
      export: "Exporting .splat...",
      uploading: "Uploading...",
    };
    iterEl.textContent = stageNames[job.stage] || "Processing...";
    lossEl.textContent = "";
    etaEl.textContent = "";
    bar.style.width = "0%";
  }

  const logEl = document.getElementById("train-log")!;
  logEl.textContent = job.logs.slice(-20).join("\n");
  logEl.scrollTop = logEl.scrollHeight;

  const errorEl = document.getElementById("train-error")!;
  if (job.status === "failed" && job.error) {
    errorEl.textContent = job.error;
    errorEl.style.display = "block";
  } else {
    errorEl.style.display = "none";
  }

  const loadBtn = document.getElementById("load-result-btn")!;
  if (job.status === "completed" && job.outputFile) {
    loadBtn.style.display = "block";
    loadBtn.dataset.outputFile = job.outputFile;
    loadFileList();
  } else {
    loadBtn.style.display = "none";
  }

  if (job.status === "completed" || job.status === "failed") {
    const trainBtn = document.getElementById("train-btn") as HTMLButtonElement;
    trainBtn.disabled = false;
    trainBtn.textContent = "Start Training";
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

// ─── File List ───

async function loadFileList() {
  const listEl = document.getElementById("file-list");
  if (!listEl) return;

  try {
    const resp = await fetch("/api/splats");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const files: { name: string; path: string; size: number }[] = await resp.json();

    if (files.length === 0) {
      listEl.innerHTML = '<div class="file-list-empty">No .splat or .ply files found</div>';
      return;
    }

    listEl.innerHTML = "";
    for (const file of files) {
      const item = document.createElement("div");
      item.className = "file-item";
      item.innerHTML = `
        <div>
          <div class="file-item-name">${file.name}</div>
          <div class="file-item-path">${file.path}</div>
        </div>
        <div class="file-item-size">${formatSize(file.size)}</div>
      `;
      item.addEventListener("click", () => loadFromServer(file.path, file.name));
      listEl.appendChild(item);
    }
  } catch (e: any) {
    listEl.innerHTML = `<div class="file-list-empty">Could not load file list</div>`;
  }
}

async function loadFromServer(filePath: string, filename: string) {
  const statusEl = document.getElementById("status")!;
  statusEl.textContent = `Loading ${filename}...`;
  statusEl.style.display = "block";

  try {
    const resp = await fetch(`/splats/${filePath}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    loadFile(buffer, filename);
  } catch (e: any) {
    statusEl.textContent = `Failed to load: ${e.message}`;
  }
}

async function checkUrlParam() {
  const params = new URLSearchParams(window.location.search);
  const url = params.get("url");
  if (url) {
    const statusEl = document.getElementById("status")!;
    statusEl.textContent = "Loading from URL...";
    statusEl.style.display = "block";

    try {
      const resp = await fetch(url);
      const buffer = await resp.arrayBuffer();
      const filename = url.split("/").pop() || "model.splat";
      loadFile(buffer, filename);
    } catch (e: any) {
      statusEl.textContent = `Failed to load: ${e.message}`;
    }
  }
}

// Start when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

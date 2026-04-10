"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface Detection {
  class: string;
  confidence: number;
  center: number[];
  size: number[];
  color: number[];
  suggestion: { item: string; range: string };
}

const DETECT_URL = process.env.NEXT_PUBLIC_DETECT_URL || "http://localhost:8100";

export default function GaussianViewer({ plyUrl }: { plyUrl: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<InstanceType<typeof import("@/lib/splat-viewer/renderer").SplatRenderer> | null>(null);
  const sceneInfoRef = useRef<{ center: number[]; radius: number }>({ center: [0, 0, 0], radius: 1 });

  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [selectedDet, setSelectedDet] = useState<Detection | null>(null);

  // Run detection
  const runDetection = useCallback(async () => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    setDetecting(true);
    setSelectedDet(null);

    try {
      // Capture canvas as base64 PNG
      const imageB64 = canvas.toDataURL("image/png");

      // Get camera matrices
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      const viewMatrix = Array.from(renderer.camera.getViewMatrix());
      const projMatrix = Array.from(renderer.camera.getProjectionMatrix(w / h));

      const body = {
        frames: [{
          image: imageB64,
          viewMatrix,
          projMatrix,
        }],
        sceneCenter: sceneInfoRef.current.center,
        sceneRadius: sceneInfoRef.current.radius,
      };

      const res = await fetch(`${DETECT_URL}/api/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Detection failed: ${res.status}`);

      const data = await res.json();
      const dets: Detection[] = data.detections || [];
      setDetections(dets);

      // Add 3D box overlays
      renderer.overlayRenderer.overlays = dets.map((d) => ({
        type: "box" as const,
        center: d.center as [number, number, number],
        halfExtents: [d.size[0] / 2, d.size[1] / 2, d.size[2] / 2] as [number, number, number],
        color: d.color as [number, number, number, number],
      }));
    } catch (err) {
      console.error("Detection error:", err);
    } finally {
      setDetecting(false);
    }
  }, []);

  // Clear detections
  const clearDetections = useCallback(() => {
    setDetections([]);
    setSelectedDet(null);
    if (rendererRef.current) {
      rendererRef.current.overlayRenderer.overlays = [];
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animId: number;
    let destroyed = false;

    async function init() {
      const { SplatRenderer } = await import("@/lib/splat-viewer/renderer");
      const { detectAndLoad, analyzeSplatData, repairSplatData } = await import("@/lib/splat-viewer/loader");

      if (destroyed) return;

      const renderer = new SplatRenderer(canvas!);
      rendererRef.current = renderer;

      // Fetch PLY with progress
      const response = await fetch(plyUrl);
      const contentLength = Number(response.headers.get("content-length")) || 0;
      const reader = response.body?.getReader();
      if (!reader) {
        setError("Datei konnte nicht geladen werden");
        return;
      }

      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) {
          setProgress(Math.round((received / contentLength) * 100));
        }
      }

      const buffer = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }

      if (destroyed) return;

      const filename = plyUrl.split("/").pop() || "model.ply";
      const splatData = detectAndLoad(buffer.buffer, filename);

      const warnings = analyzeSplatData(splatData);
      if (warnings.constantAlpha !== null || warnings.hugeScaleCount > 0) {
        repairSplatData(splatData, warnings);
      }

      renderer.loadSplatData(splatData);

      // Compute scene bounds for detection
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < splatData.count; i++) {
        cx += splatData.positions[i * 3];
        cy += splatData.positions[i * 3 + 1];
        cz += splatData.positions[i * 3 + 2];
      }
      cx /= splatData.count;
      cy /= splatData.count;
      cz /= splatData.count;

      let maxDist = 0;
      for (let i = 0; i < splatData.count; i++) {
        const dx = splatData.positions[i * 3] - cx;
        const dy = splatData.positions[i * 3 + 1] - cy;
        const dz = splatData.positions[i * 3 + 2] - cz;
        maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy + dz * dz));
      }

      sceneInfoRef.current = { center: [cx, cy, cz], radius: maxDist };

      setLoading(false);

      function animate() {
        if (destroyed) return;
        renderer.render();
        animId = requestAnimationFrame(animate);
      }
      animate();
    }

    init().catch((err) => {
      setError(err.message || "Fehler beim Laden");
    });

    const onResize = () => {
      if (!canvas) return;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
    };
    window.addEventListener("resize", onResize);

    return () => {
      destroyed = true;
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
    };
  }, [plyUrl]);

  return (
    <div className="w-full h-full relative bg-[#0d0d14]">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ touchAction: "none" }}
      />

      {/* Loading */}
      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0d0d14] z-10">
          <div className="relative w-16 h-16 mb-4">
            <div className="absolute inset-0 rounded-full border-4 border-white/10" />
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-yellow animate-spin-ring" />
          </div>
          <p className="text-white/60 text-sm font-medium mb-2">3D-Modell laden...</p>
          <p className="text-yellow text-lg font-bold">{progress}%</p>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0d0d14] z-10">
          <p className="text-red text-sm">{error}</p>
        </div>
      )}

      {/* Toolbar */}
      {!loading && !error && (
        <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
          {/* Detect button */}
          <button
            onClick={runDetection}
            disabled={detecting}
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all shadow-lg ${
              detecting
                ? "bg-yellow/80 cursor-wait"
                : "bg-white/10 backdrop-blur-sm hover:bg-yellow text-white hover:text-black"
            }`}
            title="Objekte erkennen"
          >
            {detecting ? (
              <div className="w-4 h-4 border-2 border-black/60 border-t-transparent rounded-full animate-spin-ring" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            )}
          </button>

          {/* Clear detections */}
          {detections.length > 0 && (
            <button
              onClick={clearDetections}
              className="w-11 h-11 rounded-xl bg-white/10 backdrop-blur-sm hover:bg-red/80 text-white flex items-center justify-center transition-all shadow-lg"
              title="Erkennungen löschen"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Detection results panel */}
      {detections.length > 0 && (
        <div className="absolute top-4 left-4 z-10 w-64 max-h-[60vh] overflow-y-auto">
          <div className="bg-black/70 backdrop-blur-md rounded-2xl p-3 space-y-2">
            <div className="text-white/60 text-[10px] font-bold uppercase tracking-wider px-1">
              {detections.length} Objekte erkannt
            </div>

            {detections.map((det, i) => (
              <button
                key={i}
                onClick={() => {
                  setSelectedDet(selectedDet === det ? null : det);
                  if (rendererRef.current) {
                    rendererRef.current.overlayRenderer.selectedIndex =
                      selectedDet === det ? -1 : i;
                  }
                }}
                className={`w-full text-left p-2.5 rounded-xl transition-all ${
                  selectedDet === det
                    ? "bg-yellow/20 border border-yellow/40"
                    : "bg-white/5 hover:bg-white/10 border border-transparent"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{
                      backgroundColor: `rgba(${det.color.slice(0, 3).map((c: number) => Math.round(c * 255)).join(",")}, 0.9)`,
                    }}
                  />
                  <span className="text-white text-sm font-semibold capitalize">{det.class}</span>
                  <span className="text-white/40 text-[10px] ml-auto">
                    {Math.round(det.confidence * 100)}%
                  </span>
                </div>
                <div className="text-white/50 text-[11px]">{det.suggestion.item}</div>
                <div className="text-yellow text-xs font-bold mt-0.5">{det.suggestion.range}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Selected detection detail */}
      {selectedDet && (
        <div className="absolute bottom-4 left-4 right-4 z-10">
          <div className="bg-black/70 backdrop-blur-md rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-4 h-4 rounded-full"
                style={{
                  backgroundColor: `rgba(${selectedDet.color.slice(0, 3).map((c: number) => Math.round(c * 255)).join(",")}, 0.9)`,
                }}
              />
              <span className="text-white font-bold capitalize">{selectedDet.class}</span>
              <span className="text-white/40 text-xs ml-auto">
                Konfidenz: {Math.round(selectedDet.confidence * 100)}%
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="bg-white/5 rounded-lg p-2 text-center">
                <div className="text-white/40 text-[9px] uppercase">Breite</div>
                <div className="text-white text-sm font-bold">{selectedDet.size[0].toFixed(2)}m</div>
              </div>
              <div className="bg-white/5 rounded-lg p-2 text-center">
                <div className="text-white/40 text-[9px] uppercase">Höhe</div>
                <div className="text-white text-sm font-bold">{selectedDet.size[1].toFixed(2)}m</div>
              </div>
              <div className="bg-white/5 rounded-lg p-2 text-center">
                <div className="text-white/40 text-[9px] uppercase">Tiefe</div>
                <div className="text-white text-sm font-bold">{selectedDet.size[2].toFixed(2)}m</div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/60 text-xs">{selectedDet.suggestion.item}</span>
              <span className="text-yellow font-bold text-sm">{selectedDet.suggestion.range}</span>
            </div>
          </div>
        </div>
      )}

      {/* Controls hint */}
      {!loading && !error && detections.length === 0 && !selectedDet && (
        <div className="absolute bottom-4 left-4 text-white/30 text-xs pointer-events-none">
          Maus: Drehen · Rechtsklick: Verschieben · Scroll: Zoom
        </div>
      )}
    </div>
  );
}

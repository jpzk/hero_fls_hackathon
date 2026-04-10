"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function ScanPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraReady(true);
        }
      } catch {
        setError("Kamera-Zugriff nicht möglich. Bitte Berechtigung erteilen.");
      }
    }

    startCamera();

    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const handleCapture = () => {
    router.push("/results");
  };

  return (
    <div className="min-h-screen bg-black relative flex flex-col">
      {/* Camera feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Overlay */}
      <div className="relative z-10 flex-1 flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 pt-5">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-1.5 text-white text-sm font-medium bg-black/40 backdrop-blur-sm px-3 py-2 rounded-full"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Zurück
          </button>

          {cameraReady && (
            <div className="flex items-center gap-1.5 bg-red/90 px-3 py-2 rounded-full">
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span className="text-[11px] font-bold text-white uppercase tracking-wider">Live</span>
            </div>
          )}
        </div>

        {/* Center area */}
        <div className="flex-1 flex items-center justify-center">
          {error ? (
            <div className="bg-black/60 backdrop-blur-sm rounded-2xl p-6 mx-6 text-center">
              <p className="text-white/80 text-sm">{error}</p>
              <button
                onClick={() => router.push("/")}
                className="mt-4 px-5 py-2.5 bg-yellow text-black rounded-full text-sm font-bold"
              >
                Zurück
              </button>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-white/60 text-sm mb-2">Objekt in den Rahmen halten</p>
            </div>
          )}
        </div>

        {/* Bottom controls */}
        {cameraReady && (
          <div className="flex flex-col items-center pb-12">
            <div className="relative mb-4">
              <div className="absolute inset-0 rounded-full bg-yellow animate-pulse-ring" />
              <button
                onClick={handleCapture}
                className="relative w-20 h-20 rounded-full bg-yellow hover:bg-yellow-hover flex items-center justify-center transition-colors shadow-lg"
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                  <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                </svg>
              </button>
            </div>
            <p className="text-white/40 text-xs">Tippen zum Scannen</p>
          </div>
        )}
      </div>
    </div>
  );
}

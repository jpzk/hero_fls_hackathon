"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("video/")) return;
    setFile(f);
    setVideoUrl(URL.createObjectURL(f));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleAnalyze = () => {
    router.push("/results");
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Nav */}
      <div className="flex items-center gap-3 px-6 py-5">
        <button onClick={() => router.push("/")} className="text-white/60 hover:text-white transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-white">
          HER<span className="text-yellow">O</span>. <span className="text-white/40 font-medium text-sm">Upload</span>
        </h1>
      </div>

      <div className="flex-1 flex flex-col px-6 pb-8">
        {!file ? (
          /* Drop zone */
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 border-2 border-dashed border-white/20 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-yellow/40 transition-colors"
          >
            <div className="w-20 h-20 rounded-2xl bg-white/5 flex items-center justify-center mb-5">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#FFD600" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <p className="text-white font-semibold text-lg mb-1">Video hier ablegen</p>
            <p className="text-white/40 text-sm mb-5">oder tippen zum Auswählen</p>
            <div className="flex gap-2">
              {["MP4", "MOV", "AVI"].map((fmt) => (
                <span key={fmt} className="px-3 py-1.5 bg-white/10 rounded-full text-xs text-white/50 font-medium">
                  {fmt}
                </span>
              ))}
            </div>
          </div>
        ) : (
          /* Preview */
          <div className="flex-1 flex flex-col">
            <div className="flex-1 rounded-2xl bg-white/5 border border-white/10 overflow-hidden relative mb-5">
              {videoUrl && <video src={videoUrl} className="w-full h-full object-cover" controls />}
            </div>

            {/* File info */}
            <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3 mb-5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="text-white/80 text-sm flex-1 truncate">{file.name}</span>
              <span className="text-white/40 text-sm">{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
            </div>

            <button
              onClick={handleAnalyze}
              className="w-full py-4 bg-yellow hover:bg-yellow-hover text-black rounded-2xl font-bold text-base transition-colors mb-3"
            >
              Video analysieren
            </button>
            <button
              onClick={() => { setFile(null); setVideoUrl(null); }}
              className="w-full py-3 border border-white/20 text-white/60 rounded-2xl text-sm font-medium hover:border-white/40 transition-colors"
            >
              Anderes Video wählen
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
    </div>
  );
}

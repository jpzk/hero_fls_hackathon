"use client";

import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Nav */}
      <div className="flex items-center px-6 py-5">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          HER<span className="text-yellow">O</span>.
        </h1>
        <span className="ml-2 text-sm text-white/40 font-medium">Scanner</span>
      </div>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-yellow" />
          <span className="text-xs font-semibold text-yellow uppercase tracking-wider">
            AI-powered · 3D
          </span>
        </div>

        <h2 className="text-4xl font-bold text-white text-center leading-tight mb-3">
          Scan & analyse<br />construction sites
        </h2>
        <p className="text-base text-white/50 text-center max-w-md mb-12">
          Automatisch Maße, Materialien und Kosten erkennen — direkt auf der Baustelle.
        </p>

        {/* Two CTAs */}
        <div className="flex flex-col gap-4 w-full max-w-sm">
          <Link
            href="/scan"
            className="flex items-center justify-center gap-3 w-full py-4 bg-yellow hover:bg-yellow-hover text-black rounded-2xl font-bold text-base transition-colors"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7V5a2 2 0 0 1 2-2h2" />
              <path d="M17 3h2a2 2 0 0 1 2 2v2" />
              <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
              <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
              <line x1="7" y1="12" x2="17" y2="12" />
            </svg>
            Start Scan
          </Link>

          <Link
            href="/upload"
            className="flex items-center justify-center gap-3 w-full py-4 border-2 border-white/20 text-white rounded-2xl font-semibold text-base hover:border-white/40 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload Video
          </Link>

          <Link
            href="/progress"
            className="flex items-center justify-center gap-3 w-full py-4 border-2 border-yellow/30 text-yellow rounded-2xl font-semibold text-base hover:border-yellow/60 hover:bg-yellow/5 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" />
            </svg>
            Baufortschritt
          </Link>
        </div>
      </div>

      {/* Bottom hint */}
      <div className="text-center pb-8">
        <p className="text-xs text-white/30">Hackathon Demo · Hero Software × 3D Construction</p>
      </div>
    </div>
  );
}

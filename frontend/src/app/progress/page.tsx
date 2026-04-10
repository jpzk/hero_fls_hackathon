"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

const GaussianViewer = dynamic(() => import("@/components/GaussianViewer"), {
  ssr: false,
});

interface Phase {
  id: string;
  date: string;
  title: string;
  status: "done" | "active" | "upcoming";
  progress: number;
  description: string;
  plyFile: string | null;
  stats: { label: string; value: string }[];
  tasks: { name: string; done: boolean }[];
  cost: { spent: string; budget: string };
}

const PROJECT = {
  name: "Bürosanierung Altona",
  client: "Müller & Partner GmbH",
  address: "Große Bergstraße 42, 22767 Hamburg",
  startDate: "18.03.2026",
  endDate: "30.05.2026 (geplant)",
  totalBudget: "48.500",
};

const PHASES: Phase[] = [
  {
    id: "phase-1",
    date: "18.03.2026",
    title: "Bestandsaufnahme",
    status: "done",
    progress: 100,
    description: "Initiale 3D-Erfassung des Sanitärbereichs. Alle Leitungen, Armaturen und Geräte dokumentiert.",
    plyFile: "/models/hamburg.ply",
    stats: [
      { label: "Fläche", value: "12,4 m²" },
      { label: "Objekte", value: "5 erkannt" },
      { label: "Scan-Zeit", value: "4 Min" },
    ],
    tasks: [
      { name: "Sanitärbereich erfasst", done: true },
      { name: "Rohrleitungen dokumentiert", done: true },
      { name: "Durchlauferhitzer geprüft", done: true },
      { name: "Mängel protokolliert", done: true },
    ],
    cost: { spent: "2.400", budget: "3.000" },
  },
  {
    id: "phase-2",
    date: "02.04.2026",
    title: "Rohbau & Sanitär",
    status: "done",
    progress: 100,
    description: "Sanitärinstallation abgeschlossen. Neue Leitungen verlegt, Waschbecken montiert, Durchlauferhitzer getauscht.",
    plyFile: "/models/room.splat",
    stats: [
      { label: "Fläche", value: "28,6 m²" },
      { label: "Objekte", value: "12 erkannt" },
      { label: "Scan-Zeit", value: "8 Min" },
    ],
    tasks: [
      { name: "Alte Leitungen demontiert", done: true },
      { name: "Neue Kupferleitungen verlegt", done: true },
      { name: "Abflüsse erneuert (DN 50)", done: true },
      { name: "Durchlauferhitzer 21kW installiert", done: true },
      { name: "Druckprüfung bestanden", done: true },
    ],
    cost: { spent: "8.200", budget: "9.500" },
  },
  {
    id: "phase-3",
    date: "10.04.2026",
    title: "Innenausbau",
    status: "active",
    progress: 65,
    description: "Küche und Aufenthaltsbereich im Ausbau. Theke montiert, Glastrennwand eingesetzt.",
    plyFile: "/models/output_2012.ply",
    stats: [
      { label: "Fläche", value: "16,3 m²" },
      { label: "Objekte", value: "8 erkannt" },
      { label: "Scan-Zeit", value: "6 Min" },
    ],
    tasks: [
      { name: "Empfangstheke montiert", done: true },
      { name: "Glastrennwand eingesetzt", done: true },
      { name: "Bodenbelag verlegt", done: true },
      { name: "Lüftungskanäle installiert", done: true },
      { name: "Elektroinstallation", done: false },
      { name: "Malerarbeiten", done: false },
      { name: "Endabnahme", done: false },
    ],
    cost: { spent: "18.400", budget: "24.000" },
  },
  {
    id: "phase-4",
    date: "28.04.2026",
    title: "Kücheneinbau",
    status: "upcoming",
    progress: 0,
    description: "Einbauküche montieren, Geräte anschließen, Fliesen im Spritzbereich.",
    plyFile: "/models/kitchen.splat",
    stats: [
      { label: "Fläche", value: "8,2 m²" },
      { label: "Objekte", value: "—" },
      { label: "Scan-Zeit", value: "—" },
    ],
    tasks: [
      { name: "Küchenzeile montieren", done: false },
      { name: "Spüle & Armatur anschließen", done: false },
      { name: "Elektrogeräte einbauen", done: false },
      { name: "Fliesenspiegel anbringen", done: false },
      { name: "Endkontrolle", done: false },
    ],
    cost: { spent: "0", budget: "12.000" },
  },
];

export default function ProgressPage() {
  const router = useRouter();
  const [selectedPhase, setSelectedPhase] = useState(2); // Active phase
  const [viewerOpen, setViewerOpen] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [comparePhase, setComparePhase] = useState(0);

  const phase = PHASES[selectedPhase];
  const totalSpent = PHASES.reduce((sum, p) => sum + parseFloat(p.cost.spent.replace(".", "")), 0);
  const totalBudget = parseFloat(PROJECT.totalBudget.replace(".", ""));
  const overallProgress = Math.round(
    PHASES.reduce((sum, p) => sum + p.progress, 0) / PHASES.length
  );

  if (viewerOpen && phase.plyFile) {
    return (
      <div className="h-screen bg-[#111] flex flex-col">
        {/* Viewer header */}
        <div className="flex items-center justify-between px-5 py-3 bg-black/80 backdrop-blur-sm z-20">
          <button
            onClick={() => { setViewerOpen(false); setCompareMode(false); }}
            className="flex items-center gap-1.5 text-white text-sm font-medium"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Zurück
          </button>
          <div className="text-center">
            <div className="text-white font-bold text-sm">{phase.title}</div>
            <div className="text-white/40 text-[10px]">{phase.date}</div>
          </div>
          {!compareMode ? (
            <button
              onClick={() => setCompareMode(true)}
              className="px-3 py-1.5 bg-yellow/20 text-yellow rounded-full text-[11px] font-bold hover:bg-yellow/30 transition-colors"
            >
              Vergleichen
            </button>
          ) : (
            <button
              onClick={() => setCompareMode(false)}
              className="px-3 py-1.5 bg-white/10 text-white/60 rounded-full text-[11px] font-bold hover:bg-white/20 transition-colors"
            >
              Einzelansicht
            </button>
          )}
        </div>

        {compareMode ? (
          /* Side-by-side comparison */
          <div className="flex-1 flex">
            <div className="flex-1 border-r border-white/10 relative">
              <div className="absolute top-3 left-3 z-10 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full">
                <span className="text-white/60 text-[10px] font-bold uppercase">Vorher · {PHASES[comparePhase].date}</span>
              </div>
              <GaussianViewer plyUrl={PHASES[comparePhase].plyFile!} />
            </div>
            <div className="flex-1 relative">
              <div className="absolute top-3 left-3 z-10 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full">
                <span className="text-yellow text-[10px] font-bold uppercase">Nachher · {phase.date}</span>
              </div>
              <GaussianViewer plyUrl={phase.plyFile!} />
            </div>
          </div>
        ) : (
          /* Single view */
          <div className="flex-1" key={phase.plyFile}>
            <GaussianViewer plyUrl={phase.plyFile!} />
          </div>
        )}

        {/* Compare phase selector */}
        {compareMode && (
          <div className="px-5 py-3 bg-black/80 backdrop-blur-sm z-20">
            <div className="text-white/40 text-[10px] font-bold uppercase tracking-wider mb-2">Vorher-Phase wählen</div>
            <div className="flex gap-2">
              {PHASES.filter((_, i) => i !== selectedPhase && PHASES[i].plyFile).map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => setComparePhase(i)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                    comparePhase === i ? "bg-yellow text-black" : "bg-white/10 text-white/50"
                  }`}
                >
                  {p.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => router.push("/")} className="text-white/60 hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="text-lg font-bold">
            HER<span className="text-yellow">O</span>. <span className="text-white/40 font-medium text-sm">Baufortschritt</span>
          </h1>
          <div className="w-5" />
        </div>

        {/* Project info */}
        <div className="bg-white/5 rounded-2xl p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="font-bold text-lg">{PROJECT.name}</h2>
              <p className="text-white/40 text-xs mt-0.5">{PROJECT.client}</p>
              <p className="text-white/30 text-[11px]">{PROJECT.address}</p>
            </div>
            <div className="text-right">
              <div className="text-yellow font-bold text-2xl">{overallProgress}%</div>
              <div className="text-white/30 text-[10px]">Gesamtfortschritt</div>
            </div>
          </div>

          {/* Overall progress bar */}
          <div className="h-2 bg-white/10 rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-yellow rounded-full transition-all duration-500"
              style={{ width: `${overallProgress}%` }}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className="text-white font-bold text-sm">{PROJECT.startDate.split(".").slice(0, 2).join(".")}</div>
              <div className="text-white/30 text-[9px]">Startdatum</div>
            </div>
            <div className="text-center">
              <div className="text-white font-bold text-sm">
                {(totalSpent / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} €
              </div>
              <div className="text-white/30 text-[9px]">von {PROJECT.totalBudget} € Budget</div>
            </div>
            <div className="text-center">
              <div className="text-white font-bold text-sm">{PHASES.filter(p => p.status === "done").length}/{PHASES.length}</div>
              <div className="text-white/30 text-[9px]">Phasen fertig</div>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="px-6 py-5">
        <div className="text-white/40 text-[10px] font-bold uppercase tracking-wider mb-4">Bauphasen</div>

        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[15px] top-0 bottom-0 w-[2px] bg-white/10" />

          <div className="flex flex-col gap-1">
            {PHASES.map((p, i) => {
              const isSelected = selectedPhase === i;
              return (
                <div key={p.id}>
                  {/* Phase card */}
                  <button
                    onClick={() => setSelectedPhase(i)}
                    className={`w-full text-left relative pl-10 pr-0 py-0 transition-all`}
                  >
                    {/* Timeline dot */}
                    <div className={`absolute left-[9px] top-4 w-[14px] h-[14px] rounded-full border-2 z-10 ${
                      p.status === "done"
                        ? "bg-green border-green"
                        : p.status === "active"
                          ? "bg-yellow border-yellow"
                          : "bg-[#0a0a0a] border-white/20"
                    }`}>
                      {p.status === "done" && (
                        <svg className="w-full h-full p-[1px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                      {p.status === "active" && (
                        <div className="w-full h-full rounded-full bg-black scale-[0.4]" />
                      )}
                    </div>

                    <div className={`rounded-2xl p-4 transition-all ${
                      isSelected
                        ? "bg-white/10 border border-yellow/30"
                        : "bg-white/5 border border-transparent hover:bg-white/8"
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white/40 text-[10px] font-medium">{p.date}</span>
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${
                          p.status === "done" ? "text-green" : p.status === "active" ? "text-yellow" : "text-white/20"
                        }`}>
                          {p.status === "done" ? "Fertig" : p.status === "active" ? "In Arbeit" : "Ausstehend"}
                        </span>
                      </div>
                      <h3 className="font-bold text-base mb-1">{p.title}</h3>
                      <p className="text-white/40 text-xs leading-relaxed">{p.description}</p>

                      {/* Progress bar */}
                      <div className="flex items-center gap-3 mt-3">
                        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              p.status === "done" ? "bg-green" : p.status === "active" ? "bg-yellow" : "bg-white/10"
                            }`}
                            style={{ width: `${p.progress}%` }}
                          />
                        </div>
                        <span className="text-white/50 text-xs font-bold w-10 text-right">{p.progress}%</span>
                      </div>
                    </div>
                  </button>

                  {/* Expanded details */}
                  {isSelected && (
                    <div className="pl-10 mt-1 mb-2 animate-fade-in-up">
                      <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                        {/* Stats */}
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {p.stats.map((s, j) => (
                            <div key={j} className="bg-black/40 rounded-xl p-2.5 text-center">
                              <div className="text-white font-bold text-sm">{s.value}</div>
                              <div className="text-white/30 text-[9px]">{s.label}</div>
                            </div>
                          ))}
                        </div>

                        {/* Tasks */}
                        <div className="mb-4">
                          <div className="text-white/30 text-[9px] font-bold uppercase tracking-wider mb-2">Aufgaben</div>
                          <div className="flex flex-col gap-1.5">
                            {p.tasks.map((t, j) => (
                              <div key={j} className="flex items-center gap-2">
                                <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                                  t.done ? "bg-green/20" : "bg-white/5"
                                }`}>
                                  {t.done ? (
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  ) : (
                                    <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                                  )}
                                </div>
                                <span className={`text-xs ${t.done ? "text-white/50" : "text-white/80"}`}>
                                  {t.name}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Cost */}
                        <div className="bg-black/40 rounded-xl p-3 mb-4">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-white/40 text-[10px]">Kosten</span>
                            <span className="text-white text-xs font-bold">{p.cost.spent} € / {p.cost.budget} €</span>
                          </div>
                          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-yellow rounded-full"
                              style={{
                                width: `${Math.min(100, (parseFloat(p.cost.spent.replace(".", "")) / parseFloat(p.cost.budget.replace(".", ""))) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>

                        {/* View 3D button */}
                        {p.plyFile && (
                          <button
                            onClick={() => setViewerOpen(true)}
                            className="w-full py-3.5 bg-yellow hover:bg-yellow-hover text-black rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                            </svg>
                            3D-Scan ansehen
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

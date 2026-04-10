"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

const GaussianViewer = dynamic(() => import("@/components/GaussianViewer"), {
  ssr: false,
});

interface AnalysisObject {
  name: string;
  icon: string;
  dimensions: { label: string; value: string }[];
  material: string;
  condition: string;
  conditionColor: string;
  cost: string;
  notes?: string;
}

interface ModelInfo {
  name: string;
  file: string;
  splats: string;
  size: string;
  sceneType: string;
  analysis: {
    summary: string;
    totalCost: string;
    objects: AnalysisObject[];
  };
}

const MODELS: ModelInfo[] = [
  {
    name: "Waschbecken-Bereich",
    file: "/models/hamburg.ply",
    splats: "240k",
    size: "57 MB",
    sceneType: "Sanitärinstallation",
    analysis: {
      summary: "Sanitärbereich mit Ausgussbecken, Durchlauferhitzer und Rohrleitungen erkannt.",
      totalCost: "1.850 – 2.400",
      objects: [
        {
          name: "Ausgussbecken (Stahl, wandmontiert)",
          icon: "🪣",
          dimensions: [
            { label: "Breite", value: "600 mm" },
            { label: "Tiefe", value: "450 mm" },
            { label: "Höhe", value: "280 mm" },
            { label: "Wandhöhe", value: "850 mm" },
          ],
          material: "Stahl emailliert, weiß",
          condition: "Gebrauchsspuren, funktionsfähig",
          conditionColor: "text-yellow",
          cost: "180 – 250",
          notes: "Standardmaß, Austausch mit handelsüblichem Modell möglich",
        },
        {
          name: "Durchlauferhitzer (Stiebel Eltron)",
          icon: "🔥",
          dimensions: [
            { label: "Breite", value: "470 mm" },
            { label: "Höhe", value: "240 mm" },
            { label: "Tiefe", value: "130 mm" },
            { label: "Wandabstand", value: "1.350 mm" },
          ],
          material: "Kunststoffgehäuse, elektronisch",
          condition: "Gut, betriebsbereit",
          conditionColor: "text-green",
          cost: "350 – 520",
          notes: "Leistung ca. 18-21 kW, 400V Anschluss erforderlich",
        },
        {
          name: "Abflussrohr (vertikal)",
          icon: "🔧",
          dimensions: [
            { label: "Durchmesser", value: "DN 50" },
            { label: "Sichtbare Länge", value: "1.800 mm" },
            { label: "Wandabstand", value: "35 mm" },
          ],
          material: "Gusseisen / HT-Rohr",
          condition: "Korrosionsspuren",
          conditionColor: "text-red",
          cost: "120 – 180",
          notes: "Prüfung auf Dichtheit empfohlen",
        },
        {
          name: "Wasserleitungen (Zu-/Ablauf)",
          icon: "💧",
          dimensions: [
            { label: "Warmwasser", value: "DN 15 (½\")" },
            { label: "Kaltwasser", value: "DN 15 (½\")" },
            { label: "Leitungslänge", value: "ca. 1.200 mm" },
          ],
          material: "Kupfer, verchromt",
          condition: "Gut",
          conditionColor: "text-green",
          cost: "80 – 150",
        },
        {
          name: "Siphon / Ablaufgarnitur",
          icon: "⚙️",
          dimensions: [
            { label: "Anschluss", value: "DN 40" },
            { label: "Höhe", value: "220 mm" },
          ],
          material: "Kunststoff, weiß",
          condition: "Funktionsfähig",
          conditionColor: "text-green",
          cost: "25 – 45",
        },
      ],
    },
  },
  {
    name: "Büro / Empfangsbereich",
    file: "/models/output_2012.ply",
    splats: "491k",
    size: "116 MB",
    sceneType: "Gewerberaum",
    analysis: {
      summary: "Empfangs-/Thekenbereich mit Glasfront, abgehängter Decke und Lüftungskanälen erkannt.",
      totalCost: "8.200 – 12.500",
      objects: [
        {
          name: "Empfangstheke (L-Form)",
          icon: "🏗️",
          dimensions: [
            { label: "Länge (lang)", value: "3.200 mm" },
            { label: "Länge (kurz)", value: "1.400 mm" },
            { label: "Höhe", value: "1.100 mm" },
            { label: "Tiefe", value: "450 mm" },
          ],
          material: "MDF, anthrazit beschichtet",
          condition: "Neuwertig",
          conditionColor: "text-green",
          cost: "1.800 – 2.600",
        },
        {
          name: "Glastrennwand mit Tür",
          icon: "🚪",
          dimensions: [
            { label: "Breite gesamt", value: "3.600 mm" },
            { label: "Höhe", value: "2.800 mm" },
            { label: "Türbreite", value: "900 mm" },
            { label: "Glasdicke", value: "8 mm (ESG)" },
          ],
          material: "Aluminium-Rahmen, Einscheibensicherheitsglas",
          condition: "Neuwertig",
          conditionColor: "text-green",
          cost: "3.200 – 4.800",
        },
        {
          name: "Abgehängte Decke / Lüftungskanal",
          icon: "🌀",
          dimensions: [
            { label: "Raumbreite", value: "4.800 mm" },
            { label: "Raumtiefe", value: "3.400 mm" },
            { label: "Deckenhöhe", value: "3.100 mm" },
            { label: "Kanal Ø", value: "250 mm" },
          ],
          material: "Verzinktes Stahlblech (Lüftung), Gipskarton (Decke)",
          condition: "Gut",
          conditionColor: "text-green",
          cost: "1.400 – 2.200",
        },
        {
          name: "Bodenfläche",
          icon: "🏠",
          dimensions: [
            { label: "Fläche", value: "ca. 16,3 m²" },
            { label: "Format", value: "600 × 600 mm" },
          ],
          material: "Feinsteinzeug, hellgrau",
          condition: "Neuwertig, keine Beschädigungen",
          conditionColor: "text-green",
          cost: "650 – 980",
          notes: "Verlegemuster: Rasterverband",
        },
        {
          name: "Abfallbehälter (3er-Set)",
          icon: "🗑️",
          dimensions: [
            { label: "Höhe", value: "500 mm" },
            { label: "Ø", value: "300 mm" },
          ],
          material: "Kunststoff / Metall",
          condition: "Gebrauchsfähig",
          conditionColor: "text-yellow",
          cost: "80 – 150",
        },
      ],
    },
  },
];

export default function ResultsPage() {
  const router = useRouter();
  const [activeModel, setActiveModel] = useState(0);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysisReady, setAnalysisReady] = useState(false);
  const [expandedObj, setExpandedObj] = useState<number | null>(null);
  const model = MODELS[activeModel];

  // Simulate analysis delay when model changes
  useEffect(() => {
    setShowAnalysis(false);
    setAnalysisReady(false);
    setExpandedObj(null);
    const t = setTimeout(() => setAnalysisReady(true), 3000);
    return () => clearTimeout(t);
  }, [activeModel]);

  return (
    <div className="h-screen bg-[#111] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 bg-black/80 backdrop-blur-sm z-20">
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-1.5 text-white text-sm font-medium"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Zurück
        </button>

        {/* Model switcher */}
        <div className="flex bg-white/10 rounded-full p-0.5">
          {MODELS.map((m, i) => (
            <button
              key={m.file}
              onClick={() => setActiveModel(i)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
                activeModel === i ? "bg-yellow text-black" : "text-white/50"
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>

        {/* Analysis toggle */}
        <button
          onClick={() => setShowAnalysis(!showAnalysis)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${
            showAnalysis
              ? "bg-yellow text-black"
              : analysisReady
                ? "bg-yellow/20 text-yellow hover:bg-yellow/30"
                : "bg-white/10 text-white/30 cursor-wait"
          }`}
          disabled={!analysisReady}
        >
          {!analysisReady ? (
            <>
              <div className="w-3 h-3 border-2 border-white/30 border-t-yellow rounded-full animate-spin-ring" />
              Analysiert...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              Analyse
            </>
          )}
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* 3D Viewer */}
        <div className={`flex-1 transition-all ${showAnalysis ? "" : ""}`} key={model.file}>
          <GaussianViewer plyUrl={model.file} />
        </div>

        {/* Analysis Panel */}
        {showAnalysis && (
          <div className="w-[380px] bg-black/90 backdrop-blur-md border-l border-white/10 overflow-y-auto z-20 animate-fade-in-up">
            {/* Panel header */}
            <div className="sticky top-0 bg-black/95 backdrop-blur-md px-5 pt-4 pb-3 border-b border-white/10 z-10">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green" />
                  <span className="text-green text-[10px] font-bold uppercase tracking-wider">KI-Analyse abgeschlossen</span>
                </div>
                <button
                  onClick={() => setShowAnalysis(false)}
                  className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/20 transition-all"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <h3 className="text-white font-bold text-lg">{model.name}</h3>
              <p className="text-white/40 text-xs mt-0.5">{model.sceneType} · {model.analysis.objects.length} Objekte erkannt</p>
            </div>

            {/* Summary */}
            <div className="px-5 py-3">
              <div className="bg-yellow/10 border border-yellow/20 rounded-xl p-3 mb-3">
                <p className="text-yellow/90 text-xs leading-relaxed">{model.analysis.summary}</p>
              </div>

              {/* Total cost */}
              <div className="bg-white/5 rounded-xl p-4 mb-4">
                <div className="text-white/40 text-[10px] uppercase tracking-wider mb-1">Geschätzte Gesamtkosten</div>
                <div className="text-white font-bold text-2xl">{model.analysis.totalCost} €</div>
                <div className="text-white/30 text-[10px] mt-1">Material + Montage · Marktpreise April 2026</div>
              </div>

              {/* Objects list */}
              <div className="text-white/40 text-[10px] font-bold uppercase tracking-wider mb-2">
                Erkannte Objekte ({model.analysis.objects.length})
              </div>

              <div className="flex flex-col gap-2">
                {model.analysis.objects.map((obj, i) => {
                  const isExpanded = expandedObj === i;
                  return (
                    <div
                      key={i}
                      className={`rounded-xl border transition-all cursor-pointer ${
                        isExpanded
                          ? "bg-white/10 border-yellow/30"
                          : "bg-white/5 border-transparent hover:bg-white/8 hover:border-white/10"
                      }`}
                      onClick={() => setExpandedObj(isExpanded ? null : i)}
                    >
                      {/* Object header */}
                      <div className="flex items-center gap-3 px-3.5 py-3">
                        <span className="text-lg">{obj.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-white text-sm font-semibold truncate">{obj.name}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[10px] font-medium ${obj.conditionColor}`}>
                              {obj.condition}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-yellow text-sm font-bold">{obj.cost} €</div>
                          <svg
                            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            className={`text-white/30 ml-auto mt-1 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </div>
                      </div>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="px-3.5 pb-3.5 pt-0 border-t border-white/5">
                          {/* Dimensions */}
                          <div className="mt-3 mb-2">
                            <div className="text-white/30 text-[9px] font-bold uppercase tracking-wider mb-1.5">Maße</div>
                            <div className="grid grid-cols-2 gap-1.5">
                              {obj.dimensions.map((dim, j) => (
                                <div key={j} className="bg-black/40 rounded-lg px-2.5 py-2">
                                  <div className="text-white/40 text-[9px]">{dim.label}</div>
                                  <div className="text-white font-bold text-sm">{dim.value}</div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Material */}
                          <div className="mb-2">
                            <div className="text-white/30 text-[9px] font-bold uppercase tracking-wider mb-1">Material</div>
                            <div className="text-white/70 text-xs">{obj.material}</div>
                          </div>

                          {/* Notes */}
                          {obj.notes && (
                            <div className="bg-blue/10 border border-blue/20 rounded-lg px-2.5 py-2 mt-2">
                              <p className="text-blue/80 text-[11px] leading-relaxed">💡 {obj.notes}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 mt-4 pb-4">
                <button className="flex-1 py-3 border border-white/15 text-white rounded-xl font-semibold text-xs hover:bg-white/5 transition-colors">
                  PDF Export
                </button>
                <button className="flex-[2] py-3 bg-yellow hover:bg-yellow-hover text-black rounded-xl font-bold text-xs transition-colors">
                  Angebot erstellen
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom info */}
      <div className="px-5 py-3 bg-black/80 backdrop-blur-sm z-20">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-bold text-base">{model.name}</h2>
            <p className="text-white/40 text-[11px]">3D Gaussian Splat · {model.splats} Punkte</p>
          </div>
          <div className="flex gap-2">
            <span className="px-2.5 py-1 bg-white/5 text-white/50 text-[10px] font-medium rounded-full">{model.size}</span>
            <span className="px-2.5 py-1 bg-yellow/15 text-yellow text-[10px] font-bold rounded-full">{model.sceneType}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";

interface Tip {
  text: string;
  type: "info" | "success" | "warning";
}

const DUMMY_TIPS: Tip[] = [
  { text: "Kontrolliere das Zentrum! Felder e4, d4, e5, d5 sind am wichtigsten.", type: "info" },
  { text: "Entwickle deine Leichtfiguren (Springer & Läufer) vor den Schwerfiguren!", type: "info" },
  { text: "Rochiere früh, um deinen König in Sicherheit zu bringen.", type: "success" },
  { text: "Vermeide unnötige Bauernzüge in der Eröffnung.", type: "warning" },
  { text: "Springer am Rand bringt Kummer und Schand!", type: "warning" },
  { text: "Doppelbauern sind meistens eine Schwäche – vermeide sie wenn möglich.", type: "info" },
  { text: "Verbundene Freibauern im Endspiel sind extrem stark!", type: "success" },
  { text: "Türme gehören auf offene Linien.", type: "info" },
  { text: "Tausche Figuren, wenn du Material-Vorteil hast.", type: "success" },
  { text: "Achte auf Gabelangriffe mit dem Springer!", type: "warning" },
];

export default function CoachTipps() {
  const [tips, setTips] = useState<Tip[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  function giveTip() {
    setIsLoading(true);
    // Simulate a small delay like an API call
    setTimeout(() => {
      const randomTip = DUMMY_TIPS[Math.floor(Math.random() * DUMMY_TIPS.length)];
      setTips((prev) => [randomTip, ...prev].slice(0, 8)); // Keep last 8 tips
      setIsLoading(false);
    }, 300);
  }

  function clearTips() {
    setTips([]);
  }

  return (
    <div className="flex w-full max-w-xs flex-col rounded-2xl bg-[var(--bg-secondary)] p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)]">
          🧠 Coach-Tipps
        </h3>
        {tips.length > 0 && (
          <button
            onClick={clearTips}
            className="text-xs text-[var(--text-secondary)] transition hover:text-[var(--accent)]"
          >
            Löschen
          </button>
        )}
      </div>

      <button
        onClick={giveTip}
        disabled={isLoading}
        className="mb-3 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
      >
        {isLoading ? "Denke nach…" : "💡 Tipp geben"}
      </button>

      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {tips.length === 0 ? (
          <p className="text-center text-xs text-[var(--text-secondary)]">
            Klicke auf &quot;Tipp geben&quot; für einen Hinweis
          </p>
        ) : (
          tips.map((tip, i) => (
            <div
              key={i}
              className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                tip.type === "success"
                  ? "border-l-2 border-green-500 bg-green-900/20 text-green-300"
                  : tip.type === "warning"
                  ? "border-l-2 border-yellow-500 bg-yellow-900/20 text-yellow-300"
                  : "border-l-2 border-blue-500 bg-blue-900/20 text-blue-300"
              }`}
            >
              {tip.text}
            </div>
          ))
        )}
      </div>

      <p className="mt-3 text-center text-[10px] text-[var(--text-secondary)]">
        KI-Coach kommt bald – aktuell nur Dummy-Tipps
      </p>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { analyseGame } from "@/lib/analysis";
import { REASON_TEXT } from "@/lib/gameRules";

export type GameOutcomeView = "win" | "loss" | "draw";

const HEADLINE: Record<GameOutcomeView, { text: string; icon: string; color: string }> = {
  win: { text: "Gewonnen", icon: "♛", color: "var(--accent)" },
  loss: { text: "Verloren", icon: "♟", color: "var(--danger)" },
  draw: { text: "Remis", icon: "½", color: "var(--text-secondary)" },
};

/**
 * Tiefe fuer die Genauigkeit im Ergebnisfenster.
 *
 * Bewusst flacher als in der Partieanalyse: das Fenster soll nach Sekunden eine
 * Zahl zeigen, nicht nach Minuten. Fuer die Genauigkeit reicht das — sie misst
 * den Bewertungsverlust, und der ist ab Tiefe 10 stabil genug.
 */
const ACCURACY_DEPTH = 10;

export default function GameOverModal({
  outcome,
  reason,
  whiteName,
  blackName,
  myColor,
  movesUci,
  onAnalyse,
  onAccuracy,
  onRematch,
  onSecondary,
  secondaryLabel,
  rematchInfo,
  onClose,
}: {
  outcome: GameOutcomeView;
  reason: string | null;
  whiteName: string;
  blackName: string;
  myColor: "w" | "b";
  movesUci: string[];
  onAnalyse: () => void;
  /** Wird einmal aufgerufen, sobald die Genauigkeit feststeht. */
  onAccuracy?: (whiteAccuracy: number, blackAccuracy: number) => void;
  onRematch?: () => void;
  onSecondary?: () => void;
  secondaryLabel?: string;
  rematchInfo?: string | null;
  onClose: () => void;
}) {
  const headline = HEADLINE[outcome];
  const reasonText = reason ? REASON_TEXT[reason] ?? reason : null;

  const [accuracy, setAccuracy] = useState<{ w: number; b: number } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [accuracyFailed, setAccuracyFailed] = useState(false);

  // Zugliste als Zeichenkette: die Array-Identitaet aendert sich bei jedem
  // Server-Update, der Inhalt nach Partieende nicht mehr.
  const movesKey = movesUci.join(" ");

  // Ueber eine Referenz, damit ein neu erzeugter Callback die Analyse nicht
  // abbricht und von vorn startet.
  const onAccuracyRef = useRef(onAccuracy);
  onAccuracyRef.current = onAccuracy;

  useEffect(() => {
    const moves = movesKey ? movesKey.split(" ") : [];
    if (moves.length === 0) return;

    const signal = { aborted: false };
    setProgress({ done: 0, total: moves.length + 1 });
    setAccuracyFailed(false);

    analyseGame(moves, {
      depth: ACCURACY_DEPTH,
      onProgress: (value) => {
        if (!signal.aborted) setProgress(value);
      },
      signal,
    })
      .then((result) => {
        if (signal.aborted) return;
        setAccuracy({ w: result.accuracyWhite, b: result.accuracyBlack });
        onAccuracyRef.current?.(result.accuracyWhite, result.accuracyBlack);
      })
      .catch(() => {
        if (!signal.aborted) setAccuracyFailed(true);
      })
      .finally(() => {
        if (!signal.aborted) setProgress(null);
      });

    // Schliesst der Nutzer das Fenster, laeuft die Engine nicht weiter.
    return () => {
      signal.aborted = true;
    };
  }, [movesKey]);

  const myAccuracy = accuracy ? (myColor === "w" ? accuracy.w : accuracy.b) : null;
  const opponentAccuracy = accuracy ? (myColor === "w" ? accuracy.b : accuracy.w) : null;

  const percentDone = useMemo(
    () => (progress ? Math.round((progress.done / progress.total) * 100) : 0),
    [progress]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card animate-fade-up my-auto w-full max-w-sm p-6 text-center">
        <div className="text-4xl" style={{ color: headline.color }}>
          {headline.icon}
        </div>
        <h2 className="mt-2 text-2xl font-extrabold" style={{ color: headline.color }}>
          {headline.text}
        </h2>
        {reasonText && <p className="mt-1 text-sm text-[var(--text-secondary)]">{reasonText}</p>}

        {/* Wer gegen wen, mit Farbe und Markierung des eigenen Kontos */}
        <div className="mt-5 flex items-center justify-center gap-3 rounded-xl bg-[var(--bg-card)] px-4 py-3">
          <PlayerChip
            name={whiteName}
            color="w"
            isMe={myColor === "w"}
            accuracy={accuracy?.w ?? null}
          />
          <span className="text-xs font-bold text-[var(--text-secondary)]">vs</span>
          <PlayerChip
            name={blackName}
            color="b"
            isMe={myColor === "b"}
            accuracy={accuracy?.b ?? null}
          />
        </div>

        {/* Genauigkeit */}
        <div className="mt-3 rounded-xl bg-[var(--bg-card)] px-4 py-3">
          <p className="label mb-2">Genauigkeit</p>
          {accuracy ? (
            <div className="flex items-center justify-center gap-4">
              <div>
                <p className="text-2xl font-extrabold" style={{ color: "var(--accent)" }}>
                  {myAccuracy!.toFixed(1)}%
                </p>
                <p className="text-[10px] text-[var(--text-secondary)]">du</p>
              </div>
              <div>
                <p className="text-2xl font-extrabold text-[var(--text-secondary)]">
                  {opponentAccuracy!.toFixed(1)}%
                </p>
                <p className="text-[10px] text-[var(--text-secondary)]">Gegner</p>
              </div>
            </div>
          ) : progress ? (
            <>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                <div
                  className="h-full bg-[var(--accent)] transition-[width]"
                  style={{ width: `${percentDone}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                Stockfish rechnet… {progress.done}/{progress.total}
              </p>
            </>
          ) : (
            <p className="text-xs text-[var(--text-secondary)]">
              {accuracyFailed ? "Berechnung fehlgeschlagen." : "Keine Züge zum Auswerten."}
            </p>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <button onClick={onAnalyse} className="btn btn-primary">
            Partieanalyse öffnen
          </button>
          <div className="flex gap-2">
            {onRematch && (
              <button onClick={onRematch} className="btn btn-ghost flex-1">
                Revanche
              </button>
            )}
            {onSecondary && (
              <button onClick={onSecondary} className="btn btn-ghost flex-1">
                {secondaryLabel ?? "Weiter"}
              </button>
            )}
          </div>
          {rematchInfo && <p className="text-xs text-[var(--text-secondary)]">{rematchInfo}</p>}
          <button
            onClick={onClose}
            className="mt-1 text-xs text-[var(--text-secondary)] transition hover:text-white"
          >
            Brett ansehen
          </button>
        </div>
      </div>
    </div>
  );
}

function PlayerChip({
  name,
  color,
  isMe,
  accuracy,
}: {
  name: string;
  color: "w" | "b";
  isMe: boolean;
  accuracy: number | null;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <span
        className="flex h-6 w-6 items-center justify-center rounded-md text-sm"
        style={{
          background: color === "w" ? "#f0f0e6" : "#2a2a2a",
          color: color === "w" ? "#1a1a1a" : "#f0f0e6",
        }}
      >
        {color === "w" ? "♔" : "♚"}
      </span>
      <span className="mt-1 w-full truncate text-sm font-semibold" title={name}>
        {name}
      </span>
      <span className="text-[10px] text-[var(--text-secondary)]">
        {isMe ? "du" : ""}
        {accuracy !== null && `${isMe ? " · " : ""}${accuracy.toFixed(1)}%`}
      </span>
    </div>
  );
}

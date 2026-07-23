"use client";

import { useState } from "react";
import {
  TIME_CONTROL_LIST,
  type ColorChoice,
  type TimeControlKey,
} from "@/lib/timeControls";

const COLOR_OPTIONS: { key: ColorChoice; label: string; glyph: string }[] = [
  { key: "white", label: "Weiß", glyph: "♔" },
  { key: "random", label: "Zufall", glyph: "⁈" },
  { key: "black", label: "Schwarz", glyph: "♚" },
];

export default function ChallengeModal({
  opponentName,
  onCancel,
  onSubmit,
}: {
  opponentName: string;
  onCancel: () => void;
  onSubmit: (timeControl: TimeControlKey, color: ColorChoice) => void;
}) {
  const [timeControl, setTimeControl] = useState<TimeControlKey>("blitz");
  const [color, setColor] = useState<ColorChoice>("random");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="card animate-fade-up w-full max-w-md p-6">
        <h2 className="text-lg font-bold">
          <span className="text-[var(--accent)]">{opponentName}</span> herausfordern
        </h2>
        <p className="mb-5 text-sm text-[var(--text-secondary)]">
          Zeitkontrolle und Farbe wählen.
        </p>

        <p className="label mb-2">Zeitkontrolle</p>
        <div className="mb-5 grid grid-cols-3 gap-2">
          {TIME_CONTROL_LIST.map((spec) => (
            <button
              key={spec.key}
              onClick={() => setTimeControl(spec.key)}
              className={`rounded-xl border p-3 text-center transition ${
                timeControl === spec.key
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-elevated)]"
              }`}
            >
              <div className="text-xl">{spec.icon}</div>
              <div className="mt-1 text-sm font-semibold">{spec.label}</div>
              <div className="text-xs text-[var(--text-secondary)]">{spec.short}</div>
            </button>
          ))}
        </div>

        <p className="label mb-2">Deine Farbe</p>
        <div className="mb-6 grid grid-cols-3 gap-2">
          {COLOR_OPTIONS.map((option) => (
            <button
              key={option.key}
              onClick={() => setColor(option.key)}
              className={`rounded-xl border p-3 text-center transition ${
                color === option.key
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-elevated)]"
              }`}
            >
              <div className="text-2xl leading-none">{option.glyph}</div>
              <div className="mt-1 text-xs font-semibold">{option.label}</div>
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button onClick={onCancel} className="btn btn-ghost flex-1">
            Abbrechen
          </button>
          <button
            onClick={() => onSubmit(timeControl, color)}
            className="btn btn-primary flex-1"
          >
            Herausfordern
          </button>
        </div>
      </div>
    </div>
  );
}

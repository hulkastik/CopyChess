"use client";

import { nextRankFor, rankFor, rankProgress } from "@/lib/rating";

/** Rangabzeichen mit Wertung. `compact` für Listen, sonst mit Fortschrittsbalken. */
export default function RankBadge({
  elo,
  compact = false,
}: {
  elo: number;
  compact?: boolean;
}) {
  const rank = rankFor(elo);
  const next = nextRankFor(elo);

  if (compact) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-bold"
        style={{ background: `${rank.color}22`, color: rank.color }}
        title={`${rank.label} · ${elo}`}
      >
        <span>{rank.icon}</span>
        {elo}
      </span>
    );
  }

  return (
    <div className="rounded-xl bg-[var(--bg-card)] p-4">
      <div className="flex items-center gap-3">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl"
          style={{ background: `${rank.color}22`, color: rank.color }}
        >
          {rank.icon}
        </span>
        <div className="min-w-0">
          <p className="text-lg font-extrabold" style={{ color: rank.color }}>
            {rank.label}
          </p>
          <p className="text-sm text-[var(--text-secondary)]">{elo} Punkte</p>
        </div>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
        <div
          className="h-full transition-[width]"
          style={{ width: `${rankProgress(elo) * 100}%`, background: rank.color }}
        />
      </div>
      <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
        {next ? `Noch ${next.from - elo} bis ${next.label} ${next.icon}` : "Höchster Rang erreicht"}
      </p>
    </div>
  );
}

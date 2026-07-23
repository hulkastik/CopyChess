"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { TIME_CONTROLS, type TimeControlKey } from "@/lib/timeControls";

interface PlayerRef {
  id: string;
  username: string;
  displayName: string;
}

interface GameRow {
  id: string;
  white: PlayerRef;
  black: PlayerRef;
  whiteId: string;
  blackId: string;
  timeControl: TimeControlKey;
  status: string;
  result: string | null;
  startedAt: string;
  movesUci: string;
}

export default function GameList() {
  const { user, ready, authFetch } = useAuth();
  const [games, setGames] = useState<GameRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await authFetch("/api/games?limit=20");
      if (cancelled) return;
      if (res.ok) setGames((await res.json()).games);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user, authFetch]);

  if (!ready || !user) return null;
  if (loading) {
    return <p className="text-sm text-[var(--text-secondary)]">Lade Partien…</p>;
  }
  if (games.length === 0) {
    return (
      <p className="text-sm text-[var(--text-secondary)]">
        Noch keine Partien. Fordere rechts oben einen Freund heraus.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {games.map((game) => {
        const iAmWhite = game.whiteId === user.id;
        const opponent = iAmWhite ? game.black : game.white;
        const active = game.status === "ACTIVE";
        const outcome = !active && game.result
          ? game.result === "1/2-1/2"
            ? "Remis"
            : (game.result === "1-0") === iAmWhite
            ? "Sieg"
            : "Niederlage"
          : null;
        const spec = TIME_CONTROLS[game.timeControl];
        const plies = game.movesUci ? game.movesUci.split(" ").filter(Boolean).length : 0;

        return (
          <div
            key={game.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-3 sm:px-4"
          >
            <span className="text-lg" title={spec?.label}>
              {spec?.icon ?? "♟"}
            </span>
            <div className="min-w-0 flex-1 basis-40">
              <p className="truncate text-sm font-semibold">
                gegen {opponent.displayName}
                <span className="ml-2 text-xs font-normal text-[var(--text-secondary)]">
                  als {iAmWhite ? "Weiß" : "Schwarz"} · {Math.ceil(plies / 2)} Züge
                </span>
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                {new Date(game.startedAt).toLocaleString("de-DE")}
              </p>
            </div>

            {outcome && (
              <span
                className={`rounded-md px-2 py-1 text-xs font-bold ${
                  outcome === "Sieg"
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : outcome === "Niederlage"
                    ? "bg-[rgba(229,72,77,0.14)] text-[var(--danger)]"
                    : "bg-[var(--bg-card)] text-[var(--text-secondary)]"
                }`}
              >
                {outcome}
              </span>
            )}

            {active ? (
              <Link href={`/play/${game.id}`} className="btn btn-primary">
                Fortsetzen
              </Link>
            ) : (
              <Link href={`/analyse/${game.id}`} className="btn btn-ghost">
                Analyse
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}

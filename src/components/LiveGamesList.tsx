"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { TIME_CONTROLS, type TimeControlKey } from "@/lib/timeControls";
import RankBadge from "./RankBadge";

interface PlayerRef {
  id: string;
  username: string;
  displayName: string;
  elo: number;
}

interface LiveGame {
  id: string;
  white: PlayerRef;
  black: PlayerRef;
  timeControl: TimeControlKey;
  startedAt: string;
  movesUci: string;
  isMine: boolean;
}

/** Laufende Partien von Freunden — mit Knopf zum Zuschauen. */
export default function LiveGamesList() {
  const { user, ready, authFetch } = useAuth();
  const [games, setGames] = useState<LiveGame[]>([]);

  const refresh = useCallback(async () => {
    if (!user) {
      setGames([]);
      return;
    }
    const res = await authFetch("/api/games/live");
    if (res.ok) setGames((await res.json()).games);
  }, [user, authFetch]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Partien starten und enden ohne Zutun dieser Seite — regelmaessig nachziehen.
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [user, refresh]);

  if (!ready || !user || games.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="label mb-3">Läuft gerade ({games.length})</h2>
      <div className="flex flex-col gap-2">
        {games.map((game) => {
          const spec = TIME_CONTROLS[game.timeControl];
          const plies = game.movesUci ? game.movesUci.split(" ").filter(Boolean).length : 0;

          return (
            <div
              key={game.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-3 sm:px-4"
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
              </span>

              <div className="min-w-0 flex-1 basis-48">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                  <span className="truncate">{game.white.displayName}</span>
                  <RankBadge elo={game.white.elo} compact />
                  <span className="text-xs font-normal text-[var(--text-secondary)]">gegen</span>
                  <span className="truncate">{game.black.displayName}</span>
                  <RankBadge elo={game.black.elo} compact />
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {spec?.icon} {spec?.short} · {Math.ceil(plies / 2)} Züge
                </p>
              </div>

              {game.isMine ? (
                <Link href={`/play/${game.id}`} className="btn btn-primary shrink-0">
                  Fortsetzen
                </Link>
              ) : (
                <Link href={`/watch/${game.id}`} className="btn btn-ghost shrink-0">
                  👁 Zuschauen
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

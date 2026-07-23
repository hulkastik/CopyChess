"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { REASON_TEXT } from "@/lib/gameRules";
import { TIME_CONTROLS, type TimeControlKey } from "@/lib/timeControls";
import RankBadge from "./RankBadge";

interface PlayerRef {
  id: string;
  username: string;
  displayName: string;
}

interface Profile {
  id: string;
  username: string;
  displayName: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  createdAt: string;
}

interface ProfileGame {
  id: string;
  whiteId: string;
  blackId: string;
  white: PlayerRef;
  black: PlayerRef;
  timeControl: TimeControlKey;
  result: string | null;
  reason: string | null;
  finishedAt: string | null;
  startedAt: string;
  movesUci: string;
  whiteAccuracy: number | null;
  blackAccuracy: number | null;
  whiteEloChange: number | null;
  blackEloChange: number | null;
}

export default function ProfileView({ userId }: { userId: string }) {
  const { user, ready, authFetch } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [games, setGames] = useState<ProfileGame[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    (async () => {
      const res = await authFetch(`/api/profile/${userId}`);
      const data = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setError(data.error ?? "Profil konnte nicht geladen werden");
        return;
      }
      setProfile(data.profile);
      setGames(data.games);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user, userId, authFetch]);

  if (!ready) return <p className="text-[var(--text-secondary)]">Lade…</p>;

  if (!user) {
    return (
      <div className="card p-6 text-center">
        <p className="font-semibold">Nicht angemeldet</p>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Melde dich oben rechts an, um Profile zu sehen.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6 text-center">
        <p className="mb-3 font-semibold text-[var(--danger)]">{error}</p>
        <Link href="/" className="btn btn-ghost inline-block">
          Zur Startseite
        </Link>
      </div>
    );
  }

  if (!profile) return <p className="text-[var(--text-secondary)]">Lade Profil…</p>;

  const played = profile.wins + profile.losses + profile.draws;
  const winRate = played > 0 ? Math.round((profile.wins / played) * 100) : 0;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      {/* Kopf */}
      <div className="card p-5">
        <h2 className="text-2xl font-extrabold">{profile.displayName}</h2>
        <p className="text-sm text-[var(--text-secondary)]">@{profile.username}</p>
      </div>

      <RankBadge elo={profile.elo} />

      {/* Bilanz */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Siege" value={profile.wins} color="var(--accent)" />
        <Stat label="Niederlagen" value={profile.losses} color="var(--danger)" />
        <Stat label="Remis" value={profile.draws} />
        <Stat label="Siegquote" value={`${winRate}%`} />
      </div>

      {/* Partien */}
      <div className="card p-4">
        <p className="label mb-3">Partieverlauf ({games.length})</p>
        {games.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">Noch keine beendeten Partien.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {games.map((game) => (
              <GameRow key={game.id} game={game} userId={userId} viewerId={user.id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="rounded-xl bg-[var(--bg-card)] px-3 py-3 text-center">
      <p className="text-2xl font-extrabold" style={color ? { color } : undefined}>
        {value}
      </p>
      <p className="text-xs text-[var(--text-secondary)]">{label}</p>
    </div>
  );
}

function GameRow({
  game,
  userId,
  viewerId,
}: {
  game: ProfileGame;
  userId: string;
  viewerId: string;
}) {
  const isWhite = game.whiteId === userId;
  const opponent = isWhite ? game.black : game.white;
  const accuracy = isWhite ? game.whiteAccuracy : game.blackAccuracy;
  const opponentAccuracy = isWhite ? game.blackAccuracy : game.whiteAccuracy;
  const eloChange = isWhite ? game.whiteEloChange : game.blackEloChange;
  const spec = TIME_CONTROLS[game.timeControl];

  const outcome =
    game.result === "1/2-1/2" ? "draw" : (game.result === "1-0") === isWhite ? "win" : "loss";
  const outcomeStyle = {
    win: { text: "Sieg", color: "var(--accent)", bg: "var(--accent-soft)" },
    loss: { text: "Niederlage", color: "var(--danger)", bg: "rgba(229,72,77,0.14)" },
    draw: { text: "Remis", color: "var(--text-secondary)", bg: "var(--bg-elevated)" },
  }[outcome];

  // Die Analyse liest die Partie über /api/games/[id] — dort gilt weiterhin,
  // dass nur Beteiligte Zugriff haben. Beim Blick auf ein fremdes Profil führt
  // der Link deshalb ins Leere und wird gar nicht erst angeboten.
  const canAnalyse = game.whiteId === viewerId || game.blackId === viewerId;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-[var(--bg-card)] px-3 py-2.5">
      <span
        className="shrink-0 rounded-md px-2 py-1 text-xs font-bold"
        style={{ background: outcomeStyle.bg, color: outcomeStyle.color }}
      >
        {outcomeStyle.text}
      </span>

      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate text-sm font-semibold">
          gegen {opponent.displayName}
          <span className="ml-2 text-xs font-normal text-[var(--text-secondary)]">
            {spec?.icon} als {isWhite ? "Weiß" : "Schwarz"}
          </span>
        </p>
        <p className="text-xs text-[var(--text-secondary)]">
          {game.reason ? REASON_TEXT[game.reason] ?? game.reason : "—"} ·{" "}
          {new Date(game.finishedAt ?? game.startedAt).toLocaleDateString("de-DE")}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm font-bold tabular-nums">
          {accuracy !== null ? `${accuracy.toFixed(1)}%` : "–"}
          {opponentAccuracy !== null && (
            <span className="ml-1 text-xs font-normal text-[var(--text-secondary)]">
              vs {opponentAccuracy.toFixed(1)}%
            </span>
          )}
        </p>
        <p className="text-xs text-[var(--text-secondary)]">
          Genauigkeit
          {eloChange !== null && (
            <span
              className="ml-2 font-bold"
              style={{ color: eloChange >= 0 ? "var(--accent)" : "var(--danger)" }}
            >
              {eloChange >= 0 ? "+" : ""}
              {eloChange}
            </span>
          )}
        </p>
      </div>

      {canAnalyse && (
        <Link href={`/analyse/${game.id}`} className="btn btn-ghost shrink-0 px-3 py-1 text-xs">
          Analyse
        </Link>
      )}
    </div>
  );
}

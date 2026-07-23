"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Chessboard } from "react-chessboard";
import { useAuth } from "@/context/AuthContext";
import { useSocketConnection } from "@/hooks/useSocket";
import { replayMoves, REASON_TEXT } from "@/lib/gameRules";
import { TIME_CONTROLS, formatClock, type TimeControlKey } from "@/lib/timeControls";

interface PlayerRef {
  id: string;
  username: string;
  displayName: string;
}

interface GameStatePayload {
  id: string;
  white: PlayerRef;
  black: PlayerRef;
  timeControl: TimeControlKey;
  fen: string;
  movesUci: string[];
  movesSan: string[];
  turn: "w" | "b";
  whiteMs: number;
  blackMs: number;
  clockRunning: boolean;
  status: "ACTIVE" | "FINISHED" | "ABORTED";
  result: string | null;
  reason: string | null;
  onlineUserIds: string[];
}

/**
 * Nur-Lesen-Brett für Zuschauer. Bewusst eine eigene Komponente statt eines
 * Schalters im Spielbrett: dort haengen Zugeingabe, Uhrenabrechnung,
 * Engine-Empfehlung, Umwandlung, Aufgabe und Remis dran — alles Dinge, die ein
 * Zuschauer nicht hat. Ein Flag durch all das zu faedeln waere die schlechtere
 * Loesung als hundert Zeilen Anzeige.
 */
export default function SpectatorBoard({ gameId }: { gameId: string }) {
  const { user, ready } = useAuth();
  const { socket, connected } = useSocketConnection();

  const [state, setState] = useState<GameStatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** Aus wessen Sicht das Brett steht. */
  const [flipped, setFlipped] = useState(false);

  const stateReceivedAt = useRef(Date.now());

  const join = useCallback(() => {
    if (!user) return;
    socket.emit(
      "game:spectate",
      { gameId },
      (res: { ok: boolean; state?: GameStatePayload; error?: string }) => {
        if (!res?.ok || !res.state) {
          setError(res?.error ?? "Partie konnte nicht geladen werden");
          return;
        }
        setError(null);
        stateReceivedAt.current = Date.now();
        setState(res.state);
      }
    );
  }, [socket, gameId, user]);

  useEffect(() => {
    if (!ready || !user || !connected) return;
    join();
  }, [ready, user, connected, join]);

  useEffect(() => {
    function onState(next: GameStatePayload) {
      if (next.id !== gameId) return;
      stateReceivedAt.current = Date.now();
      setState(next);
    }
    socket.on("game:state", onState);
    return () => {
      socket.off("game:state", onState);
      socket.emit("game:leave", { gameId });
    };
  }, [socket, gameId]);

  // Uhr zwischen den Server-Meldungen lokal weiterlaufen lassen.
  useEffect(() => {
    if (!state?.clockRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [state?.clockRunning]);

  const clocks = useMemo(() => {
    if (!state) return { w: 0, b: 0 };
    const elapsed = state.clockRunning ? now - stateReceivedAt.current : 0;
    return {
      w: Math.max(0, state.whiteMs - (state.turn === "w" ? elapsed : 0)),
      b: Math.max(0, state.blackMs - (state.turn === "b" ? elapsed : 0)),
    };
  }, [state, now]);

  const chess = useMemo(() => replayMoves(state?.movesUci ?? []), [state]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    const last = state?.movesUci.at(-1);
    if (last) {
      styles[last.slice(0, 2)] = { background: "rgba(255, 213, 79, 0.32)" };
      styles[last.slice(2, 4)] = { background: "rgba(255, 213, 79, 0.32)" };
    }
    return styles;
  }, [state]);

  if (!ready) return <p className="text-[var(--text-secondary)]">Lade…</p>;

  if (!user) {
    return (
      <div className="card p-6 text-center">
        <p className="font-semibold">Nicht angemeldet</p>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Melde dich oben rechts an, um zuzuschauen.
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

  if (!state) {
    return (
      <p className="text-[var(--text-secondary)]">
        {connected ? "Verbinde mit der Partie…" : "Warte auf den Spielserver…"}
      </p>
    );
  }

  const spec = TIME_CONTROLS[state.timeControl];
  const gameOver = state.status !== "ACTIVE";
  const topColor: "w" | "b" = flipped ? "w" : "b";
  const bottomColor: "w" | "b" = flipped ? "b" : "w";

  const resultText = (() => {
    if (!gameOver) return null;
    const reason = state.reason ? REASON_TEXT[state.reason] ?? state.reason : "";
    if (state.result === "1/2-1/2") return `Remis${reason ? ` · ${reason}` : ""}`;
    const winner = state.result === "1-0" ? state.white.displayName : state.black.displayName;
    return `${winner} gewinnt${reason ? ` · ${reason}` : ""}`;
  })();

  const playerRow = (color: "w" | "b") => {
    const player = color === "w" ? state.white : state.black;
    const ms = color === "w" ? clocks.w : clocks.b;
    const active = state.turn === color && state.status === "ACTIVE" && state.clockRunning;
    const online = state.onlineUserIds.includes(player.id);

    return (
      <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg-card)] px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base"
            style={{
              background: color === "w" ? "#f0f0e6" : "#2a2a2a",
              color: color === "w" ? "#1a1a1a" : "#f0f0e6",
            }}
          >
            {color === "w" ? "♔" : "♚"}
          </span>
          <div className="min-w-0">
            <Link
              href={`/profile/${player.id}`}
              className="block truncate text-sm font-semibold hover:text-[var(--accent)]"
            >
              {player.displayName}
            </Link>
            <p className="h-4 text-xs text-[var(--text-secondary)]">
              {online ? "verbunden" : "offline"}
            </p>
          </div>
        </div>
        <div
          className={`shrink-0 rounded-lg px-2.5 py-1.5 font-mono text-lg font-bold tabular-nums sm:px-3 sm:text-xl ${
            active ? (ms < 20_000 ? "clock-low" : "clock-active") : "bg-[var(--bg-elevated)]"
          }`}
        >
          {formatClock(ms)}
        </div>
      </div>
    );
  };

  return (
    <div className="flex w-full max-w-6xl flex-col items-center gap-4 lg:flex-row lg:items-start lg:gap-6">
      <div className="board-shell w-full max-w-[min(100%,600px)]">
        <Chessboard
          options={{
            id: `SpectatorBoard-${gameId}`,
            position: state.fen,
            boardOrientation: flipped ? "black" : "white",
            allowDragging: false,
            allowDrawingArrows: false,
            animationDurationInMs: 180,
            boardStyle: { borderRadius: "10px", boxShadow: "0 8px 40px rgba(0,0,0,0.45)" },
            darkSquareStyle: { backgroundColor: "var(--square-dark)" },
            lightSquareStyle: { backgroundColor: "var(--square-light)" },
            squareStyles,
          }}
        />
      </div>

      <div className="flex w-full flex-col gap-3 lg:max-w-sm">
        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-semibold">
            {spec?.icon} {spec?.label}{" "}
            <span className="text-[var(--text-secondary)]">{spec?.short}</span>
          </span>
          <span className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-bold text-[var(--accent)]">
            👁 Zuschauer
          </span>
        </div>

        {playerRow(topColor)}

        <div
          className={`rounded-xl px-4 py-3 text-center text-sm font-semibold ${
            gameOver
              ? "bg-[var(--accent-soft)] text-[var(--accent)]"
              : "bg-[var(--bg-card)] text-[var(--text-secondary)]"
          }`}
        >
          {gameOver
            ? resultText
            : !state.clockRunning
            ? "Warte auf beide Spieler…"
            : `${state.turn === "w" ? state.white.displayName : state.black.displayName} ist am Zug`}
        </div>

        {playerRow(bottomColor)}

        <div className="flex gap-2">
          <button onClick={() => setFlipped((value) => !value)} className="btn btn-ghost flex-1">
            ⇅ Brett drehen
          </button>
          {gameOver && (
            <Link href={`/analyse/${gameId}`} className="btn btn-primary flex-1">
              Analyse
            </Link>
          )}
        </div>

        <div className="card p-4">
          <p className="label mb-2">Zugverlauf</p>
          <div className="max-h-64 overflow-y-auto">
            {state.movesSan.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">Noch keine Züge</p>
            ) : (
              <div className="grid grid-cols-[2rem_1fr_1fr] gap-x-2 gap-y-1 font-mono text-sm">
                {Array.from({ length: Math.ceil(state.movesSan.length / 2) }, (_, row) => (
                  <div key={row} className="contents">
                    <span className="text-[var(--text-secondary)]">{row + 1}.</span>
                    <span>{state.movesSan[row * 2] ?? ""}</span>
                    <span>{state.movesSan[row * 2 + 1] ?? ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {chess.isCheck() && !gameOver && (
            <p className="mt-2 text-xs font-semibold text-[var(--danger)]">Schach!</p>
          )}
        </div>
      </div>
    </div>
  );
}

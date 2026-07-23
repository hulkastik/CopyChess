"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Chess, Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useAuth } from "@/context/AuthContext";
import { useSocketConnection } from "@/hooks/useSocket";
import { getEngine } from "@/lib/stockfish";
import { drawWarning, replayMoves, REASON_TEXT } from "@/lib/gameRules";
import { TIME_CONTROLS, formatClock, type TimeControlKey } from "@/lib/timeControls";
import GameOverModal, { type GameOutcomeView } from "./GameOverModal";
import PromotionPicker from "./PromotionPicker";

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
  incrementMs: number;
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
  drawOfferFrom: string | null;
  onlineUserIds: string[];
}

/** Engine-Tiefe fuer die Live-Empfehlung: schnell genug fuer Bullet. */
const ASSIST_DEPTH = 14;

export default function LiveGameBoard({ gameId }: { gameId: string }) {
  const { user, ready } = useAuth();
  const { socket, connected } = useSocketConnection();
  const router = useRouter();

  const [state, setState] = useState<GameStatePayload | null>(null);
  const [myColor, setMyColor] = useState<"w" | "b" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [assistMove, setAssistMove] = useState<string | null>(null);
  const [assistThinking, setAssistThinking] = useState(false);
  const [rematchInfo, setRematchInfo] = useState<string | null>(null);
  /** Ergebnis-Popup wurde fuer diese Partie bereits weggeklickt. */
  const [resultDismissed, setResultDismissed] = useState(false);

  /** Zeitpunkt der letzten Server-Nachricht — Basis fuer die lokale Uhr. */
  const stateReceivedAt = useRef(Date.now());
  const assistRequestFen = useRef<string | null>(null);

  // Aus der Zugliste rekonstruiert, nicht aus der FEN — sonst faellt die
  // Wiederholungswarnung weg, weil chess.js dafuer den Verlauf braucht.
  const chess = useMemo(() => replayMoves(state?.movesUci ?? []), [state]);
  const warning = useMemo(() => (state?.status === "ACTIVE" ? drawWarning(chess) : null), [chess, state]);
  const engineAssist = Boolean(user?.engineAssist);
  const isMyTurn = Boolean(state && myColor && state.turn === myColor && state.status === "ACTIVE");

  // ── Partie betreten ─────────────────────────────────────────────────────
  const join = useCallback(() => {
    if (!user) return;
    socket.emit(
      "game:join",
      { gameId },
      (res: { ok: boolean; color?: "w" | "b"; state?: GameStatePayload; error?: string }) => {
        if (!res?.ok || !res.state) {
          setError(res?.error ?? "Partie konnte nicht geladen werden");
          return;
        }
        setError(null);
        setMyColor(res.color ?? null);
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
      setSelectedSquare(null);
    }
    socket.on("game:state", onState);
    return () => {
      socket.off("game:state", onState);
      socket.emit("game:leave", { gameId });
    };
  }, [socket, gameId]);

  // Revanche laeuft als normale Herausforderung — die Sidebar navigiert danach.
  useEffect(() => {
    function onExpired() {
      setRematchInfo(null);
    }
    socket.on("challenge:declined", onExpired);
    socket.on("challenge:expired", onExpired);
    return () => {
      socket.off("challenge:declined", onExpired);
      socket.off("challenge:expired", onExpired);
    };
  }, [socket]);

  // ── Uhr lokal weiterlaufen lassen ───────────────────────────────────────
  useEffect(() => {
    if (!state?.clockRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
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

  // ── Engine-Empfehlung (nur fuer Konten mit engineAssist) ────────────────
  useEffect(() => {
    if (!engineAssist || !state || state.status !== "ACTIVE" || !isMyTurn) {
      setAssistMove(null);
      setAssistThinking(false);
      return;
    }

    const fen = state.fen;
    assistRequestFen.current = fen;
    setAssistMove(null);
    setAssistThinking(true);

    getEngine()
      .analyse(fen, { depth: ASSIST_DEPTH, multipv: 1, timeoutMs: 25_000 })
      .then((result) => {
        // Stellung hat sich waehrend der Rechnung geaendert -> Ergebnis verwerfen.
        if (assistRequestFen.current !== fen) return;
        setAssistMove(result.bestMove);
        setAssistThinking(false);
      })
      .catch(() => {
        if (assistRequestFen.current !== fen) return;
        setAssistThinking(false);
      });
  }, [engineAssist, state, isMyTurn]);

  // ── Zug senden ──────────────────────────────────────────────────────────
  const submitMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      if (!state || !isMyTurn) return false;

      // Lokal validieren, bevor der Server befragt wird — spart eine Runde.
      const probe = new Chess(state.fen);
      let applied;
      try {
        applied = probe.move({ from, to, promotion });
      } catch {
        return false;
      }
      if (!applied) return false;

      const uci = `${from}${to}${promotion ?? ""}`;

      // Optimistisch anzeigen; der Server korrigiert per game:state.
      stateReceivedAt.current = Date.now();
      setState({
        ...state,
        fen: probe.fen(),
        turn: probe.turn(),
        movesUci: [...state.movesUci, uci],
        movesSan: [...state.movesSan, applied.san],
        whiteMs: clocks.w + (myColor === "w" ? state.incrementMs : 0),
        blackMs: clocks.b + (myColor === "b" ? state.incrementMs : 0),
        drawOfferFrom: null,
      });
      setSelectedSquare(null);
      setAssistMove(null);

      socket.emit("game:move", { gameId, uci }, (res: { ok: boolean; error?: string }) => {
        if (!res?.ok) {
          setError(res?.error ?? "Zug abgelehnt");
          join(); // Wahrheit vom Server nachladen
          setTimeout(() => setError(null), 2500);
        }
      });
      return true;
    },
    [state, isMyTurn, clocks, myColor, socket, gameId, join]
  );

  const tryMove = useCallback(
    (from: Square, to: Square): boolean => {
      if (!state || !isMyTurn) return false;
      const piece = chess.get(from);
      if (!piece || piece.color !== myColor) return false;

      const isPromotion =
        piece.type === "p" && (to[1] === "8" || to[1] === "1");
      if (isPromotion) {
        // Nur oeffnen, wenn der Zug ueberhaupt legal ist.
        const legal = chess
          .moves({ square: from, verbose: true })
          .some((move) => move.to === to);
        if (!legal) return false;
        setPendingPromotion({ from, to });
        return true;
      }
      return submitMove(from, to);
    },
    [state, isMyTurn, chess, myColor, submitMove]
  );

  // ── Board-Interaktion ───────────────────────────────────────────────────
  function onPieceDrop({
    sourceSquare,
    targetSquare,
  }: {
    piece: unknown;
    sourceSquare: string;
    targetSquare: string | null;
  }): boolean {
    setSelectedSquare(null);
    if (!targetSquare) return false;
    return tryMove(sourceSquare as Square, targetSquare as Square);
  }

  function onSquareClick({ square }: { piece: unknown; square: string }) {
    if (!isMyTurn) return;
    const target = square as Square;
    if (selectedSquare && selectedSquare !== target) {
      if (tryMove(selectedSquare, target)) return;
    }
    const piece = chess.get(target);
    setSelectedSquare(piece && piece.color === myColor ? target : null);
  }

  // ── Markierungen ────────────────────────────────────────────────────────
  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};

    const lastUci = state?.movesUci.at(-1);
    if (lastUci) {
      styles[lastUci.slice(0, 2)] = { background: "rgba(255, 213, 79, 0.32)" };
      styles[lastUci.slice(2, 4)] = { background: "rgba(255, 213, 79, 0.32)" };
    }

    if (selectedSquare) {
      styles[selectedSquare] = { background: "rgba(107, 171, 74, 0.45)" };
      for (const move of chess.moves({ square: selectedSquare, verbose: true })) {
        styles[move.to] = move.captured
          ? {
              background: "radial-gradient(transparent 52%, rgba(107,171,74,0.45) 52%)",
              borderRadius: "50%",
            }
          : {
              background: "radial-gradient(circle, rgba(107,171,74,0.45) 24%, transparent 24%)",
              borderRadius: "50%",
            };
      }
    }

    return styles;
  }, [state, selectedSquare, chess]);

  const arrows = useMemo(() => {
    if (!engineAssist || !assistMove || !isMyTurn) return [];
    return [
      {
        startSquare: assistMove.slice(0, 2),
        endSquare: assistMove.slice(2, 4),
        color: "#27ae60",
      },
    ];
  }, [engineAssist, assistMove, isMyTurn]);

  // ── Rahmenzustaende ─────────────────────────────────────────────────────
  if (!ready) return <p className="text-[var(--text-secondary)]">Lade…</p>;

  if (!user) {
    return (
      <div className="card p-6 text-center">
        <p className="mb-2 font-semibold">Nicht angemeldet</p>
        <p className="text-sm text-[var(--text-secondary)]">
          Melde dich oben rechts an, um diese Partie zu sehen.
        </p>
      </div>
    );
  }

  if (error && !state) {
    return (
      <div className="card p-6 text-center">
        <p className="mb-3 font-semibold text-[var(--danger)]">{error}</p>
        <Link href="/" className="btn btn-ghost inline-block">
          Zur Startseite
        </Link>
      </div>
    );
  }

  if (!state || !myColor) {
    return (
      <p className="text-[var(--text-secondary)]">
        {connected ? "Verbinde mit der Partie…" : "Warte auf den Spielserver…"}
      </p>
    );
  }

  const opponent = myColor === "w" ? state.black : state.white;
  const me = myColor === "w" ? state.white : state.black;
  const opponentOnline = state.onlineUserIds.includes(opponent.id);
  const gameOver = state.status !== "ACTIVE";
  const spec = TIME_CONTROLS[state.timeControl];

  const outcomeView: GameOutcomeView | null = (() => {
    if (!gameOver || !state.result) return null;
    if (state.result === "1/2-1/2") return "draw";
    const winnerIsWhite = state.result === "1-0";
    return (winnerIsWhite && myColor === "w") || (!winnerIsWhite && myColor === "b")
      ? "win"
      : "loss";
  })();

  const resultText = (() => {
    if (!outcomeView) return null;
    const reason = REASON_TEXT[state.reason ?? ""] ?? state.reason ?? "";
    const label =
      outcomeView === "draw" ? "Remis" : outcomeView === "win" ? "Gewonnen" : "Verloren";
    return reason ? `${label} · ${reason}` : label;
  })();

  const requestRematch = () =>
    socket.emit("game:rematch", { gameId }, (res: { ok: boolean; error?: string }) =>
      setRematchInfo(res?.ok ? "Revanche angefragt…" : res?.error ?? "Fehlgeschlagen")
    );

  // Bewusst eine Funktion, keine Komponente: bei 10 Ticks pro Sekunde wuerde
  // React einen inline definierten Komponententyp jedes Mal neu mounten.
  const playerRow = (player: PlayerRef, color: "w" | "b") => {
    const ms = color === "w" ? clocks.w : clocks.b;
    const active = state.turn === color && state.status === "ACTIVE" && state.clockRunning;
    const low = ms < 20_000;

    return (
      <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg-card)] px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base"
            style={{
              background: color === "w" ? "#f0f0e6" : "#2a2a2a",
              color: color === "w" ? "#1a1a1a" : "#f0f0e6",
            }}
            title={color === "w" ? "Weiß" : "Schwarz"}
          >
            {color === "w" ? "♔" : "♚"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {player.displayName}
              {player.id === user.id && (
                <span className="ml-1 text-xs font-normal text-[var(--text-secondary)]">(du)</span>
              )}
            </p>
            <p className="h-4 truncate text-xs text-[var(--text-secondary)]">
              {capturedBy(chess, color)}
            </p>
          </div>
        </div>
        <div
          className={`shrink-0 rounded-lg px-2.5 py-1.5 font-mono text-lg font-bold tabular-nums sm:px-3 sm:text-xl ${
            active ? (low ? "clock-low" : "clock-active") : "bg-[var(--bg-elevated)]"
          }`}
        >
          {formatClock(ms)}
        </div>
      </div>
    );
  };

  return (
    <div className="flex w-full max-w-6xl flex-col items-center gap-4 lg:flex-row lg:items-start lg:gap-6">
      {/* Brett */}
      <div className="board-shell w-full max-w-[min(100%,600px)]">
        <Chessboard
          options={{
            id: `LiveBoard-${gameId}`,
            position: state.fen,
            onPieceDrop,
            onSquareClick,
            boardOrientation: myColor === "b" ? "black" : "white",
            allowDragging: isMyTurn,
            animationDurationInMs: 180,
            arrows,
            boardStyle: { borderRadius: "10px", boxShadow: "0 8px 40px rgba(0,0,0,0.45)" },
            darkSquareStyle: { backgroundColor: "var(--square-dark)" },
            lightSquareStyle: { backgroundColor: "var(--square-light)" },
            squareStyles: squareStyles,
          }}
        />
      </div>

      {/* Seitenleiste */}
      <div className="flex w-full flex-col gap-3 lg:max-w-sm">
        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-semibold">
            {spec.icon} {spec.label}{" "}
            <span className="text-[var(--text-secondary)]">{spec.short}</span>
          </span>
          {!opponentOnline && !gameOver && (
            <span className="text-xs text-[var(--danger)]">Gegner offline</span>
          )}
        </div>

        {playerRow(opponent, myColor === "w" ? "b" : "w")}

        <div
          className={`rounded-xl px-4 py-3 text-center text-sm font-semibold ${
            gameOver
              ? "bg-[var(--accent-soft)] text-[var(--accent)]"
              : isMyTurn
              ? "bg-[var(--accent-soft)] text-[var(--accent)]"
              : "bg-[var(--bg-card)] text-[var(--text-secondary)]"
          }`}
        >
          {gameOver
            ? resultText
            : !state.clockRunning
            ? "Warte auf den Gegner…"
            : isMyTurn
            ? chess.isCheck()
              ? "Du bist im Schach!"
              : "Du bist am Zug"
            : "Gegner ist am Zug…"}
        </div>

        {playerRow(me, myColor)}

        {warning && (
          <p className="rounded-xl bg-[rgba(244,196,48,0.12)] px-3 py-2 text-center text-xs text-[#f4c430]">
            ⚠ {warning}
          </p>
        )}

        {error && (
          <p className="rounded-xl bg-[rgba(229,72,77,0.12)] px-3 py-2 text-center text-xs text-[var(--danger)]">
            {error}
          </p>
        )}

        {/* Engine-Empfehlung */}
        {engineAssist && !gameOver && (
          <div className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-4 py-3">
            <p className="label mb-1 text-[var(--accent)]">Engine-Empfehlung</p>
            {!isMyTurn ? (
              <p className="text-sm text-[var(--text-secondary)]">
                Aktiv, sobald du am Zug bist ({myColor === "w" ? "Weiß" : "Schwarz"}).
              </p>
            ) : assistThinking ? (
              <p className="animate-pulse text-sm text-[var(--text-secondary)]">
                Stockfish rechnet…
              </p>
            ) : assistMove ? (
              <p className="font-mono text-2xl font-bold text-[var(--accent)]">
                {assistMove.slice(0, 2)} → {assistMove.slice(2, 4)}
                {assistMove.length > 4 && `=${assistMove[4].toUpperCase()}`}
              </p>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">Kein Vorschlag.</p>
            )}
          </div>
        )}

        {/* Remisangebot */}
        {state.drawOfferFrom && state.drawOfferFrom !== user.id && !gameOver && (
          <div className="card border-[var(--accent)] p-3">
            <p className="mb-2 text-sm">{opponent.displayName} bietet Remis an.</p>
            <div className="flex gap-2">
              <button
                onClick={() => socket.emit("game:draw-respond", { gameId, accept: true })}
                className="btn btn-primary flex-1"
              >
                Annehmen
              </button>
              <button
                onClick={() => socket.emit("game:draw-respond", { gameId, accept: false })}
                className="btn btn-ghost flex-1"
              >
                Ablehnen
              </button>
            </div>
          </div>
        )}

        {/* Aktionen */}
        {!gameOver ? (
          <div className="flex gap-2">
            <button
              onClick={() => socket.emit("game:draw-offer", { gameId })}
              disabled={state.drawOfferFrom === user.id}
              className="btn btn-ghost flex-1"
            >
              {state.drawOfferFrom === user.id ? "Remis angeboten" : "Remis anbieten"}
            </button>
            <button
              onClick={() => {
                if (confirm("Partie wirklich aufgeben?")) {
                  socket.emit("game:resign", { gameId });
                }
              }}
              className="btn btn-danger flex-1"
            >
              Aufgeben
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Link href={`/analyse/${gameId}`} className="btn btn-primary text-center">
              Partieanalyse öffnen
            </Link>
            <div className="flex gap-2">
              <button onClick={requestRematch} className="btn btn-ghost flex-1">
                Revanche
              </button>
              <button
                onClick={() => setResultDismissed(false)}
                className="btn btn-ghost flex-1"
              >
                Ergebnis
              </button>
            </div>
            {rematchInfo && (
              <p className="text-center text-xs text-[var(--text-secondary)]">{rematchInfo}</p>
            )}
          </div>
        )}

        {/* Zugliste */}
        <div className="card p-4">
          <p className="label mb-2">Zugverlauf</p>
          <div className="max-h-56 overflow-y-auto">
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
        </div>
      </div>

      {pendingPromotion && (
        <PromotionPicker
          color={myColor}
          onCancel={() => setPendingPromotion(null)}
          onSelect={(piece) => {
            const { from, to } = pendingPromotion;
            setPendingPromotion(null);
            submitMove(from, to, piece);
          }}
        />
      )}

      {outcomeView && !resultDismissed && (
        <GameOverModal
          outcome={outcomeView}
          reason={state.reason}
          whiteName={state.white.displayName}
          blackName={state.black.displayName}
          myColor={myColor}
          movesUci={state.movesUci}
          onAnalyse={() => router.push(`/analyse/${gameId}`)}
          onRematch={requestRematch}
          onSecondary={() => router.push("/")}
          secondaryLabel="Startseite"
          rematchInfo={rematchInfo}
          onClose={() => setResultDismissed(true)}
        />
      )}
    </div>
  );
}

/** Geschlagene Figuren der Gegenseite als Symbolzeile. */
function capturedBy(chess: Chess, color: "w" | "b"): string {
  const START: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const GLYPH: Record<string, string> = {
    p: color === "w" ? "♟" : "♙",
    n: color === "w" ? "♞" : "♘",
    b: color === "w" ? "♝" : "♗",
    r: color === "w" ? "♜" : "♖",
    q: color === "w" ? "♛" : "♕",
  };

  const opponent = color === "w" ? "b" : "w";
  const alive: Record<string, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece && piece.color === opponent && piece.type in alive) alive[piece.type] += 1;
    }
  }

  return (["q", "r", "b", "n", "p"] as const)
    .map((type) => GLYPH[type].repeat(Math.max(0, START[type] - alive[type])))
    .join("");
}

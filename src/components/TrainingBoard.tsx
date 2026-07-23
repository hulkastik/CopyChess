"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { getEngine } from "@/lib/stockfish";
import { useAuth } from "@/context/AuthContext";
import { drawWarning, getOutcome, replayMoves, REASON_TEXT } from "@/lib/gameRules";
import { storeHandoff } from "@/lib/analysisHandoff";
import GameOverModal, { type GameOutcomeView } from "./GameOverModal";
import PromotionPicker from "./PromotionPicker";

// Nur Skill Level + Suchtiefe. UCI_Elo waere die Alternative, klemmt aber bei
// Stockfish 18 unterhalb von ~1320 und ignoriert dann den Skill Level komplett.
const LEVELS = [
  { label: "Anfänger", skill: 0, depth: 4 },
  { label: "Leicht", skill: 3, depth: 6 },
  { label: "Mittel", skill: 7, depth: 8 },
  { label: "Fortgeschritten", skill: 12, depth: 10 },
  { label: "Stark", skill: 16, depth: 14 },
  { label: "Meister", skill: 19, depth: 18 },
  { label: "Maximum", skill: 20, depth: 20 },
];

/** Empfehlungstiefe — unabhaengig von der eingestellten Gegnerstaerke. */
const ASSIST_DEPTH = 14;

export default function TrainingBoard() {
  const { user } = useAuth();
  const router = useRouter();
  // Zugliste ist die Wahrheit, nicht die FEN — nur so sieht chess.js eine
  // dreifache Stellungswiederholung.
  const [movesUci, setMovesUci] = useState<string[]>([]);
  const [levelIndex, setLevelIndex] = useState(2);
  const [playerColor, setPlayerColor] = useState<"w" | "b">("w");
  const [isThinking, setIsThinking] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);

  const [assistMove, setAssistMove] = useState<string | null>(null);
  const [assistThinking, setAssistThinking] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(false);

  /** Verhindert, dass eine laufende Engine-Rechnung doppelt gestartet wird. */
  const thinkingFor = useRef<string | null>(null);
  const assistRequestFen = useRef<string | null>(null);

  const chess = useMemo(() => replayMoves(movesUci), [movesUci]);
  const fen = chess.fen();
  const history = useMemo(() => chess.history(), [chess]);
  const outcome = useMemo(() => getOutcome(chess), [chess]);
  const warning = useMemo(() => drawWarning(chess), [chess]);
  const isGameOver = outcome !== null;
  const myTurn = chess.turn() === playerColor;
  const level = LEVELS[levelIndex];
  const engineAssist = Boolean(user?.engineAssist);

  const pushMove = useCallback((from: Square, to: Square, promotion?: string) => {
    let applied = false;
    setMovesUci((current) => {
      const next = replayMoves(current);
      try {
        if (!next.move({ from, to, promotion })) return current;
        applied = true;
        return [...current, `${from}${to}${promotion ?? ""}`];
      } catch {
        return current;
      }
    });
    setSelectedSquare(null);
    return applied;
  }, []);

  // ── Engine zieht ────────────────────────────────────────────────────────
  useEffect(() => {
    if (isGameOver || myTurn) return;
    if (thinkingFor.current === fen) return;

    thinkingFor.current = fen;
    setIsThinking(true);
    setEngineError(null);

    let cancelled = false;
    getEngine()
      .analyse(fen, {
        depth: level.depth,
        multipv: 1,
        skillLevel: level.skill,
        elo: null,
        timeoutMs: 30_000,
      })
      .then((result) => {
        if (cancelled) return;
        setIsThinking(false);
        if (!result.bestMove) return;
        pushMove(
          result.bestMove.slice(0, 2) as Square,
          result.bestMove.slice(2, 4) as Square,
          result.bestMove.length > 4 ? result.bestMove[4] : undefined
        );
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setIsThinking(false);
        thinkingFor.current = null;
        setEngineError(error.message);
      });

    return () => {
      cancelled = true;
    };
  }, [fen, myTurn, isGameOver, level, pushMove]);

  // ── Engine-Empfehlung (nur fuer Konten mit engineAssist) ────────────────
  useEffect(() => {
    if (!engineAssist || isGameOver || !myTurn) {
      setAssistMove(null);
      setAssistThinking(false);
      return;
    }

    assistRequestFen.current = fen;
    setAssistMove(null);
    setAssistThinking(true);

    // Volle Staerke, egal wie schwach der Gegner eingestellt ist — die
    // Empfehlung soll der beste Zug sein, nicht der beste Zug auf Stufe 3.
    getEngine()
      .analyse(fen, { depth: ASSIST_DEPTH, multipv: 1, skillLevel: 20, elo: null, timeoutMs: 25_000 })
      .then((result) => {
        if (assistRequestFen.current !== fen) return;
        setAssistMove(result.bestMove);
        setAssistThinking(false);
      })
      .catch(() => {
        if (assistRequestFen.current !== fen) return;
        setAssistThinking(false);
      });
  }, [engineAssist, fen, myTurn, isGameOver]);

  // ── Spielerzug ──────────────────────────────────────────────────────────
  const tryMove = useCallback(
    (from: Square, to: Square): boolean => {
      if (!myTurn || isGameOver || isThinking) return false;
      const piece = chess.get(from);
      if (!piece || piece.color !== playerColor) return false;

      const legal = chess.moves({ square: from, verbose: true }).some((move) => move.to === to);
      if (!legal) return false;

      if (piece.type === "p" && (to[1] === "8" || to[1] === "1")) {
        setPendingPromotion({ from, to });
        return true;
      }
      return pushMove(from, to);
    },
    [myTurn, isGameOver, isThinking, chess, playerColor, pushMove]
  );

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
    if (!myTurn || isGameOver || isThinking) return;
    const target = square as Square;
    if (selectedSquare && selectedSquare !== target && tryMove(selectedSquare, target)) return;
    const piece = chess.get(target);
    setSelectedSquare(piece && piece.color === playerColor ? target : null);
  }

  // ── Steuerung ───────────────────────────────────────────────────────────
  function newGame(color: "w" | "b" = playerColor) {
    thinkingFor.current = null;
    setPlayerColor(color);
    setMovesUci([]);
    setResultDismissed(false);
    setIsThinking(false);
    setSelectedSquare(null);
    setEngineError(null);
  }

  const engineName = `Stockfish (${level.label})`;
  const myName = user?.displayName ?? "Du";
  const whiteName = playerColor === "w" ? myName : engineName;
  const blackName = playerColor === "b" ? myName : engineName;

  /** Ergebnis aus meiner Sicht — Grundlage fuer die Überschrift im Popup. */
  const outcomeView: GameOutcomeView | null = (() => {
    if (!outcome) return null;
    if (outcome.result === "1/2-1/2") return "draw";
    const winnerIsWhite = outcome.result === "1-0";
    return winnerIsWhite === (playerColor === "w") ? "win" : "loss";
  })();

  function openAnalysis() {
    storeHandoff({
      movesUci,
      whiteName,
      blackName,
      result: outcome?.result ?? null,
      reason: outcome?.reason ?? null,
      subtitle: `Training gegen ${engineName}`,
      orientation: playerColor,
    });
    router.push("/analyse/session");
  }

  function undo() {
    thinkingFor.current = null;
    setMovesUci((current) => {
      // So weit zuruecknehmen, dass der Spieler wieder am Zug ist.
      let next = current.slice(0, -1);
      if (replayMoves(next).turn() !== playerColor && next.length > 0) next = next.slice(0, -1);
      return next;
    });
    setSelectedSquare(null);
  }

  const statusText = (() => {
    if (outcome) {
      if (outcome.reason === "checkmate") {
        return myTurn ? "Schachmatt – Stockfish gewinnt" : "Schachmatt – du gewinnst!";
      }
      return REASON_TEXT[outcome.reason];
    }
    if (engineError) return "Engine-Fehler";
    if (isThinking) return "Stockfish denkt…";
    if (chess.isCheck()) return myTurn ? "Du bist im Schach!" : "Stockfish steht im Schach";
    return myTurn ? "Du bist am Zug" : "Stockfish ist am Zug…";
  })();

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (!selectedSquare) return styles;
    styles[selectedSquare] = { background: "rgba(107,171,74,0.45)" };
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
    return styles;
  }, [selectedSquare, chess]);

  const arrows = useMemo(() => {
    if (!engineAssist || !assistMove || !myTurn) return [];
    return [
      {
        startSquare: assistMove.slice(0, 2),
        endSquare: assistMove.slice(2, 4),
        color: "#27ae60",
      },
    ];
  }, [engineAssist, assistMove, myTurn]);

  return (
    <div className="flex w-full max-w-5xl flex-col items-center gap-4 lg:flex-row lg:items-start lg:gap-6">
      <div className="board-shell w-full max-w-[min(100%,600px)]">
        <Chessboard
          options={{
            id: "TrainingBoard",
            position: fen,
            onPieceDrop,
            onSquareClick,
            boardOrientation: playerColor === "b" ? "black" : "white",
            allowDragging: myTurn && !isGameOver && !isThinking,
            animationDurationInMs: 180,
            arrows,
            boardStyle: { borderRadius: "10px", boxShadow: "0 8px 40px rgba(0,0,0,0.45)" },
            darkSquareStyle: { backgroundColor: "var(--square-dark)" },
            lightSquareStyle: { backgroundColor: "var(--square-light)" },
            squareStyles: squareStyles,
          }}
        />
      </div>

      <div className="flex w-full flex-col gap-3 lg:max-w-sm">
        <div
          className={`rounded-xl px-4 py-3 text-center text-sm font-semibold ${
            isGameOver
              ? "bg-[var(--accent-soft)] text-[var(--accent)]"
              : isThinking
              ? "animate-pulse bg-[var(--bg-card)] text-[var(--text-secondary)]"
              : "bg-[var(--bg-card)]"
          }`}
        >
          {statusText}
        </div>

        {warning && (
          <p className="rounded-xl bg-[rgba(244,196,48,0.12)] px-3 py-2 text-xs text-[#f4c430]">
            ⚠ {warning}
          </p>
        )}

        {engineError && (
          <p className="rounded-xl bg-[rgba(229,72,77,0.12)] px-3 py-2 text-xs text-[var(--danger)]">
            {engineError}
          </p>
        )}

        {engineAssist && !isGameOver && (
          <div className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-4 py-3">
            <p className="label mb-1 text-[var(--accent)]">Engine-Empfehlung</p>
            {!myTurn ? (
              <p className="text-sm text-[var(--text-secondary)]">
                Aktiv, sobald du am Zug bist ({playerColor === "w" ? "Weiß" : "Schwarz"}).
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

        <div className="card p-4">
          <p className="label mb-2">Schwierigkeit</p>
          <select
            value={levelIndex}
            onChange={(e) => setLevelIndex(Number(e.target.value))}
            className="input"
          >
            {LEVELS.map((option, index) => (
              <option key={option.label} value={index}>
                {option.label}
              </option>
            ))}
          </select>

          <p className="label mb-2 mt-4">Deine Farbe</p>
          <div className="flex gap-2">
            <button
              onClick={() => newGame("w")}
              className={`btn flex-1 ${playerColor === "w" ? "btn-primary" : "btn-ghost"}`}
            >
              ♔ Weiß
            </button>
            <button
              onClick={() => newGame("b")}
              className={`btn flex-1 ${playerColor === "b" ? "btn-primary" : "btn-ghost"}`}
            >
              ♚ Schwarz
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={undo}
            disabled={history.length < 1 || isThinking}
            className="btn btn-ghost flex-1"
          >
            ↩ Zurück
          </button>
          <button onClick={() => newGame()} className="btn btn-ghost flex-1">
            Neues Spiel
          </button>
        </div>

        <button
          onClick={openAnalysis}
          disabled={movesUci.length === 0 || isThinking}
          className={`btn ${isGameOver ? "btn-primary" : "btn-ghost"}`}
        >
          Partieanalyse öffnen
        </button>

        <div className="card p-4">
          <p className="label mb-2">Zugverlauf</p>
          <div className="max-h-56 overflow-y-auto">
            {history.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">Noch keine Züge</p>
            ) : (
              <div className="grid grid-cols-[2rem_1fr_1fr] gap-x-2 gap-y-1 font-mono text-sm">
                {Array.from({ length: Math.ceil(history.length / 2) }, (_, row) => (
                  <div key={row} className="contents">
                    <span className="text-[var(--text-secondary)]">{row + 1}.</span>
                    <span>{history[row * 2] ?? ""}</span>
                    <span>{history[row * 2 + 1] ?? ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {outcomeView && !resultDismissed && (
        <GameOverModal
          outcome={outcomeView}
          reason={outcome?.reason ?? null}
          whiteName={whiteName}
          blackName={blackName}
          myColor={playerColor}
          movesUci={movesUci}
          onAnalyse={openAnalysis}
          onSecondary={() => newGame()}
          secondaryLabel="Neues Spiel"
          onClose={() => setResultDismissed(true)}
        />
      )}

      {pendingPromotion && (
        <PromotionPicker
          color={playerColor}
          onCancel={() => setPendingPromotion(null)}
          onSelect={(piece) => {
            const { from, to } = pendingPromotion;
            setPendingPromotion(null);
            pushMove(from, to, piece);
          }}
        />
      )}
    </div>
  );
}

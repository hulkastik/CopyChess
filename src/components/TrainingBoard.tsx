"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Chess, Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import {
  initStockfish,
  getBestMove,
  setStockfishLevel,
  destroyStockfish,
} from "@/lib/stockfish";
import CoachTipps from "./CoachTipps";

const LEVELS = [
  { label: "Anfänger (Elo ~800)", level: 0, depth: 4 },
  { label: "Leicht (Elo ~1000)", level: 3, depth: 6 },
  { label: "Mittel (Elo ~1400)", level: 7, depth: 8 },
  { label: "Fortgeschritten (Elo ~1800)", level: 12, depth: 10 },
  { label: "Stark (Elo ~2200)", level: 16, depth: 14 },
  { label: "Meister (Elo ~2600)", level: 19, depth: 18 },
  { label: "Maximum (Elo ~3000)", level: 20, depth: 20 },
];

export default function TrainingBoard() {
  const [game, setGame] = useState(new Chess());
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [selectedLevel, setSelectedLevel] = useState(2); // Mittel
  const [isThinking, setIsThinking] = useState(false);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [playerColor] = useState<"w" | "b">("w"); // Player is always white
  const workerRef = useRef<Worker | null>(null);

  const isGameOver = game.isGameOver();
  const myTurn = game.turn() === playerColor;

  // ── Initialize Stockfish in Web Worker ────────────────────────────────
  useEffect(() => {
    try {
      const worker = initStockfish();
      workerRef.current = worker;

      // Wait for UCI ready, then set level
      const onMessage = (e: MessageEvent) => {
        if (typeof e.data === "string" && e.data.includes("uciok")) {
          setStockfishLevel(worker, LEVELS[selectedLevel].level);
          worker.postMessage("isready");
        }
      };
      worker.addEventListener("message", onMessage);

      return () => {
        worker.removeEventListener("message", onMessage);
      };
    } catch (err) {
      console.error("Stockfish init error:", err);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update Stockfish level when changed ───────────────────────────────
  useEffect(() => {
    if (workerRef.current) {
      setStockfishLevel(workerRef.current, LEVELS[selectedLevel].level);
    }
  }, [selectedLevel]);

  // ── Cleanup on unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      destroyStockfish();
      workerRef.current = null;
    };
  }, []);

  // ── Stockfish makes a move when it's the engine's turn ────────────────
  useEffect(() => {
    if (isGameOver || myTurn || isThinking) return;
    if (!workerRef.current) return;
    setSelectedSquare(null); // Clear highlighting during engine's turn

    const makeEngineMove = async () => {
      setIsThinking(true);
      try {
        const bestMoveUci = await getBestMove(
          workerRef.current!,
          game.fen(),
          LEVELS[selectedLevel].depth
        );

        // UCi move format: e2e4, e7e8q (with promotion)
        const from = bestMoveUci.slice(0, 2) as Square;
        const to = bestMoveUci.slice(2, 4) as Square;
        const promotion = bestMoveUci.length > 4 ? bestMoveUci[4] : undefined;

        const gameCopy = new Chess(game.fen());
        const move = gameCopy.move({ from, to, promotion });
        if (move) {
          setGame(gameCopy);
          setMoveHistory((prev) => [...prev, move.san]);
        }
      } catch (err) {
        console.error("Engine move error:", err);
      }
      setIsThinking(false);
    };

    // Small delay so the user can see the board update
    const timer = setTimeout(makeEngineMove, 500);
    return () => clearTimeout(timer);
  }, [game, myTurn, isGameOver, isThinking, selectedLevel]);

  // ── Status text ─────────────────────────────────────────────────────────
  const statusText = useMemo(() => {
    if (game.isCheckmate()) {
      return myTurn ? "Schachmatt – Stockfish gewinnt!" : "Schachmatt – Du gewinnst! 🎉";
    }
    if (game.isDraw()) return "Unentschieden!";
    if (game.isStalemate()) return "Patt!";
    if (isThinking) return "Stockfish denkt nach…";
    if (game.isCheck()) return myTurn ? "Du bist im Schach!" : "Stockfish ist im Schach!";
    return myTurn ? "Du bist am Zug" : "Stockfish ist am Zug…";
  }, [game, myTurn, isThinking]);

  // ── Player makes a move ─────────────────────────────────────────────
  const onDrop = useCallback(
    ({ sourceSquare, targetSquare }: { piece: unknown; sourceSquare: string; targetSquare: string | null }): boolean => {
      if (!myTurn || isGameOver || isThinking || !targetSquare) {
        setSelectedSquare(null);
        return false;
      }

      const gameCopy = new Chess(game.fen());
      try {
        const move = gameCopy.move({
          from: sourceSquare as Square,
          to: targetSquare as Square,
          promotion: "q",
        });
        if (move) {
          setGame(gameCopy);
          setMoveHistory((prev) => [...prev, move.san]);
          setSelectedSquare(null);
          return true;
        }
      } catch {
        // illegal
      }
      setSelectedSquare(null);
      return false;
    },
    [game, myTurn, isGameOver, isThinking]
  );

  // ── Undo move (takes back player's + engine's last moves) ────────────
  function undoMove() {
    const gameCopy = new Chess(game.fen());
    // Undo engine's move
    gameCopy.undo();
    // Undo player's move
    gameCopy.undo();
    setGame(gameCopy);
    setMoveHistory((prev) => prev.slice(0, -2));
    setSelectedSquare(null);
  }

  // ── New game ──────────────────────────────────────────────────────────
  function newGame() {
    setGame(new Chess());
    setMoveHistory([]);
    setIsThinking(false);
    setSelectedSquare(null);
  }

  // ── Click-to-move ─────────────────────────────────────────────────────
  function onSquareClick({ square }: { piece: unknown; square: string }) {
    if (!myTurn || isGameOver || isThinking) return;
    const sq = square as Square;
    if (selectedSquare) {
      const gameCopy = new Chess(game.fen());
      try {
        const move = gameCopy.move({ from: selectedSquare, to: sq, promotion: "q" });
        if (move) {
          setGame(gameCopy);
          setMoveHistory((prev) => [...prev, move.san]);
          setSelectedSquare(null);
          return;
        }
      } catch { /* illegal */ }
      setSelectedSquare(sq);
    } else {
      setSelectedSquare(sq);
    }
  }

  // ── Drag highlighting ─────────────────────────────────────────────────
  function onPieceDrag({ square }: { isSparePiece: boolean; piece: unknown; square: string | null }) {
    if (square && myTurn && !isGameOver && !isThinking) {
      setSelectedSquare(square as Square);
    }
  }

  // ── Legal move highlighting ───────────────────────────────────────────
  const legalMoveStyles = useMemo(() => {
    if (!selectedSquare) return {};
    const moves = game.moves({ square: selectedSquare, verbose: true });
    const styles: Record<string, React.CSSProperties> = {};
    moves.forEach((m) => {
      styles[m.to] = m.captured
        ? {
            background:
              "radial-gradient(transparent 51%, rgba(233,69,96,0.4) 51%)",
            borderRadius: "50%",
          }
        : {
            background:
              "radial-gradient(circle, rgba(233,69,96,0.4) 25%, transparent 25%)",
            borderRadius: "50%",
          };
    });
    styles[selectedSquare] = { background: "rgba(233,69,96,0.5)" };
    return styles;
  }, [selectedSquare, game]);

  return (
    <div className="flex flex-col items-center gap-6 xl:flex-row xl:items-start xl:gap-10">
      {/* Board */}
      <div className="w-[min(90vw,560px)]">
        <Chessboard
          options={{
            id: "TrainingBoard",
            position: game.fen(),
            onPieceDrop: onDrop,
            onPieceDrag: onPieceDrag,
            onSquareClick: onSquareClick,
            boardOrientation: "white",
            allowDragging: myTurn && !isGameOver && !isThinking,
            animationDurationInMs: 200,
            boardStyle: {
              borderRadius: "8px",
              boxShadow: "0 4px 30px rgba(0,0,0,0.5)",
            },
            darkSquareStyle: { backgroundColor: "#779952" },
            lightSquareStyle: { backgroundColor: "#edeed1" },
            squareStyles: legalMoveStyles,
          }}
        />
      </div>

      {/* Side Panel */}
      <div className="flex w-full max-w-xs flex-col gap-4">
        {/* Status */}
        <div
          className={`rounded-xl px-5 py-3 text-center font-semibold ${
            isGameOver
              ? "bg-[var(--accent)] text-white"
              : isThinking
              ? "animate-pulse bg-yellow-500/20 text-yellow-300"
              : "bg-[var(--bg-card)] text-[var(--text-primary)]"
          }`}
        >
          {statusText}
        </div>

        {/* Difficulty */}
        <div className="rounded-xl bg-[var(--bg-secondary)] p-4">
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
            Schwierigkeit
          </label>
          <select
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(Number(e.target.value))}
            className="w-full rounded-lg bg-[var(--bg-card)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            {LEVELS.map((l, i) => (
              <option key={i} value={i}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={undoMove}
            disabled={moveHistory.length < 2 || isThinking}
            className="flex-1 rounded-lg bg-[var(--bg-card)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent)] disabled:opacity-40"
          >
            ↩ Undo
          </button>
          <button
            onClick={newGame}
            className="flex-1 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            Neues Spiel
          </button>
        </div>

        {/* Move History */}
        <div className="rounded-xl bg-[var(--bg-secondary)] p-4">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)]">
            Zugverlauf
          </h3>
          <div className="max-h-40 overflow-y-auto text-sm">
            {moveHistory.length === 0 ? (
              <p className="text-[var(--text-secondary)]">Noch keine Züge</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {moveHistory.map((move, i) => (
                  <span
                    key={i}
                    className={
                      i % 2 === 0 ? "text-white" : "text-[var(--text-secondary)]"
                    }
                  >
                    {i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ""}
                    {move}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Coach Tips */}
        <CoachTipps />
      </div>
    </div>
  );
}

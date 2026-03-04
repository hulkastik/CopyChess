"use client";

import { useState, useMemo, useCallback } from "react";
import { Chess, Square } from "chess.js";
import { Chessboard } from "react-chessboard";

export default function LocalChessBoard() {
  const [game, setGame] = useState(new Chess());
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);

  // Determine whose turn it is
  const turn = game.turn(); // 'w' or 'b'
  const isGameOver = game.isGameOver();

  const statusText = useMemo(() => {
    if (game.isCheckmate()) {
      return `Schachmatt! ${turn === "w" ? "Schwarz" : "Weiß"} gewinnt!`;
    }
    if (game.isDraw()) return "Unentschieden!";
    if (game.isStalemate()) return "Patt!";
    if (game.isCheck()) {
      return `${turn === "w" ? "Weiß" : "Schwarz"} ist im Schach!`;
    }
    return `${turn === "w" ? "Weiß" : "Schwarz"} ist am Zug`;
  }, [game, turn]);

  const makeMove = useCallback(
    (sourceSquare: Square, targetSquare: Square) => {
      const gameCopy = new Chess(game.fen());
      try {
        const move = gameCopy.move({
          from: sourceSquare,
          to: targetSquare,
          promotion: "q", // always promote to queen for simplicity
        });
        if (move) {
          setGame(gameCopy);
          setMoveHistory((prev) => [...prev, move.san]);
          setSelectedSquare(null);
          return true;
        }
      } catch {
        // illegal move – piece snaps back
      }
      return false;
    },
    [game]
  );

  function onDrop({ sourceSquare, targetSquare }: { piece: unknown; sourceSquare: string; targetSquare: string | null }) {
    if (!targetSquare) { setSelectedSquare(null); return false; }
    const success = makeMove(sourceSquare as Square, targetSquare as Square);
    if (!success) setSelectedSquare(null);
    return success;
  }

  function onPieceDrag({ square }: { isSparePiece: boolean; piece: unknown; square: string | null }) {
    if (square) setSelectedSquare(square as Square);
  }

  function onSquareClick({ square }: { piece: unknown; square: string }) {
    const sq = square as Square;
    if (selectedSquare) {
      const success = makeMove(selectedSquare, sq);
      if (!success) {
        setSelectedSquare(sq);
      }
    } else {
      setSelectedSquare(sq);
    }
  }

  function resetGame() {
    setGame(new Chess());
    setMoveHistory([]);
    setSelectedSquare(null);
  }

  // Highlight legal moves for selected square
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
    styles[selectedSquare] = {
      background: "rgba(233,69,96,0.5)",
    };
    return styles;
  }, [selectedSquare, game]);

  return (
    <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-start lg:gap-10">
      {/* Board */}
      <div className="w-[min(90vw,560px)]">
        <Chessboard
          options={{
            id: "LocalBoard",
            position: game.fen(),
            onPieceDrop: onDrop,
            onPieceDrag: onPieceDrag,
            onSquareClick: onSquareClick,
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
              : "bg-[var(--bg-card)] text-[var(--text-primary)]"
          }`}
        >
          {statusText}
        </div>

        {/* Buttons */}
        <button
          onClick={resetGame}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
        >
          Neues Spiel
        </button>

        {/* Move History */}
        <div className="rounded-xl bg-[var(--bg-secondary)] p-4">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)]">
            Zugverlauf
          </h3>
          <div className="max-h-64 overflow-y-auto text-sm">
            {moveHistory.length === 0 ? (
              <p className="text-[var(--text-secondary)]">Noch keine Züge</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {moveHistory.map((move, i) => (
                  <span
                    key={i}
                    className={i % 2 === 0 ? "text-white" : "text-[var(--text-secondary)]"}
                  >
                    {i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ""}
                    {move}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

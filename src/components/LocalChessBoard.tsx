"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { drawWarning, getOutcome, replayMoves, REASON_TEXT } from "@/lib/gameRules";
import { storeHandoff } from "@/lib/analysisHandoff";
import PromotionPicker from "./PromotionPicker";

export default function LocalChessBoard() {
  const router = useRouter();
  // Zugliste statt FEN: dreifache Stellungswiederholung braucht den Verlauf.
  const [movesUci, setMovesUci] = useState<string[]>([]);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);

  const chess = useMemo(() => replayMoves(movesUci), [movesUci]);
  const fen = chess.fen();
  const history = useMemo(() => chess.history(), [chess]);
  const outcome = useMemo(() => getOutcome(chess), [chess]);
  const warning = useMemo(() => drawWarning(chess), [chess]);
  const turn = chess.turn();
  const isGameOver = outcome !== null;

  const statusText = (() => {
    if (outcome) {
      return outcome.reason === "checkmate"
        ? `Schachmatt – ${turn === "w" ? "Schwarz" : "Weiß"} gewinnt`
        : REASON_TEXT[outcome.reason];
    }
    if (chess.isCheck()) return `${turn === "w" ? "Weiß" : "Schwarz"} steht im Schach`;
    return `${turn === "w" ? "Weiß" : "Schwarz"} ist am Zug`;
  })();

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

  const tryMove = useCallback(
    (from: Square, to: Square): boolean => {
      const piece = chess.get(from);
      if (!piece || piece.color !== turn) return false;
      const legal = chess.moves({ square: from, verbose: true }).some((move) => move.to === to);
      if (!legal) return false;

      if (piece.type === "p" && (to[1] === "8" || to[1] === "1")) {
        setPendingPromotion({ from, to });
        return true;
      }
      return pushMove(from, to);
    },
    [chess, turn, pushMove]
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
    const target = square as Square;
    if (selectedSquare && selectedSquare !== target && tryMove(selectedSquare, target)) return;
    const piece = chess.get(target);
    setSelectedSquare(piece && piece.color === turn ? target : null);
  }

  function undo() {
    setMovesUci((current) => current.slice(0, -1));
    setSelectedSquare(null);
  }

  function reset() {
    setMovesUci([]);
    setSelectedSquare(null);
  }

  function openAnalysis() {
    storeHandoff({
      movesUci,
      whiteName: "Weiß",
      blackName: "Schwarz",
      result: outcome?.result ?? null,
      reason: outcome?.reason ?? null,
      subtitle: "Lokale Partie",
      orientation: flipped ? "b" : "w",
    });
    router.push("/analyse/session");
  }

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

  return (
    <div className="flex w-full max-w-5xl flex-col items-center gap-4 lg:flex-row lg:items-start lg:gap-6">
      <div className="board-shell w-full max-w-[min(100%,600px)]">
        <Chessboard
          options={{
            id: "LocalBoard",
            position: fen,
            onPieceDrop,
            onSquareClick,
            boardOrientation: flipped ? "black" : "white",
            animationDurationInMs: 180,
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
            isGameOver ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--bg-card)]"
          }`}
        >
          {statusText}
        </div>

        {warning && (
          <p className="rounded-xl bg-[rgba(244,196,48,0.12)] px-3 py-2 text-xs text-[#f4c430]">
            ⚠ {warning}
          </p>
        )}

        <div className="flex gap-2">
          <button onClick={undo} disabled={history.length === 0} className="btn btn-ghost flex-1">
            ↩ Zurück
          </button>
          <button onClick={() => setFlipped((v) => !v)} className="btn btn-ghost flex-1">
            ⇅ Drehen
          </button>
          <button onClick={reset} className="btn btn-ghost flex-1">
            Neu
          </button>
        </div>

        <button
          onClick={openAnalysis}
          disabled={movesUci.length === 0}
          className={`btn ${isGameOver ? "btn-primary" : "btn-ghost"}`}
        >
          Partieanalyse öffnen
        </button>

        <div className="card p-4">
          <p className="label mb-2">Zugverlauf</p>
          <div className="max-h-72 overflow-y-auto">
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

      {pendingPromotion && (
        <PromotionPicker
          color={turn}
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

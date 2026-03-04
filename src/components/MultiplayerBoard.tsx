"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Chess, Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useSocket } from "@/hooks/useSocket";

type PlayerColor = "w" | "b" | null;

export default function MultiplayerBoard() {
  const socket = useSocket();

  const [game, setGame] = useState(new Chess());
  const [playerColor, setPlayerColor] = useState<PlayerColor>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [opponentJoined, setOpponentJoined] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);

  const myTurn = game.turn() === playerColor;
  const boardOrientation = playerColor === "b" ? "black" : "white";

  // ── Socket event listeners ──────────────────────────────────────────────
  useEffect(() => {
    socket.on("opponent-joined", (data: { fen: string }) => {
      setOpponentJoined(true);
      setStatusMessage("Gegner ist beigetreten! Spiel beginnt.");
      setGame(new Chess(data.fen));
    });

    socket.on("opponent-move", (data: { fen: string; move: string }) => {
      setGame(new Chess(data.fen));
      setMoveHistory((prev) => [...prev, data.move]);
    });

    socket.on("game-over", (data: { result: string }) => {
      setStatusMessage(`Spiel vorbei: ${data.result}`);
    });

    socket.on("opponent-disconnected", () => {
      setStatusMessage("Gegner hat die Verbindung getrennt.");
      setOpponentJoined(false);
    });

    return () => {
      socket.off("opponent-joined");
      socket.off("opponent-move");
      socket.off("game-over");
      socket.off("opponent-disconnected");
    };
  }, [socket]);

  // ── Create Room ─────────────────────────────────────────────────────────
  const createRoom = useCallback(() => {
    socket.emit("create-room", (data: { roomId: string; color: "w" }) => {
      setRoomId(data.roomId);
      setPlayerColor(data.color);
      setStatusMessage(`Raum erstellt! ID: ${data.roomId} – Warte auf Gegner…`);
    });
  }, [socket]);

  // ── Join Room ───────────────────────────────────────────────────────────
  const joinRoom = useCallback(() => {
    if (!joinInput.trim()) return;
    socket.emit(
      "join-room",
      joinInput.trim(),
      (data: { success: boolean; color?: "b"; fen?: string; error?: string }) => {
        if (data.success) {
          setRoomId(joinInput.trim());
          setPlayerColor(data.color!);
          setOpponentJoined(true);
          if (data.fen) setGame(new Chess(data.fen));
          setStatusMessage("Beigetreten! Du spielst Schwarz.");
        } else {
          setStatusMessage(`Fehler: ${data.error}`);
        }
      }
    );
  }, [joinInput, socket]);

  // ── Make a move ─────────────────────────────────────────────────────────
  function makeMove(sourceSquare: Square, targetSquare: Square): boolean {
    const gameCopy = new Chess(game.fen());
    try {
      const move = gameCopy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: "q",
      });
      if (move) {
        setGame(gameCopy);
        setMoveHistory((prev) => [...prev, move.san]);
        setSelectedSquare(null);

        // Send move to server
        socket.emit("move", {
          roomId,
          fen: gameCopy.fen(),
          move: move.san,
        });

        // Check for game over
        if (gameCopy.isGameOver()) {
          let result = "Unentschieden";
          if (gameCopy.isCheckmate()) {
            result = gameCopy.turn() === "w" ? "Schwarz gewinnt!" : "Weiß gewinnt!";
          }
          setStatusMessage(`Spiel vorbei: ${result}`);
          socket.emit("game-over", { roomId, result });
        }
        return true;
      }
    } catch {
      // illegal
    }
    return false;
  }

  function onDrop({ sourceSquare, targetSquare }: { piece: unknown; sourceSquare: string; targetSquare: string | null }): boolean {
    if (!myTurn || !opponentJoined || !targetSquare) {
      setSelectedSquare(null);
      return false;
    }
    const success = makeMove(sourceSquare as Square, targetSquare as Square);
    if (!success) setSelectedSquare(null);
    return success;
  }

  function onSquareClick({ square }: { piece: unknown; square: string }) {
    if (!myTurn || !opponentJoined) return;
    const sq = square as Square;
    if (selectedSquare) {
      const success = makeMove(selectedSquare, sq);
      if (!success) setSelectedSquare(sq);
    } else {
      setSelectedSquare(sq);
    }
  }

  function onPieceDrag({ square }: { isSparePiece: boolean; piece: unknown; square: string | null }) {
    if (square && myTurn && opponentJoined) {
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

  // ── Status text ─────────────────────────────────────────────────────────
  const turnText = useMemo(() => {
    if (!roomId) return "Erstelle oder trete einem Raum bei";
    if (!opponentJoined) return "Warte auf Gegner…";
    if (game.isGameOver()) return statusMessage;
    return myTurn ? "Du bist am Zug!" : "Gegner ist am Zug…";
  }, [roomId, opponentJoined, game, myTurn, statusMessage]);

  // ── Lobby (no room yet) ─────────────────────────────────────────────────
  if (!roomId) {
    return (
      <div className="flex flex-col items-center gap-6">
        <h2 className="text-2xl font-bold">Multiplayer Lobby</h2>

        <button
          onClick={createRoom}
          className="rounded-lg bg-[var(--accent)] px-6 py-3 text-lg font-semibold text-white transition hover:bg-[var(--accent-hover)]"
        >
          Neues Spiel erstellen
        </button>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Raum-ID eingeben"
            value={joinInput}
            onChange={(e) => setJoinInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && joinRoom()}
            className="rounded-lg bg-[var(--bg-card)] px-4 py-2 text-white placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <button
            onClick={joinRoom}
            className="rounded-lg bg-[var(--bg-card)] px-4 py-2 font-semibold text-white transition hover:bg-[var(--accent)]"
          >
            Beitreten
          </button>
        </div>

        {statusMessage && (
          <p className="text-sm text-[var(--accent)]">{statusMessage}</p>
        )}
      </div>
    );
  }

  // ── Game view ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-start lg:gap-10">
      {/* Board */}
      <div className="w-[min(90vw,560px)]">
        <Chessboard
          options={{
            id: "MultiplayerBoard",
            position: game.fen(),
            onPieceDrop: onDrop,
            onPieceDrag: onPieceDrag,
            onSquareClick: onSquareClick,
            boardOrientation: boardOrientation,
            allowDragging: myTurn && opponentJoined,
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
        {/* Room Info */}
        <div className="rounded-xl bg-[var(--bg-card)] p-4">
          <p className="text-xs text-[var(--text-secondary)]">Raum-ID</p>
          <p className="font-mono text-lg font-bold text-[var(--accent)]">
            {roomId}
          </p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Farbe: {playerColor === "w" ? "Weiß" : "Schwarz"}
          </p>
        </div>

        {/* Turn Info */}
        <div
          className={`rounded-xl px-5 py-3 text-center font-semibold ${
            myTurn
              ? "bg-green-600/20 text-green-400"
              : "bg-[var(--bg-card)] text-[var(--text-secondary)]"
          }`}
        >
          {turnText}
        </div>

        {/* Status */}
        {statusMessage && (
          <div className="rounded-xl bg-[var(--accent)]/10 px-4 py-2 text-center text-sm text-[var(--accent)]">
            {statusMessage}
          </div>
        )}

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
      </div>
    </div>
  );
}

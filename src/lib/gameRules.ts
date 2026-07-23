import { Chess } from "chess.js";

/**
 * Spielt eine UCI-Zugliste auf einer frischen Instanz nach.
 *
 * Wichtig: `new Chess(fen)` kennt keinen Verlauf. Dreifache Stellungswiederholung
 * ist damit grundsaetzlich nicht erkennbar, weil chess.js dafuer alle vorher
 * erreichten Stellungen braucht. Ein Brett, das Remis korrekt melden soll, muss
 * deshalb ueber die Zugliste rekonstruiert werden, nicht ueber die FEN.
 */
export function replayMoves(movesUci: string[]): Chess {
  const chess = new Chess();
  for (const uci of movesUci) {
    try {
      chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
    } catch {
      break;
    }
  }
  return chess;
}

export type EndReason =
  | "checkmate"
  | "stalemate"
  | "insufficient"
  | "repetition"
  | "fifty-move"
  | "draw";

export interface Outcome {
  over: boolean;
  /** "1-0" | "0-1" | "1/2-1/2" */
  result: string;
  reason: EndReason;
}

/**
 * Offizielle Abbruchbedingungen in der Reihenfolge, in der sie greifen.
 *
 * Threefold und die 50-Zuege-Regel sind nach FIDE eigentlich Reklamationsrechte
 * (automatisch erst bei fuenffacher Wiederholung bzw. 75 Zuegen). Online-Schach
 * wertet beides sofort als Remis — dieselbe Konvention gilt hier, sonst laufen
 * Blitzpartien in eine Endlosschleife, die keiner der beiden abbrechen kann.
 */
export function getOutcome(chess: Chess): Outcome | null {
  if (!chess.isGameOver()) return null;

  if (chess.isCheckmate()) {
    // Die Seite am Zug steht matt.
    return { over: true, result: chess.turn() === "w" ? "0-1" : "1-0", reason: "checkmate" };
  }
  if (chess.isStalemate()) {
    return { over: true, result: "1/2-1/2", reason: "stalemate" };
  }
  if (chess.isInsufficientMaterial()) {
    return { over: true, result: "1/2-1/2", reason: "insufficient" };
  }
  if (chess.isThreefoldRepetition()) {
    return { over: true, result: "1/2-1/2", reason: "repetition" };
  }
  if (chess.isDrawByFiftyMoves()) {
    return { over: true, result: "1/2-1/2", reason: "fifty-move" };
  }
  return { over: true, result: "1/2-1/2", reason: "draw" };
}

export const REASON_TEXT: Record<string, string> = {
  checkmate: "Schachmatt",
  stalemate: "Patt",
  insufficient: "Remis – ungenügendes Material",
  repetition: "Remis – dreifache Stellungswiederholung",
  "fifty-move": "Remis – 50-Züge-Regel",
  draw: "Remis",
  timeout: "Zeit abgelaufen",
  "timeout-insufficient": "Remis – Zeit abgelaufen, kein Mattmaterial",
  resign: "Aufgegeben",
  agreement: "Remis vereinbart",
};

/** Warnhinweis, bevor eine Partie unbeabsichtigt ins Remis läuft. */
export function drawWarning(chess: Chess): string | null {
  if (chess.isGameOver()) return null;

  // Halbzugzaehler steht in der FEN an vorletzter Stelle.
  const halfmoves = Number(chess.fen().split(" ")[4]);
  if (Number.isFinite(halfmoves) && halfmoves >= 80) {
    return `50-Züge-Regel: noch ${Math.ceil((100 - halfmoves) / 2)} Züge bis Remis`;
  }

  // Zweifache Wiederholung: die naechste gleiche Stellung beendet die Partie.
  const positions = new Map<string, number>();
  const replay = new Chess();
  const key = (c: Chess) => c.fen().split(" ").slice(0, 4).join(" ");
  positions.set(key(replay), 1);
  for (const move of chess.history()) {
    replay.move(move);
    const k = key(replay);
    positions.set(k, (positions.get(k) ?? 0) + 1);
  }
  if ((positions.get(key(chess)) ?? 0) >= 2) {
    return "Stellungswiederholung: noch einmal und die Partie endet remis";
  }

  return null;
}

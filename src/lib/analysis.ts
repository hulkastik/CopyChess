"use client";

import { Chess, Square } from "chess.js";
import { getEngine, type EngineLine } from "./stockfish";

export type MoveQuality =
  | "brilliant"
  | "great"
  | "best"
  | "good"
  | "inaccuracy"
  | "missed"
  | "mistake"
  | "blunder"
  | "book";

export interface QualityStyle {
  label: string;
  icon: string;
  color: string;
  bg: string;
}

export const QUALITY_STYLE: Record<MoveQuality, QualityStyle> = {
  brilliant: { label: "Brillant", icon: "!!", color: "#26c6da", bg: "rgba(38,198,218,0.16)" },
  great: { label: "Großartig", icon: "!", color: "#5b9bd5", bg: "rgba(91,155,213,0.16)" },
  best: { label: "Bester Zug", icon: "★", color: "#7cb342", bg: "rgba(124,179,66,0.16)" },
  good: { label: "Gut", icon: "✓", color: "#9ccc65", bg: "rgba(156,204,101,0.14)" },
  book: { label: "Eröffnung", icon: "📖", color: "#a1887f", bg: "rgba(161,136,127,0.16)" },
  inaccuracy: { label: "Ungenau", icon: "?!", color: "#f4c430", bg: "rgba(244,196,48,0.16)" },
  missed: { label: "Verpasste Chance", icon: "✗", color: "#e88f2f", bg: "rgba(232,143,47,0.18)" },
  mistake: { label: "Schlecht", icon: "?", color: "#ef8b3a", bg: "rgba(239,139,58,0.16)" },
  blunder: { label: "Patzer", icon: "??", color: "#e5484d", bg: "rgba(229,72,77,0.18)" },
};

export interface PositionEval {
  /** Centipawn aus Sicht von Weiß. null wenn Matt erzwungen ist. */
  cp: number | null;
  /** Zuege bis Matt aus Sicht von Weiß (positiv = Weiß setzt matt). */
  mate: number | null;
  bestMoveUci: string | null;
  bestMoveSan: string | null;
  /** Abstand zwischen bester und zweitbester Fortsetzung in Centipawn. */
  onlyMoveGap: number | null;
}

export interface AnalysedMove {
  ply: number;
  moveNumber: number;
  color: "w" | "b";
  san: string;
  uci: string;
  /** Stellung VOR dem Zug. */
  fenBefore: string;
  fenAfter: string;
  quality: MoveQuality;
  /** Verlust in Centipawn gegenueber dem besten Zug (>= 0). */
  centipawnLoss: number;
  bestMoveUci: string | null;
  bestMoveSan: string | null;
  /** Bewertung nach dem Zug, aus Sicht von Weiß. */
  evalAfter: PositionEval;
  accuracy: number;
}

export interface GameAnalysis {
  moves: AnalysedMove[];
  evals: PositionEval[];
  accuracyWhite: number;
  accuracyBlack: number;
  counts: Record<MoveQuality, { w: number; b: number }>;
}

const PIECE_VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

/** Matt-Scores in eine vergleichbare Centipawn-Skala ziehen. */
function toCp(evaluation: { cp: number | null; mate: number | null }): number {
  if (evaluation.mate !== null) {
    const magnitude = 12_000 - Math.min(60, Math.abs(evaluation.mate)) * 100;
    return evaluation.mate >= 0 ? magnitude : -magnitude;
  }
  return evaluation.cp ?? 0;
}

/**
 * Gewinnwahrscheinlichkeit in Prozent.
 *
 * Deckelung bei ±1000 Centipawn ist Absicht: ob eine Stellung +10 oder +20
 * Bauern steht, aendert am Ausgang nichts. Ohne die Deckelung wuerde jede
 * Ungenauigkeit in einer laengst gewonnenen Stellung als Einbruch gewertet.
 */
function winPercent(cp: number): number {
  const clamped = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/**
 * Genauigkeit eines einzelnen Zuges aus dem Verlust an Gewinnwahrscheinlichkeit.
 * Kein Verlust = 100 %, ein halber Punkt weggeworfen = knapp über 0 %.
 */
function accuracyFromWinDrop(before: number, after: number): number {
  const drop = Math.max(0, before - after);
  const value = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669 + 1;
  return Math.max(0, Math.min(100, value));
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Fasst die Einzelgenauigkeiten zu einer Partiegenauigkeit zusammen.
 *
 * Das reine arithmetische Mittel taugt dafuer nicht: bei 20 Zuegen kostet ein
 * partieentscheidender Patzer darin nur ~4 Prozentpunkte, weil 19 fehlerfreie
 * Zuege ihn erdruecken. Deshalb zwei Mittel, gemittelt:
 *
 * - gewichtetes arithmetisches Mittel: Zuege aus unruhigen Phasen zaehlen mehr
 *   als Zuege aus einer toten Stellung, in der ohnehin nichts zu verlieren ist.
 *   Gewicht ist die Streuung der Gewinnwahrscheinlichkeit im Fenster davor.
 * - harmonisches Mittel: bestraft Ausreisser nach unten hart. Ein einzelner
 *   Zug mit 11 % zieht das Ergebnis spuerbar, statt im Mittel zu verschwinden.
 */
export function combineAccuracies(accuracies: number[], weights: number[]): number {
  if (accuracies.length === 0) return 100;

  let weightSum = 0;
  let weightedSum = 0;
  let reciprocalSum = 0;

  for (let i = 0; i < accuracies.length; i += 1) {
    // Untergrenze, damit ein 0-%-Zug das harmonische Mittel nicht auf 0 zieht.
    const value = Math.max(1, accuracies[i]);
    const weight = weights[i] ?? 1;
    weightedSum += value * weight;
    weightSum += weight;
    reciprocalSum += 1 / value;
  }

  const weightedMean = weightSum > 0 ? weightedSum / weightSum : 100;
  const harmonicMean = accuracies.length / reciprocalSum;
  return Math.max(0, Math.min(100, (weightedMean + harmonicMean) / 2));
}

/**
 * Gewicht je Zug: Streuung der Gewinnwahrscheinlichkeit im Fenster vor dem Zug.
 * `winPercents` enthaelt einen Wert je Stellung, aus Sicht von Weiß.
 */
export function volatilityWeights(winPercents: number[], plyIndices: number[]): number[] {
  const windowSize = Math.max(2, Math.min(8, Math.floor(winPercents.length / 10)));
  return plyIndices.map((ply) => {
    const end = Math.min(winPercents.length, ply + 1);
    const start = Math.max(0, end - windowSize);
    const deviation = standardDeviation(winPercents.slice(start, end));
    return Math.max(0.5, Math.min(12, deviation));
  });
}

function materialOn(chess: Chess, color: "w" | "b"): number {
  let total = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece && piece.color === color) total += PIECE_VALUE[piece.type] ?? 0;
    }
  }
  return total;
}

/**
 * Grobe Opfer-Erkennung: die gezogene Figur steht danach auf einem Feld, das der
 * Gegner schlagen kann, und der Materialsaldo faellt dabei um mindestens eine
 * Leichtfigur. Kein voller SEE — reicht aber, um "!!"-Zuege von normalen
 * Abtauschen zu trennen.
 */
function isSacrifice(fenBefore: string, uci: string): boolean {
  const before = new Chess(fenBefore);
  const mover = before.turn();
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const movedPiece = before.get(from);
  if (!movedPiece) return false;

  const captured = before.get(to);
  const gained = captured ? PIECE_VALUE[captured.type] ?? 0 : 0;
  const risked = PIECE_VALUE[movedPiece.type] ?? 0;
  if (risked - gained < 300) return false;

  const after = new Chess(fenBefore);
  try {
    after.move({ from, to, promotion: uci.length > 4 ? uci[4] : undefined });
  } catch {
    return false;
  }

  const opponentCaptures = after
    .moves({ verbose: true })
    .filter((m) => m.to === to && "captured" in m && m.captured);
  if (opponentCaptures.length === 0) return false;

  // Materialbilanz nach bestem Zurueckschlagen des Gegners
  let worstBalance = materialOn(after, mover) - materialOn(after, mover === "w" ? "b" : "w");
  for (const capture of opponentCaptures) {
    const branch = new Chess(after.fen());
    try {
      branch.move({ from: capture.from, to: capture.to, promotion: "q" });
    } catch {
      continue;
    }
    const balance = materialOn(branch, mover) - materialOn(branch, mover === "w" ? "b" : "w");
    worstBalance = Math.min(worstBalance, balance);
  }

  const balanceBefore = materialOn(before, mover) - materialOn(before, mover === "w" ? "b" : "w");
  return worstBalance <= balanceBefore - 250;
}

function toWhitePerspective(
  line: EngineLine | undefined,
  sideToMove: "w" | "b"
): { cp: number | null; mate: number | null } {
  if (!line) return { cp: 0, mate: null };
  const sign = sideToMove === "w" ? 1 : -1;
  return {
    cp: line.cp === null ? null : line.cp * sign,
    mate: line.mate === null ? null : line.mate * sign,
  };
}

function uciToSan(fen: string, uci: string | null): string | null {
  if (!uci) return null;
  const chess = new Chess(fen);
  try {
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return move?.san ?? null;
  } catch {
    return null;
  }
}

export interface AnalyseProgress {
  done: number;
  total: number;
}

export interface JudgedMove {
  quality: MoveQuality;
  /** Verlust in Centipawn gegenueber dem besten Zug (>= 0). */
  centipawnLoss: number;
  accuracy: number;
}

/**
 * Stuft einen einzelnen Zug ein.
 *
 * Beide Bewertungen kommen aus Sicht von Weiß herein und werden hier auf die
 * Sicht der ziehenden Seite gedreht. `ply` dient nur der Eroeffnungserkennung —
 * fuer frei ausprobierte Zuege im Analysebrett bewusst weglassen, dort ist die
 * Zugnummer kein Hinweis auf Theorie.
 */
export function judgeMove(input: {
  fenBefore: string;
  uci: string;
  evalBefore: PositionEval;
  evalAfter: PositionEval;
  ply?: number;
}): JudgedMove {
  const { fenBefore, uci, evalBefore, evalAfter, ply } = input;
  const sign = fenBefore.split(" ")[1] === "b" ? -1 : 1;

  const beforeMover = toCp(evalBefore) * sign;
  const afterMover = toCp(evalAfter) * sign;

  const centipawnLoss = Math.max(0, Math.round(beforeMover - afterMover));
  const accuracy = accuracyFromWinDrop(winPercent(beforeMover), winPercent(afterMover));

  const playedIsBest = evalBefore.bestMoveUci !== null && evalBefore.bestMoveUci === uci;
  // In einer laengst verlorenen Stellung ist kein Zug mehr ein Patzer.
  const hopeless = beforeMover <= -900 && afterMover <= -900;
  // Gewinnstellung verspielt: eigene Kategorie, sonst geht die Info in
  // "Schlecht" unter, obwohl das der teuerste Fehlertyp ueberhaupt ist.
  const missedWin = !playedIsBest && beforeMover >= 200 && afterMover < 100 && centipawnLoss >= 150;
  const missedMate =
    !playedIsBest &&
    evalBefore.mate !== null &&
    evalBefore.mate * sign > 0 &&
    !(evalAfter.mate !== null && evalAfter.mate * sign > 0);

  let quality: MoveQuality;
  if (playedIsBest && isSacrifice(fenBefore, uci) && afterMover >= -50) {
    quality = "brilliant";
  } else if (playedIsBest && (evalBefore.onlyMoveGap ?? 0) >= 150) {
    quality = "great";
  } else if (playedIsBest) {
    quality = "best";
  } else if (hopeless || centipawnLoss <= 50) {
    quality = "good";
  } else if (missedMate || missedWin) {
    quality = "missed";
  } else if (centipawnLoss <= 100) {
    quality = "inaccuracy";
  } else if (centipawnLoss <= 250) {
    quality = "mistake";
  } else {
    quality = "blunder";
  }

  // Die ersten Halbzuege sind Theorie, kein Verdienst und kein Fehler.
  if (ply !== undefined && ply < 6 && (quality === "best" || quality === "good")) {
    quality = "book";
  }

  return { quality, centipawnLoss, accuracy };
}

/**
 * Analysiert eine komplette Partie. Pro Stellung genau EIN Engine-Lauf:
 * die Bewertung nach dem gespielten Zug ist die Bewertung der Folgestellung,
 * nur vorzeichengedreht. Das halbiert die Rechenzeit gegenueber dem naiven Weg.
 */
export async function analyseGame(
  movesUci: string[],
  options: { depth?: number; onProgress?: (progress: AnalyseProgress) => void; signal?: { aborted: boolean } } = {}
): Promise<GameAnalysis> {
  const depth = options.depth ?? 14;
  const engine = getEngine();

  const chess = new Chess();
  const fens: string[] = [chess.fen()];
  const sans: string[] = [];
  const colors: ("w" | "b")[] = [];

  for (const uci of movesUci) {
    colors.push(chess.turn());
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    sans.push(move.san);
    fens.push(chess.fen());
  }

  const total = fens.length;
  const evals: PositionEval[] = [];

  for (let i = 0; i < total; i += 1) {
    if (options.signal?.aborted) throw new Error("Analyse abgebrochen");
    const fen = fens[i];
    const sideToMove = fen.split(" ")[1] === "b" ? "b" : "w";
    const position = new Chess(fen);

    if (position.isGameOver()) {
      const mate = position.isCheckmate() ? (sideToMove === "w" ? -1 : 1) : null;
      evals.push({
        cp: mate === null ? 0 : null,
        mate,
        bestMoveUci: null,
        bestMoveSan: null,
        onlyMoveGap: null,
      });
      options.onProgress?.({ done: i + 1, total });
      continue;
    }

    const result = await engine.analyse(fen, { depth, multipv: 2, timeoutMs: 60_000 });
    const first = result.lines.find((l) => l.multipv === 1);
    const second = result.lines.find((l) => l.multipv === 2);
    const whiteView = toWhitePerspective(first, sideToMove);

    const gap =
      first && second ? Math.abs(toCp({ cp: first.cp, mate: first.mate }) - toCp({ cp: second.cp, mate: second.mate })) : null;

    evals.push({
      ...whiteView,
      bestMoveUci: result.bestMove,
      bestMoveSan: uciToSan(fen, result.bestMove),
      onlyMoveGap: gap,
    });
    options.onProgress?.({ done: i + 1, total });
  }

  const moves: AnalysedMove[] = [];
  const counts = Object.fromEntries(
    (Object.keys(QUALITY_STYLE) as MoveQuality[]).map((key) => [key, { w: 0, b: 0 }])
  ) as Record<MoveQuality, { w: number; b: number }>;
  const accuracies: { w: number[]; b: number[] } = { w: [], b: [] };
  const plyIndices: { w: number[]; b: number[] } = { w: [], b: [] };

  for (let i = 0; i < movesUci.length; i += 1) {
    const color = colors[i];
    plyIndices[color].push(i);
    const judged = judgeMove({
      fenBefore: fens[i],
      uci: movesUci[i],
      evalBefore: evals[i],
      evalAfter: evals[i + 1],
      ply: i,
    });

    const { quality, centipawnLoss, accuracy } = judged;
    accuracies[color].push(accuracy);
    const bestUci = evals[i].bestMoveUci;

    counts[quality][color] += 1;

    moves.push({
      ply: i,
      moveNumber: Math.floor(i / 2) + 1,
      color,
      san: sans[i],
      uci: movesUci[i],
      fenBefore: fens[i],
      fenAfter: fens[i + 1],
      quality,
      centipawnLoss,
      bestMoveUci: bestUci,
      bestMoveSan: evals[i].bestMoveSan,
      evalAfter: evals[i + 1],
      accuracy,
    });
  }

  // Gewinnwahrscheinlichkeit je Stellung, aus Sicht von Weiß — Grundlage der
  // Gewichtung: in ruhigen Phasen zaehlt ein Zug weniger als in scharfen.
  const winPercents = evals.map((evaluation) => winPercent(toCp(evaluation)));

  const accuracyFor = (color: "w" | "b") =>
    Math.round(
      combineAccuracies(accuracies[color], volatilityWeights(winPercents, plyIndices[color])) * 10
    ) / 10;

  return {
    moves,
    evals,
    accuracyWhite: accuracyFor("w"),
    accuracyBlack: accuracyFor("b"),
    counts,
  };
}

/** Kurztext einer Bewertung fuer die Anzeige ("+1.4", "M3"). */
export function formatEval(evaluation: { cp: number | null; mate: number | null }): string {
  if (evaluation.mate !== null) {
    return `${evaluation.mate > 0 ? "" : "-"}M${Math.abs(evaluation.mate)}`;
  }
  const pawns = (evaluation.cp ?? 0) / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

/** 0..1 — Anteil des Balkens, der Weiß gehoert. */
export function evalToWhiteShare(evaluation: { cp: number | null; mate: number | null }): number {
  if (evaluation.mate !== null) return evaluation.mate > 0 ? 1 : 0;
  return winPercent(evaluation.cp ?? 0) / 100;
}

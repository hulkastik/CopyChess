/** Startwertung jedes Kontos. Gleichzeitig die Untergrenze. */
export const START_ELO = 100;

/**
 * K-Faktor. Bei einem Startwert von 100 und einem K von 32 bringt ein Sieg
 * gegen einen gleich starken Gegner 16 Punkte — die Wertung bewegt sich also
 * von Anfang an sichtbar, statt hundert Partien lang festzukleben.
 */
const K_FACTOR = 32;

export interface EloResult {
  whiteChange: number;
  blackChange: number;
  whiteElo: number;
  blackElo: number;
}

/**
 * Erwartungswert nach der Elo-Formel.
 *
 * Bewusst die Originalformel mit 400er-Skala: sie bestimmt, dass ein Sieg gegen
 * einen deutlich stärkeren Gegner viel bringt und gegen einen deutlich
 * schwächeren fast nichts — genau das gewünschte Verhalten.
 */
function expectedScore(own: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - own) / 400));
}

/** `result` ist "1-0", "0-1" oder "1/2-1/2". */
export function applyElo(whiteElo: number, blackElo: number, result: string): EloResult {
  const whiteScore = result === "1-0" ? 1 : result === "0-1" ? 0 : 0.5;
  const blackScore = 1 - whiteScore;

  const whiteRaw = K_FACTOR * (whiteScore - expectedScore(whiteElo, blackElo));
  const blackRaw = K_FACTOR * (blackScore - expectedScore(blackElo, whiteElo));

  // Erst runden, dann deckeln: sonst weicht die angezeigte Veränderung von der
  // tatsächlich gespeicherten Wertung ab.
  const nextWhite = Math.max(START_ELO, Math.round(whiteElo + whiteRaw));
  const nextBlack = Math.max(START_ELO, Math.round(blackElo + blackRaw));

  return {
    whiteElo: nextWhite,
    blackElo: nextBlack,
    whiteChange: nextWhite - whiteElo,
    blackChange: nextBlack - blackElo,
  };
}

// ─── Ränge ───────────────────────────────────────────────────────────────────

export interface Rank {
  key: string;
  label: string;
  icon: string;
  color: string;
  /** Untergrenze der Wertung, ab der dieser Rang gilt. */
  from: number;
}

/**
 * Aufsteigend nach Wertung. Die Figuren steigen in ihrem Materialwert —
 * Bauer, Springer, Läufer, Turm, Dame, König.
 */
export const RANKS: Rank[] = [
  { key: "pawn", label: "Bauer", icon: "♙", color: "#a87e5a", from: 0 },
  { key: "knight", label: "Springer", icon: "♘", color: "#b9c2cc", from: 250 },
  { key: "bishop", label: "Läufer", icon: "♗", color: "#e0b341", from: 450 },
  { key: "rook", label: "Turm", icon: "♖", color: "#3fbf8f", from: 700 },
  { key: "queen", label: "Dame", icon: "♕", color: "#5aa7e8", from: 1000 },
  { key: "king", label: "König", icon: "♔", color: "#c07de8", from: 1400 },
];

export function rankFor(elo: number): Rank {
  let current = RANKS[0];
  for (const rank of RANKS) {
    if (elo >= rank.from) current = rank;
  }
  return current;
}

/** Nächsthöherer Rang, oder null wenn bereits ganz oben. */
export function nextRankFor(elo: number): Rank | null {
  return RANKS.find((rank) => rank.from > elo) ?? null;
}

/** Fortschritt im aktuellen Rang, 0..1. Im höchsten Rang immer 1. */
export function rankProgress(elo: number): number {
  const current = rankFor(elo);
  const next = nextRankFor(elo);
  if (!next) return 1;
  return Math.max(0, Math.min(1, (elo - current.from) / (next.from - current.from)));
}

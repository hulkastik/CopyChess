import { replayMoves, getOutcome, drawWarning } from "../../src/lib/gameRules";
import { judgeMove } from "../../src/lib/analysis";

let failed = 0;
function check(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failed += 1;
}

// 1. Dreifache Stellungswiederholung (Springer hin und her)
const rep = replayMoves(["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"]);
const repOut = getOutcome(rep);
check("threefold repetition", repOut?.reason === "repetition" && repOut.result === "1/2-1/2", JSON.stringify(repOut));

// Eine Wiederholung vorher: noch keine Partieende, aber Warnung
const nearRep = replayMoves(["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6"]);
check("no premature repetition draw", getOutcome(nearRep) === null);
check("repetition warning shown", (drawWarning(nearRep) ?? "").includes("Stellungswiederholung"), String(drawWarning(nearRep)));

// 2. Patt (klassische Stellung ueber FEN nachgestellt)
const { Chess } = require("chess.js");
const stale = new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
check("stalemate", getOutcome(stale)?.reason === "stalemate", JSON.stringify(getOutcome(stale)));

// 3. Schachmatt: Narrenmatt
const mate = replayMoves(["f2f3", "e7e5", "g2g4", "d8h4"]);
const mateOut = getOutcome(mate);
check("checkmate result 0-1", mateOut?.reason === "checkmate" && mateOut.result === "0-1", JSON.stringify(mateOut));

// 4. Ungenuegendes Material: K+L vs K
const insuf = new Chess("8/8/4k3/8/8/4KB2/8/8 w - - 0 1");
check("insufficient material", getOutcome(insuf)?.reason === "insufficient", JSON.stringify(getOutcome(insuf)));

// 5. 50-Zuege-Regel: Halbzugzaehler auf 100
const fifty = new Chess("8/8/4k3/8/8/4K3/6R1/8 w - - 100 80");
check("fifty move rule", getOutcome(fifty)?.reason === "fifty-move", JSON.stringify(getOutcome(fifty)));

const fiftyWarn = new Chess("8/8/4k3/8/8/4K3/6R1/8 w - - 85 70");
check("fifty move warning", (drawWarning(fiftyWarn) ?? "").includes("50-Züge"), String(drawWarning(fiftyWarn)));

// 6. Laufende Partie bleibt unangetastet
const running = replayMoves(["e2e4", "e7e5"]);
check("running game has no outcome", getOutcome(running) === null);
check("running game has no warning", drawWarning(running) === null);

// 7. FEN-Instanz kann Wiederholung nicht sehen -> genau der behobene Fehler
const fromFen = new Chess(rep.fen());
check("regression: FEN-only instance is blind to repetition", getOutcome(fromFen) === null);

// ─── Zug-Einstufung ──────────────────────────────────────────────────────────
const START = new Chess().fen();
// Stellung mit Schwarz am Zug
const BLACK_TO_MOVE = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"
  .replace(" w ", " b ");

const ev = (cp: number | null, best: string | null, mate: number | null = null, gap: number | null = null) => ({
  cp,
  mate,
  bestMoveUci: best,
  bestMoveSan: null,
  onlyMoveGap: gap,
});

check(
  "played best move -> best",
  judgeMove({ fenBefore: START, uci: "e2e4", evalBefore: ev(30, "e2e4"), evalAfter: ev(30, null) }).quality === "best"
);

check(
  "small loss -> good",
  judgeMove({ fenBefore: START, uci: "d2d4", evalBefore: ev(30, "e2e4"), evalAfter: ev(-10, null) }).quality === "good"
);

check(
  "loss 80 -> inaccuracy",
  judgeMove({ fenBefore: START, uci: "a2a3", evalBefore: ev(30, "e2e4"), evalAfter: ev(-50, null) }).quality === "inaccuracy"
);

check(
  "loss 150 from equal -> mistake",
  judgeMove({ fenBefore: START, uci: "a2a3", evalBefore: ev(30, "e2e4"), evalAfter: ev(-120, null) }).quality === "mistake"
);

check(
  "winning position thrown away -> missed",
  judgeMove({ fenBefore: START, uci: "a2a3", evalBefore: ev(400, "e2e4"), evalAfter: ev(50, null) }).quality === "missed",
  JSON.stringify(judgeMove({ fenBefore: START, uci: "a2a3", evalBefore: ev(400, "e2e4"), evalAfter: ev(50, null) }))
);

check(
  "forced mate given up -> missed",
  judgeMove({ fenBefore: START, uci: "a2a3", evalBefore: ev(null, "e2e4", 3), evalAfter: ev(120, null) }).quality === "missed"
);

check(
  "big loss -> blunder",
  judgeMove({ fenBefore: START, uci: "a2a3", evalBefore: ev(0, "e2e4"), evalAfter: ev(-600, null) }).quality === "blunder"
);

check(
  "already lost -> no blunder",
  judgeMove({ fenBefore: START, uci: "a2a3", evalBefore: ev(-1500, "e2e4"), evalAfter: ev(-1900, null) }).quality === "good"
);

check(
  "only move played -> great",
  judgeMove({ fenBefore: START, uci: "e2e4", evalBefore: ev(30, "e2e4", null, 300), evalAfter: ev(30, null) }).quality === "great"
);

// Vorzeichen: Bewertungen kommen aus Sicht von Weiß herein. Zieht Schwarz,
// muss ein fuer Weiß fallender Wert ein Gewinn fuer Schwarz sein.
check(
  "black perspective is inverted",
  judgeMove({
    fenBefore: BLACK_TO_MOVE,
    uci: "b8c6",
    evalBefore: ev(0, "g8f6"),
    evalAfter: ev(-300, null),
  }).quality === "best" === false &&
    judgeMove({
      fenBefore: BLACK_TO_MOVE,
      uci: "b8c6",
      evalBefore: ev(0, "g8f6"),
      evalAfter: ev(-300, null),
    }).centipawnLoss === 0,
  "Schwarz verbessert sich -> kein Verlust"
);

check(
  "opening moves are labelled as theory",
  judgeMove({ fenBefore: START, uci: "e2e4", evalBefore: ev(30, "e2e4"), evalAfter: ev(30, null), ply: 0 })
    .quality === "book"
);

console.log(failed === 0 ? "\nall green" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

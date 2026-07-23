import { applyElo, rankFor, nextRankFor, rankProgress, RANKS, START_ELO } from "../../src/lib/rating";

let failed = 0;
function check(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failed += 1;
}

// Gleich starke Gegner: Sieg und Niederlage sind spiegelbildlich
const even = applyElo(100, 100, "1-0");
check("Sieg gegen Gleichstarken bringt +16", even.whiteChange === 16, JSON.stringify(even));
check("Wertung ist ein Nullsummenspiel", even.whiteChange === -even.blackChange || even.blackElo === START_ELO,
  `w${even.whiteChange} b${even.blackChange}`);

// Untergrenze: unter den Startwert geht es nicht
const floor = applyElo(100, 100, "0-1");
check("Wertung faellt nicht unter den Startwert", floor.whiteElo === START_ELO, String(floor.whiteElo));

// Der springende Punkt: Unterschied bestimmt den Ertrag
const underdog = applyElo(200, 800, "1-0");   // Schwacher schlaegt Starken
const favourite = applyElo(800, 200, "1-0");  // Starker schlaegt Schwachen
check("Sieg gegen deutlich Staerkeren bringt viel", underdog.whiteChange > 28,
  `+${underdog.whiteChange}`);
check("Sieg gegen deutlich Schwaecheren bringt wenig", favourite.whiteChange < 4,
  `+${favourite.whiteChange}`);
check("Underdog-Sieg bringt mehr als Favoritensieg",
  underdog.whiteChange > favourite.whiteChange * 5);

// Verlieren gegen Schwaechere tut weh
const upset = applyElo(800, 200, "0-1");
check("Niederlage gegen Schwaecheren kostet viel", upset.whiteChange < -28, String(upset.whiteChange));

// Remis
const drawEven = applyElo(400, 400, "1/2-1/2");
check("Remis unter Gleichstarken aendert nichts", drawEven.whiteChange === 0 && drawEven.blackChange === 0);
const drawUneven = applyElo(200, 800, "1/2-1/2");
check("Remis gegen Staerkeren bringt Punkte", drawUneven.whiteChange > 0, `+${drawUneven.whiteChange}`);
check("Remis gegen Schwaecheren kostet Punkte", drawUneven.blackChange < 0, String(drawUneven.blackChange));

// Angezeigte Veraenderung muss zur gespeicherten Wertung passen
const consistency = applyElo(547, 613, "1-0");
check("Veraenderung passt zur neuen Wertung",
  consistency.whiteElo === 547 + consistency.whiteChange &&
  consistency.blackElo === 613 + consistency.blackChange);

// Raenge
check("Startwertung ist Bauer", rankFor(START_ELO).key === "pawn", rankFor(START_ELO).label);
check("250 ist Springer", rankFor(250).key === "knight");
check("249 ist noch Bauer", rankFor(249).key === "pawn");
check("2000 ist Koenig", rankFor(2000).key === "king");
check("Raenge sind aufsteigend sortiert",
  RANKS.every((r, i) => i === 0 || r.from > RANKS[i - 1].from));
check("hoechster Rang hat keinen Nachfolger", nextRankFor(2000) === null);
check("Bauer hat Springer als Nachfolger", nextRankFor(100)?.key === "knight");
check("Fortschritt liegt zwischen 0 und 1",
  [0, 100, 249, 250, 900, 5000].every((e) => rankProgress(e) >= 0 && rankProgress(e) <= 1));
check("Fortschritt im hoechsten Rang ist voll", rankProgress(9999) === 1);

console.log(failed === 0 ? "\nall green" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

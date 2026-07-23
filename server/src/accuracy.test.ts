import { combineAccuracies, volatilityWeights } from "../../src/lib/analysis";

let failed = 0;
function check(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failed += 1;
}

// Einzelzug-Genauigkeiten wie sie die Kurve liefert
const PERFECT = 100;
const GOOD = 97;      // ~kleiner Verlust
const INACCURACY = 84;
const MISTAKE = 55;
const BLUNDER = 11;

// Alle Zuege in einer scharfen Partie gleich gewichtet -> Gewichte konstant
const flat = (n: number) => Array(n).fill(4);

const scenario = (list: number[]) =>
  Math.round(combineAccuracies(list, flat(list.length)) * 10) / 10;

const perfectGame = scenario(Array(20).fill(PERFECT));
const oneBlunder = scenario(Array(19).fill(PERFECT).concat([BLUNDER]));
const threeBlunders = scenario(Array(17).fill(PERFECT).concat([BLUNDER, BLUNDER, BLUNDER]));
const sloppy = scenario(Array(20).fill(INACCURACY));
const mixed = scenario(Array(10).fill(PERFECT).concat(Array(6).fill(GOOD), Array(3).fill(MISTAKE), [BLUNDER]));

console.log(`perfekt        ${perfectGame}%`);
console.log(`1 Patzer/20    ${oneBlunder}%`);
console.log(`3 Patzer/20    ${threeBlunders}%`);
console.log(`durchgehend ungenau ${sloppy}%`);
console.log(`gemischt       ${mixed}%`);
console.log("");

check("fehlerfreie Partie ist 100 %", perfectGame === 100, String(perfectGame));
check("ein Patzer kostet spuerbar", perfectGame - oneBlunder > 15, `-${(perfectGame - oneBlunder).toFixed(1)}`);
check("drei Patzer kosten mehr als einer", threeBlunders < oneBlunder - 10, `${threeBlunders} < ${oneBlunder}`);
check("monoton fallend mit mehr Fehlern", perfectGame > oneBlunder && oneBlunder > threeBlunders);
check("durchgehende Ungenauigkeit landet nahe am Einzelwert", Math.abs(sloppy - INACCURACY) < 1, String(sloppy));
check("gemischte Partie liegt dazwischen", mixed < GOOD && mixed > threeBlunders, String(mixed));
check("Werte bleiben im Rahmen", [perfectGame, oneBlunder, threeBlunders, sloppy, mixed].every((v) => v >= 0 && v <= 100));
check("leere Zugliste ergibt 100 %", combineAccuracies([], []) === 100);

// Gewichtung: ruhige Phase soll weniger zaehlen als scharfe
const quiet = [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
const sharp = [50, 70, 30, 80, 20, 75, 25, 60, 40, 90, 10, 55, 45, 85, 15, 65, 35, 95, 5, 50];
const quietWeights = volatilityWeights(quiet, [5, 6, 7]);
const sharpWeights = volatilityWeights(sharp, [5, 6, 7]);
check("ruhige Stellung -> Mindestgewicht", quietWeights.every((w) => w === 0.5), JSON.stringify(quietWeights));
check(
  "scharfe Stellung -> hoeheres Gewicht",
  sharpWeights.every((w) => w > 5),
  JSON.stringify(sharpWeights.map((w) => Math.round(w)))
);

// Ein Patzer in ruhiger Phase darf nicht so stark durchschlagen wie in scharfer
const accList = Array(19).fill(PERFECT).concat([BLUNDER]);
const lowWeightOnBlunder = accList.map((_, i) => (i === 19 ? 0.5 : 8));
const highWeightOnBlunder = accList.map((_, i) => (i === 19 ? 12 : 0.5));
check(
  "Gewichtung wirkt auf das Ergebnis",
  combineAccuracies(accList, highWeightOnBlunder) < combineAccuracies(accList, lowWeightOnBlunder) - 5,
  `${combineAccuracies(accList, highWeightOnBlunder).toFixed(1)} vs ${combineAccuracies(accList, lowWeightOnBlunder).toFixed(1)}`
);

console.log(failed === 0 ? "\nall green" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

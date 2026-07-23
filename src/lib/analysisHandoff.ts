"use client";

/**
 * Übergabe einer nicht gespeicherten Partie an die Analyseseite.
 *
 * Training und lokales Spiel landen nicht in der Datenbank — es gibt dort keinen
 * zweiten Benutzer, an dem ein `Game`-Datensatz haengen koennte. Statt dafuer das
 * Schema aufzuweichen, wandert die Zugliste ueber sessionStorage. Bleibt am Tab
 * haengen, ueberlebt den Seitenwechsel und ist beim Schliessen wieder weg.
 */
export interface AnalysisHandoff {
  movesUci: string[];
  whiteName: string;
  blackName: string;
  result: string | null;
  reason: string | null;
  subtitle: string;
  /** Aus wessen Sicht das Brett steht. */
  orientation: "w" | "b";
}

const KEY = "chess-analysis-handoff";

export function storeHandoff(handoff: AnalysisHandoff): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(handoff));
  } catch (error) {
    console.error("Analyse-Übergabe fehlgeschlagen:", error);
  }
}

export function readHandoff(): AnalysisHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AnalysisHandoff;
    if (!Array.isArray(parsed.movesUci)) return null;
    return parsed;
  } catch {
    return null;
  }
}

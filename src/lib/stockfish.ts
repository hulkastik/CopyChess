"use client";

/**
 * Stockfish-WASM-Wrapper.
 *
 * Eine einzige Worker-Instanz fuer die gesamte App, Anfragen laufen ueber eine
 * serielle Queue. Grund: der stockfish-18-single Build zieht ~113 MB WASM pro
 * Worker — zwei parallele Instanzen (Live-Hilfe + Analyse) sprengen auf
 * schwaecheren Rechnern den Tab-Speicher. UCI ist ohnehin single-session.
 */

export interface EngineLine {
  multipv: number;
  /** Bewertung in Centipawn aus Sicht der Seite am Zug. null bei Matt-Score. */
  cp: number | null;
  /** Zuege bis Matt aus Sicht der Seite am Zug (positiv = wir setzen matt). */
  mate: number | null;
  /** Hauptvariante in UCI. */
  pv: string[];
  depth: number;
}

export interface EngineResult {
  bestMove: string | null;
  lines: EngineLine[];
}

export interface AnalyseOptions {
  depth?: number;
  multipv?: number;
  /** Harte Obergrenze, damit ein haengender Worker die UI nicht einfriert. */
  timeoutMs?: number;
  skillLevel?: number;
  elo?: number | null;
}

type Listener = (line: string) => void;

const DEFAULT_TIMEOUT_MS = 20_000;

class StockfishEngine {
  private worker: Worker | null = null;
  private listeners = new Set<Listener>();
  private queue: Promise<unknown> = Promise.resolve();
  private readyPromise: Promise<void> | null = null;
  private currentMultipv = 1;
  private currentSkill: number | null = null;
  private currentElo: number | null = null;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker("/stockfish.js");
    worker.addEventListener("message", (event: MessageEvent) => {
      const raw = event.data;
      const text = typeof raw === "string" ? raw : String(raw ?? "");
      for (const line of text.split("\n")) {
        if (!line) continue;
        for (const listener of Array.from(this.listeners)) listener(line);
      }
    });
    worker.addEventListener("error", (event) => {
      console.error("Stockfish worker error:", event.message);
    });
    this.worker = worker;
    return worker;
  }

  private send(command: string): void {
    this.ensureWorker().postMessage(command);
  }

  private waitFor(token: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`Stockfish: Timeout beim Warten auf "${token}"`));
      }, timeoutMs);

      const listener: Listener = (line) => {
        if (!line.startsWith(token)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve();
      };
      this.listeners.add(listener);
    });
  }

  /** UCI-Handshake, genau einmal pro Worker. */
  ready(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
      this.ensureWorker();
      const uciOk = this.waitFor("uciok", DEFAULT_TIMEOUT_MS);
      this.send("uci");
      await uciOk;
      const readyOk = this.waitFor("readyok", DEFAULT_TIMEOUT_MS);
      this.send("isready");
      await readyOk;
    })().catch((err) => {
      // Fehlgeschlagenen Handshake nicht cachen — naechster Aufruf darf neu versuchen.
      this.readyPromise = null;
      throw err;
    });
    return this.readyPromise;
  }

  /** Gibt true zurueck, wenn sich eine Option geaendert hat. */
  private applyOptions(options: AnalyseOptions): boolean {
    let changed = false;

    const multipv = options.multipv ?? 1;
    if (multipv !== this.currentMultipv) {
      this.send(`setoption name MultiPV value ${multipv}`);
      this.currentMultipv = multipv;
      changed = true;
    }

    // UCI_Elo und Skill Level schliessen sich aus — wer eine Elo vorgibt,
    // bekommt die Elo-Begrenzung, sonst zaehlt der Skill Level.
    const elo = options.elo ?? null;
    if (elo !== this.currentElo) {
      if (elo === null) {
        this.send("setoption name UCI_LimitStrength value false");
      } else {
        this.send("setoption name UCI_LimitStrength value true");
        this.send(`setoption name UCI_Elo value ${Math.round(elo)}`);
      }
      this.currentElo = elo;
      changed = true;
    }

    if (elo === null) {
      const skill = options.skillLevel ?? 20;
      if (skill !== this.currentSkill) {
        this.send(`setoption name Skill Level value ${Math.min(20, Math.max(0, skill))}`);
        this.currentSkill = skill;
        changed = true;
      }
    }

    return changed;
  }

  /**
   * Analysiert eine Stellung. Aufrufe werden serialisiert — ein zweiter Aufruf
   * wartet, bis der erste sein `bestmove` geliefert hat.
   */
  analyse(fen: string, options: AnalyseOptions = {}): Promise<EngineResult> {
    const run = async (): Promise<EngineResult> => {
      await this.ready();
      const depth = options.depth ?? 14;
      const multipv = options.multipv ?? 1;
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const optionsChanged = this.applyOptions(options);

      return new Promise<EngineResult>((resolve, reject) => {
        const lines = new Map<number, EngineLine>();

        const cleanup = () => {
          clearTimeout(timer);
          this.listeners.delete(listener);
        };

        const timer = setTimeout(() => {
          cleanup();
          this.send("stop");
          reject(new Error("Stockfish: Analyse-Timeout"));
        }, timeoutMs);

        const listener: Listener = (line) => {
          if (line.startsWith("info ")) {
            const parsed = parseInfoLine(line);
            if (parsed) lines.set(parsed.multipv, parsed);
            return;
          }
          if (line.startsWith("bestmove")) {
            cleanup();
            const token = line.split(/\s+/)[1];
            const bestMove = !token || token === "(none)" ? null : token;
            const sorted = Array.from(lines.values()).sort((a, b) => a.multipv - b.multipv);
            resolve({ bestMove, lines: sorted });
          }
        };

        this.listeners.add(listener);
        // ucinewgame leert die Hash-Table. Bei einer Partieanalyse laufen 60+
        // verwandte Stellungen durch — die Table warm zu halten ist dort mehrere
        // Faktoren schneller. Nur bei geaenderten Optionen wirklich neu starten.
        if (optionsChanged) this.send("ucinewgame");
        this.send(`position fen ${fen}`);
        this.send(`go depth ${depth}`);
      });
    };

    // Fehler duerfen die Queue nicht vergiften.
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Bequemer Einzeiler fuer "welcher Zug ist der beste". */
  async bestMove(fen: string, depth = 14): Promise<string | null> {
    const result = await this.analyse(fen, { depth, multipv: 1 });
    return result.bestMove;
  }

  destroy(): void {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
    this.listeners.clear();
    this.readyPromise = null;
    this.queue = Promise.resolve();
    this.currentMultipv = 1;
    this.currentSkill = null;
    this.currentElo = null;
  }
}

function parseInfoLine(line: string): EngineLine | null {
  const tokens = line.split(/\s+/);
  const pvIndex = tokens.indexOf("pv");
  const depthIndex = tokens.indexOf("depth");
  if (pvIndex === -1 || depthIndex === -1) return null;

  const multipvIndex = tokens.indexOf("multipv");
  const scoreIndex = tokens.indexOf("score");
  if (scoreIndex === -1) return null;

  const scoreType = tokens[scoreIndex + 1];
  const scoreValue = Number(tokens[scoreIndex + 2]);
  if (!Number.isFinite(scoreValue)) return null;

  return {
    multipv: multipvIndex === -1 ? 1 : Number(tokens[multipvIndex + 1]) || 1,
    cp: scoreType === "cp" ? scoreValue : null,
    mate: scoreType === "mate" ? scoreValue : null,
    pv: tokens.slice(pvIndex + 1).filter(Boolean),
    depth: Number(tokens[depthIndex + 1]) || 0,
  };
}

let engineInstance: StockfishEngine | null = null;

export function getEngine(): StockfishEngine {
  if (typeof window === "undefined") {
    throw new Error("Stockfish laeuft nur im Browser.");
  }
  if (!engineInstance) engineInstance = new StockfishEngine();
  return engineInstance;
}

export function destroyEngine(): void {
  engineInstance?.destroy();
  engineInstance = null;
}

export type { StockfishEngine };

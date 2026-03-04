// Stockfish Web Worker Wrapper
// This runs Stockfish WASM in a Web Worker to keep the UI responsive.

let stockfish: Worker | null = null;

export function initStockfish(): Worker {
  if (stockfish) return stockfish;

  // Load stockfish.js from /public (same-origin — CDN URLs are blocked by browser Same-Origin Policy)
  stockfish = new Worker("/stockfish.js");

  // Initialize UCI protocol
  stockfish.postMessage("uci");

  return stockfish;
}

export function setStockfishLevel(worker: Worker, level: number): void {
  // Stockfish skill level: 0-20
  worker.postMessage(`setoption name Skill Level value ${level}`);
}

export function setStockfishElo(worker: Worker, elo: number): void {
  // Limit Elo (requires Skill Level to be set)
  // Map elo (800-3000) to skill level (0-20)
  const skill = Math.round(((elo - 800) / 2200) * 20);
  worker.postMessage(`setoption name Skill Level value ${Math.min(20, Math.max(0, skill))}`);

  // Also use UCI_LimitStrength and UCI_Elo if supported
  worker.postMessage("setoption name UCI_LimitStrength value true");
  worker.postMessage(`setoption name UCI_Elo value ${elo}`);
}

export function getBestMove(
  worker: Worker,
  fen: string,
  depth: number = 12
): Promise<string> {
  return new Promise((resolve) => {
    function onMessage(event: MessageEvent) {
      const line: string =
        typeof event.data === "string" ? event.data : event.data?.toString();
      if (line.startsWith("bestmove")) {
        worker.removeEventListener("message", onMessage);
        const best = line.split(" ")[1];
        resolve(best);
      }
    }

    worker.addEventListener("message", onMessage);
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage(`go depth ${depth}`);
  });
}

export function destroyStockfish(): void {
  if (stockfish) {
    stockfish.terminate();
    stockfish = null;
  }
}

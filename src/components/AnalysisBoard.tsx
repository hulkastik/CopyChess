"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Chess, Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useAuth } from "@/context/AuthContext";
import { getEngine } from "@/lib/stockfish";
import {
  analyseGame,
  evalToWhiteShare,
  formatEval,
  judgeMove,
  QUALITY_STYLE,
  type GameAnalysis,
  type MoveQuality,
  type PositionEval,
} from "@/lib/analysis";
import { readHandoff, type AnalysisHandoff } from "@/lib/analysisHandoff";
import { REASON_TEXT } from "@/lib/gameRules";
import { TIME_CONTROLS, type TimeControlKey } from "@/lib/timeControls";
import PromotionPicker from "./PromotionPicker";

interface PlayerRef {
  id: string;
  username: string;
  displayName: string;
}

interface GameRecord {
  id: string;
  whiteId: string;
  blackId: string;
  white: PlayerRef;
  black: PlayerRef;
  timeControl: TimeControlKey;
  movesUci: string;
  result: string | null;
  reason: string | null;
  status: string;
  startedAt: string;
}

/**
 * Einheitliche Form fuer beide Quellen: gespeicherte Partie aus der Datenbank
 * und nicht gespeicherte Partie (Training, lokal) aus dem sessionStorage.
 */
type AnalysisSubject = AnalysisHandoff;

function fromRecord(record: GameRecord, viewerId: string | null): AnalysisSubject {
  const spec = TIME_CONTROLS[record.timeControl];
  return {
    movesUci: record.movesUci ? record.movesUci.split(" ").filter(Boolean) : [],
    whiteName: record.white.displayName,
    blackName: record.black.displayName,
    result: record.result,
    reason: record.reason,
    subtitle: `${spec?.label ?? record.timeControl} · ${new Date(record.startedAt).toLocaleString("de-DE")}`,
    orientation: viewerId && record.blackId === viewerId ? "b" : "w",
  };
}

const DEPTH_OPTIONS = [
  { label: "Schnell (Tiefe 10)", depth: 10 },
  { label: "Standard (Tiefe 14)", depth: 14 },
  { label: "Gründlich (Tiefe 18)", depth: 18 },
];

const QUALITY_ORDER: MoveQuality[] = [
  "brilliant",
  "great",
  "best",
  "good",
  "book",
  "inaccuracy",
  "missed",
  "mistake",
  "blunder",
];

interface ExploredMove {
  uci: string;
  san: string;
  fenBefore: string;
  fenAfter: string;
  /** null solange die Engine die Folgestellung noch rechnet. */
  quality: MoveQuality | null;
  centipawnLoss: number | null;
  /** Was in der Stellung davor am besten gewesen waere. */
  bestAlternativeSan: string | null;
}

interface Exploration {
  fen: string;
  baseFen: string;
  moves: ExploredMove[];
}

/**
 * Dreht das Zugrecht in einer FEN um.
 *
 * Damit lassen sich im Analysebrett auch Figuren der Gegenseite bewegen — ohne
 * das darf man immer nur die Seite ziehen, die gerade dran ist, und kann eine
 * Variante nicht zu Ende spielen. En-passant-Feld muss dabei fallen, sonst
 * beschreibt es einen Schlagzug, den es nach dem Wechsel nicht mehr gibt.
 */
/** Knopf der Zugnavigation — kräftiger als `btn-ghost`, das auf dunklem Grund untergeht. */
function NavButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-11 flex-1 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-base text-[var(--text-primary)] transition hover:bg-[var(--accent)] hover:text-black disabled:opacity-30 disabled:hover:bg-[var(--bg-elevated)] disabled:hover:text-[var(--text-primary)]"
    >
      {children}
    </button>
  );
}

function uciToSanLocal(fen: string, uci: string | null): string | null {
  if (!uci) return null;
  try {
    const chess = new Chess(fen);
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

function flipTurn(fen: string): string | null {
  const parts = fen.split(" ");
  if (parts.length < 6) return null;
  parts[1] = parts[1] === "w" ? "b" : "w";
  parts[3] = "-";
  const flipped = parts.join(" ");
  try {
    // Wirft, wenn die Stellung so nicht legal ist (z. B. Gegner steht im Schach).
    new Chess(flipped);
    return flipped;
  } catch {
    return null;
  }
}

/** Ohne `gameId` wird die Partie aus dem sessionStorage gelesen. */
export default function AnalysisBoard({ gameId }: { gameId?: string }) {
  const { user, ready, authFetch } = useAuth();

  const [subject, setSubject] = useState<AnalysisSubject | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [depth, setDepth] = useState(14);

  const [ply, setPly] = useState(0);
  const [exploration, setExploration] = useState<Exploration | null>(null);
  const [liveEval, setLiveEval] = useState<PositionEval | null>(null);
  const [liveThinking, setLiveThinking] = useState(false);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);

  const abortSignal = useRef<{ aborted: boolean }>({ aborted: false });
  const liveRequestFen = useRef<string | null>(null);
  const moveListRef = useRef<HTMLDivElement | null>(null);
  /** Bewertungen nach FEN — Grundlage fuer die Einstufung eigener Probezuege. */
  const evalCache = useRef(new Map<string, PositionEval>());

  // ── Partie laden ────────────────────────────────────────────────────────
  useEffect(() => {
    // Übergebene Partie (Training / lokal): kein Konto noetig, nichts zu laden.
    if (!gameId) {
      const handoff = readHandoff();
      if (!handoff) {
        setLoadError("Keine Partie zum Analysieren. Starte die Analyse direkt am Brett.");
        return;
      }
      setSubject(handoff);
      return;
    }

    if (!ready) return;
    if (!user) return;

    let cancelled = false;
    (async () => {
      const res = await authFetch(`/api/games/${gameId}`);
      const data = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setLoadError(data.error ?? "Partie konnte nicht geladen werden");
        return;
      }
      setSubject(fromRecord(data.game, user.id));
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user, gameId, authFetch]);

  useEffect(() => {
    return () => {
      abortSignal.current.aborted = true;
    };
  }, []);

  const movesUci = useMemo(() => subject?.movesUci ?? [], [subject]);

  // Alle Stellungen der Hauptvariante einmal vorberechnen.
  const mainline = useMemo(() => {
    const chess = new Chess();
    const fens = [chess.fen()];
    const sans: string[] = [];
    for (const uci of movesUci) {
      try {
        const move = chess.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.length > 4 ? uci[4] : undefined,
        });
        sans.push(move.san);
        fens.push(chess.fen());
      } catch {
        break;
      }
    }
    return { fens, sans };
  }, [movesUci]);

  const currentFen = exploration ? exploration.fen : mainline.fens[ply] ?? mainline.fens[0];
  const currentChess = useMemo(() => new Chess(currentFen), [currentFen]);

  const myColor: "w" | "b" = subject?.orientation ?? "w";

  // ── Analyse starten ─────────────────────────────────────────────────────
  const runAnalysis = useCallback(async () => {
    if (movesUci.length === 0) {
      setAnalysisError("Diese Partie enthält keine Züge.");
      return;
    }
    abortSignal.current = { aborted: false };
    setAnalysisError(null);
    setAnalysis(null);
    setProgress({ done: 0, total: movesUci.length + 1 });

    try {
      const result = await analyseGame(movesUci, {
        depth,
        onProgress: setProgress,
        signal: abortSignal.current,
      });
      setAnalysis(result);
    } catch (error) {
      if (!abortSignal.current.aborted) {
        setAnalysisError(
          error instanceof Error ? error.message : "Analyse fehlgeschlagen"
        );
      }
    } finally {
      setProgress(null);
    }
  }, [movesUci, depth]);

  // Fertige Analyse in den Cache spiegeln — die Einstufung eigener Probezuege
  // braucht die Bewertung der Ausgangsstellung, ohne sie neu zu rechnen.
  useEffect(() => {
    if (!analysis) return;
    for (let i = 0; i < analysis.evals.length; i += 1) {
      const fen = mainline.fens[i];
      if (fen) evalCache.current.set(fen, analysis.evals[i]);
    }
  }, [analysis, mainline.fens]);

  // ── Live-Bewertung fuer die angezeigte Stellung ─────────────────────────
  useEffect(() => {
    // Auf der Hauptvariante liefert die fertige Analyse die Bewertung schon.
    if (!exploration && analysis) {
      setLiveEval(null);
      return;
    }
    if (progress) return; // waehrend der Gesamtanalyse ist die Engine belegt

    const fen = currentFen;
    const position = new Chess(fen);

    if (position.isGameOver()) {
      // Matt oder Remis: kein Zug mehr, aber die Bewertung ist eindeutig.
      const mate = position.isCheckmate() ? (position.turn() === "w" ? -1 : 1) : null;
      const terminal: PositionEval = {
        cp: mate === null ? 0 : null,
        mate,
        bestMoveUci: null,
        bestMoveSan: null,
        onlyMoveGap: null,
      };
      evalCache.current.set(fen, terminal);
      setLiveEval(terminal);
      setLiveThinking(false);
      judgePendingMove(fen, terminal);
      return;
    }

    const cached = evalCache.current.get(fen);
    if (cached) {
      setLiveEval(cached);
      setLiveThinking(false);
      judgePendingMove(fen, cached);
      return;
    }

    liveRequestFen.current = fen;
    setLiveThinking(true);

    getEngine()
      .analyse(fen, { depth: Math.min(depth, 16), multipv: 2, timeoutMs: 30_000 })
      .then((result) => {
        if (liveRequestFen.current !== fen) return;
        const first = result.lines.find((l) => l.multipv === 1);
        const second = result.lines.find((l) => l.multipv === 2);
        const sign = position.turn() === "w" ? 1 : -1;
        const evaluation: PositionEval = {
          cp: first?.cp == null ? null : first.cp * sign,
          mate: first?.mate == null ? null : first.mate * sign,
          bestMoveUci: result.bestMove,
          bestMoveSan: uciToSanLocal(fen, result.bestMove),
          onlyMoveGap:
            first && second
              ? Math.abs(
                  (first.mate !== null ? Math.sign(first.mate) * 10_000 : first.cp ?? 0) -
                    (second.mate !== null ? Math.sign(second.mate) * 10_000 : second.cp ?? 0)
                )
              : null,
        };
        evalCache.current.set(fen, evaluation);
        setLiveEval(evaluation);
        setLiveThinking(false);
        judgePendingMove(fen, evaluation);
      })
      .catch(() => {
        if (liveRequestFen.current !== fen) return;
        setLiveThinking(false);
      });
    // judgePendingMove ist bewusst nicht in den Abhaengigkeiten: die Funktion
    // liest nur Refs und setzt State ueber Updater.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFen, exploration, analysis, progress, depth]);

  /** Stuft den zuletzt ausprobierten Zug ein, sobald die Folgestellung bewertet ist. */
  function judgePendingMove(fen: string, evalAfter: PositionEval) {
    setExploration((current) => {
      if (!current || current.moves.length === 0) return current;
      const last = current.moves[current.moves.length - 1];
      if (last.quality !== null || last.fenAfter !== fen) return current;

      const evalBefore = evalCache.current.get(last.fenBefore);
      if (!evalBefore) return current;

      const judged = judgeMove({
        fenBefore: last.fenBefore,
        uci: last.uci,
        evalBefore,
        evalAfter,
      });

      const moves = [...current.moves];
      moves[moves.length - 1] = {
        ...last,
        quality: judged.quality,
        centipawnLoss: judged.centipawnLoss,
        bestAlternativeSan: evalBefore.bestMoveSan ?? uciToSanLocal(last.fenBefore, evalBefore.bestMoveUci),
      };
      return { ...current, moves };
    });
  }

  // ── Navigation ──────────────────────────────────────────────────────────
  const goToPly = useCallback(
    (next: number) => {
      setExploration(null);
      setSelectedSquare(null);
      setPly(Math.max(0, Math.min(mainline.fens.length - 1, next)));
    },
    [mainline.fens.length]
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPly(ply - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goToPly(ply + 1);
      } else if (event.key === "Home") {
        goToPly(0);
      } else if (event.key === "End") {
        goToPly(mainline.fens.length - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ply, goToPly, mainline.fens.length]);

  // Aktiven Zug in der Liste im Blick behalten.
  //
  // Bewusst kein scrollIntoView: das scrollt jeden scrollbaren Vorfahren mit,
  // also auch das Fenster — bei jedem Zugwechsel sprang die Seite nach unten
  // zur Zugliste. Hier wird ausschliesslich der Listencontainer verschoben.
  useEffect(() => {
    const container = moveListRef.current;
    const active = container?.querySelector<HTMLElement>('[data-active="true"]');
    if (!container || !active) return;

    const top = active.offsetTop;
    const bottom = top + active.offsetHeight;
    if (top < container.scrollTop) {
      container.scrollTop = top;
    } else if (bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = bottom - container.clientHeight;
    }
  }, [ply]);

  // ── Freies Ausprobieren auf dem Brett ───────────────────────────────────

  /**
   * Ausgangsstellung fuer einen Zug mit dieser Figur.
   *
   * Greift man eine Figur der Gegenseite, wird das Zugrecht gedreht. Sonst
   * liesse sich eine Variante nur abwechselnd bis zum ersten gegnerischen Zug
   * spielen — man will aber beide Seiten frei bewegen koennen.
   */
  const baseFenFor = useCallback(
    (from: Square): string | null => {
      const piece = currentChess.get(from);
      if (!piece) return null;
      if (piece.color === currentChess.turn()) return currentFen;
      return flipTurn(currentFen);
    },
    [currentChess, currentFen]
  );

  const applyExploreMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      const fenBefore = baseFenFor(from);
      if (!fenBefore) return false;

      const chess = new Chess(fenBefore);
      let move;
      try {
        move = chess.move({ from, to, promotion });
      } catch {
        return false;
      }
      if (!move) return false;

      const fenAfter = chess.fen();
      setExploration((current) => ({
        fen: fenAfter,
        baseFen: current?.baseFen ?? currentFen,
        moves: [
          ...(current?.moves ?? []),
          {
            uci: `${from}${to}${promotion ?? ""}`,
            san: move.san,
            fenBefore,
            fenAfter,
            quality: null,
            centipawnLoss: null,
            bestAlternativeSan: null,
          },
        ],
      }));
      setSelectedSquare(null);
      return true;
    },
    [baseFenFor, currentFen]
  );

  const tryMove = useCallback(
    (from: Square, to: Square): boolean => {
      const fenBefore = baseFenFor(from);
      if (!fenBefore) return false;

      const board = new Chess(fenBefore);
      const legal = board.moves({ square: from, verbose: true }).some((move) => move.to === to);
      if (!legal) return false;

      const piece = board.get(from);
      if (piece?.type === "p" && (to[1] === "8" || to[1] === "1")) {
        setPendingPromotion({ from, to });
        return true;
      }
      return applyExploreMove(from, to);
    },
    [baseFenFor, applyExploreMove]
  );

  function onPieceDrop({
    sourceSquare,
    targetSquare,
  }: {
    piece: unknown;
    sourceSquare: string;
    targetSquare: string | null;
  }): boolean {
    setSelectedSquare(null);
    if (!targetSquare) return false;
    return tryMove(sourceSquare as Square, targetSquare as Square);
  }

  function onSquareClick({ square }: { piece: unknown; square: string }) {
    const target = square as Square;
    if (selectedSquare && selectedSquare !== target && tryMove(selectedSquare, target)) return;
    // Jede Figur darf gegriffen werden, nicht nur die der Seite am Zug.
    setSelectedSquare(currentChess.get(target) ? target : null);
  }

  // ── Anzeige-Daten ───────────────────────────────────────────────────────
  const displayedEval: PositionEval | null = exploration
    ? liveEval
    : analysis
    ? analysis.evals[ply] ?? null
    : liveEval;

  const currentMove = !exploration && ply > 0 ? analysis?.moves[ply - 1] ?? null : null;
  const lastExplored = exploration?.moves[exploration.moves.length - 1] ?? null;

  const bestMoveUci = displayedEval?.bestMoveUci ?? null;

  /** Feld und Einstufung fuer die Marke auf dem Brett. */
  const qualityBadge = useMemo((): { square: string; quality: MoveQuality } | null => {
    if (lastExplored?.quality) {
      return { square: lastExplored.uci.slice(2, 4), quality: lastExplored.quality };
    }
    if (currentMove) {
      return { square: currentMove.uci.slice(2, 4), quality: currentMove.quality };
    }
    return null;
  }, [lastExplored, currentMove]);

  const arrows = useMemo(() => {
    const list: { startSquare: string; endSquare: string; color: string }[] = [];
    if (bestMoveUci) {
      list.push({
        startSquare: bestMoveUci.slice(0, 2),
        endSquare: bestMoveUci.slice(2, 4),
        color: "#27ae60",
      });
    }
    // Der tatsaechlich gespielte Zug, wenn er vom besten abweicht.
    if (currentMove && currentMove.uci !== bestMoveUci) {
      list.push({
        startSquare: currentMove.uci.slice(0, 2),
        endSquare: currentMove.uci.slice(2, 4),
        color: QUALITY_STYLE[currentMove.quality].color,
      });
    }
    return list;
  }, [bestMoveUci, currentMove]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};

    if (qualityBadge) {
      styles[qualityBadge.square] = { background: QUALITY_STYLE[qualityBadge.quality].bg };
    }

    if (selectedSquare) {
      const fenBefore = baseFenFor(selectedSquare) ?? currentFen;
      styles[selectedSquare] = { background: "rgba(107,171,74,0.45)" };
      for (const move of new Chess(fenBefore).moves({ square: selectedSquare, verbose: true })) {
        styles[move.to] = move.captured
          ? {
              background: "radial-gradient(transparent 52%, rgba(107,171,74,0.45) 52%)",
              borderRadius: "50%",
            }
          : {
              background: "radial-gradient(circle, rgba(107,171,74,0.45) 24%, transparent 24%)",
              borderRadius: "50%",
            };
      }
    }
    return styles;
  }, [selectedSquare, baseFenFor, currentFen, qualityBadge]);

  /**
   * Eigener Feld-Renderer, um die Bewertungsmarke ueber das Zielfeld zu legen.
   * `squareStyles` muss dabei selbst angewendet werden — der Standard-Renderer,
   * der das sonst uebernimmt, wird hier ersetzt.
   */
  const squareRenderer = useCallback(
    ({ square, children }: { square: string; children?: React.ReactNode }) => {
      const badge = qualityBadge?.square === square ? QUALITY_STYLE[qualityBadge.quality] : null;
      return (
        <div style={{ width: "100%", height: "100%", position: "relative", ...squareStyles[square] }}>
          {children}
          {badge && (
            <span
              title={badge.label}
              style={{
                position: "absolute",
                top: "-8%",
                right: "-8%",
                width: "38%",
                height: "38%",
                borderRadius: "50%",
                background: badge.color,
                color: "#10130c",
                fontWeight: 800,
                fontSize: "clamp(8px, 2vw, 14px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 1px 6px rgba(0,0,0,0.45)",
                pointerEvents: "none",
                zIndex: 3,
              }}
            >
              {badge.icon}
            </span>
          )}
        </div>
      );
    },
    [qualityBadge, squareStyles]
  );

  const whiteShare = displayedEval ? evalToWhiteShare(displayedEval) : 0.5;

  // ── Rahmenzustaende ─────────────────────────────────────────────────────
  // Nur die Datenbank-Variante braucht ein Konto. Eine uebergebene Trainings-
  // partie liegt bereits im Browser und gehoert niemandem sonst.
  if (gameId && !ready) return <p className="text-[var(--text-secondary)]">Lade…</p>;

  if (gameId && !user) {
    return (
      <div className="card p-6 text-center">
        <p className="font-semibold">Nicht angemeldet</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card p-6 text-center">
        <p className="mb-3 font-semibold text-[var(--danger)]">{loadError}</p>
        <Link href="/" className="btn btn-ghost inline-block">
          Zur Startseite
        </Link>
      </div>
    );
  }

  if (!subject) return <p className="text-[var(--text-secondary)]">Lade Partie…</p>;

  return (
    <div className="flex w-full max-w-6xl flex-col items-stretch gap-4 lg:flex-row lg:items-start lg:gap-6">
      {/* Bewertungsbalken + Brett + Navigation */}
      <div className="flex w-full flex-col gap-3 lg:w-auto">
        {/* Nur diese Zeile darf sich strecken: der Balken richtet sich am Brett
            aus. Läge die Navigation mit drin, wüchse das Brett auf die Höhe der
            gesamten Spalte und schöbe sich über die Knöpfe. */}
        <div className="flex w-full items-stretch gap-2 sm:gap-3">
          <div className="relative w-3 shrink-0 overflow-hidden rounded-full bg-[#2b2b2b] sm:w-4">
            <div
              className="absolute inset-x-0 bottom-0 bg-[#f4f4f0] transition-[height] duration-300"
              style={{ height: `${whiteShare * 100}%` }}
            />
          </div>

          <div className="board-shell min-w-0 flex-1 lg:w-[600px] lg:flex-none">
            <Chessboard
              options={{
                id: `AnalysisBoard-${gameId ?? "session"}`,
                position: currentFen,
                onPieceDrop,
                onSquareClick,
                boardOrientation: myColor === "b" ? "black" : "white",
                animationDurationInMs: 160,
                arrows,
                allowDragging: true,
                boardStyle: { borderRadius: "10px", boxShadow: "0 8px 40px rgba(0,0,0,0.45)" },
                darkSquareStyle: { backgroundColor: "var(--square-dark)" },
                lightSquareStyle: { backgroundColor: "var(--square-light)" },
                squareStyles: squareStyles,
                squareRenderer,
              }}
            />
          </div>
        </div>

        {/* Zugnavigation als eigene Leiste, damit sie sich klar vom Brett und
            von den Karten darunter absetzt. */}
        <div className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-1.5 sm:gap-2 sm:p-2">
          <NavButton onClick={() => goToPly(0)} disabled={ply === 0} label="Anfang">
            ⏮
          </NavButton>
          <NavButton onClick={() => goToPly(ply - 1)} disabled={ply === 0} label="Zurück">
            ◀
          </NavButton>
          <span className="shrink-0 px-1 text-center font-mono text-xs tabular-nums text-[var(--text-secondary)] sm:min-w-20 sm:text-sm">
            {ply} / {mainline.fens.length - 1}
          </span>
          <NavButton
            onClick={() => goToPly(ply + 1)}
            disabled={ply >= mainline.fens.length - 1}
            label="Vor"
          >
            ▶
          </NavButton>
          <NavButton
            onClick={() => goToPly(mainline.fens.length - 1)}
            disabled={ply >= mainline.fens.length - 1}
            label="Ende"
          >
            ⏭
          </NavButton>
        </div>
      </div>

      {/* Seitenleiste */}
      <div className="flex w-full flex-col gap-3 lg:max-w-sm">
        {/* Kopf */}
        <div className="card p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">{subject.whiteName}</span>
            <span className="font-mono text-[var(--text-secondary)]">
              {subject.result ?? "*"}
            </span>
            <span className="font-semibold">{subject.blackName}</span>
          </div>
          <p className="mt-1 text-center text-xs text-[var(--text-secondary)]">
            {subject.subtitle}
            {subject.reason ? ` · ${REASON_TEXT[subject.reason] ?? subject.reason}` : ""}
          </p>

          {analysis && (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-[var(--bg-card)] px-3 py-2 text-sm">
              <span>
                <span className="text-[var(--text-secondary)]">Genauigkeit </span>
                <span className="font-bold">{analysis.accuracyWhite}%</span>
              </span>
              <span>
                <span className="font-bold">{analysis.accuracyBlack}%</span>
              </span>
            </div>
          )}
        </div>

        {/* Analyse-Steuerung */}
        <div className="card p-4">
          {progress ? (
            <>
              <p className="label mb-2">Analysiere…</p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-card)]">
                <div
                  className="h-full bg-[var(--accent)] transition-[width]"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                Stellung {progress.done} von {progress.total}
              </p>
              <button
                onClick={() => {
                  abortSignal.current.aborted = true;
                  setProgress(null);
                }}
                className="btn btn-ghost mt-3 w-full"
              >
                Abbrechen
              </button>
            </>
          ) : (
            <>
              <p className="label mb-2">Partieanalyse</p>
              <select
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
                className="input mb-2"
              >
                {DEPTH_OPTIONS.map((option) => (
                  <option key={option.depth} value={option.depth}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button onClick={runAnalysis} className="btn btn-primary w-full">
                {analysis ? "Neu analysieren" : "Analyse starten"}
              </button>
              {analysisError && (
                <p className="mt-2 text-xs text-[var(--danger)]">{analysisError}</p>
              )}
            </>
          )}
        </div>

        {/* Bewertung der aktuellen Stellung */}
        <div className="card p-4">
          <div className="flex items-baseline justify-between">
            <p className="label">Bewertung</p>
            <span className="font-mono text-xl font-bold">
              {displayedEval ? formatEval(displayedEval) : liveThinking ? "…" : "–"}
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Bester Zug:{" "}
            <span className="font-mono text-[var(--accent)]">
              {bestMoveUci
                ? `${bestMoveUci.slice(0, 2)}→${bestMoveUci.slice(2, 4)}`
                : liveThinking
                ? "rechnet…"
                : "–"}
            </span>
          </p>

          {currentMove && (
            <div
              className="mt-3 rounded-xl px-3 py-2"
              style={{ background: QUALITY_STYLE[currentMove.quality].bg }}
            >
              <p
                className="text-sm font-bold"
                style={{ color: QUALITY_STYLE[currentMove.quality].color }}
              >
                {QUALITY_STYLE[currentMove.quality].icon} {currentMove.san} –{" "}
                {QUALITY_STYLE[currentMove.quality].label}
              </p>
              {currentMove.bestMoveSan && currentMove.quality !== "best" && (
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Besser war <span className="font-mono">{currentMove.bestMoveSan}</span>
                  {currentMove.centipawnLoss > 0 && ` (−${(currentMove.centipawnLoss / 100).toFixed(2)})`}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Erkundungsmodus */}
        {exploration && (
          <div className="card border-[var(--accent)] p-4">
            <p className="label mb-2 text-[var(--accent)]">Deine Variante</p>
            <div className="flex flex-col gap-1">
              {exploration.moves.map((move, index) => {
                const style = move.quality ? QUALITY_STYLE[move.quality] : null;
                return (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm"
                    style={style ? { background: style.bg } : undefined}
                  >
                    <span className="font-mono font-semibold">{move.san}</span>
                    {style ? (
                      <span className="text-xs font-bold" style={{ color: style.color }}>
                        {style.icon} {style.label}
                      </span>
                    ) : (
                      <span className="animate-pulse text-xs text-[var(--text-secondary)]">
                        wird bewertet…
                      </span>
                    )}
                    {move.quality &&
                      move.quality !== "best" &&
                      move.quality !== "brilliant" &&
                      move.bestAlternativeSan && (
                        <span className="ml-auto text-xs text-[var(--text-secondary)]">
                          besser: <span className="font-mono">{move.bestAlternativeSan}</span>
                        </span>
                      )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() =>
                  setExploration((current) => {
                    if (!current || current.moves.length <= 1) return null;
                    const moves = current.moves.slice(0, -1);
                    return { ...current, moves, fen: moves[moves.length - 1].fenAfter };
                  })
                }
                className="btn btn-ghost flex-1"
              >
                ↩ Ein Zug zurück
              </button>
              <button
                onClick={() => {
                  setExploration(null);
                  setSelectedSquare(null);
                }}
                className="btn btn-ghost flex-1"
              >
                Zur Partie
              </button>
            </div>
          </div>
        )}

        {/* Zugliste */}
        <div className="card flex-1 p-4">
          <p className="label mb-2">Züge</p>
          {/* relative: macht offsetTop der Zug-Knoepfe auf diesen Container bezogen */}
          <div ref={moveListRef} className="relative max-h-80 overflow-y-auto">
            <div className="grid grid-cols-[2rem_1fr_1fr] items-center gap-x-1 gap-y-0.5 text-sm">
              {Array.from({ length: Math.ceil(mainline.sans.length / 2) }, (_, row) => (
                <div key={row} className="contents">
                  <span className="font-mono text-[var(--text-secondary)]">{row + 1}.</span>
                  {[0, 1].map((offset) => {
                    const index = row * 2 + offset;
                    if (index >= mainline.sans.length) return <span key={offset} />;
                    const move = analysis?.moves[index];
                    const active = !exploration && ply === index + 1;
                    return (
                      <button
                        key={offset}
                        data-active={active}
                        onClick={() => goToPly(index + 1)}
                        className={`flex items-center gap-1 rounded-md px-2 py-1 text-left font-mono transition ${
                          active ? "bg-[var(--bg-elevated)]" : "hover:bg-[var(--bg-card)]"
                        }`}
                      >
                        <span>{mainline.sans[index]}</span>
                        {move && (
                          <span
                            className="text-xs font-bold"
                            style={{ color: QUALITY_STYLE[move.quality].color }}
                            title={QUALITY_STYLE[move.quality].label}
                          >
                            {QUALITY_STYLE[move.quality].icon}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            {mainline.sans.length === 0 && (
              <p className="text-sm text-[var(--text-secondary)]">Keine Züge vorhanden.</p>
            )}
          </div>
        </div>

        {/* Zusammenfassung */}
        {analysis && (
          <div className="card p-4">
            <p className="label mb-2">Zugqualität</p>
            <div className="flex flex-col gap-1">
              {QUALITY_ORDER.filter(
                (quality) => analysis.counts[quality].w + analysis.counts[quality].b > 0
              ).map((quality) => (
                <div key={quality} className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center text-sm">
                  <span className="text-center font-bold" style={{ color: QUALITY_STYLE[quality].color }}>
                    {analysis.counts[quality].w}
                  </span>
                  <span className="text-center text-xs" style={{ color: QUALITY_STYLE[quality].color }}>
                    {QUALITY_STYLE[quality].icon} {QUALITY_STYLE[quality].label}
                  </span>
                  <span className="text-center font-bold" style={{ color: QUALITY_STYLE[quality].color }}>
                    {analysis.counts[quality].b}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {pendingPromotion && (
        <PromotionPicker
          color={currentChess.turn()}
          onCancel={() => setPendingPromotion(null)}
          onSelect={(piece) => {
            const { from, to } = pendingPromotion;
            setPendingPromotion(null);
            applyExploreMove(from, to, piece);
          }}
        />
      )}
    </div>
  );
}

import http from "http";
import path from "path";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Chess } from "chess.js";
import { Server, Socket } from "socket.io";
import { v4 as uuidv4 } from "uuid";

// .env liegt im Projekt-Root, nicht im server/-Ordner.
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

// `PORT` wird mitgelesen, weil pm2 und viele Hoster genau die Variable setzen —
// ein Server, der nur SOCKET_PORT kennt, landet dort still auf dem falschen Port.
const PORT = Number(process.env.SOCKET_PORT || process.env.PORT || 3001);

/**
 * Adresse des Next-Prozesses. Darueber legt der Spielserver Partien an und
 * schreibt Zuege fort — laeuft Next auf einem anderen Port, schlaegt sonst
 * jedes Annehmen einer Herausforderung fehl, und zwar erst im Moment des
 * Annehmens. Deshalb der Erreichbarkeitstest beim Start.
 */
const NEXT_API_URL = process.env.NEXT_API_URL || "http://localhost:3000";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "chess-internal-dev-secret";
/**
 * Erlaubte Herkuenfte.
 *
 * Ist CLIENT_ORIGIN nicht gesetzt, wird die anfragende Herkunft gespiegelt.
 * Der frühere Standard "http://localhost:3000" blockierte hinter einer Domain
 * jede Verbindung per CORS — und zwar lautlos, sichtbar nur als grauer Punkt.
 * Der Socket-Server traegt keine Cookie-Anmeldung, das Spiegeln oeffnet also
 * keinen Zugriff; die Identitaet prueft weiterhin auth:identify.
 */
const CONFIGURED_ORIGINS = (process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const CORS_ORIGIN: boolean | string[] = CONFIGURED_ORIGINS.length > 0 ? CONFIGURED_ORIGINS : true;

// ─── Typen ────────────────────────────────────────────────────────────────────
type TimeControlKey = "bullet" | "blitz" | "rapid";
type ColorChoice = "white" | "black" | "random";
type Color = "w" | "b";

interface TimeControlSpec {
  initialSeconds: number;
  incrementSeconds: number;
}

const TIME_CONTROLS: Record<TimeControlKey, TimeControlSpec> = {
  bullet: { initialSeconds: 60, incrementSeconds: 0 },
  blitz: { initialSeconds: 180, incrementSeconds: 2 },
  rapid: { initialSeconds: 600, incrementSeconds: 0 },
};

interface PlayerRef {
  id: string;
  username: string;
  displayName: string;
}

interface GameState {
  id: string;
  white: PlayerRef;
  black: PlayerRef;
  timeControl: TimeControlKey;
  incrementMs: number;
  chess: Chess;
  movesUci: string[];
  whiteMs: number;
  blackMs: number;
  /** Zeitpunkt, ab dem die Uhr der Seite am Zug laeuft. null = Uhr steht. */
  turnStartedAt: number | null;
  joined: Set<string>;
  status: "ACTIVE" | "FINISHED" | "ABORTED";
  result: string | null;
  reason: string | null;
  drawOfferFrom: string | null;
  /** Verhindert doppelte Endabrechnung aus Timer und Zug gleichzeitig. */
  finishing: boolean;
  /** Serialisiert die DB-Schreibvorgaenge dieser Partie. */
  persistChain: Promise<void>;
}

interface Challenge {
  id: string;
  fromUserId: string;
  fromDisplayName: string;
  toUserId: string;
  timeControl: TimeControlKey;
  color: ColorChoice;
  createdAt: number;
}

// ─── Zustand ──────────────────────────────────────────────────────────────────
const games = new Map<string, GameState>();
const challenges = new Map<string, Challenge>();
/** userId -> Menge aktiver Socket-IDs (mehrere Tabs sind erlaubt). */
const userSockets = new Map<string, Set<string>>();
/** socketId -> userId */
const socketUser = new Map<string, string>();

const CHALLENGE_TTL_MS = 60_000;

// ─── Persistenz ueber die internen Next-Routen ───────────────────────────────
async function internalFetch(pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${NEXT_API_URL}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": INTERNAL_SECRET,
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new Error(`${pathname} -> ${response.status} ${body?.error || text.slice(0, 200)}`);
  }
  return body;
}

function persistGame(game: GameState): void {
  // Momentaufnahme sofort einfrieren, aber die Schreibvorgaenge verketten:
  // parallele PATCHes koennen sich sonst ueberholen und einen Zug verschlucken.
  const snapshot = {
    movesUci: game.movesUci.join(" "),
    fen: game.chess.fen(),
    whiteMs: Math.round(game.whiteMs),
    blackMs: Math.round(game.blackMs),
    status: game.status,
    result: game.result,
    reason: game.reason,
  };

  game.persistChain = game.persistChain
    .then(() =>
      internalFetch(`/api/internal/games/${game.id}`, {
        method: "PATCH",
        body: JSON.stringify(snapshot),
      })
    )
    .then(
      () => undefined,
      (error: Error) => {
        console.error(`[persist ${game.id}]`, error.message);
      }
    );
}

// ─── Uhr ──────────────────────────────────────────────────────────────────────
function remainingMs(game: GameState, color: Color): number {
  const base = color === "w" ? game.whiteMs : game.blackMs;
  if (game.status !== "ACTIVE" || game.turnStartedAt === null) return base;
  if (game.chess.turn() !== color) return base;
  return base - (Date.now() - game.turnStartedAt);
}

function serializeGame(game: GameState) {
  return {
    id: game.id,
    white: game.white,
    black: game.black,
    timeControl: game.timeControl,
    incrementMs: game.incrementMs,
    fen: game.chess.fen(),
    movesUci: game.movesUci,
    movesSan: game.chess.history(),
    turn: game.chess.turn(),
    whiteMs: Math.max(0, Math.round(remainingMs(game, "w"))),
    blackMs: Math.max(0, Math.round(remainingMs(game, "b"))),
    clockRunning: game.turnStartedAt !== null && game.status === "ACTIVE",
    status: game.status,
    result: game.result,
    reason: game.reason,
    drawOfferFrom: game.drawOfferFrom,
    onlineUserIds: [game.white.id, game.black.id].filter((id) => userSockets.has(id)),
  };
}

function broadcastGame(io: Server, game: GameState): void {
  io.to(`game:${game.id}`).emit("game:state", serializeGame(game));
}

function finishGame(
  io: Server,
  game: GameState,
  result: string,
  reason: string,
  status: "FINISHED" | "ABORTED" = "FINISHED"
): void {
  if (game.status !== "ACTIVE" || game.finishing) return;
  game.finishing = true;

  // Restzeit der Seite am Zug einfrieren, bevor die Uhr angehalten wird.
  const turn = game.chess.turn();
  const left = Math.max(0, remainingMs(game, turn));
  if (turn === "w") game.whiteMs = left;
  else game.blackMs = left;

  game.turnStartedAt = null;
  game.status = status;
  game.result = result;
  game.reason = reason;
  game.drawOfferFrom = null;

  persistGame(game);
  broadcastGame(io, game);
  io.to(`game:${game.id}`).emit("game:over", { gameId: game.id, result, reason });
}

/**
 * Prueft die Stellung auf Matt/Patt/Remis und beendet die Partie ggf.
 *
 * Threefold und 50-Zuege-Regel sind nach FIDE Reklamationsrechte (zwingend erst
 * bei fuenffacher Wiederholung bzw. 75 Zuegen). Wie im Online-Schach ueblich
 * greifen sie hier sofort — sonst laesst sich eine Partie nicht beenden, wenn
 * beide Seiten stur wiederholen.
 *
 * Die Wiederholung ist nur erkennbar, weil `game.chess` alle Zuege gepusht
 * bekommt bzw. beim Laden aus der DB nachgespielt wird. Eine aus der FEN
 * gebaute Instanz haette den noetigen Verlauf nicht.
 */
function checkGameEnd(io: Server, game: GameState): boolean {
  const chess = game.chess;
  if (!chess.isGameOver()) return false;

  if (chess.isCheckmate()) {
    // Seite am Zug ist matt gesetzt worden.
    finishGame(io, game, chess.turn() === "w" ? "0-1" : "1-0", "checkmate");
  } else if (chess.isStalemate()) {
    finishGame(io, game, "1/2-1/2", "stalemate");
  } else if (chess.isInsufficientMaterial()) {
    finishGame(io, game, "1/2-1/2", "insufficient");
  } else if (chess.isThreefoldRepetition()) {
    finishGame(io, game, "1/2-1/2", "repetition");
  } else if (chess.isDrawByFiftyMoves()) {
    finishGame(io, game, "1/2-1/2", "fifty-move");
  } else {
    finishGame(io, game, "1/2-1/2", "draw");
  }
  return true;
}

/**
 * Materialcheck fuer Zeitueberschreitung: wer nicht mehr mattsetzen kann,
 * gewinnt auch nicht auf Zeit — das ist Remis, nicht Sieg.
 */
function hasMatingMaterial(game: GameState, color: Color): boolean {
  let minors = 0;
  for (const row of game.chess.board()) {
    for (const piece of row) {
      if (!piece || piece.color !== color) continue;
      if (piece.type === "p" || piece.type === "r" || piece.type === "q") return true;
      if (piece.type === "n" || piece.type === "b") minors += 1;
    }
  }
  return minors >= 2;
}

// ─── Setup ────────────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ["GET", "POST"], credentials: true },
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    games: games.size,
    challenges: challenges.size,
    onlineUsers: userSockets.size,
  });
});

// ─── Zeitueberwachung ─────────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();

  for (const game of games.values()) {
    if (game.status !== "ACTIVE" || game.turnStartedAt === null) continue;
    const turn = game.chess.turn();
    if (remainingMs(game, turn) > 0) continue;

    if (turn === "w") game.whiteMs = 0;
    else game.blackMs = 0;

    const winner: Color = turn === "w" ? "b" : "w";
    if (hasMatingMaterial(game, winner)) {
      finishGame(io, game, winner === "w" ? "1-0" : "0-1", "timeout");
    } else {
      finishGame(io, game, "1/2-1/2", "timeout-insufficient");
    }
  }

  // Abgelaufene Herausforderungen aufraeumen
  for (const [id, challenge] of challenges) {
    if (now - challenge.createdAt <= CHALLENGE_TTL_MS) continue;
    challenges.delete(id);
    emitToUser(challenge.fromUserId, "challenge:expired", { challengeId: id });
    emitToUser(challenge.toUserId, "challenge:expired", { challengeId: id });
  }

  // Beendete Partien nach 10 Minuten aus dem Speicher werfen (DB hat alles)
  for (const [id, game] of games) {
    if (game.status === "ACTIVE") continue;
    if (io.sockets.adapter.rooms.get(`game:${id}`)?.size) continue;
    games.delete(id);
  }
}, 200);

function emitToUser(userId: string, event: string, payload: unknown): void {
  io.to(`user:${userId}`).emit(event, payload);
}

function broadcastPresence(): void {
  io.emit("presence:update", { onlineUserIds: Array.from(userSockets.keys()) });
}

/** Laedt eine Partie in den Speicher — aus dem Cache oder aus der DB. */
async function loadGame(gameId: string): Promise<GameState | null> {
  const cached = games.get(gameId);
  if (cached) return cached;

  let payload: any;
  try {
    payload = await internalFetch(`/api/internal/games/${gameId}`);
  } catch (error: any) {
    console.error(`[loadGame ${gameId}]`, error.message);
    return null;
  }
  const record = payload?.game;
  if (!record) return null;

  const chess = new Chess();
  const movesUci: string[] = record.movesUci ? record.movesUci.split(" ").filter(Boolean) : [];
  for (const uci of movesUci) {
    try {
      chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
    } catch {
      console.error(`[loadGame ${gameId}] ungültiger gespeicherter Zug: ${uci}`);
      break;
    }
  }

  const state: GameState = {
    id: record.id,
    white: {
      id: record.white.id,
      username: record.white.username,
      displayName: record.white.displayName,
    },
    black: {
      id: record.black.id,
      username: record.black.username,
      displayName: record.black.displayName,
    },
    timeControl: record.timeControl,
    incrementMs: record.incrementSeconds * 1000,
    chess,
    movesUci,
    whiteMs: record.whiteMs,
    blackMs: record.blackMs,
    turnStartedAt: null,
    joined: new Set(),
    status: record.status,
    result: record.result,
    reason: record.reason,
    drawOfferFrom: null,
    finishing: false,
    persistChain: Promise.resolve(),
  };

  games.set(gameId, state);
  return state;
}

function colorOf(game: GameState, userId: string): Color | null {
  if (game.white.id === userId) return "w";
  if (game.black.id === userId) return "b";
  return null;
}

// ─── Socket-Logik ─────────────────────────────────────────────────────────────
io.on("connection", (socket: Socket) => {
  // ── Identitaet melden ───────────────────────────────────────────────────
  socket.on("auth:identify", (data: { userId?: string }, ack?: (r: unknown) => void) => {
    const userId = data?.userId;
    if (!userId) {
      ack?.({ ok: false, error: "userId fehlt" });
      return;
    }

    const previous = socketUser.get(socket.id);
    if (previous && previous !== userId) {
      userSockets.get(previous)?.delete(socket.id);
      if (userSockets.get(previous)?.size === 0) userSockets.delete(previous);
      socket.leave(`user:${previous}`);
    }

    socketUser.set(socket.id, userId);
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId)!.add(socket.id);
    socket.join(`user:${userId}`);

    ack?.({ ok: true, onlineUserIds: Array.from(userSockets.keys()) });
    broadcastPresence();

    // Herausforderungen nachliefern, die eintrafen, waehrend dieser Nutzer
    // gerade nicht erreichbar war (Seitenwechsel, kurzer Verbindungsabriss).
    // Ohne das geht eine Anfrage still verloren, obwohl beide online sind.
    for (const challenge of challenges.values()) {
      if (challenge.toUserId !== userId) continue;
      socket.emit("challenge:incoming", {
        challengeId: challenge.id,
        fromUserId: challenge.fromUserId,
        fromDisplayName: challenge.fromDisplayName,
        timeControl: challenge.timeControl,
        yourColor:
          challenge.color === "random" ? "random" : challenge.color === "white" ? "black" : "white",
      });
    }
  });

  socket.on("auth:logout", () => {
    const userId = socketUser.get(socket.id);
    if (!userId) return;
    userSockets.get(userId)?.delete(socket.id);
    if (userSockets.get(userId)?.size === 0) userSockets.delete(userId);
    socketUser.delete(socket.id);
    socket.leave(`user:${userId}`);
    broadcastPresence();
  });

  socket.on("presence:list", (ack?: (r: unknown) => void) => {
    ack?.({ onlineUserIds: Array.from(userSockets.keys()) });
  });

  // ── Herausforderung senden ──────────────────────────────────────────────
  socket.on(
    "challenge:send",
    (
      data: { toUserId?: string; timeControl?: TimeControlKey; color?: ColorChoice; fromDisplayName?: string },
      ack?: (r: unknown) => void
    ) => {
      const fromUserId = socketUser.get(socket.id);
      if (!fromUserId) {
        ack?.({ ok: false, error: "Verbindung nicht angemeldet – Seite neu laden" });
        return;
      }
      const toUserId = data?.toUserId;
      const timeControl = data?.timeControl;
      const color: ColorChoice = data?.color ?? "random";

      if (!toUserId || toUserId === fromUserId) {
        ack?.({ ok: false, error: "Ungültiger Gegner" });
        return;
      }
      if (!timeControl || !(timeControl in TIME_CONTROLS)) {
        ack?.({ ok: false, error: "Ungültige Zeitkontrolle" });
        return;
      }

      const challenge: Challenge = {
        id: uuidv4().slice(0, 8),
        fromUserId,
        fromDisplayName: data.fromDisplayName || "Unbekannt",
        toUserId,
        timeControl,
        color,
        createdAt: Date.now(),
      };
      challenges.set(challenge.id, challenge);

      // Nur an den Adressaten — nicht an alle Verbundenen. Ist er gerade nicht
      // verbunden, bleibt die Herausforderung bis zum Ablauf liegen und wird
      // beim naechsten auth:identify zugestellt.
      const reachable = userSockets.has(toUserId);
      emitToUser(toUserId, "challenge:incoming", {
        challengeId: challenge.id,
        fromUserId,
        fromDisplayName: challenge.fromDisplayName,
        timeControl,
        // Der Herausgeforderte spielt die Gegenfarbe.
        yourColor: color === "random" ? "random" : color === "white" ? "black" : "white",
      });

      ack?.({ ok: true, challengeId: challenge.id, reachable });
    }
  );

  socket.on("challenge:cancel", (data: { challengeId?: string }) => {
    const userId = socketUser.get(socket.id);
    const challenge = data?.challengeId ? challenges.get(data.challengeId) : undefined;
    if (!challenge || challenge.fromUserId !== userId) return;
    challenges.delete(challenge.id);
    emitToUser(challenge.toUserId, "challenge:cancelled", { challengeId: challenge.id });
  });

  // ── Herausforderung beantworten ─────────────────────────────────────────
  socket.on(
    "challenge:respond",
    async (data: { challengeId?: string; accept?: boolean }, ack?: (r: unknown) => void) => {
      const userId = socketUser.get(socket.id);
      const challenge = data?.challengeId ? challenges.get(data.challengeId) : undefined;

      if (!challenge || challenge.toUserId !== userId) {
        ack?.({ ok: false, error: "Herausforderung nicht gefunden" });
        return;
      }
      challenges.delete(challenge.id);

      if (!data.accept) {
        emitToUser(challenge.fromUserId, "challenge:declined", { challengeId: challenge.id });
        ack?.({ ok: true, declined: true });
        return;
      }

      const challengerIsWhite =
        challenge.color === "random" ? Math.random() < 0.5 : challenge.color === "white";
      const whiteId = challengerIsWhite ? challenge.fromUserId : challenge.toUserId;
      const blackId = challengerIsWhite ? challenge.toUserId : challenge.fromUserId;

      try {
        const payload = await internalFetch("/api/internal/games", {
          method: "POST",
          body: JSON.stringify({ whiteId, blackId, timeControl: challenge.timeControl }),
        });
        const record = payload.game;
        const spec = TIME_CONTROLS[challenge.timeControl];

        const state: GameState = {
          id: record.id,
          white: {
            id: record.white.id,
            username: record.white.username,
            displayName: record.white.displayName,
          },
          black: {
            id: record.black.id,
            username: record.black.username,
            displayName: record.black.displayName,
          },
          timeControl: challenge.timeControl,
          incrementMs: spec.incrementSeconds * 1000,
          chess: new Chess(),
          movesUci: [],
          whiteMs: spec.initialSeconds * 1000,
          blackMs: spec.initialSeconds * 1000,
          turnStartedAt: null,
          joined: new Set(),
          status: "ACTIVE",
          result: null,
          reason: null,
          drawOfferFrom: null,
          finishing: false,
          persistChain: Promise.resolve(),
        };
        games.set(state.id, state);

        emitToUser(challenge.fromUserId, "challenge:accepted", { gameId: state.id });
        emitToUser(challenge.toUserId, "challenge:accepted", { gameId: state.id });
        ack?.({ ok: true, gameId: state.id });
      } catch (error: any) {
        console.error("[challenge:respond]", error.message);
        emitToUser(challenge.fromUserId, "challenge:failed", { challengeId: challenge.id });
        ack?.({ ok: false, error: "Partie konnte nicht erstellt werden" });
      }
    }
  );

  // ── Partie betreten ─────────────────────────────────────────────────────
  socket.on("game:join", async (data: { gameId?: string }, ack?: (r: unknown) => void) => {
    const userId = socketUser.get(socket.id);
    if (!userId || !data?.gameId) {
      ack?.({ ok: false, error: "Nicht angemeldet" });
      return;
    }

    const game = await loadGame(data.gameId);
    if (!game) {
      ack?.({ ok: false, error: "Partie nicht gefunden" });
      return;
    }

    const color = colorOf(game, userId);
    if (!color) {
      ack?.({ ok: false, error: "Du gehörst nicht zu dieser Partie" });
      return;
    }

    socket.join(`game:${game.id}`);
    game.joined.add(userId);

    // Uhr startet erst, wenn beide wirklich am Brett sitzen.
    if (game.status === "ACTIVE" && game.turnStartedAt === null && game.joined.size === 2) {
      game.turnStartedAt = Date.now();
    }

    ack?.({ ok: true, color, state: serializeGame(game) });
    broadcastGame(io, game);
  });

  // ── Zuschauen ───────────────────────────────────────────────────────────
  socket.on("game:spectate", async (data: { gameId?: string }, ack?: (r: unknown) => void) => {
    const userId = socketUser.get(socket.id);
    if (!userId || !data?.gameId) {
      ack?.({ ok: false, error: "Nicht angemeldet" });
      return;
    }

    // Berechtigung liegt bei Next — dort stehen die Freundschaften.
    let allowed = false;
    try {
      const payload = await internalFetch(
        `/api/internal/spectate?gameId=${encodeURIComponent(data.gameId)}&userId=${encodeURIComponent(userId)}`
      );
      allowed = Boolean(payload?.allowed);
    } catch (error: any) {
      console.error("[game:spectate]", error.message);
      ack?.({ ok: false, error: "Berechtigung nicht prüfbar" });
      return;
    }

    if (!allowed) {
      ack?.({ ok: false, error: "Nur Partien von Freunden sind einsehbar" });
      return;
    }

    const game = await loadGame(data.gameId);
    if (!game) {
      ack?.({ ok: false, error: "Partie nicht gefunden" });
      return;
    }

    // Bewusst NICHT in `game.joined` eintragen: die Uhr startet, sobald zwei
    // Beteiligte am Brett sitzen — ein Zuschauer darf sie nicht anwerfen.
    socket.join(`game:${game.id}`);
    ack?.({ ok: true, state: serializeGame(game) });
  });

  socket.on("game:leave", (data: { gameId?: string }) => {
    if (data?.gameId) socket.leave(`game:${data.gameId}`);
  });

  // ── Zug ─────────────────────────────────────────────────────────────────
  socket.on("game:move", (data: { gameId?: string; uci?: string }, ack?: (r: unknown) => void) => {
    const userId = socketUser.get(socket.id);
    const game = data?.gameId ? games.get(data.gameId) : undefined;

    if (!userId || !game) {
      ack?.({ ok: false, error: "Partie nicht aktiv" });
      return;
    }
    if (game.status !== "ACTIVE") {
      ack?.({ ok: false, error: "Partie ist beendet" });
      return;
    }

    const color = colorOf(game, userId);
    if (!color || color !== game.chess.turn()) {
      ack?.({ ok: false, error: "Du bist nicht am Zug" });
      return;
    }

    const uci = data.uci ?? "";
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
      ack?.({ ok: false, error: "Ungültiges Zugformat" });
      return;
    }

    // Uhr VOR der Zuganwendung abrechnen — sonst zahlt der Gegner die Bedenkzeit.
    const now = Date.now();
    if (game.turnStartedAt !== null) {
      const elapsed = now - game.turnStartedAt;
      if (color === "w") game.whiteMs -= elapsed;
      else game.blackMs -= elapsed;

      if ((color === "w" ? game.whiteMs : game.blackMs) <= 0) {
        if (color === "w") game.whiteMs = 0;
        else game.blackMs = 0;
        const winner: Color = color === "w" ? "b" : "w";
        if (hasMatingMaterial(game, winner)) {
          finishGame(io, game, winner === "w" ? "1-0" : "0-1", "timeout");
        } else {
          finishGame(io, game, "1/2-1/2", "timeout-insufficient");
        }
        ack?.({ ok: false, error: "Zeit abgelaufen" });
        return;
      }
    }

    try {
      game.chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
    } catch {
      // Uhr zuruecksetzen, der Zug hat nicht stattgefunden.
      if (game.turnStartedAt !== null) {
        const elapsed = now - game.turnStartedAt;
        if (color === "w") game.whiteMs += elapsed;
        else game.blackMs += elapsed;
      }
      ack?.({ ok: false, error: "Ungültiger Zug" });
      return;
    }

    game.movesUci.push(uci);
    game.drawOfferFrom = null;

    if (game.turnStartedAt !== null) {
      if (color === "w") game.whiteMs += game.incrementMs;
      else game.blackMs += game.incrementMs;
      game.turnStartedAt = Date.now();
    }

    ack?.({ ok: true });

    if (!checkGameEnd(io, game)) {
      persistGame(game);
      broadcastGame(io, game);
    }
  });

  // ── Aufgeben ────────────────────────────────────────────────────────────
  socket.on("game:resign", (data: { gameId?: string }) => {
    const userId = socketUser.get(socket.id);
    const game = data?.gameId ? games.get(data.gameId) : undefined;
    if (!userId || !game || game.status !== "ACTIVE") return;
    const color = colorOf(game, userId);
    if (!color) return;
    finishGame(io, game, color === "w" ? "0-1" : "1-0", "resign");
  });

  // ── Remis ───────────────────────────────────────────────────────────────
  socket.on("game:draw-offer", (data: { gameId?: string }) => {
    const userId = socketUser.get(socket.id);
    const game = data?.gameId ? games.get(data.gameId) : undefined;
    if (!userId || !game || game.status !== "ACTIVE") return;
    if (!colorOf(game, userId)) return;
    game.drawOfferFrom = userId;
    broadcastGame(io, game);
  });

  socket.on("game:draw-respond", (data: { gameId?: string; accept?: boolean }) => {
    const userId = socketUser.get(socket.id);
    const game = data?.gameId ? games.get(data.gameId) : undefined;
    if (!userId || !game || game.status !== "ACTIVE") return;
    if (!colorOf(game, userId) || !game.drawOfferFrom || game.drawOfferFrom === userId) return;

    if (data.accept) {
      finishGame(io, game, "1/2-1/2", "agreement");
    } else {
      game.drawOfferFrom = null;
      broadcastGame(io, game);
    }
  });

  socket.on("game:rematch", (data: { gameId?: string }, ack?: (r: unknown) => void) => {
    const userId = socketUser.get(socket.id);
    const game = data?.gameId ? games.get(data.gameId) : undefined;
    if (!userId || !game || game.status === "ACTIVE") {
      ack?.({ ok: false, error: "Partie läuft noch" });
      return;
    }
    const color = colorOf(game, userId);
    if (!color) {
      ack?.({ ok: false, error: "Kein Zugriff" });
      return;
    }
    const opponent = color === "w" ? game.black : game.white;
    if (!userSockets.has(opponent.id)) {
      ack?.({ ok: false, error: "Gegner ist offline" });
      return;
    }

    // Farben tauschen: Rueckkampf mit umgekehrter Farbverteilung.
    const challenge: Challenge = {
      id: uuidv4().slice(0, 8),
      fromUserId: userId,
      fromDisplayName: color === "w" ? game.white.displayName : game.black.displayName,
      toUserId: opponent.id,
      timeControl: game.timeControl,
      color: color === "w" ? "black" : "white",
      createdAt: Date.now(),
    };
    challenges.set(challenge.id, challenge);
    emitToUser(opponent.id, "challenge:incoming", {
      challengeId: challenge.id,
      fromUserId: userId,
      fromDisplayName: challenge.fromDisplayName,
      timeControl: challenge.timeControl,
      yourColor: color === "w" ? "white" : "black",
      rematch: true,
    });
    ack?.({ ok: true, challengeId: challenge.id });
  });

  // ── Trennung ────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const userId = socketUser.get(socket.id);
    socketUser.delete(socket.id);
    if (!userId) return;

    const sockets = userSockets.get(userId);
    sockets?.delete(socket.id);
    if (sockets && sockets.size === 0) {
      userSockets.delete(userId);
      // Offene Herausforderungen dieses Users verfallen sofort.
      for (const [id, challenge] of challenges) {
        if (challenge.fromUserId !== userId && challenge.toUserId !== userId) continue;
        challenges.delete(id);
        const other = challenge.fromUserId === userId ? challenge.toUserId : challenge.fromUserId;
        emitToUser(other, "challenge:expired", { challengeId: id });
      }
      for (const game of games.values()) {
        if (game.status !== "ACTIVE") continue;
        if (game.white.id !== userId && game.black.id !== userId) continue;
        broadcastGame(io, game);
      }
      broadcastPresence();
    }
  });
});

io.engine.on("connection_error", (error: any) => {
  console.error(
    `[connection_error] code=${error?.code} msg=${error?.message} origin=${error?.req?.headers?.origin ?? "-"}`
  );
});

/**
 * Prueft beim Start, ob der Next-Prozess erreichbar ist.
 *
 * Die interne Route antwortet ohne gueltiges Secret mit 403 — auch das ist ein
 * Erfolg im Sinne der Erreichbarkeit. Erst ein Verbindungsfehler bedeutet, dass
 * NEXT_API_URL auf den falschen Port zeigt.
 */
async function checkNextReachable(): Promise<void> {
  try {
    const response = await fetch(`${NEXT_API_URL}/api/internal/games/ping`, {
      method: "GET",
      headers: { "x-internal-secret": INTERNAL_SECRET },
    });
    if (response.status === 404 || response.ok) {
      console.log(`Next-API erreichbar (${NEXT_API_URL})`);
    } else if (response.status === 403) {
      console.error(
        `Next-API erreichbar, aber INTERNAL_API_SECRET stimmt nicht ueberein (${NEXT_API_URL}). ` +
          `Partien lassen sich damit nicht anlegen.`
      );
    } else {
      console.log(`Next-API antwortet mit ${response.status} (${NEXT_API_URL})`);
    }
  } catch (error: any) {
    console.error(
      `Next-API NICHT erreichbar unter ${NEXT_API_URL}: ${error?.message}. ` +
        `Setze NEXT_API_URL in der .env auf den Port, auf dem Next laeuft — ` +
        `sonst schlaegt jedes Annehmen einer Herausforderung fehl.`
    );
  }
}

server.listen(PORT, () => {
  console.log(`Chess-Server laeuft auf http://localhost:${PORT}`);
  console.log(`Next-API: ${NEXT_API_URL}`);
  void checkNextReachable();
  console.log(
    `Erlaubte Herkunft: ${CONFIGURED_ORIGINS.length > 0 ? CONFIGURED_ORIGINS.join(", ") : "alle (CLIENT_ORIGIN nicht gesetzt)"}`
  );
});

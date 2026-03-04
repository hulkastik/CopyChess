import express from "express";
import http from "http";
import cors from "cors";
import { Server, Socket } from "socket.io";
import { v4 as uuidv4 } from "uuid";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Room {
  id: string;
  white: string | null; // socket id
  black: string | null; // socket id
  fen: string;
  moves: string[];
}

// ─── Setup ────────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000"],
    methods: ["GET", "POST"],
  },
});

const rooms = new Map<string, Room>();
const DEFAULT_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// ─── REST endpoints (for debugging / health check) ───────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", rooms: rooms.size });
});

// ─── Socket.IO logic ─────────────────────────────────────────────────────────
io.on("connection", (socket: Socket) => {
  console.log(`✓ Client connected: ${socket.id}`);

  // ── Create a new room ────────────────────────────────────────────────────
  socket.on("create-room", (callback: (data: { roomId: string; color: "w" }) => void) => {
    const roomId = uuidv4().slice(0, 8); // short ID
    const room: Room = {
      id: roomId,
      white: socket.id,
      black: null,
      fen: DEFAULT_FEN,
      moves: [],
    };
    rooms.set(roomId, room);
    socket.join(roomId);
    console.log(`Room created: ${roomId} by ${socket.id}`);
    callback({ roomId, color: "w" });
  });

  // ── Join an existing room ────────────────────────────────────────────────
  socket.on(
    "join-room",
    (roomId: string, callback: (data: { success: boolean; color?: "b"; fen?: string; error?: string }) => void) => {
      const room = rooms.get(roomId);
      if (!room) {
        callback({ success: false, error: "Raum nicht gefunden" });
        return;
      }
      if (room.black) {
        callback({ success: false, error: "Raum ist voll" });
        return;
      }
      room.black = socket.id;
      socket.join(roomId);
      console.log(`${socket.id} joined room ${roomId} as black`);

      // Notify white that opponent joined
      io.to(roomId).emit("opponent-joined", { fen: room.fen });
      callback({ success: true, color: "b", fen: room.fen });
    }
  );

  // ── Receive a move from a client ─────────────────────────────────────────
  socket.on("move", (data: { roomId: string; fen: string; move: string }) => {
    const room = rooms.get(data.roomId);
    if (!room) return;

    room.fen = data.fen;
    room.moves.push(data.move);

    // Broadcast to opponent in the same room
    socket.to(data.roomId).emit("opponent-move", {
      fen: data.fen,
      move: data.move,
    });
  });

  // ── Game over notification ───────────────────────────────────────────────
  socket.on("game-over", (data: { roomId: string; result: string }) => {
    socket.to(data.roomId).emit("game-over", { result: data.result });
  });

  // ── Challenge a friend (from friends list) ──────────────────────────────
  socket.on(
    "challenge-friend",
    (data: { targetUserId: string; fromUsername: string }, callback: (data: { roomId: string }) => void) => {
      const roomId = uuidv4().slice(0, 8);
      const room: Room = {
        id: roomId,
        white: socket.id,
        black: null,
        fen: DEFAULT_FEN,
        moves: [],
      };
      rooms.set(roomId, room);
      socket.join(roomId);

      // Emit challenge notification to target user
      io.emit("challenge-received", {
        roomId,
        fromUsername: data.fromUsername,
        targetUserId: data.targetUserId,
      });

      callback({ roomId });
    }
  );

  // ── Disconnect ───────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    console.log(`✗ Client disconnected: ${socket.id}`);
    // Clean up: notify opponent, remove from room
    rooms.forEach((room, roomId) => {
      if (room.white === socket.id || room.black === socket.id) {
        socket.to(roomId).emit("opponent-disconnected");
        // If both left, delete room
        if (room.white === socket.id) room.white = null;
        if (room.black === socket.id) room.black = null;
        if (!room.white && !room.black) {
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted (empty)`);
        }
      }
    });
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Chess server running on http://localhost:${PORT}`);
});

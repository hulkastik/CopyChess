"use client";

import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

let globalSocket: Socket | null = null;

export function useSocket(): Socket {
  const socketRef = useRef<Socket | null>(null);

  if (!globalSocket) {
    globalSocket = io(SOCKET_URL, {
      autoConnect: true,
      transports: ["websocket", "polling"],
    });
  }

  socketRef.current = globalSocket;

  useEffect(() => {
    return () => {
      // don't disconnect on unmount – we keep the connection alive
    };
  }, []);

  return socketRef.current;
}

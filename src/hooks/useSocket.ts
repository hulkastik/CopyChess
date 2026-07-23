"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "@/context/AuthContext";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

let globalSocket: Socket | null = null;

function getSocket(): Socket {
  if (!globalSocket) {
    globalSocket = io(SOCKET_URL, {
      autoConnect: true,
      transports: ["websocket", "polling"],
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
  }
  return globalSocket;
}

/** Rohe Socket-Instanz (App-weit genau eine Verbindung). */
export function useSocket(): Socket {
  return getSocket();
}

/**
 * Verbindungs- und Identitaetsstatus. Die Identitaet wird bei jedem (Re-)Connect
 * neu gemeldet — nach einem Server-Neustart weiss der Server sonst nicht mehr,
 * welcher Socket zu welchem Konto gehoert.
 */
export function useSocketConnection() {
  const { user } = useAuth();
  const socket = getSocket();
  const [connected, setConnected] = useState(socket.connected);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);

  useEffect(() => {
    function identify() {
      setConnected(true);
      if (!user) return;
      socket.emit(
        "auth:identify",
        { userId: user.id },
        (res: { ok: boolean; onlineUserIds?: string[] }) => {
          if (res?.ok && res.onlineUserIds) setOnlineUserIds(res.onlineUserIds);
        }
      );
    }

    function onDisconnect() {
      setConnected(false);
    }

    function onPresence(data: { onlineUserIds: string[] }) {
      setOnlineUserIds(data.onlineUserIds ?? []);
    }

    socket.on("connect", identify);
    socket.on("disconnect", onDisconnect);
    socket.on("presence:update", onPresence);

    if (socket.connected) identify();
    else socket.connect();

    return () => {
      socket.off("connect", identify);
      socket.off("disconnect", onDisconnect);
      socket.off("presence:update", onPresence);
    };
  }, [socket, user]);

  useEffect(() => {
    if (user) return;
    socket.emit("auth:logout");
    setOnlineUserIds([]);
  }, [socket, user]);

  return { socket, connected, onlineUserIds };
}

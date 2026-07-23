"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "@/context/AuthContext";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

/** Sicherheitsnetz gegen verpasste presence:update-Ereignisse. */
const PRESENCE_RESYNC_MS = 12_000;

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

// ─── Gemeinsamer Präsenz-Zustand ────────────────────────────────────────────
//
// Bewusst ausserhalb von React: frueher hielt jede Komponente, die den Hook
// benutzt, eine eigene Kopie samt eigenem Listener. Bei jedem Wechsel des
// angemeldeten Kontos wurden alle Listener ab- und wieder angemeldet — ein in
// diesem Fenster eintreffendes presence:update war dauerhaft verloren, weil es
// keinen erneuten Abgleich gab.

type Subscriber = () => void;

const subscribers = new Set<Subscriber>();
let onlineUserIds: string[] = [];
let connected = false;
/** Wer aktuell gemeldet ist. null = niemand angemeldet. */
let identifiedUserId: string | null = null;
let listenersBound = false;
let resyncTimer: ReturnType<typeof setInterval> | null = null;

function notify() {
  for (const subscriber of Array.from(subscribers)) subscriber();
}

function setOnline(ids: string[] | undefined) {
  const next = ids ?? [];
  // Referenz nur tauschen, wenn sich etwas geaendert hat — sonst rendert jede
  // Antwort des Abgleichs die halbe App neu.
  if (next.length === onlineUserIds.length && next.every((id, i) => id === onlineUserIds[i])) {
    return;
  }
  onlineUserIds = next;
  notify();
}

function identify(socket: Socket) {
  if (!identifiedUserId) return;
  socket.emit(
    "auth:identify",
    { userId: identifiedUserId },
    (res: { ok: boolean; onlineUserIds?: string[] }) => {
      if (res?.ok) setOnline(res.onlineUserIds);
    }
  );
}

function bindListeners(socket: Socket) {
  if (listenersBound) return;
  listenersBound = true;

  socket.on("connect", () => {
    connected = true;
    notify();
    identify(socket);
  });

  socket.on("disconnect", () => {
    connected = false;
    setOnline([]);
    notify();
  });

  socket.on("presence:update", (data: { onlineUserIds: string[] }) => {
    setOnline(data?.onlineUserIds);
  });

  // Regelmaessiger Abgleich. Ein einzelnes verlorenes Ereignis wuerde die Liste
  // sonst bis zum naechsten Verbindungsaufbau falsch lassen — genau daran
  // scheiterte das Herausfordern eines tatsaechlich anwesenden Freundes.
  resyncTimer = setInterval(() => {
    if (!socket.connected || !identifiedUserId) return;
    socket.emit("presence:list", (res: { onlineUserIds?: string[] }) => {
      setOnline(res?.onlineUserIds);
    });
  }, PRESENCE_RESYNC_MS);
}

/** Meldet das angemeldete Konto beim Spielserver an bzw. ab. */
function setIdentity(socket: Socket, userId: string | null) {
  if (identifiedUserId === userId) return;

  const previous = identifiedUserId;
  identifiedUserId = userId;

  if (userId) {
    if (socket.connected) identify(socket);
    else socket.connect();
    return;
  }

  // Nur bei echtem Abmelden abmelden. Frueher feuerte hier jede Komponente
  // beim Mounten ein auth:logout, weil die Sitzung noch geladen wurde — das
  // loeschte die gerade angemeldete Verbindung wieder aus der Präsenzliste.
  if (previous) {
    socket.emit("auth:logout");
    setOnline([]);
  }
}

export function destroyPresence() {
  if (resyncTimer) clearInterval(resyncTimer);
  resyncTimer = null;
  listenersBound = false;
  identifiedUserId = null;
  onlineUserIds = [];
}

/**
 * Verbindungs- und Präsenzstatus. Die Identität wird bei jedem (Re-)Connect neu
 * gemeldet — nach einem Server-Neustart weiss der Server sonst nicht mehr,
 * welcher Socket zu welchem Konto gehört.
 */
export function useSocketConnection() {
  const { user, ready } = useAuth();
  const socket = getSocket();
  const [, forceRender] = useState(0);

  useEffect(() => {
    bindListeners(socket);
    connected = socket.connected;

    const subscriber = () => forceRender((value) => value + 1);
    subscribers.add(subscriber);
    return () => {
      subscribers.delete(subscriber);
    };
  }, [socket]);

  useEffect(() => {
    // Solange die Sitzung noch wiederhergestellt wird, nichts melden.
    if (!ready) return;
    setIdentity(socket, user?.id ?? null);
  }, [socket, ready, user]);

  return { socket, connected, onlineUserIds };
}

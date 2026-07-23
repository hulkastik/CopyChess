"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "@/context/AuthContext";

/** Sicherheitsnetz gegen verpasste presence:update-Ereignisse. */
const PRESENCE_RESYNC_MS = 12_000;

/**
 * Adresse des Spielservers.
 *
 * Standard ist dieselbe Herkunft wie die Seite — Next reicht `/socket.io/` an
 * den Spielserver weiter (siehe next.config.ts). Damit muss die Adresse nicht
 * ins Browser-Bundle, es gibt kein CORS und der Tunnel braucht keine eigene
 * Regel. Der frühere Standard `http://localhost:3001` war für jeden Aufbau
 * ausser dem eigenen Rechner falsch: der Browser eines Besuchers verband sich
 * damit gegen SEINEN Rechner statt gegen den Server.
 *
 * `NEXT_PUBLIC_SOCKET_URL` überschreibt das, falls der Spielserver bewusst
 * unter einer eigenen Adresse erreichbar sein soll.
 */
export function resolveSocketUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();
  if (configured) return configured;
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

let globalSocket: Socket | null = null;

/** null waehrend des Renderns auf dem Server — dort gibt es keinen Browser. */
function getSocket(): Socket | null {
  if (typeof window === "undefined") return null;
  if (!globalSocket) {
    globalSocket = io(resolveSocketUrl(), {
      autoConnect: true,
      // Standardreihenfolge (erst Polling, dann Aufstieg auf WebSocket): hinter
      // Proxies und Zugriffsschutz kommt der direkte WebSocket-Aufbau oft nicht
      // durch, und ohne Polling davor gibt es dann gar keine Verbindung.
      transports: ["polling", "websocket"],
      // Nötig, damit das Sitzungs-Cookie eines Zugriffsschutzes mitgeht.
      withCredentials: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      timeout: 10_000,
    });
  }
  return globalSocket;
}

/**
 * Rohe Socket-Instanz. Beim Rendern auf dem Server gibt es keine Verbindung;
 * die Attrappe schluckt Aufrufe, statt die Seite abstürzen zu lassen.
 */
const NOOP_SOCKET = {
  connected: false,
  emit: () => undefined,
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  connect: () => undefined,
} as unknown as Socket;

export function useSocket(): Socket {
  return getSocket() ?? NOOP_SOCKET;
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
/** Letzter Verbindungsfehler — wird in der Oberfläche angezeigt. */
let connectionError: string | null = null;
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
    connectionError = null;
    notify();
    identify(socket);
  });

  socket.on("disconnect", () => {
    connected = false;
    setOnline([]);
    notify();
  });

  // Ohne diese Meldung sieht man nur einen grauen Punkt und weiss nicht, ob die
  // Adresse falsch ist, CORS blockt oder der Dienst gar nicht laeuft.
  socket.on("connect_error", (error: Error) => {
    connected = false;
    connectionError = error?.message || "Verbindung fehlgeschlagen";
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
  const socket = useSocket();
  const [, forceRender] = useState(0);

  useEffect(() => {
    const real = getSocket();
    if (!real) return;

    bindListeners(real);

    // Die Verbindung kann bereits stehen, bevor die Listener haengen — dann
    // gaebe es nie ein `connect`-Ereignis und der Zustand bliebe auf "getrennt".
    if (connected !== real.connected) {
      connected = real.connected;
      notify();
    }
    if (!real.connected) real.connect();

    const subscriber = () => forceRender((value) => value + 1);
    subscribers.add(subscriber);
    return () => {
      subscribers.delete(subscriber);
    };
  }, []);

  useEffect(() => {
    const real = getSocket();
    // Solange die Sitzung noch wiederhergestellt wird, nichts melden.
    if (!real || !ready) return;
    setIdentity(real, user?.id ?? null);
  }, [ready, user]);

  return { socket, connected, onlineUserIds, connectionError, socketUrl: resolveSocketUrl() };
}

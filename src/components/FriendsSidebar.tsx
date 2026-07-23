"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useSocketConnection } from "@/hooks/useSocket";
import { TIME_CONTROLS, type ColorChoice, type TimeControlKey } from "@/lib/timeControls";
import RankBadge from "./RankBadge";
import AuthModal from "./AuthModal";
import ChallengeModal from "./ChallengeModal";

interface Friend {
  id: string;
  username: string;
  displayName: string;
  elo: number;
  friendshipId: string;
}

interface FriendRequest {
  friendshipId: string;
  from: { id: string; username: string; displayName: string };
}

interface IncomingChallenge {
  challengeId: string;
  fromUserId: string;
  fromDisplayName: string;
  timeControl: TimeControlKey;
  yourColor: ColorChoice;
  rematch?: boolean;
}

export default function FriendsSidebar() {
  const { user, ready, logout, authFetch } = useAuth();
  const { socket, connected, onlineUserIds, connectionError, socketUrl } = useSocketConnection();
  const router = useRouter();

  const [showAuth, setShowAuth] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [addInput, setAddInput] = useState("");
  const [message, setMessage] = useState("");
  const [challengeTarget, setChallengeTarget] = useState<Friend | null>(null);
  const [incoming, setIncoming] = useState<IncomingChallenge | null>(null);
  const [pendingOutgoing, setPendingOutgoing] = useState<{ id: string; name: string } | null>(null);
  /** userId -> laufende Partie, in der dieser Freund gerade spielt. */
  const [liveByUser, setLiveByUser] = useState<Record<string, string>>({});

  // ── Daten laden ─────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!user) {
      setFriends([]);
      setRequests([]);
      return;
    }
    const [friendsRes, requestsRes, liveRes] = await Promise.all([
      authFetch("/api/friends"),
      authFetch("/api/friends/requests"),
      authFetch("/api/games/live"),
    ]);
    if (friendsRes.ok) setFriends((await friendsRes.json()).friends);
    if (requestsRes.ok) setRequests((await requestsRes.json()).requests);
    if (liveRes.ok) {
      const { games } = await liveRes.json();
      const map: Record<string, string> = {};
      for (const game of games) {
        if (game.isMine) continue;
        map[game.white.id] = game.id;
        map[game.black.id] = game.id;
      }
      setLiveByUser(map);
    }
  }, [user, authFetch]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Offene Anfragen im Hintergrund nachziehen — ohne Reload sichtbar.
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [user, refresh]);

  // ── Socket-Ereignisse ───────────────────────────────────────────────────
  useEffect(() => {
    function onIncoming(data: IncomingChallenge) {
      setIncoming(data);
    }
    function onAccepted(data: { gameId: string }) {
      setIncoming(null);
      setPendingOutgoing(null);
      setIsOpen(false);
      router.push(`/play/${data.gameId}`);
    }
    function onDeclined() {
      setPendingOutgoing(null);
      setMessage("Herausforderung abgelehnt.");
    }
    function onExpired(data: { challengeId: string }) {
      setPendingOutgoing((current) => (current?.id === data.challengeId ? null : current));
      setIncoming((current) => (current?.challengeId === data.challengeId ? null : current));
    }
    function onFailed() {
      setPendingOutgoing(null);
      setMessage("Partie konnte nicht erstellt werden.");
    }

    socket.on("challenge:incoming", onIncoming);
    socket.on("challenge:accepted", onAccepted);
    socket.on("challenge:declined", onDeclined);
    socket.on("challenge:expired", onExpired);
    socket.on("challenge:cancelled", onExpired);
    socket.on("challenge:failed", onFailed);

    return () => {
      socket.off("challenge:incoming", onIncoming);
      socket.off("challenge:accepted", onAccepted);
      socket.off("challenge:declined", onDeclined);
      socket.off("challenge:expired", onExpired);
      socket.off("challenge:cancelled", onExpired);
      socket.off("challenge:failed", onFailed);
    };
  }, [socket, router]);

  // ── Aktionen ────────────────────────────────────────────────────────────
  async function addFriend() {
    if (!addInput.trim()) return;
    setMessage("");
    const res = await authFetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendUsername: addInput.trim() }),
    });
    const data = await res.json();
    if (res.ok) {
      setMessage("Anfrage gesendet.");
      setAddInput("");
      refresh();
    } else {
      setMessage(data.error);
    }
  }

  async function handleRequest(friendshipId: string, action: "accept" | "decline") {
    const res = await authFetch("/api/friends/requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendshipId, action }),
    });
    if (res.ok) refresh();
  }

  async function removeFriend(friendshipId: string) {
    const res = await authFetch(`/api/friends?friendshipId=${friendshipId}`, {
      method: "DELETE",
    });
    if (res.ok) refresh();
  }

  function sendChallenge(timeControl: TimeControlKey, color: ColorChoice) {
    const target = challengeTarget;
    if (!target || !user) return;
    setChallengeTarget(null);
    setMessage("");

    socket.emit(
      "challenge:send",
      {
        toUserId: target.id,
        timeControl,
        color,
        fromDisplayName: user.displayName,
      },
      (res: { ok: boolean; challengeId?: string; reachable?: boolean; error?: string }) => {
        if (res?.ok && res.challengeId) {
          setPendingOutgoing({ id: res.challengeId, name: target.displayName });
          if (res.reachable === false) {
            setMessage(`${target.displayName} ist gerade nicht verbunden – die Anfrage wartet 60 Sekunden.`);
          }
        } else {
          setMessage(res?.error ?? "Herausforderung fehlgeschlagen");
        }
      }
    );
  }

  function respondToChallenge(accept: boolean) {
    if (!incoming) return;
    socket.emit("challenge:respond", { challengeId: incoming.challengeId, accept });
    setIncoming(null);
  }

  function cancelOutgoing() {
    if (!pendingOutgoing) return;
    socket.emit("challenge:cancel", { challengeId: pendingOutgoing.id });
    setPendingOutgoing(null);
  }

  function handleLogout() {
    socket.emit("auth:logout");
    logout();
    setIsOpen(false);
  }

  // ── Nicht angemeldet ────────────────────────────────────────────────────
  if (!ready) return null;

  if (!user) {
    return (
      <>
        <button
          onClick={() => setShowAuth(true)}
          className="btn btn-primary fixed right-3 top-3 z-40 sm:right-4 sm:top-4"
        >
          Anmelden
        </button>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </>
    );
  }

  const onlineSet = new Set(onlineUserIds);

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed right-3 top-3 z-40 flex max-w-[45vw] items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm font-semibold transition hover:bg-[var(--bg-elevated)] sm:right-4 sm:top-4"
      >
        <span
          className={`h-2 w-2 rounded-full ${connected ? "bg-[var(--accent)]" : "bg-[var(--danger)]"}`}
          title={connected ? "Verbunden" : "Keine Verbindung zum Spielserver"}
        />
        <span className="truncate">{user.displayName}</span>
        {requests.length > 0 && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-black">
            {requests.length}
          </span>
        )}
      </button>

      {/* Eingehende Herausforderung */}
      {incoming && (
        <div className="card animate-fade-up fixed inset-x-3 top-16 z-50 border-[var(--accent)] p-4 sm:inset-x-auto sm:right-4 sm:w-80">
          <p className="text-sm font-semibold">
            {incoming.rematch ? "Revanche von " : "Herausforderung von "}
            <span className="text-[var(--accent)]">{incoming.fromDisplayName}</span>
          </p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {TIME_CONTROLS[incoming.timeControl].icon}{" "}
            {TIME_CONTROLS[incoming.timeControl].label} ·{" "}
            {TIME_CONTROLS[incoming.timeControl].short} · du spielst{" "}
            {incoming.yourColor === "random"
              ? "zufällige Farbe"
              : incoming.yourColor === "white"
              ? "Weiß"
              : "Schwarz"}
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => respondToChallenge(true)} className="btn btn-primary flex-1">
              Annehmen
            </button>
            <button onClick={() => respondToChallenge(false)} className="btn btn-ghost flex-1">
              Ablehnen
            </button>
          </div>
        </div>
      )}

      {/* Eigene laufende Herausforderung */}
      {pendingOutgoing && !incoming && (
        <div className="card animate-fade-up fixed inset-x-3 top-16 z-50 p-4 sm:inset-x-auto sm:right-4 sm:w-80">
          <p className="text-sm">
            Warte auf{" "}
            <span className="font-semibold text-[var(--accent)]">{pendingOutgoing.name}</span>…
          </p>
          <button onClick={cancelOutgoing} className="btn btn-ghost mt-3 w-full">
            Zurückziehen
          </button>
        </div>
      )}

      {/* Sidebar */}
      <div
        className={`fixed right-0 top-0 z-30 flex h-full w-[min(88vw,20rem)] transform flex-col border-l border-[var(--border)] bg-[var(--bg-secondary)] transition-transform duration-200 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col p-4 pt-16">
          <div className="mb-4 flex items-center justify-between">
            <div className="min-w-0">
              <Link
                href={`/profile/${user.id}`}
                onClick={() => setIsOpen(false)}
                className="text-base font-bold hover:text-[var(--accent)]"
              >
                {user.displayName}
              </Link>
              <div className="mt-0.5">
                <RankBadge elo={user.elo} compact />
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="text-xs text-[var(--text-secondary)] transition hover:text-[var(--danger)]"
            >
              Abmelden
            </button>
          </div>

          <div className="mb-3 flex gap-2">
            <input
              className="input"
              type="text"
              placeholder="Username hinzufügen"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addFriend()}
            />
            <button onClick={addFriend} className="btn btn-primary px-3">
              +
            </button>
          </div>
          {message && <p className="mb-3 text-xs text-[var(--accent)]">{message}</p>}

          {requests.length > 0 && (
            <div className="mb-4">
              <p className="label mb-2">Anfragen ({requests.length})</p>
              {requests.map((r) => (
                <div
                  key={r.friendshipId}
                  className="mb-2 flex items-center justify-between rounded-xl bg-[var(--bg-card)] px-3 py-2"
                >
                  <span className="text-sm">{r.from.displayName}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleRequest(r.friendshipId, "accept")}
                      className="rounded-lg bg-[var(--accent)] px-2 py-1 text-xs font-bold text-black"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => handleRequest(r.friendshipId, "decline")}
                      className="btn-danger rounded-lg px-2 py-1 text-xs font-bold"
                    >
                      ✗
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!connected && (
            <div className="mb-3 rounded-xl bg-[rgba(229,72,77,0.12)] px-3 py-2 text-xs text-[var(--danger)]">
              <p className="font-semibold">Kein Kontakt zum Spielserver</p>
              <p className="mt-1 break-all opacity-80">{socketUrl || "(keine Adresse)"}</p>
              {connectionError && <p className="mt-1 break-all opacity-80">{connectionError}</p>}
              <p className="mt-1 opacity-80">
                Ohne Verbindung sind Online-Anzeige und Herausforderungen nicht möglich.
              </p>
            </div>
          )}

          <p className="label mb-2">Freundesliste ({friends.length})</p>
          <div className="-mr-2 flex-1 overflow-y-auto pr-2">
            {friends.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">
                Noch niemand. Username oben eintragen.
              </p>
            ) : (
              friends.map((friend) => {
                const online = onlineSet.has(friend.id);
                return (
                  <div
                    key={friend.id}
                    className="group mb-2 flex items-center gap-2 rounded-xl bg-[var(--bg-card)] px-3 py-2"
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        online ? "bg-[var(--accent)]" : "bg-[var(--text-secondary)]/40"
                      }`}
                    />
                    <Link
                      href={`/profile/${friend.id}`}
                      onClick={() => setIsOpen(false)}
                      className="min-w-0 flex-1 truncate text-sm hover:text-[var(--accent)]"
                      title="Profil ansehen"
                    >
                      {friend.displayName}
                    </Link>
                    <RankBadge elo={friend.elo} compact />
                    <button
                      onClick={() => removeFriend(friend.friendshipId)}
                      title="Freund entfernen"
                      className="text-xs text-[var(--text-secondary)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--danger)]"
                    >
                      ✕
                    </button>
                    {liveByUser[friend.id] ? (
                      <Link
                        href={`/watch/${liveByUser[friend.id]}`}
                        onClick={() => setIsOpen(false)}
                        className="btn btn-ghost px-2 py-1 text-xs"
                        title="Spielt gerade – zuschauen"
                      >
                        👁
                      </Link>
                    ) : (
                      <button
                        onClick={() => setChallengeTarget(friend)}
                        disabled={!connected}
                        className="btn btn-primary px-2 py-1 text-xs"
                        title={online ? "Herausfordern" : "Scheint offline – Versuch schadet nicht"}
                      >
                        ⚔
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-20 bg-black/40" onClick={() => setIsOpen(false)} />
      )}

      {challengeTarget && (
        <ChallengeModal
          opponentName={challengeTarget.displayName}
          onCancel={() => setChallengeTarget(null)}
          onSubmit={sendChallenge}
        />
      )}
    </>
  );
}

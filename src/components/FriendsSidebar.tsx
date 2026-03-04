"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/hooks/useSocket";
import AuthModal from "./AuthModal";

interface Friend {
  id: string;
  username: string;
  friendshipId: string;
}

interface FriendRequest {
  friendshipId: string;
  from: { id: string; username: string };
}

interface ChallengeNotification {
  roomId: string;
  fromUsername: string;
}

export default function FriendsSidebar() {
  const { user, logout } = useAuth();
  const socket = useSocket();

  const [showAuth, setShowAuth] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [addInput, setAddInput] = useState("");
  const [message, setMessage] = useState("");
  const [challenge, setChallenge] = useState<ChallengeNotification | null>(null);

  // ── Fetch friends and requests ────────────────────────────────────────
  const fetchFriends = useCallback(async () => {
    if (!user) return;
    const res = await fetch(`/api/friends?userId=${user.id}`);
    const data = await res.json();
    if (res.ok) setFriends(data.friends);
  }, [user]);

  const fetchRequests = useCallback(async () => {
    if (!user) return;
    const res = await fetch(`/api/friends/requests?userId=${user.id}`);
    const data = await res.json();
    if (res.ok) setRequests(data.requests);
  }, [user]);

  useEffect(() => {
    fetchFriends();
    fetchRequests();
  }, [fetchFriends, fetchRequests]);

  // ── Listen for challenge notifications ────────────────────────────────
  useEffect(() => {
    socket.on(
      "challenge-received",
      (data: { roomId: string; fromUsername: string; targetUserId: string }) => {
        if (user && data.targetUserId === user.id) {
          setChallenge({ roomId: data.roomId, fromUsername: data.fromUsername });
        }
      }
    );
    return () => {
      socket.off("challenge-received");
    };
  }, [socket, user]);

  // ── Add friend ────────────────────────────────────────────────────────
  async function addFriend() {
    if (!user || !addInput.trim()) return;
    setMessage("");
    const res = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, friendUsername: addInput.trim() }),
    });
    const data = await res.json();
    if (res.ok) {
      setMessage("Anfrage gesendet!");
      setAddInput("");
    } else {
      setMessage(data.error);
    }
  }

  // ── Accept / Decline request ──────────────────────────────────────────
  async function handleRequest(friendshipId: string, action: "accept" | "decline") {
    const res = await fetch("/api/friends/requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendshipId, action }),
    });
    if (res.ok) {
      fetchFriends();
      fetchRequests();
    }
  }

  // ── Challenge friend ──────────────────────────────────────────────────
  function challengeFriend(friend: Friend) {
    if (!user) return;
    socket.emit(
      "challenge-friend",
      { targetUserId: friend.id, fromUsername: user.username },
      (data: { roomId: string }) => {
        // Navigate to multiplayer with room ID
        window.location.href = `/multiplayer?room=${data.roomId}`;
      }
    );
  }

  // ── Accept challenge ──────────────────────────────────────────────────
  function acceptChallenge() {
    if (!challenge) return;
    window.location.href = `/multiplayer?room=${challenge.roomId}`;
    setChallenge(null);
  }

  // ── Not logged in ─────────────────────────────────────────────────────
  if (!user) {
    return (
      <>
        <button
          onClick={() => setShowAuth(true)}
          className="fixed right-4 top-4 z-40 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
        >
          Anmelden
        </button>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </>
    );
  }

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed right-4 top-4 z-40 flex items-center gap-2 rounded-lg bg-[var(--bg-card)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent)]"
      >
        👥 {user.username}
        {requests.length > 0 && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-xs">
            {requests.length}
          </span>
        )}
      </button>

      {/* Challenge popup */}
      {challenge && (
        <div className="fixed right-4 top-16 z-50 w-72 rounded-xl bg-[var(--accent)] p-4 text-white shadow-xl">
          <p className="font-semibold">
            ⚔️ {challenge.fromUsername} fordert dich heraus!
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={acceptChallenge}
              className="flex-1 rounded-lg bg-white/20 py-1 text-sm font-semibold transition hover:bg-white/30"
            >
              Annehmen
            </button>
            <button
              onClick={() => setChallenge(null)}
              className="flex-1 rounded-lg bg-white/10 py-1 text-sm transition hover:bg-white/20"
            >
              Ablehnen
            </button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div
        className={`fixed right-0 top-0 z-30 h-full w-80 transform bg-[var(--bg-secondary)] shadow-2xl transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col p-4 pt-16">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">Freundesliste</h2>
            <button
              onClick={logout}
              className="text-xs text-[var(--text-secondary)] transition hover:text-[var(--accent)]"
            >
              Abmelden
            </button>
          </div>

          {/* Add friend */}
          <div className="mb-4 flex gap-2">
            <input
              type="text"
              placeholder="Username eingeben"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addFriend()}
              className="flex-1 rounded-lg bg-[var(--bg-card)] px-3 py-2 text-sm text-white placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
            <button
              onClick={addFriend}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)]"
            >
              +
            </button>
          </div>
          {message && (
            <p className="mb-2 text-xs text-[var(--accent)]">{message}</p>
          )}

          {/* Pending requests */}
          {requests.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Anfragen ({requests.length})
              </h3>
              {requests.map((r) => (
                <div
                  key={r.friendshipId}
                  className="mb-2 flex items-center justify-between rounded-lg bg-[var(--bg-card)] px-3 py-2"
                >
                  <span className="text-sm">{r.from.username}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleRequest(r.friendshipId, "accept")}
                      className="rounded bg-green-600 px-2 py-1 text-xs text-white transition hover:bg-green-500"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => handleRequest(r.friendshipId, "decline")}
                      className="rounded bg-red-600 px-2 py-1 text-xs text-white transition hover:bg-red-500"
                    >
                      ✗
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Friends list */}
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
            Freunde ({friends.length})
          </h3>
          <div className="flex-1 overflow-y-auto">
            {friends.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">
                Noch keine Freunde
              </p>
            ) : (
              friends.map((f) => (
                <div
                  key={f.id}
                  className="mb-2 flex items-center justify-between rounded-lg bg-[var(--bg-card)] px-3 py-2"
                >
                  <span className="text-sm">{f.username}</span>
                  <button
                    onClick={() => challengeFriend(f)}
                    className="rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-white transition hover:bg-[var(--accent-hover)]"
                  >
                    ⚔️ Herausfordern
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Overlay when sidebar is open */}
      {isOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}

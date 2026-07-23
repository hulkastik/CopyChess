"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";

export default function AuthModal({ onClose }: { onClose: () => void }) {
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const err = isLogin
      ? await login(username.trim(), password)
      : await register(username.trim(), password, displayName.trim() || username.trim());

    setLoading(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card animate-fade-up w-full max-w-sm p-6">
        <h2 className="mb-1 text-xl font-bold">
          {isLogin ? "Anmelden" : "Konto erstellen"}
        </h2>
        <p className="mb-5 text-sm text-[var(--text-secondary)]">
          {isLogin
            ? "Melde dich an, um Freunde herauszufordern."
            : "Username, Passwort, Anzeigename – fertig."}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            className="input"
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />

          {!isLogin && (
            <input
              className="input"
              type="text"
              placeholder="Anzeigename (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={24}
            />
          )}

          <input
            className="input"
            type="password"
            placeholder="Passwort"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isLogin ? "current-password" : "new-password"}
          />

          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

          <button type="submit" disabled={loading} className="btn btn-primary mt-1">
            {loading ? "…" : isLogin ? "Anmelden" : "Registrieren"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-[var(--text-secondary)]">
          {isLogin ? "Noch kein Konto?" : "Schon ein Konto?"}{" "}
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setError("");
            }}
            className="font-semibold text-[var(--accent)] hover:underline"
          >
            {isLogin ? "Registrieren" : "Anmelden"}
          </button>
        </p>

        <button
          onClick={onClose}
          className="mt-3 w-full text-center text-xs text-[var(--text-secondary)] transition hover:text-white"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}

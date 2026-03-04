"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";

export default function AuthModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const err = isLogin
      ? await login(username, password)
      : await register(username, password);

    setLoading(false);
    if (err) {
      setError(err);
    } else {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--bg-secondary)] p-6 shadow-xl">
        <h2 className="mb-4 text-center text-xl font-bold">
          {isLogin ? "Anmelden" : "Registrieren"}
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="rounded-lg bg-[var(--bg-card)] px-4 py-2 text-white placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            autoFocus
          />
          <input
            type="password"
            placeholder="Passwort"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg bg-[var(--bg-card)] px-4 py-2 text-white placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />

          {error && (
            <p className="text-center text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-[var(--accent)] py-2 font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {loading ? "…" : isLogin ? "Anmelden" : "Registrieren"}
          </button>
        </form>

        <p className="mt-3 text-center text-sm text-[var(--text-secondary)]">
          {isLogin ? "Noch kein Konto?" : "Schon ein Konto?"}{" "}
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setError("");
            }}
            className="text-[var(--accent)] underline"
          >
            {isLogin ? "Registrieren" : "Anmelden"}
          </button>
        </p>

        <button
          onClick={onClose}
          className="mt-3 w-full text-center text-sm text-[var(--text-secondary)] transition-colors hover:text-white"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}

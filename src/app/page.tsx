"use client";

import Link from "next/link";

const modes = [
  {
    title: "Lokal spielen",
    description: "Zwei Spieler an einem Bildschirm",
    href: "/local",
    icon: "♟️",
  },
  {
    title: "Multiplayer",
    description: "Online gegen Freunde spielen",
    href: "/multiplayer",
    icon: "🌐",
  },
  {
    title: "Training",
    description: "Gegen Stockfish-KI trainieren",
    href: "/training",
    icon: "🤖",
  },
];

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="mb-2 text-5xl font-extrabold tracking-tight">
        ♚ Chess App
      </h1>
      <p className="mb-12 text-lg text-[var(--text-secondary)]">
        Wähle einen Spielmodus
      </p>

      <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-3">
        {modes.map((mode) => (
          <Link
            key={mode.href}
            href={mode.href}
            className="group flex flex-col items-center rounded-2xl border border-white/10 bg-[var(--bg-secondary)] px-8 py-10 transition-all hover:border-[var(--accent)] hover:shadow-lg hover:shadow-[var(--accent)]/20"
          >
            <span className="mb-4 text-5xl">{mode.icon}</span>
            <h2 className="mb-1 text-xl font-bold group-hover:text-[var(--accent)]">
              {mode.title}
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {mode.description}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}

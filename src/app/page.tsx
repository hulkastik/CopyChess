"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import GameList from "@/components/GameList";
import RankBadge from "@/components/RankBadge";

const modes = [
  {
    title: "Lokal spielen",
    description: "Zwei Spieler an einem Bildschirm",
    href: "/local",
    icon: "♟️",
  },
  {
    title: "Training",
    description: "Gegen Stockfish auf sieben Stufen",
    href: "/training",
    icon: "🤖",
  },
];

export default function HomePage() {
  const { user, ready } = useAuth();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 pb-12 pt-20 sm:px-6 sm:pt-16">
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">♚ Chess</h1>
        <p className="mt-1 text-[var(--text-secondary)]">
          {ready && user
            ? `Willkommen, ${user.displayName}.`
            : "Anmelden, Freunde hinzufügen, herausfordern."}
        </p>
      </header>

      {ready && user && (
        <section className="mb-8">
          <Link href={`/profile/${user.id}`} className="block transition hover:opacity-80">
            <RankBadge elo={user.elo} />
            <p className="mt-2 text-center text-xs text-[var(--text-secondary)]">
              Profil und Partieverlauf ansehen →
            </p>
          </Link>
        </section>
      )}

      {/* Herausfordern */}
      <section className="mb-10">
        <h2 className="label mb-3">Gegen Freunde</h2>
        <div className="card p-5">
          <p className="text-sm text-[var(--text-secondary)]">
            {ready && user ? (
              <>
                Öffne die Freundesliste oben rechts, wähle einen Freund und starte eine
                Partie in <span className="text-[var(--text-primary)]">Bullet</span>,{" "}
                <span className="text-[var(--text-primary)]">Blitz</span> oder{" "}
                <span className="text-[var(--text-primary)]">10 Minuten</span> – mit
                Farbwahl Weiß, Schwarz oder Zufall.
              </>
            ) : (
              "Melde dich oben rechts an, um Freunde hinzuzufügen und herauszufordern."
            )}
          </p>
        </div>
      </section>

      {/* Partien */}
      {ready && user && (
        <section className="mb-10">
          <h2 className="label mb-3">Deine Partien</h2>
          <GameList />
        </section>
      )}

      {/* Weitere Modi */}
      <section>
        <h2 className="label mb-3">Weitere Modi</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {modes.map((mode) => (
            <Link
              key={mode.href}
              href={mode.href}
              className="group flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-5 py-4 transition hover:border-[var(--accent)]"
            >
              <span className="text-3xl">{mode.icon}</span>
              <div>
                <h3 className="font-bold group-hover:text-[var(--accent)]">{mode.title}</h3>
                <p className="text-sm text-[var(--text-secondary)]">{mode.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

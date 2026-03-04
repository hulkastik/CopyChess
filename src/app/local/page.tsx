import LocalChessBoard from "@/components/LocalChessBoard";
import Link from "next/link";

export default function LocalPage() {
  return (
    <main className="flex min-h-screen flex-col items-center p-6">
      <div className="mb-6 flex w-full max-w-4xl items-center justify-between">
        <Link
          href="/"
          className="text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]"
        >
          ← Zurück
        </Link>
        <h1 className="text-2xl font-bold">♟️ Lokales Spiel</h1>
        <div className="w-16" />
      </div>
      <LocalChessBoard />
    </main>
  );
}

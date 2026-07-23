import Link from "next/link";

/**
 * Kopfzeile der Unterseiten.
 *
 * Der Konto-Button der Freundesleiste liegt fix oben rechts. Auf schmalen
 * Displays wuerde ein dreispaltiger Kopf darunter laufen, deshalb bleibt rechts
 * nur so viel Platz frei, wie der Button tatsaechlich braucht.
 */
export default function PageHeader({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-4 flex w-full max-w-6xl items-center gap-3 pr-28 sm:mb-6 sm:pr-44">
      <Link
        href="/"
        className="shrink-0 text-sm text-[var(--text-secondary)] transition hover:text-[var(--accent)]"
      >
        ←<span className="ml-1 hidden sm:inline">Startseite</span>
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-base font-bold sm:text-lg">{title}</h1>
      {hint && (
        <span className="hidden shrink-0 text-xs text-[var(--text-secondary)] md:inline">
          {hint}
        </span>
      )}
    </div>
  );
}

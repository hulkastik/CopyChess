"use client";

const PIECES: { key: "q" | "r" | "b" | "n"; white: string; black: string; label: string }[] = [
  { key: "q", white: "♕", black: "♛", label: "Dame" },
  { key: "r", white: "♖", black: "♜", label: "Turm" },
  { key: "b", white: "♗", black: "♝", label: "Läufer" },
  { key: "n", white: "♘", black: "♞", label: "Springer" },
];

export default function PromotionPicker({
  color,
  onSelect,
  onCancel,
}: {
  color: "w" | "b";
  onSelect: (piece: "q" | "r" | "b" | "n") => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="card animate-fade-up p-5">
        <p className="label mb-3 text-center">Umwandlung</p>
        <div className="flex gap-2">
          {PIECES.map((piece) => (
            <button
              key={piece.key}
              onClick={() => onSelect(piece.key)}
              title={piece.label}
              className="flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--bg-card)] text-4xl transition hover:bg-[var(--accent-soft)]"
            >
              {color === "w" ? piece.white : piece.black}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

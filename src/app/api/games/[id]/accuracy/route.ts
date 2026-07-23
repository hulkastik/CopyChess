import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

/**
 * Genauigkeit einer beendeten Partie nachreichen.
 *
 * Berechnet wird sie im Browser (Stockfish läuft dort), gespeichert wird sie
 * hier. Beide Beteiligten rechnen dasselbe Ergebnis, der erste Aufruf gewinnt —
 * ein zweiter überschreibt nichts, sonst könnte ein Client mit abweichender
 * Suchtiefe die bereits gespeicherten Werte verändern.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const body = await req.json();

    const white = Number(body.whiteAccuracy);
    const black = Number(body.blackAccuracy);
    const valid = (value: number) => Number.isFinite(value) && value >= 0 && value <= 100;
    if (!valid(white) || !valid(black)) {
      return NextResponse.json(
        { error: "whiteAccuracy und blackAccuracy müssen zwischen 0 und 100 liegen" },
        { status: 400 }
      );
    }

    const game = await prisma.game.findUnique({ where: { id } });
    if (!game) {
      return NextResponse.json({ error: "Partie nicht gefunden" }, { status: 404 });
    }
    if (game.whiteId !== auth.user.id && game.blackId !== auth.user.id) {
      return NextResponse.json({ error: "Kein Zugriff auf diese Partie" }, { status: 403 });
    }
    if (game.status === "ACTIVE") {
      return NextResponse.json({ error: "Partie läuft noch" }, { status: 409 });
    }
    if (game.whiteAccuracy !== null && game.blackAccuracy !== null) {
      return NextResponse.json({ game }, { status: 200 });
    }

    const updated = await prisma.game.update({
      where: { id },
      data: {
        whiteAccuracy: Math.round(white * 10) / 10,
        blackAccuracy: Math.round(black * 10) / 10,
      },
    });

    return NextResponse.json({ game: updated });
  } catch (error) {
    console.error("Accuracy update error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

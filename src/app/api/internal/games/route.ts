import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isInternalRequest } from "@/lib/auth";
import { TIME_CONTROLS, isTimeControlKey } from "@/lib/timeControls";

/**
 * Wird ausschliesslich vom Socket-Server aufgerufen (x-internal-secret).
 * Der Spielserver haelt den Zustand im Speicher, die DB ist die Persistenz.
 */
export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) {
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });
  }

  try {
    const { whiteId, blackId, timeControl } = await req.json();
    if (!whiteId || !blackId || !isTimeControlKey(timeControl)) {
      return NextResponse.json(
        { error: "whiteId, blackId und gültige timeControl erforderlich" },
        { status: 400 }
      );
    }
    if (whiteId === blackId) {
      return NextResponse.json({ error: "Spieler müssen verschieden sein" }, { status: 400 });
    }

    const players = await prisma.user.findMany({
      where: { id: { in: [whiteId, blackId] } },
      select: { id: true, username: true, displayName: true, engineAssist: true },
    });
    if (players.length !== 2) {
      return NextResponse.json({ error: "Spieler nicht gefunden" }, { status: 404 });
    }

    const spec = TIME_CONTROLS[timeControl];
    const game = await prisma.game.create({
      data: {
        whiteId,
        blackId,
        timeControl,
        initialSeconds: spec.initialSeconds,
        incrementSeconds: spec.incrementSeconds,
        whiteMs: spec.initialSeconds * 1000,
        blackMs: spec.initialSeconds * 1000,
      },
      include: {
        white: { select: { id: true, username: true, displayName: true } },
        black: { select: { id: true, username: true, displayName: true } },
      },
    });

    return NextResponse.json({ game }, { status: 201 });
  } catch (error) {
    console.error("Internal create game error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

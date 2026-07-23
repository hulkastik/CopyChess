import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isInternalRequest } from "@/lib/auth";

const PLAYER_SELECT = { select: { id: true, username: true, displayName: true, engineAssist: true } };

// GET – der Socket-Server laedt eine Partie nach einem Neustart aus der DB nach.
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isInternalRequest(req)) {
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });
  }
  const { id } = await context.params;
  const game = await prisma.game.findUnique({
    where: { id },
    include: { white: PLAYER_SELECT, black: PLAYER_SELECT },
  });
  if (!game) {
    return NextResponse.json({ error: "Partie nicht gefunden" }, { status: 404 });
  }
  return NextResponse.json({ game });
}

// PATCH – Zugliste, Uhren und Endstand fortschreiben.
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isInternalRequest(req)) {
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });
  }

  try {
    const { id } = await context.params;
    const body = await req.json();

    const data: Record<string, unknown> = {};
    if (typeof body.movesUci === "string") data.movesUci = body.movesUci;
    if (typeof body.fen === "string") data.fen = body.fen;
    if (Number.isFinite(body.whiteMs)) data.whiteMs = Math.max(0, Math.round(body.whiteMs));
    if (Number.isFinite(body.blackMs)) data.blackMs = Math.max(0, Math.round(body.blackMs));
    if (typeof body.status === "string") data.status = body.status;
    if (typeof body.result === "string" || body.result === null) data.result = body.result;
    if (typeof body.reason === "string" || body.reason === null) data.reason = body.reason;
    if (body.status === "FINISHED" || body.status === "ABORTED") data.finishedAt = new Date();

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Keine Felder zum Aktualisieren" }, { status: 400 });
    }

    const game = await prisma.game.update({ where: { id }, data });
    return NextResponse.json({ game });
  } catch (error) {
    console.error("Internal update game error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

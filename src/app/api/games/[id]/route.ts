import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const PLAYER_SELECT = { select: { id: true, username: true, displayName: true } };

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const game = await prisma.game.findUnique({
    where: { id },
    include: { white: PLAYER_SELECT, black: PLAYER_SELECT },
  });

  if (!game) {
    return NextResponse.json({ error: "Partie nicht gefunden" }, { status: 404 });
  }
  if (game.whiteId !== auth.user.id && game.blackId !== auth.user.id) {
    return NextResponse.json({ error: "Kein Zugriff auf diese Partie" }, { status: 403 });
  }

  return NextResponse.json({ game });
}

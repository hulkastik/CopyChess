import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isInternalRequest } from "@/lib/auth";

/**
 * Darf dieser Nutzer bei dieser Partie zuschauen?
 *
 * Der Spielserver kennt keine Freundschaften — die stehen in der Datenbank.
 * Statt sie dorthin zu spiegeln, fragt er hier nach. Erlaubt sind Beteiligte
 * und wer mit mindestens einem der beiden befreundet ist.
 */
export async function GET(req: NextRequest) {
  if (!isInternalRequest(req)) {
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });
  }

  const gameId = req.nextUrl.searchParams.get("gameId");
  const userId = req.nextUrl.searchParams.get("userId");
  if (!gameId || !userId) {
    return NextResponse.json({ error: "gameId und userId erforderlich" }, { status: 400 });
  }

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { whiteId: true, blackId: true },
  });
  if (!game) {
    return NextResponse.json({ allowed: false, reason: "not-found" });
  }

  if (game.whiteId === userId || game.blackId === userId) {
    return NextResponse.json({ allowed: true, participant: true });
  }

  const friendship = await prisma.friendship.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { user1Id: userId, user2Id: { in: [game.whiteId, game.blackId] } },
        { user2Id: userId, user1Id: { in: [game.whiteId, game.blackId] } },
      ],
    },
    select: { id: true },
  });

  return NextResponse.json({ allowed: Boolean(friendship), participant: false });
}

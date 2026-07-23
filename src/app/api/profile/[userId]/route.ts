import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const PLAYER_SELECT = { select: { id: true, username: true, displayName: true } };

/**
 * Profil eines Kontos: Wertung, Bilanz, Partieverlauf.
 *
 * Sichtbar für das eigene Konto und für bestätigte Freunde. Fremde Profile
 * bleiben zu — die Partieliste verrät sonst, gegen wen jemand wann gespielt hat.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ userId: string }> }) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const { userId } = await context.params;
  const isSelf = userId === auth.user.id;

  if (!isSelf) {
    const friendship = await prisma.friendship.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { user1Id: auth.user.id, user2Id: userId },
          { user1Id: userId, user2Id: auth.user.id },
        ],
      },
      select: { id: true },
    });
    if (!friendship) {
      return NextResponse.json(
        { error: "Nur eigene Profile und Profile von Freunden sind sichtbar" },
        { status: 403 }
      );
    }
  }

  const profile = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      displayName: true,
      elo: true,
      wins: true,
      losses: true,
      draws: true,
      createdAt: true,
    },
  });
  if (!profile) {
    return NextResponse.json({ error: "Benutzer nicht gefunden" }, { status: 404 });
  }

  const games = await prisma.game.findMany({
    where: {
      status: "FINISHED",
      OR: [{ whiteId: userId }, { blackId: userId }],
    },
    include: { white: PLAYER_SELECT, black: PLAYER_SELECT },
    orderBy: { finishedAt: "desc" },
    take: 40,
  });

  return NextResponse.json({ profile, games, isSelf });
}

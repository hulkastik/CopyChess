import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const PLAYER_SELECT = { select: { id: true, username: true, displayName: true, elo: true } };

/**
 * Laufende Partien, bei denen zugeschaut werden darf: eigene Partien und
 * Partien, an denen mindestens ein Freund beteiligt ist.
 *
 * Bewusst aus der Datenbank und nicht aus dem Speicher des Spielservers: nach
 * einem Neustart liegt dort noch keine Partie, die Liste waere dann leer,
 * obwohl die Partien weiterlaufen.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const userId = auth.user.id;

  const friendships = await prisma.friendship.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ user1Id: userId }, { user2Id: userId }],
    },
    select: { user1Id: true, user2Id: true },
  });

  const friendIds = friendships.map((f) => (f.user1Id === userId ? f.user2Id : f.user1Id));
  const visibleIds = [userId, ...friendIds];

  const games = await prisma.game.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ whiteId: { in: visibleIds } }, { blackId: { in: visibleIds } }],
    },
    include: { white: PLAYER_SELECT, black: PLAYER_SELECT },
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  return NextResponse.json({
    games: games.map((game) => ({
      id: game.id,
      white: game.white,
      black: game.black,
      timeControl: game.timeControl,
      startedAt: game.startedAt,
      movesUci: game.movesUci,
      // Eigene Partien fortsetzen statt zuschauen.
      isMine: game.whiteId === userId || game.blackId === userId,
    })),
  });
}

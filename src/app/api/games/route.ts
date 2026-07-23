import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const PLAYER_SELECT = { select: { id: true, username: true, displayName: true } };

// GET /api/games?status=FINISHED&limit=20 – Partien des eingeloggten Users
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const status = req.nextUrl.searchParams.get("status");
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? 25);
  const take = Number.isFinite(limitParam) ? Math.min(100, Math.max(1, limitParam)) : 25;

  const games = await prisma.game.findMany({
    where: {
      OR: [{ whiteId: auth.user.id }, { blackId: auth.user.id }],
      ...(status ? { status } : {}),
    },
    include: { white: PLAYER_SELECT, black: PLAYER_SELECT },
    orderBy: { startedAt: "desc" },
    take,
  });

  return NextResponse.json({ games });
}

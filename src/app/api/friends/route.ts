import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

// GET /api/friends – akzeptierte Freunde des eingeloggten Users
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const userId = auth.user.id;

  const friendships = await prisma.friendship.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ user1Id: userId }, { user2Id: userId }],
    },
    include: {
      user1: { select: { id: true, username: true, displayName: true } },
      user2: { select: { id: true, username: true, displayName: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const friends = friendships.map((f) => {
    const friend = f.user1Id === userId ? f.user2 : f.user1;
    return {
      id: friend.id,
      username: friend.username,
      displayName: friend.displayName,
      friendshipId: f.id,
    };
  });

  return NextResponse.json({ friends });
}

// POST /api/friends – Freundschaftsanfrage senden
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const userId = auth.user.id;

  try {
    const body = await req.json();
    const friendUsername = String(body.friendUsername ?? "").trim();
    if (!friendUsername) {
      return NextResponse.json({ error: "Username fehlt" }, { status: 400 });
    }

    const friend = await prisma.user.findUnique({ where: { username: friendUsername } });
    if (!friend) {
      return NextResponse.json({ error: "Benutzer nicht gefunden" }, { status: 404 });
    }
    if (friend.id === userId) {
      return NextResponse.json(
        { error: "Du kannst dich nicht selbst hinzufügen" },
        { status: 400 }
      );
    }

    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { user1Id: userId, user2Id: friend.id },
          { user1Id: friend.id, user2Id: userId },
        ],
      },
    });

    if (existing) {
      if (existing.status === "ACCEPTED") {
        return NextResponse.json({ error: "Ihr seid bereits Freunde" }, { status: 409 });
      }
      // Eine abgelehnte oder in Gegenrichtung offene Anfrage darf neu gestellt werden.
      if (existing.status === "DECLINED") {
        const revived = await prisma.friendship.update({
          where: { id: existing.id },
          data: { status: "PENDING", user1Id: userId, user2Id: friend.id },
        });
        return NextResponse.json({ friendship: revived }, { status: 201 });
      }
      if (existing.user1Id === friend.id) {
        // Gegenseitige Anfrage = direkt befreundet
        const accepted = await prisma.friendship.update({
          where: { id: existing.id },
          data: { status: "ACCEPTED" },
        });
        return NextResponse.json({ friendship: accepted }, { status: 200 });
      }
      return NextResponse.json({ error: "Anfrage läuft bereits" }, { status: 409 });
    }

    const friendship = await prisma.friendship.create({
      data: { user1Id: userId, user2Id: friend.id, status: "PENDING" },
    });

    return NextResponse.json({ friendship }, { status: 201 });
  } catch (error) {
    console.error("Add friend error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

// DELETE /api/friends?friendshipId=xxx – Freundschaft aufloesen
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const friendshipId = req.nextUrl.searchParams.get("friendshipId");
  if (!friendshipId) {
    return NextResponse.json({ error: "friendshipId fehlt" }, { status: 400 });
  }

  const friendship = await prisma.friendship.findUnique({ where: { id: friendshipId } });
  if (!friendship) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  if (friendship.user1Id !== auth.user.id && friendship.user2Id !== auth.user.id) {
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });
  }

  await prisma.friendship.delete({ where: { id: friendshipId } });
  return NextResponse.json({ ok: true });
}

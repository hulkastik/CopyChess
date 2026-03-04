import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/friends?userId=xxx – list all accepted friends
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId fehlt" }, { status: 400 });
  }

  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [
        { user1Id: userId, status: "ACCEPTED" },
        { user2Id: userId, status: "ACCEPTED" },
      ],
    },
    include: {
      user1: { select: { id: true, username: true } },
      user2: { select: { id: true, username: true } },
    },
  });

  // Return the "other" user in each friendship
  const friends = friendships.map((f: { id: string; user1Id: string; user2Id: string; user1: { id: string; username: string }; user2: { id: string; username: string } }) => {
    const friend = f.user1Id === userId ? f.user2 : f.user1;
    return { id: friend.id, username: friend.username, friendshipId: f.id };
  });

  return NextResponse.json({ friends });
}

// POST /api/friends – send friend request
export async function POST(req: NextRequest) {
  try {
    const { userId, friendUsername } = await req.json();

    if (!userId || !friendUsername) {
      return NextResponse.json(
        { error: "userId und friendUsername sind erforderlich" },
        { status: 400 }
      );
    }

    // Find the friend by username
    const friend = await prisma.user.findUnique({
      where: { username: friendUsername },
    });
    if (!friend) {
      return NextResponse.json(
        { error: "Benutzer nicht gefunden" },
        { status: 404 }
      );
    }

    if (friend.id === userId) {
      return NextResponse.json(
        { error: "Du kannst dich nicht selbst hinzufügen" },
        { status: 400 }
      );
    }

    // Check if friendship already exists (in either direction)
    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { user1Id: userId, user2Id: friend.id },
          { user1Id: friend.id, user2Id: userId },
        ],
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Freundschaftsanfrage existiert bereits" },
        { status: 409 }
      );
    }

    const friendship = await prisma.friendship.create({
      data: {
        user1Id: userId,
        user2Id: friend.id,
        status: "PENDING",
      },
    });

    return NextResponse.json({ friendship }, { status: 201 });
  } catch (error) {
    console.error("Add friend error:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}

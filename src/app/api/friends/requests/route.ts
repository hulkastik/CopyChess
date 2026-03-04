import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/friends/requests?userId=xxx – list pending friend requests for a user
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId fehlt" }, { status: 400 });
  }

  const requests = await prisma.friendship.findMany({
    where: {
      user2Id: userId,
      status: "PENDING",
    },
    include: {
      user1: { select: { id: true, username: true } },
    },
  });

  return NextResponse.json({
    requests: requests.map((r: { id: string; user1: { id: string; username: string } }) => ({
      friendshipId: r.id,
      from: r.user1,
    })),
  });
}

// PATCH /api/friends/requests – accept or decline a friend request
export async function PATCH(req: NextRequest) {
  try {
    const { friendshipId, action } = await req.json();

    if (!friendshipId || !["accept", "decline"].includes(action)) {
      return NextResponse.json(
        { error: "friendshipId und action (accept/decline) erforderlich" },
        { status: 400 }
      );
    }

    const friendship = await prisma.friendship.update({
      where: { id: friendshipId },
      data: {
        status: action === "accept" ? "ACCEPTED" : "DECLINED",
      },
    });

    return NextResponse.json({ friendship });
  } catch (error) {
    console.error("Friend request error:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

// GET /api/friends/requests – offene Anfragen an den eingeloggten User
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const requests = await prisma.friendship.findMany({
    where: { user2Id: auth.user.id, status: "PENDING" },
    include: { user1: { select: { id: true, username: true, displayName: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    requests: requests.map((r) => ({ friendshipId: r.id, from: r.user1 })),
  });
}

// PATCH /api/friends/requests – Anfrage annehmen oder ablehnen
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { friendshipId, action } = await req.json();
    if (!friendshipId || !["accept", "decline"].includes(action)) {
      return NextResponse.json(
        { error: "friendshipId und action (accept/decline) erforderlich" },
        { status: 400 }
      );
    }

    const friendship = await prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!friendship) {
      return NextResponse.json({ error: "Anfrage nicht gefunden" }, { status: 404 });
    }
    // Nur der Empfaenger darf ueber die eigene Anfrage entscheiden.
    if (friendship.user2Id !== auth.user.id) {
      return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });
    }

    const updated = await prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: action === "accept" ? "ACCEPTED" : "DECLINED" },
    });

    return NextResponse.json({ friendship: updated });
  } catch (error) {
    console.error("Friend request error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

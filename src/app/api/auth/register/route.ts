import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    const displayName = String(body.displayName ?? "").trim() || username;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username und Passwort sind erforderlich" },
        { status: 400 }
      );
    }

    if (username.length < 3 || password.length < 4) {
      return NextResponse.json(
        { error: "Username min. 3 Zeichen, Passwort min. 4 Zeichen" },
        { status: 400 }
      );
    }

    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      return NextResponse.json(
        { error: "Username darf nur Buchstaben, Zahlen, . _ - enthalten" },
        { status: 400 }
      );
    }

    if (displayName.length > 24) {
      return NextResponse.json(
        { error: "Anzeigename max. 24 Zeichen" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json(
        { error: "Username ist bereits vergeben" },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, passwordHash, displayName },
      select: { id: true, username: true, displayName: true, engineAssist: true },
    });

    return NextResponse.json({ user, token: createToken(user.id) }, { status: 201 });
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

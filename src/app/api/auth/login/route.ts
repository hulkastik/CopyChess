import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username und Passwort sind erforderlich" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({ where: { username } });
    // Gleiche Fehlermeldung fuer "kein User" und "falsches Passwort" —
    // sonst laesst sich ueber die API herausfinden, welche Namen existieren.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return NextResponse.json(
        { error: "Ungültiger Username oder Passwort" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        engineAssist: user.engineAssist,
        elo: user.elo,
      },
      token: createToken(user.id),
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

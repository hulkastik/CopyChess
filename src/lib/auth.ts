import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";

const SECRET = process.env.INTERNAL_API_SECRET || "chess-internal-dev-secret";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 Tage

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  engineAssist: boolean;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

/**
 * Opaques, HMAC-signiertes Token statt reiner localStorage-User-ID.
 * Ohne das koennte jeder Client eine fremde userId in die API schreiben.
 */
export function createToken(userId: string): string {
  const payload = `${userId}.${Date.now()}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function verifyToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const [userId, issuedAt] = payload.split(".");
  if (!userId || !issuedAt) return null;
  if (Date.now() - Number(issuedAt) > TOKEN_TTL_MS) return null;
  return userId;
}

function bearerFrom(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

/** Liefert den eingeloggten User oder null. */
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const userId = verifyToken(bearerFrom(req));
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, displayName: true, engineAssist: true },
  });
  return user;
}

/** Wie getSessionUser, gibt aber direkt die 401-Antwort zurueck. */
export async function requireUser(
  req: NextRequest
): Promise<{ user: SessionUser; response?: never } | { user?: never; response: NextResponse }> {
  const user = await getSessionUser(req);
  if (!user) {
    return {
      response: NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 }),
    };
  }
  return { user };
}

/** Zugriffsschutz fuer die Routen, die der Socket-Server aufruft. */
export function isInternalRequest(req: NextRequest): boolean {
  const provided = req.headers.get("x-internal-secret");
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

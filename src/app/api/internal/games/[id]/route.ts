import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isInternalRequest } from "@/lib/auth";
import { applyElo } from "@/lib/rating";

const PLAYER_SELECT = { select: { id: true, username: true, displayName: true, engineAssist: true } };

// GET – der Socket-Server laedt eine Partie nach einem Neustart aus der DB nach.
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isInternalRequest(req)) {
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });
  }
  const { id } = await context.params;
  const game = await prisma.game.findUnique({
    where: { id },
    include: { white: PLAYER_SELECT, black: PLAYER_SELECT },
  });
  if (!game) {
    return NextResponse.json({ error: "Partie nicht gefunden" }, { status: 404 });
  }
  return NextResponse.json({ game });
}

// PATCH – Zugliste, Uhren und Endstand fortschreiben.
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isInternalRequest(req)) {
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });
  }

  try {
    const { id } = await context.params;
    const body = await req.json();

    const data: Record<string, unknown> = {};
    if (typeof body.movesUci === "string") data.movesUci = body.movesUci;
    if (typeof body.fen === "string") data.fen = body.fen;
    if (Number.isFinite(body.whiteMs)) data.whiteMs = Math.max(0, Math.round(body.whiteMs));
    if (Number.isFinite(body.blackMs)) data.blackMs = Math.max(0, Math.round(body.blackMs));
    if (typeof body.status === "string") data.status = body.status;
    if (typeof body.result === "string" || body.result === null) data.result = body.result;
    if (typeof body.reason === "string" || body.reason === null) data.reason = body.reason;
    if (body.status === "FINISHED" || body.status === "ABORTED") data.finishedAt = new Date();

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Keine Felder zum Aktualisieren" }, { status: 400 });
    }

    const finishing = body.status === "FINISHED" && typeof body.result === "string";

    // Wertung und Bilanz in einer Transaktion mit dem Partie-Update.
    //
    // Der Socket-Server schreibt bei jedem Zug; nach Partieende koennen weitere
    // Schreibvorgaenge folgen (Nachzuegler aus der Persistenz-Kette). Die
    // Bedingung `status: "ACTIVE"` im Update stellt sicher, dass die Wertung
    // genau einmal verrechnet wird — der zweite Aufruf findet keinen Datensatz
    // mehr und laesst Elo und Bilanz unangetastet.
    const game = await prisma.$transaction(async (tx) => {
      if (!finishing) {
        return tx.game.update({ where: { id }, data });
      }

      const claimed = await tx.game.updateMany({
        where: { id, status: "ACTIVE" },
        data,
      });

      const current = await tx.game.findUniqueOrThrow({
        where: { id },
        include: {
          white: { select: { id: true, elo: true } },
          black: { select: { id: true, elo: true } },
        },
      });

      if (claimed.count === 0) return current; // war bereits abgerechnet

      const result = body.result as string;
      const rating = applyElo(current.white.elo, current.black.elo, result);

      const whiteOutcome = result === "1-0" ? "wins" : result === "0-1" ? "losses" : "draws";
      const blackOutcome = result === "0-1" ? "wins" : result === "1-0" ? "losses" : "draws";

      await tx.user.update({
        where: { id: current.whiteId },
        data: { elo: rating.whiteElo, [whiteOutcome]: { increment: 1 } },
      });
      await tx.user.update({
        where: { id: current.blackId },
        data: { elo: rating.blackElo, [blackOutcome]: { increment: 1 } },
      });

      return tx.game.update({
        where: { id },
        data: {
          whiteEloBefore: current.white.elo,
          blackEloBefore: current.black.elo,
          whiteEloChange: rating.whiteChange,
          blackEloChange: rating.blackChange,
        },
      });
    });

    return NextResponse.json({ game });
  } catch (error) {
    console.error("Internal update game error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

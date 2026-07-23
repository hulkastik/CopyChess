/**
 * Legt das Admin-Konto an (bzw. aktualisiert es).
 *
 *   Username: Admin
 *   Passwort: Admin
 *   Anzeigename: Emre
 *   engineAssist: true  -> Stockfish blendet waehrend der Partie den besten Zug ein
 *
 * Aufruf: npm run seed
 */
require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("Admin", 10);

  const admin = await prisma.user.upsert({
    where: { username: "Admin" },
    update: { displayName: "Emre", engineAssist: true, passwordHash },
    create: {
      username: "Admin",
      passwordHash,
      displayName: "Emre",
      engineAssist: true,
    },
    select: { id: true, username: true, displayName: true, engineAssist: true },
  });

  console.log("Admin-Konto bereit:", admin);
}

main()
  .catch((error) => {
    console.error("Seed fehlgeschlagen:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

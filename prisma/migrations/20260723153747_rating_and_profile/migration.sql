-- AlterTable
ALTER TABLE "Game" ADD COLUMN "blackAccuracy" REAL;
ALTER TABLE "Game" ADD COLUMN "blackEloBefore" INTEGER;
ALTER TABLE "Game" ADD COLUMN "blackEloChange" INTEGER;
ALTER TABLE "Game" ADD COLUMN "whiteAccuracy" REAL;
ALTER TABLE "Game" ADD COLUMN "whiteEloBefore" INTEGER;
ALTER TABLE "Game" ADD COLUMN "whiteEloChange" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "engineAssist" BOOLEAN NOT NULL DEFAULT false,
    "elo" INTEGER NOT NULL DEFAULT 100,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "displayName", "engineAssist", "id", "passwordHash", "updatedAt", "username") SELECT "createdAt", "displayName", "engineAssist", "id", "passwordHash", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

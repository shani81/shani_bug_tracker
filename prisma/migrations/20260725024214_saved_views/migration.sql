-- Adds org scoping + sharing to SavedSearch.
--
-- `orgId` is required, so existing rows are backfilled from the owning user's
-- membership (falling back to User.orgId). Any row whose owner has no org is
-- dropped: it could not be scoped to a tenant and was unreachable anyway.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SavedSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT 'bug',
    "queryJson" TEXT NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SavedSearch_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SavedSearch" ("createdAt", "id", "name", "queryJson", "userId", "orgId")
SELECT s."createdAt", s."id", s."name", s."queryJson", s."userId",
       COALESCE(
         (SELECT m."orgId" FROM "Membership" m WHERE m."userId" = s."userId" ORDER BY m."createdAt" ASC LIMIT 1),
         (SELECT u."orgId" FROM "User" u WHERE u."id" = s."userId")
       )
FROM "SavedSearch" s
WHERE COALESCE(
        (SELECT m."orgId" FROM "Membership" m WHERE m."userId" = s."userId" ORDER BY m."createdAt" ASC LIMIT 1),
        (SELECT u."orgId" FROM "User" u WHERE u."id" = s."userId")
      ) IS NOT NULL;
DROP TABLE "SavedSearch";
ALTER TABLE "new_SavedSearch" RENAME TO "SavedSearch";
CREATE INDEX "SavedSearch_userId_idx" ON "SavedSearch"("userId");
CREATE INDEX "SavedSearch_orgId_group_idx" ON "SavedSearch"("orgId", "group");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

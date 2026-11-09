-- LCH-06: personal invite links and friends who answered. Additive: two new tables and one new column with a safe
-- default (on). Nothing existing is renamed, retyped or removed.
ALTER TABLE "UserSettings" ADD COLUMN "shareMyWord" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "Invite" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Invite_userId_key" ON "Invite"("userId");
CREATE UNIQUE INDEX "Invite_code_key" ON "Invite"("code");
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InviteFriend" (
  "id" TEXT NOT NULL,
  "inviterId" TEXT NOT NULL,
  "friendId" TEXT NOT NULL,
  "answeredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InviteFriend_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InviteFriend_friendId_key" ON "InviteFriend"("friendId");
CREATE INDEX "InviteFriend_inviterId_answeredAt_idx" ON "InviteFriend"("inviterId", "answeredAt");
ALTER TABLE "InviteFriend" ADD CONSTRAINT "InviteFriend_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InviteFriend" ADD CONSTRAINT "InviteFriend_friendId_fkey" FOREIGN KEY ("friendId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

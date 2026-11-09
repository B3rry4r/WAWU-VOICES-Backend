import { randomInt } from "node:crypto";
import type { PrismaService } from "../common/prisma/prisma.service";

/** LCH-06: the code is 7 characters of a-z 0-9 (about 78 billion), made with the system's random source. */
const CODE_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function newCode(): string {
  let s = "";
  for (let i = 0; i < 7; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return s;
}

function isUnique(e: unknown): boolean {
  return (e as { code?: string })?.code === "P2002";
}

/**
 * The person's one invite code. Made the first time it is asked for and never changed after that. Used by the invite
 * screens and (G7) by the share card, whose link line reads usevoices.com/go/<code>.
 */
export async function ensureInviteCode(
  prisma: PrismaService,
  userId: string,
): Promise<string> {
  const have = await prisma.invite.findUnique({ where: { userId } });
  if (have) return have.code;
  for (let i = 0; i < 6; i++) {
    try {
      const made = await prisma.invite.create({
        data: { userId, code: newCode() },
      });
      return made.code;
    } catch (e) {
      if (!isUnique(e)) throw e;
      // Either a parallel call made this person's code, or the code collided with someone else's: look, then retry.
      const again = await prisma.invite.findUnique({ where: { userId } });
      if (again) return again.code;
    }
  }
  throw new Error("could not make an invite code");
}

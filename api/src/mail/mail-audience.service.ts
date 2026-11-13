import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";

export interface MailAudiencePage {
  data: { email: string; firstName: string | null }[];
  nextCursor: string | null;
  /** Every member who matches, not only this page. */
  total: number;
}

/** First word of the display name, or null when there is none. */
export function firstNameOf(displayName: string | null): string | null {
  const word = displayName?.trim().split(/\s+/)[0];
  return word ? word : null;
}

/**
 * Members a bulk email may go to: ACTIVE accounts with a mail address. VOICES has no product or news email switch
 * (UserSettings holds only per-event in-app and mail switches such as notifyReplies), so nothing else leaves a member
 * out; a member who unsubscribes from a bulk email does that in the Hub's list. Reads only.
 */
@Injectable()
export class MailAudienceService {
  constructor(private readonly prisma: PrismaService) {}

  async page(
    cursor: string | undefined,
    limit: number,
  ): Promise<MailAudiencePage> {
    const base = {
      status: "ACTIVE" as const,
      mailTo: { not: null },
      NOT: { mailTo: "" },
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where: cursor ? { ...base, id: { gt: cursor } } : base,
        orderBy: { id: "asc" },
        take: limit + 1,
        select: { id: true, mailTo: true, displayName: true },
      }),
      this.prisma.user.count({ where: base }),
    ]);
    const more = rows.length > limit;
    const pageRows = more ? rows.slice(0, limit) : rows;
    return {
      data: pageRows.map((r) => ({
        email: r.mailTo as string,
        firstName: firstNameOf(r.displayName),
      })),
      nextCursor: more ? pageRows[pageRows.length - 1].id : null,
      total,
    };
  }
}

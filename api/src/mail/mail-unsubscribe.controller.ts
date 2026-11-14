import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Post,
  Query,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaService } from "../common/prisma/prisma.service";
import { MailService } from "./mail.service";
import {
  UNSUBSCRIBE_FIELD,
  UNSUBSCRIBE_LABEL,
  verifyUnsubscribe,
} from "./mail-unsubscribe";

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>` +
  `<body style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#0E1A14"><h1 style="font-size:22px">${title}</h1>${body}</body></html>`;

/**
 * One-click unsubscribe for the daily question and topic of the week emails. Public: the signed token in the link is the
 * only credential, and it can do one thing, turn one switch off for one person. POST is what a mail client's own
 * "unsubscribe" button sends (RFC 8058); GET shows a page with a button, so a link scanner opening the link changes nothing.
 */
@Controller("mail")
@SkipThrottle()
export class MailUnsubscribeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  private who(t: string | undefined) {
    const v = verifyUnsubscribe(this.mail.unsubscribeKeys(), t ?? "");
    if (!v) throw new BadRequestException("This link is not valid.");
    return v;
  }

  @Get("unsubscribe")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "no-store")
  show(@Query("t") t?: string): string {
    const v = this.who(t);
    const token = encodeURIComponent(t ?? "");
    return page(
      "Turn off these emails?",
      `<p>You will stop getting ${UNSUBSCRIBE_LABEL[v.kind]} from Voices. Other emails are not affected.</p>` +
        `<form method="post" action="/api/v1/mail/unsubscribe?t=${token}"><button type="submit" style="font-size:16px;padding:12px 22px;border-radius:999px;border:0;background:#0DA86A;color:#002B1A;font-weight:700">Turn them off</button></form>`,
    );
  }

  @Post("unsubscribe")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "no-store")
  async off(@Query("t") t?: string): Promise<string> {
    const v = this.who(t);
    const exists = await this.prisma.user.findUnique({
      where: { id: v.userId },
      select: { id: true },
    });
    if (exists) {
      const field = UNSUBSCRIBE_FIELD[v.kind];
      await this.prisma.userSettings.upsert({
        where: { userId: v.userId },
        create: { userId: v.userId, [field]: false },
        update: { [field]: false },
      });
    }
    return page(
      "You are unsubscribed",
      `<p>You will not get ${UNSUBSCRIBE_LABEL[v.kind]} any more. You can turn them back on in Settings in the app.</p>`,
    );
  }
}

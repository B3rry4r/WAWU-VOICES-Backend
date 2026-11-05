import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ConfigReader } from "./config-reader";
import { UnitsAccess } from "./units-access";

/** The `Allowances` object of the contract: what the person can do now and what it costs. */
@Injectable()
export class AllowancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigReader,
    private readonly units: UnitsAccess,
  ) {}

  async costs() {
    const c = (k: string) => this.config.num(k);
    return {
      freeReactionsPerDay: await c("allowance.free_reactions_per_day"),
      freeVotesPerDay: await c("allowance.free_votes_per_day"),
      baseKoboPerUnit: await c("units.base_rate_kobo"),
      textPostMilli: await c("cost.text_post_milli"),
      voicePostMilli: await c("cost.voice_post_milli"),
      reactionAfterFreeMilli: await c("cost.reaction_milli"),
      voteAfterFreeMilli: await c("cost.vote_milli"),
      minPackKobo: await c("units.min_purchase_kobo"),
      extraVoice30Kobo: await c("voice.extra30.price_kobo"),
      extraVoice60Kobo: await c("voice.extra60.price_kobo"),
      textMaxChars: await c("text.max_chars"),
      freeVoiceSeconds: await c("voice.free_seconds"),
    };
  }

  async snapshot(userId: string) {
    const [post, react, vote, tokens, costs, maxVoiceSeconds] =
      await Promise.all([
        this.units.freeLeft(userId, "POST_TEXT"),
        this.units.freeLeft(userId, "REACTION"),
        this.units.freeLeft(userId, "VOTE"),
        this.prisma.extraVoiceToken.findMany({
          where: { userId, status: { in: ["AVAILABLE", "RESERVED"] } },
          orderBy: { createdAt: "asc" },
        }),
        this.costs(),
        this.config.num("voice.free_seconds"),
      ]);
    return {
      freePostsRemaining: post.freeLeft,
      balanceMilli: post.balanceMilli,
      maxVoiceSeconds,
      freeReactionsLeftToday: react.freeLeft,
      freeVotesLeftToday: vote.freeLeft,
      costs,
      extraVoiceTokens: tokens.map((t) => ({
        id: t.id,
        kind: t.kind,
        maxSeconds: t.maxSeconds,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  }
}

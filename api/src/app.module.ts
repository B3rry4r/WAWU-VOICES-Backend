import { MailModule } from "./mail/mail.module";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { ApiThrottlerGuard } from "./common/throttle/api-throttler.guard";
import { AuthModule } from "./common/auth/auth.module";
import { PrismaModule } from "./common/prisma/prisma.module";
import { MeModule } from "./me/me.module";
import { FeedModule } from "./feed/feed.module";
import { TalkModule } from "./talk/talk.module";
import { DmModule } from "./dm/dm.module";
import { DmLiveModule } from "./dm/dm-live";
import { TextFixModule } from "./textfix/textfix.module";
import { VoteModule } from "./vote/vote.module";
import { UnitsModule } from "./units/units.module";
import { ResultsModule } from "./results/results.module";
import { NewsModule } from "./news/news.module";
import { ReachModule } from "./reach/reach.module";
import { AdminModule } from "./admin/admin.module";
import { MediaModule } from "./media/media.module";
import { HealthController } from "./health/health.controller";
import { ProbeController } from "./probe/probe.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          { ttl: 60_000, limit: Number(config.get("THROTTLE_LIMIT") ?? 1200) },
        ],
      }),
    }),
    PrismaModule,
    AuthModule,
    MeModule,
    FeedModule,
    TalkModule,
    DmLiveModule,
    DmModule,
    TextFixModule,
    VoteModule,
    UnitsModule,
    ResultsModule,
    NewsModule,
    ReachModule,
    AdminModule,
    MediaModule,
    MailModule,
  ],
  controllers: [HealthController, ProbeController],
  providers: [{ provide: APP_GUARD, useClass: ApiThrottlerGuard }],
})
export class AppModule {}

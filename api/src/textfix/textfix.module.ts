import { Module } from "@nestjs/common";
import { TalkSharedModule } from "../talk/shared/shared.module";
import { makeGeminiTextFixer } from "./gemini-fixer";
import { TEXT_FIXER } from "./text-fixer.port";
import { TextFixController } from "./textfix.controller";
import { TextFixService } from "./textfix.service";

/** Paid AI text fix (LCH-12). With no GEMINI_API_KEY the route answers 503 and nobody is charged. */
@Module({
  imports: [TalkSharedModule],
  controllers: [TextFixController],
  providers: [
    TextFixService,
    {
      provide: TEXT_FIXER,
      useFactory: () =>
        process.env.GEMINI_API_KEY ? makeGeminiTextFixer() : null,
    },
  ],
})
export class TextFixModule {}

import { Module } from "@nestjs/common";
import { makeGeminiTranscriber } from "../audio-ref/transcribe";
import { TalkSharedModule } from "../talk/shared/shared.module";
import { ClipsService } from "./clips.service";
import { MediaController } from "./media.controller";
import { MediaJobs } from "./media-jobs";
import { MEDIA_STORE, SpacesStore, TRANSCRIBER } from "./object-store";
import { TranscriptionWorker } from "./transcription.worker";

/**
 * Media: voice clips (presign, finalise, normalise, peaks, transcription queue, signed playback) and photo uploads.
 * The bucket and the transcriber come from env: with no SPACES_* the routes answer 503, with no GEMINI_API_KEY
 * transcripts stay PENDING.
 */
@Module({
  imports: [TalkSharedModule],
  controllers: [MediaController],
  providers: [
    { provide: MEDIA_STORE, useFactory: () => SpacesStore.fromEnv() },
    {
      provide: TRANSCRIBER,
      useFactory: () =>
        process.env.GEMINI_API_KEY ? makeGeminiTranscriber() : null,
    },
    MediaJobs,
    ClipsService,
    TranscriptionWorker,
  ],
  exports: [ClipsService, MediaJobs, TranscriptionWorker],
})
export class MediaModule {}

import { Module } from "@nestjs/common";
import { makeGeminiTranscriber } from "../audio-ref/transcribe";
import { TalkSharedModule } from "../talk/shared/shared.module";
import { ClipsService } from "./clips.service";
import { MediaController } from "./media.controller";
import { MediaJobs } from "./media-jobs";
import { MEDIA_STORE, SpacesStore, TRANSCRIBER } from "./object-store";
import { FileAttachModule } from "./file-attach.service";
import { StoragePurgeService } from "./storage-purge.service";
import { TranscriptionWorker } from "./transcription.worker";
import { VoiceVideoController } from "./voice-video.controller";
import { VoiceVideoService } from "./voice-video.service";

/**
 * Media: voice clips (presign, finalise, normalise, peaks, transcription queue, signed playback) and photo uploads.
 * The bucket and the transcriber come from env: with no SPACES_* the routes answer 503, with no GEMINI_API_KEY
 * transcripts stay PENDING.
 */
@Module({
  imports: [TalkSharedModule, FileAttachModule],
  controllers: [MediaController, VoiceVideoController],
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
    StoragePurgeService,
    VoiceVideoService,
  ],
  exports: [
    ClipsService,
    MediaJobs,
    TranscriptionWorker,
    StoragePurgeService,
    VoiceVideoService,
  ],
})
export class MediaModule {}

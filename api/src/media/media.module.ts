import { Module } from "@nestjs/common";

/** Media: empty on purpose (V-SHARED-0). The task that owns this module fills it; app.module.ts already imports it. */
@Module({})
export class MediaModule {}

import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { Throttle } from "@nestjs/throttler";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { OptionalAuthGuard } from "../common/guards/optional-auth.guard";
import { WeeklyService } from "./weekly.service";

export class ArchiveQuery {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

@Controller("weekly-reports")
@UseGuards(OptionalAuthGuard)
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class WeeklyController {
  constructor(private readonly weekly: WeeklyService) {}

  @Get()
  @Header("Cache-Control", "public, max-age=30")
  @Header("Vary", "Authorization")
  list(@Query() q: ArchiveQuery) {
    return this.weekly.archive({ cursor: q.cursor, limit: q.limit ?? 20 });
  }

  // Declared before :reportId so "latest" is never read as an id.
  @Get("latest")
  @Header("Cache-Control", "public, max-age=30")
  @Header("Vary", "Authorization")
  async latest(@Res({ passthrough: true }) res: Response) {
    const r = await this.weekly.latest();
    if (r) return r;
    res.type("application/json");
    return "null";
  }

  @Get(":reportId")
  @Header("Cache-Control", "public, max-age=30")
  @Header("Vary", "Authorization")
  one(
    @Param(
      "reportId",
      new ParseUUIDPipe({ exceptionFactory: () => notFound() }),
    )
    id: string,
  ) {
    return this.weekly.byId(id);
  }
}

function notFound(): NotFoundException {
  return new NotFoundException();
}

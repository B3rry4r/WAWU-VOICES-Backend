import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";

// Served at /api/health, outside the /api/v1 prefix (app-config.ts excludes it).
@Controller("api/health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /api/health: public. Pings the database. */
  @Get()
  async health(): Promise<{ status: "ok"; db: "up" }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        message: "VOICES is not available right now. Try again soon.",
        code: "UNAVAILABLE",
      });
    }
    return { status: "ok", db: "up" };
  }
}

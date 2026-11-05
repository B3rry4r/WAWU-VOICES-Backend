import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /api/health: public. Pings the database. */
  @Get()
  async health(): Promise<{ status: "ok"; db: "up" }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        message: "Database is not reachable.",
        code: "db_down",
      });
    }
    return { status: "ok", db: "up" };
  }
}

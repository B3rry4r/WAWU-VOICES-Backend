import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { TIER_DEFAULTS, UNIT_DEFAULTS } from "./units.defaults";
import { isAmount } from "./units.errors";

/** Reads prices, costs and allowances from ConfigEntry (admin edits apply at once, so no cache), else the PRICES.md default. */
@Injectable()
export class UnitsConfig {
  private readonly logger = new Logger(UnitsConfig.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Several integer keys in one query. A stored value that is not a sane integer fails closed. */
  async ints(keys: string[]): Promise<Record<string, number>> {
    const rows = await this.prisma.configEntry.findMany({
      where: { key: { in: keys } },
    });
    const stored = new Map(rows.map((r) => [r.key, r.valueJson]));
    const out: Record<string, number> = {};
    for (const key of keys) {
      const v = stored.has(key) ? stored.get(key) : UNIT_DEFAULTS[key]?.value;
      if (!isAmount(v)) {
        this.logger.error(`Config ${key} is not a valid integer`);
        throw new Error(`Config ${key} is not a valid integer`);
      }
      out[key] = v;
    }
    return out;
  }

  async int(key: string): Promise<number> {
    return (await this.ints([key]))[key];
  }

  /** Insert missing ConfigEntry rows and unit tiers. Never overwrites an edited value. */
  async seedDefaults(): Promise<void> {
    await this.prisma.configEntry.createMany({
      data: Object.entries(UNIT_DEFAULTS).map(([key, d]) => ({
        key,
        valueJson: d.value,
        description: d.description,
        placeholder: d.placeholder,
      })),
      skipDuplicates: true,
    });
    await this.prisma.unitTier.createMany({
      data: TIER_DEFAULTS,
      skipDuplicates: true,
    });
  }
}

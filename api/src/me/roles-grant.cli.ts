/**
 * npm run roles:grant -- --handle ada.okafor --role ADMIN [--revoke]
 *                     -- --wawu-id <sub> --role EDITOR
 * Needs DATABASE_URL. Run on the API server by the person who owns the droplet.
 */
import { clientFromEnv, grantRole } from "./roles-grant";
import type { VoicesRole } from "../generated/prisma/enums";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const prisma = clientFromEnv();
  try {
    const msg = await grantRole(prisma, {
      handle: arg("handle"),
      wawuId: arg("wawu-id"),
      role: (arg("role") ?? "").toUpperCase() as VoicesRole,
      revoke: process.argv.includes("--revoke"),
      by: process.env.USER,
    });
    console.log(msg);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

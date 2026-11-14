/**
 * npm run photos:publish
 * Makes every existing uploaded photo (AVATAR, OVERRIDE_IMAGE, AD_CREATIVE under file/) public-read in the bucket.
 * Needs DATABASE_URL and SPACES_*. Run on the API server as the voices user with /etc/voices/api.env loaded.
 * Safe to run again.
 */
import { clientFromEnv } from "../me/roles-grant";
import { SpacesStore } from "./object-store";
import { publishExistingPhotos } from "./publish-photos";

async function main() {
  const store = SpacesStore.fromEnv();
  if (!store) throw new Error("SPACES_* is not set.");
  const prisma = clientFromEnv();
  try {
    const r = await publishExistingPhotos(prisma, store, (m) =>
      console.error(m),
    );
    console.log(
      `Photos made public: ${r.made} of ${r.total} (failed ${r.failed}, no longer in the bucket ${r.missing}).`,
    );
    if (r.failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

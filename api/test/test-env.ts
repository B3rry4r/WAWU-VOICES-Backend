// CI sets only DATABASE_URL (its service database); a local run may set TEST_DATABASE_URL instead.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/voices_test?schema=public";

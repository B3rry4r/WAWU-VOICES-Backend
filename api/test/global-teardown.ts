export default function globalTeardown(): void {
  // The test database is kept between runs; migrations are idempotent.
}

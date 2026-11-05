import { NotFoundException, ParseUUIDPipe } from "@nestjs/common";

/** A path id that is not a UUID is simply not found (404), not a 400. */
export const UuidParam = new ParseUUIDPipe({
  exceptionFactory: () =>
    new NotFoundException({
      code: "NOT_FOUND",
      message: "We could not find that.",
    }),
});

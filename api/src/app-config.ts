import { randomUUID } from "node:crypto";
import {
  INestApplication,
  UnprocessableEntityException,
  ValidationError,
  ValidationPipe,
} from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import compression from "compression";
import helmet from "helmet";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { busyMiddleware, busyOptionsFromEnv } from "./common/busy/busy";

/** Everything set on the app between create and listen; main.ts and the tests share it. */
export function configureApp(app: INestApplication): void {
  // One proxy hop (nginx) in front: rate limits count the caller, not the proxy.
  (app as unknown as { set: (k: string, v: unknown) => void }).set(
    "trust proxy",
    1,
  );
  app.use(helmet());
  app.use(compression());

  const origins = process.env.CORS_ORIGIN?.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (
    process.env.NODE_ENV === "production" &&
    (!origins || origins.length === 0)
  ) {
    throw new Error("CORS_ORIGIN must list the allowed origins in production.");
  }
  app.enableCors({ origin: origins ?? true, credentials: true });

  // Every response carries X-Request-Id; the same id is in an error body.
  app.use(
    (req: Request & { id?: string }, res: Response, next: NextFunction) => {
      req.id = randomUUID();
      res.setHeader("X-Request-Id", req.id);
      next();
    },
  );

  // LCH-09: when the API is full it says so at once (503, "We are busy. Try again in a minute.") instead of queueing.
  app.use(busyMiddleware(busyOptionsFromEnv()));

  // Contract routes live under /api/v1. The health check stays at /api/health (outside the version).
  app.setGlobalPrefix("api/v1", { exclude: ["api/health"] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) =>
        new UnprocessableEntityException({
          code: "VALIDATION_FAILED",
          message: "Some details need fixing.",
          details: { fields: flatten(errors) },
        }),
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}

function flatten(
  errors: ValidationError[],
  parent = "",
): { path: string; message: string }[] {
  return errors.flatMap((e) => {
    const path = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((message) => ({
      path,
      message,
    }));
    return [...own, ...flatten(e.children ?? [], path)];
  });
}

/**
 * LCH-09: nginx keeps connections to this server open between requests (upstream keepalive). Node closes an idle connection
 * after 5 seconds by default, and when nginx sends a request at the moment Node closes, nginx logs "Connection reset by
 * peer" and the visitor gets the busy page (seen about once in 50,000 requests). Keeping idle connections open longer than
 * nginx's own keepalive_timeout (60 s) means nginx always closes first. headersTimeout must be larger than keepAliveTimeout.
 */
export function tuneServer(server: {
  keepAliveTimeout: number;
  headersTimeout: number;
}): void {
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
}

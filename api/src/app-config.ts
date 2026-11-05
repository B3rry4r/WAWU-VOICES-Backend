import { INestApplication, ValidationPipe } from "@nestjs/common";
import compression from "compression";
import helmet from "helmet";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

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

  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}

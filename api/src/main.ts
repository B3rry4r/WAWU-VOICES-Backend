import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { configureApp, tuneServer } from "./app-config";
import { gracefulStop } from "./graceful-stop";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  // The droplet sets PORT; default 4000 (V-DEPLOY-PREP). Dev agents set PORT in 14000-14019.
  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  tuneServer(app.getHttpServer());
  // SIGTERM (a deploy restart): finish the requests in flight (up to 10 s), then exit.
  const stop = gracefulStop(app.getHttpServer(), () => app.close());
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  console.log(`VOICES API listening on :${port} (prefix /api/v1)`);
}
void bootstrap();

import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { configureApp, tuneServer } from "./app-config";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  // The droplet sets PORT; default 4000 (V-DEPLOY-PREP). Dev agents set PORT in 14000-14019.
  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  tuneServer(app.getHttpServer() as Parameters<typeof tuneServer>[0]);
  console.log(`VOICES API listening on :${port} (prefix /api/v1)`);
}
void bootstrap();

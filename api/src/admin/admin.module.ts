import { Module } from "@nestjs/common";
import { AdminTrustModule } from "./trust/trust.module";

/** Admin: the console's routes. A7a (content) and A7b (trust) each add one module here; app.module.ts already imports this. */
@Module({ imports: [AdminTrustModule] })
export class AdminModule {}

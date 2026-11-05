import { Module } from "@nestjs/common";
import { ResultsModule } from "../results/results.module";
import { NewsController } from "./news.controller";
import { NewsService } from "./news.service";

/** News: the Newsroom, the three tags, flags. A7's tag decision route reads and writes the same Answer and TagChange rows. */
@Module({
  imports: [ResultsModule],
  controllers: [NewsController],
  providers: [NewsService],
  exports: [NewsService],
})
export class NewsModule {}

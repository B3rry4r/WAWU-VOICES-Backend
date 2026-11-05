import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { WawuJwtStrategy } from "./wawu-jwt.strategy";

/** WAWU ID verification. Imported once by AppModule. */
@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: "wawu-jwt" }),
  ],
  providers: [WawuJwtStrategy],
})
export class AuthModule {}

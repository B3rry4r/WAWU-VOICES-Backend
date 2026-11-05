import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/** Signed-in only. Missing or bad token: 401. */
@Injectable()
export class WawuAuthGuard extends AuthGuard("wawu-jwt") {}

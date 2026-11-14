import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentMe, Roles } from "../me/me-guards";
import type { CurrentMeInfo } from "../me/me-context";
import {
  ApproveVerificationDto,
  RejectVerificationDto,
  VerificationListQuery,
} from "./verification.dto";
import { VerificationAdminService } from "./verification-admin.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (raw: string): string => {
  if (!UUID.test(raw)) throw new NotFoundException();
  return raw;
};

/** V-46: the Verification queue. ADMIN only: identity documents are the most private thing VOICES holds. */
@Controller("admin/verification")
export class VerificationAdminController {
  constructor(private readonly svc: VerificationAdminService) {}

  @Get()
  @Roles("ADMIN")
  @Header("Cache-Control", "no-store")
  list(@Query() q: VerificationListQuery) {
    return this.svc.list(q);
  }

  @Get(":requestId")
  @Roles("ADMIN")
  @Header("Cache-Control", "no-store")
  detail(@Param("requestId") requestId: string) {
    return this.svc.detail(id(requestId));
  }

  /** The signed link to one document, made when it is opened. kind: id or bill. */
  @Get(":requestId/documents/:kind")
  @Roles("ADMIN")
  @Header("Cache-Control", "no-store")
  document(
    @CurrentMe() me: CurrentMeInfo,
    @Param("requestId") requestId: string,
    @Param("kind") kind: string,
  ) {
    if (kind !== "id" && kind !== "bill") throw new NotFoundException();
    return this.svc.documentLink(me, id(requestId), kind);
  }

  @Post(":requestId/approve")
  @HttpCode(200)
  @Roles("ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  approve(
    @CurrentMe() me: CurrentMeInfo,
    @Param("requestId") requestId: string,
    @Body() dto: ApproveVerificationDto,
  ) {
    return this.svc.approve(me, id(requestId), dto.note);
  }

  @Post(":requestId/reject")
  @HttpCode(200)
  @Roles("ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  reject(
    @CurrentMe() me: CurrentMeInfo,
    @Param("requestId") requestId: string,
    @Body() dto: RejectVerificationDto,
  ) {
    return this.svc.reject(me, id(requestId), dto);
  }
}

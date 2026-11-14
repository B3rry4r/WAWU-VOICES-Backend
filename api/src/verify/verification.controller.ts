import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { Request } from "express";
import { CurrentMe, ProfileRequired, WriteAccess } from "../me/me-guards";
import type { CurrentMeInfo } from "../me/me-context";
import { DOC_MAX_BYTES } from "./sniff";
import { VerificationService } from "./verification.service";

/** Reads a request body as raw bytes, never more than DOC_MAX_BYTES. A JSON or form body was already parsed away: refused. */
async function readBytes(req: Request): Promise<Buffer> {
  const type = String(req.headers["content-type"] ?? "").toLowerCase();
  if (/json|x-www-form-urlencoded|multipart/.test(type))
    throw new UnsupportedMediaTypeException({
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Send the file itself as the body of the request.",
    });
  const declared = Number(req.headers["content-length"] ?? 0);
  const tooBig = () =>
    new PayloadTooLargeException({
      code: "PAYLOAD_TOO_LARGE",
      message: "That file is larger than 10 MB.",
    });
  if (declared > DOC_MAX_BYTES) throw tooBig();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array);
    total += b.length;
    if (total > DOC_MAX_BYTES) {
      req.resume();
      throw tooBig();
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

const WINDOW_MS = 10 * 60_000;
const hits = new Map<string, { n: number; resetAt: number }>();

/** At most N uploads per person per 10 minutes (VERIFICATION_UPLOADS_PER_10MIN, default 30). One API process (V-23): in memory. */
function limitUploads(userId: string): void {
  const max = Number(process.env.VERIFICATION_UPLOADS_PER_10MIN ?? 30);
  const now = Date.now();
  let w = hits.get(userId);
  if (!w || w.resetAt <= now) {
    w = { n: 0, resetAt: now + WINDOW_MS };
    hits.set(userId, w);
    if (hits.size > 5000)
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }
  w.n += 1;
  if (w.n > max)
    throw new HttpException(
      {
        code: "RATE_LIMITED",
        message: "Too many tries. Wait a moment and try again.",
      },
      429,
    );
}

/** V-46: the person's side of verification. */
@Controller("me/verification")
export class VerificationController {
  constructor(private readonly svc: VerificationService) {}

  @Get()
  @ProfileRequired()
  state(@CurrentMe() me: CurrentMeInfo) {
    return this.svc.state(me.id);
  }

  /** The body is the file. :kind is `id` (government ID) or `bill` (utility bill). */
  @Put("documents/:kind")
  @WriteAccess()
  async put(
    @CurrentMe() me: CurrentMeInfo,
    @Param("kind") kind: string,
    @Req() req: Request,
  ) {
    if (kind !== "id" && kind !== "bill")
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: { fields: [{ path: "kind", message: "Use id or bill." }] },
      });
    limitUploads(me.id);
    // The subscription is checked before the body is read, so a person without one is told at once.
    await this.svc.assertCanUpload(me.id);
    const body = await readBytes(req);
    return this.svc.putDocument(me.id, kind, body);
  }

  @Post("submit")
  @HttpCode(200)
  @WriteAccess()
  submit(@CurrentMe() me: CurrentMeInfo) {
    return this.svc.submit(me.id);
  }
}

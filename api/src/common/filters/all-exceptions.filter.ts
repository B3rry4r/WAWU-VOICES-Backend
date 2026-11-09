import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

/** The one error shape (docs/contract/CONVENTIONS.md, "Errors: one shape"). */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}

const CODE_BY_STATUS: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  402: "INSUFFICIENT_UNITS",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
  503: "UNAVAILABLE",
};

const MESSAGE_BY_STATUS: Record<number, string> = {
  400: "That request could not be read.",
  401: "Sign in to continue.",
  403: "You cannot do that.",
  404: "We could not find that.",
  409: "That conflicts with what is already saved.",
  413: "That is too large to send.",
  415: "That file type is not supported.",
  422: "Some details need fixing.",
  429: "Too many tries. Wait a moment and try again.",
  503: "VOICES is not available right now. Try again soon.",
};

interface Parsed {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

function prismaCode(e: unknown): string | undefined {
  const c = e as {
    code?: unknown;
    name?: unknown;
    clientVersion?: unknown;
  } | null;
  if (
    !c ||
    typeof c !== "object" ||
    typeof c.code !== "string" ||
    !/^P\d{4}$/.test(c.code)
  )
    return undefined;
  return typeof c.clientVersion === "string" ||
    (typeof c.name === "string" && c.name.startsWith("Prisma"))
    ? c.code
    : undefined;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { id?: string }>();
    const parsed = this.parse(exception);
    const requestId = req.id ?? String(res.getHeader("X-Request-Id") ?? "");
    const error: ApiErrorBody["error"] = {
      code: parsed.code,
      message: parsed.message,
      requestId,
    };
    let details = parsed.details;
    if (parsed.statusCode === 429) {
      const retry =
        Number(res.getHeader("Retry-After")) ||
        Number(
          (details as { retryAfterSeconds?: number } | undefined)
            ?.retryAfterSeconds,
        ) ||
        60;
      res.setHeader("Retry-After", String(retry));
      details = { ...details, retryAfterSeconds: retry };
    }
    if (details) error.details = details;
    res.status(parsed.statusCode).json({ error } satisfies ApiErrorBody);
  }

  private parse(exception: unknown): Parsed {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const raw = exception.getResponse();
      let message = MESSAGE_BY_STATUS[statusCode] ?? exception.message;
      let code: string | undefined;
      let details: Record<string, unknown> | undefined;
      if (typeof raw === "object" && raw !== null) {
        const r = raw as {
          message?: unknown;
          code?: unknown;
          details?: unknown;
        };
        if (typeof r.code === "string") code = r.code;
        // A message is shown to people only when a route set it with a code of its own.
        if (code && typeof r.message === "string") message = r.message;
        if (r.details && typeof r.details === "object")
          details = r.details as Record<string, unknown>;
      }
      return {
        statusCode,
        code: code ?? CODE_BY_STATUS[statusCode] ?? "INTERNAL",
        message,
        details,
      };
    }
    const p = prismaCode(exception);
    if (p === "P2002")
      return {
        statusCode: 409,
        code: "CONFLICT",
        message: MESSAGE_BY_STATUS[409],
      };
    if (p === "P2025")
      return {
        statusCode: 404,
        code: "NOT_FOUND",
        message: MESSAGE_BY_STATUS[404],
      };
    const e = exception as { status?: unknown; expose?: unknown } | null;
    if (
      e &&
      typeof e === "object" &&
      e.expose === true &&
      typeof e.status === "number" &&
      [400, 413, 415].includes(e.status)
    ) {
      return {
        statusCode: e.status,
        code: CODE_BY_STATUS[e.status],
        message: MESSAGE_BY_STATUS[e.status],
      };
    }
    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "INTERNAL",
      message: "Something went wrong on our side.",
    };
  }
}

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

/** The one error shape on every route. */
export interface ApiError {
  statusCode: number;
  message: string;
  code: string;
}

const CODE_BY_STATUS: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "unprocessable",
  429: "rate_limited",
};

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
    const res = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiError {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const raw = exception.getResponse();
      let message = exception.message;
      let code: string | undefined;
      if (typeof raw === "object" && raw !== null) {
        const r = raw as { message?: unknown; code?: unknown };
        if (Array.isArray(r.message)) message = r.message.join(" ");
        else if (typeof r.message === "string") message = r.message;
        if (typeof r.code === "string") code = r.code;
      } else if (typeof raw === "string") message = raw;
      return {
        statusCode,
        message,
        code: code ?? CODE_BY_STATUS[statusCode] ?? "error",
      };
    }
    const p = prismaCode(exception);
    if (p === "P2002")
      return {
        statusCode: 409,
        message: "That record already exists.",
        code: "conflict",
      };
    if (p === "P2025")
      return { statusCode: 404, message: "Not found.", code: "not_found" };
    const e = exception as {
      status?: unknown;
      statusCode?: unknown;
      expose?: unknown;
    } | null;
    if (
      e &&
      typeof e === "object" &&
      e.expose === true &&
      typeof e.status === "number" &&
      [400, 413, 415].includes(e.status)
    ) {
      return {
        statusCode: e.status,
        message: "That request could not be read.",
        code: CODE_BY_STATUS[e.status],
      };
    }
    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Something went wrong on our side.",
      code: "internal_error",
    };
  }
}

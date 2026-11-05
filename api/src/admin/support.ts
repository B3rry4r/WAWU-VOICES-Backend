import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";

export type Json = Record<string, unknown>;
export type Db = PrismaService | Prisma.TransactionClient;

export interface FieldIssue {
  path: string;
  message: string;
}

/** 422 VALIDATION_FAILED in the one error shape, with the fields that need fixing. */
export function invalid(...fields: FieldIssue[]): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: "VALIDATION_FAILED",
    message: "Some details need fixing.",
    details: { fields },
  });
}

export function notFound(what = "that"): NotFoundException {
  return new NotFoundException({
    code: "NOT_FOUND",
    message: `We could not find ${what}.`,
  });
}

export function conflict(message: string): ConflictException {
  return new ConflictException({ code: "CONFLICT", message });
}

// ---------------------------------------------------------------- Lagos calendar (V-14)

const DAY_MS = 86_400_000;
const LAGOS_OFFSET_MS = 3_600_000; // Africa/Lagos is UTC+1 all year

/** The Lagos calendar day of an instant, as YYYY-MM-DD. */
export function lagosDayString(now = new Date()): string {
  return new Date(now.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** A YYYY-MM-DD string as a UTC-midnight Date (how @db.Date columns are read and written). */
export function dateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** The instant a Lagos wall-clock time falls on: day "2026-11-30", hour 8, minute 0 is 07:00Z. */
export function lagosInstant(day: string, hour: number, minute = 0): Date {
  return new Date(
    dateOnly(day).getTime() + (hour * 60 + minute) * 60_000 - LAGOS_OFFSET_MS,
  );
}

export function isDateString(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = dateOnly(v);
  return !Number.isNaN(d.getTime()) && dayString(d) === v;
}

// ---------------------------------------------------------------- audit

export interface AuditEntryInput {
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Every admin write calls this inside its own transaction: who, what, before, after, when (CONVENTIONS.md, Admin). */
export async function writeAudit(db: Db, e: AuditEntryInput): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: e.actorId,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId ?? null,
      reason: e.reason ?? null,
      before: e.before ?? undefined,
      after: e.after ?? undefined,
    },
  });
}

/** Postgres unique violation (Prisma P2002) from any driver wrapper. */
export function isUnique(e: unknown): boolean {
  const c = (e as { code?: unknown } | null)?.code;
  return c === "P2002";
}

// ---------------------------------------------------------------- numeric cursor (calendar order)

const CURSOR_TTL_MS = 24 * 60 * 60 * 1000;

export function encodeNumCursor(n: number, now = new Date()): string {
  return Buffer.from(JSON.stringify({ n, iat: now.getTime() })).toString(
    "base64url",
  );
}

export function decodeNumCursor(
  raw: string | undefined,
  now = new Date(),
): number | null {
  if (!raw) return null;
  const bad = () =>
    new BadRequestException({
      code: "BAD_REQUEST",
      message: "That page link is no longer valid. Start again.",
    });
  try {
    const o = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      n?: unknown;
      iat?: unknown;
    };
    if (
      typeof o.n !== "number" ||
      !Number.isInteger(o.n) ||
      typeof o.iat !== "number" ||
      now.getTime() - o.iat > CURSOR_TTL_MS
    )
      throw bad();
    return o.n;
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw bad();
  }
}

/** The instant a Lagos day starts (00:00 Lagos = 23:00 UTC the evening before). */
export function lagosDayStart(day: string): Date {
  return lagosInstant(day, 0, 0);
}

/** The instant a Lagos day ends (exclusive): the start of the next Lagos day. */
export function lagosDayEnd(day: string): Date {
  return lagosDayStart(dayString(addDays(dateOnly(day), 1)));
}

/** Calendar lock: week and question writes that move dates happen one at a time. */
export const CALENDAR_LOCK = 7_141_002;

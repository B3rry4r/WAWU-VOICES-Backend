import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";

/** 422 VALIDATION_FAILED in the one error shape, for a rule the DTO cannot state. */
export function invalid(path: string, message: string) {
  return new UnprocessableEntityException({
    code: "VALIDATION_FAILED",
    message: "Some details need fixing.",
    details: { fields: [{ path, message }] },
  });
}

export function notFound(message = "We could not find that.") {
  return new NotFoundException({ code: "NOT_FOUND", message });
}

export function conflict(message: string) {
  return new ConflictException({ code: "CONFLICT", message });
}

/** Locks one row for the rest of the transaction, so two staff acting on the same row run one after the other. */
export async function lockRow(
  tx: Prisma.TransactionClient,
  table: "User" | "ModerationItem" | "Ad" | "Wallet" | "Payment" | "Answer",
  idColumn: "id" | "userId",
  id: string,
): Promise<void> {
  await tx.$queryRawUnsafe(
    `SELECT 1 FROM "${table}" WHERE "${idColumn}" = $1 FOR UPDATE`,
    id,
  );
}

/** Lagos calendar day as YYYY-MM-DD. */
export function lagosDay(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function dateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "13 Nov 2026" in Lagos time, for a notice that names the day a suspension ends (lead ruling WF, 6 Nov, C-M9). */
export function lagosLongDay(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** The one wording for a suspension notice: always "suspended", always with the end date (a ban has none). */
export function suspensionTitle(until: Date | null): string {
  return until
    ? `Your account is suspended until ${lagosLongDay(until)}`
    : "Your account is suspended";
}

/**
 * The notice rows that carry an "Appeal" action are keyed `modnotice-appealable:<ACTION>:<id>` (lead ruling WF, 6 Nov,
 * RW2). The list reads that key to say whether the notice can be appealed and whether an appeal is already sent.
 */
export const APPEALABLE_NOTICE = "modnotice-appealable:";

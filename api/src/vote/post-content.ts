import { HttpException } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { apiError, type Actor } from "./support";

function invalid(path: string, message: string): HttpException {
  return apiError(422, "VALIDATION_FAILED", "Some details need fixing.", {
    fields: [{ path, message }],
  });
}

export interface PostContent {
  kind: "TEXT" | "VOICE";
  body: string | null;
  clipId: string | null;
}

/** Text needs words inside the limit; a voice needs one of the person's own READY clips that nothing else uses. */
export async function checkContent(
  tx: Prisma.TransactionClient,
  actor: Actor,
  dto: { kind: "TEXT" | "VOICE"; body?: string; clipId?: string },
  maxChars: number,
  minChars: number,
): Promise<PostContent> {
  if (dto.kind === "TEXT") {
    const body = (dto.body ?? "").trim();
    if (dto.clipId) throw invalid("clipId", "A written post has no recording.");
    if (body.length < minChars)
      throw invalid("body", `Write at least ${minChars} characters.`);
    if (body.length > maxChars)
      throw invalid("body", `Keep it to ${maxChars} characters or fewer.`);
    return { kind: "TEXT", body, clipId: null };
  }
  if (!dto.clipId) throw invalid("clipId", "Add your recording.");
  const clip = await tx.voiceClip.findUnique({ where: { id: dto.clipId } });
  if (!clip || clip.ownerId !== actor.id || clip.removedAt)
    throw apiError(404, "CLIP_NOT_FOUND", "We could not find that recording.");
  if (clip.status !== "READY")
    throw apiError(409, "CLIP_NOT_READY", "Your recording is not ready yet.");
  // One query after another on the transaction (an include would load the three relations side by side).
  const used =
    (await tx.answer.findFirst({
      where: { clipId: clip.id },
      select: { id: true },
    })) ||
    (await tx.reply.findFirst({
      where: { clipId: clip.id },
      select: { id: true },
    })) ||
    (await tx.proposal.findFirst({
      where: { clipId: clip.id },
      select: { id: true },
    }));
  if (used)
    throw apiError(409, "CONFLICT", "That recording is already posted.");
  const body = (dto.body ?? "").trim();
  if (body.length > maxChars)
    throw invalid("body", `Keep it to ${maxChars} characters or fewer.`);
  if (clip.extraTokenId)
    await tx.extraVoiceToken.updateMany({
      where: {
        id: clip.extraTokenId,
        status: { in: ["RESERVED", "AVAILABLE"] },
      },
      data: { status: "USED", usedOnClipId: clip.id, usedAt: new Date() },
    });
  return { kind: "VOICE", body: body || null, clipId: clip.id };
}

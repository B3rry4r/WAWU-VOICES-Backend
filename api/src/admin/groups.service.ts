import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { markOf, personMarks } from "../common/people";
import { MailEvents } from "../mail/mail-events";
import { invalid, notFound, writeAudit, type Json } from "./support";

/** What Next? groups: a moderator confirms that several proposals say the same thing. */
@Injectable()
export class GroupsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly mails?: MailEvents,
  ) {}

  async confirm(
    actorId: string,
    title: string,
    proposalIds: string[],
  ): Promise<Json> {
    const groupId = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.proposal.findMany({
        where: { id: { in: proposalIds }, status: "PUBLISHED" },
        select: { id: true, questionId: true, groupId: true },
      });
      if (rows.length !== proposalIds.length)
        throw notFound("one of those proposals");
      const questions = new Set(rows.map((r) => r.questionId));
      if (questions.size !== 1)
        throw invalid({
          path: "proposalIds",
          message: "A group holds proposals for one question only.",
        });
      const group = await tx.proposalGroup.create({
        data: {
          questionId: rows[0].questionId,
          title,
          suggestedBy: actorId,
          confirmedById: actorId,
          confirmedAt: new Date(),
        },
      });
      await tx.proposal.updateMany({
        where: { id: { in: proposalIds } },
        data: { groupId: group.id },
      });
      // an old group left empty by the move is removed, so no empty group is ever listed
      const olds = [
        ...new Set(rows.map((r) => r.groupId).filter((g): g is string => !!g)),
      ];
      for (const g of olds) {
        const left = await tx.proposal.count({ where: { groupId: g } });
        if (left === 0) await tx.proposalGroup.delete({ where: { id: g } });
      }
      await writeAudit(tx, {
        actorId,
        action: "proposal_group.confirm",
        targetType: "ProposalGroup",
        targetId: group.id,
        before: {
          previousGroups: Object.fromEntries(
            rows.map((r) => [r.id, r.groupId]),
          ),
        },
        after: { title, questionId: rows[0].questionId, proposalIds },
      });
      return group.id;
    });
    // V-44 (M-b, B12): the authors of the grouped proposals hear once, after the commit.
    void this.groupMail(actorId, groupId, title, proposalIds);
    return this.out(groupId);
  }

  private async groupMail(
    actorId: string,
    groupId: string,
    title: string,
    proposalIds: string[],
  ): Promise<void> {
    if (!this.mails) return;
    try {
      const ps = await this.prisma.proposal.findMany({
        where: { id: { in: proposalIds } },
        select: { authorId: true, supportCount: true, questionId: true },
      });
      if (ps.length)
        await this.mails.grouped(actorId, groupId, title, ps[0].questionId, ps);
    } catch {
      // a mail never breaks the grouping
    }
  }

  private async out(id: string): Promise<Json> {
    const g = await this.prisma.proposalGroup.findUniqueOrThrow({
      where: { id },
    });
    const ps = await this.prisma.proposal.findMany({
      where: { groupId: id, status: "PUBLISHED" },
      include: {
        author: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            state: true,
            avatarFileId: true,
            status: true,
          },
        },
        clip: { include: { transcript: true } },
      },
      orderBy: [{ supportCount: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    const top = ps[0] ?? null;
    const pictures = await personMarks(this.prisma, top ? [top.author] : []);
    return {
      id: g.id,
      title: g.title,
      confirmed: g.confirmedAt !== null,
      proposalCount: ps.length,
      supportCount: ps.reduce((s, p) => s + p.supportCount, 0),
      challengeCount: ps.reduce((s, p) => s + p.challengeCount, 0),
      topProposal: top
        ? {
            id: top.id,
            questionId: top.questionId,
            author: {
              id: top.author.id,
              handle: top.author.handle,
              displayName: top.author.displayName,
              ...markOf(pictures, top.author.id),
              state: top.author.state,
            },
            kind: top.kind,
            body: top.body,
            clip: top.clip
              ? {
                  id: top.clip.id,
                  status: top.clip.status,
                  durationMs: top.clip.durationMs,
                  maxDurationMs: top.clip.maxDurationMs,
                  peaks: Array.isArray(top.clip.peaks)
                    ? (top.clip.peaks as number[])
                    : null,
                  transcript: top.clip.transcript
                    ? {
                        status: top.clip.transcript.status,
                        language: top.clip.transcript.language,
                        text: top.clip.transcript.text,
                      }
                    : null,
                }
              : null,
            label: "PROPOSED",
            supportCount: top.supportCount,
            challengeCount: top.challengeCount,
            improveCount: top.improveCount,
            groupId: top.groupId,
            improvesId: top.improvesId,
            myStance: null,
            createdAt: top.createdAt.toISOString(),
            isMine: false,
          }
        : null,
    };
  }
}

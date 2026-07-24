import { prisma } from "@/lib/prisma";

type LogInput = {
  issueId?: string | null;
  actorId?: string | null;
  verb: string;
  field?: string;
  fromVal?: string | null;
  toVal?: string | null;
  meta?: unknown;
};

/** Append an immutable activity/audit record. */
export async function logActivity(input: LogInput) {
  return prisma.activity.create({
    data: {
      issueId: input.issueId ?? undefined,
      actorId: input.actorId ?? undefined,
      verb: input.verb,
      field: input.field,
      fromVal: input.fromVal ?? undefined,
      toVal: input.toVal ?? undefined,
      metaJson: input.meta ? JSON.stringify(input.meta) : "",
    },
  });
}

import { z } from "zod";

const timestamp = z.iso.datetime({ offset: true });

export const sessionSchema = z
  .object({
    id: z.uuid(),
    localDate: z.iso.date(),
    startedAt: timestamp,
    endedAt: timestamp,
    plannedMin: z.number().int().min(1).max(600).nullable(),
    focusedMs: z.number().int().min(0),
    outcome: z.enum(["completed", "abandoned"]),
    reason: z.string().min(1).max(500).optional(),
    pauses: z.array(z.object({ from: timestamp, to: timestamp })).max(10_000),
    blocks: z
      .array(z.object({ app: z.string().min(1).max(100), at: timestamp, killed: z.boolean() }))
      .max(200_000),
  })
  .refine((s) => s.outcome !== "abandoned" || s.reason !== undefined, {
    message: "reason is required when a session is abandoned",
    path: ["reason"],
  });

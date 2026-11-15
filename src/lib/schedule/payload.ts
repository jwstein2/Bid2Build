import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
/** Client-side id for a task that isn't saved yet. */
export const NEW_ID = /^new-[A-Za-z0-9-]{1,40}$/;
const taskId = z.union([uuid, z.string().regex(NEW_ID)]);

export const calendarSchema = z.object({
  workdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  holidays: z.array(day).max(366).default([]),
  timezone: z.string().min(1).max(64),
});

export const createSchema = z.object({
  estimateId: uuid,
  provisional: z.boolean().default(false),
  name: z.string().max(300).optional(),
  calendar: calendarSchema,
  startDate: day,
  targetEndDate: day.nullable().optional(),
  sections: z.array(z.object({ sourceGroupId: uuid, durationDays: z.number().int().min(1).max(3650), sortOrder: z.number().int().min(0).max(10_000) })).min(1).max(300),
  deps: z.array(z.object({ from: uuid, to: uuid, lagDays: z.number().int().min(-365).max(365), maxOverlap: z.number().int().min(0).max(365) })).max(1000).default([]),
});

export const taskSchema = z.object({
  id: taskId,
  parentId: taskId.nullable(),
  kind: z.enum(["section", "item"]),
  sourceGroupId: uuid,
  sourceItemId: uuid.nullable(),
  splitFrom: taskId.nullable(),
  name: z.string().max(300),
  sortOrder: z.number().int().min(0).max(100_000),
  plannedStart: day,
  plannedEnd: day,
  durationDays: z.number().int().min(1).max(3650),
  actualStart: day.nullable(),
  actualFinish: day.nullable(),
  percentComplete: z.number().min(0).max(100),
  status: z.enum(["not_started", "in_progress", "complete", "delayed", "on_hold"]),
  weight: z.number().positive().max(1_000_000).nullable(),
  assignee: z.string().max(200).nullable(),
  notes: z.string().max(4000).nullable(),
});

export const saveSchema = z.object({
  baseRevision: z.number().int().min(1),
  summary: z.string().min(1).max(500),
  tasks: z.array(taskSchema).max(2000),
  deps: z.array(z.object({ from: taskId, to: taskId, lagDays: z.number().int().min(-365).max(365), maxOverlap: z.number().int().min(0).max(365) })).max(4000),
  schedule: z.object({
    name: z.string().min(1).max(300).optional(),
    status: z.enum(["draft", "active", "completed", "archived"]).optional(),
    calendar: calendarSchema.optional(),
    targetEndDate: day.nullable().optional(),
    progressMethod: z.enum(["duration", "weight"]).optional(),
  }).optional(),
});
export type SaveBody = z.infer<typeof saveSchema>;

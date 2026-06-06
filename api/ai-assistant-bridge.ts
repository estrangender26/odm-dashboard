import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { odmTalkMessages, odmTalkNotifications, odmTalkThreads } from "@db/schema";
import { db } from "./queries/connection";

export const ODM_TALK_THREAD_TYPES = [
  "General Discussion",
  "Maintenance Recommendation",
  "KPI Insight",
  "Risk Review",
  "Action Tracking",
  "Ownership Review",
  "Post-PPP Decision",
  "Gantt Coordination",
  "Manual Governance Review",
] as const;

export const ODM_TALK_SHARE_TYPES = [
  "AI recommendation",
  "AI summary",
  "AI-generated action items",
  "Risk",
  "Decision",
  "Maintenance recommendation",
  "Ownership recommendation",
  "KPI insight",
] as const;

export const odmTalkThreadTypeSchema = z.enum(ODM_TALK_THREAD_TYPES);
export const odmTalkShareTypeSchema = z.enum(ODM_TALK_SHARE_TYPES);

export const sourceModuleSchema = z.enum([
  "Maintenance Planning",
  "Post-PPP Planning",
  "Monthly KPI Scorecard",
  "O&M Manual Governance",
  "Gantt Charts",
  "Existing Facilities Maintenance Plans",
  "Standard Maintenance Procedures",
  "Inspection Findings",
  "Help",
]);

export type OdmTalkThreadType = (typeof ODM_TALK_THREAD_TYPES)[number];
export type OdmTalkShareType = (typeof ODM_TALK_SHARE_TYPES)[number];

export type OdmTalkSource = {
  sourceModule: z.infer<typeof sourceModuleSchema>;
  sourcePage: string;
  sourceRecordId: string;
  sourceRecordLabel?: string;
  sourceUrl: string;
  assistantName: string;
  userId?: string;
};

export type OdmTalkBridgePayload = OdmTalkSource & {
  threadId?: number;
  title?: string;
  content: string;
  threadType?: OdmTalkThreadType;
  shareType?: OdmTalkShareType;
};

export const odmTalkSourceInputSchema = z.object({
  sourceModule: sourceModuleSchema,
  sourcePage: z.string().min(1).max(255),
  sourceRecordId: z.string().min(1).max(255),
  sourceRecordLabel: z.string().max(500).optional(),
  sourceUrl: z.string().min(1).max(1000).refine(
    (value) => value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\"),
    { message: "sourceUrl must be an internal app path" },
  ),
  assistantName: z.string().min(1).max(255),
  userId: z.string().max(255).optional(),
});

export const odmTalkBridgeInputSchema = odmTalkSourceInputSchema.extend({
  threadId: z.number().int().positive().optional(),
  title: z.string().max(500).optional(),
  content: z.string().min(1).max(12000),
  threadType: odmTalkThreadTypeSchema.default("General Discussion"),
  shareType: odmTalkShareTypeSchema.default("AI summary"),
});

let odmTalkTablesInitialization: Promise<void> | null = null;

export async function ensureOdmTalkTables() {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS odm_talk_threads (
      id SERIAL PRIMARY KEY,
      title VARCHAR(500) NOT NULL,
      thread_type VARCHAR(100) NOT NULL DEFAULT 'General Discussion',
      source_module VARCHAR(150) NOT NULL,
      source_page VARCHAR(255) NOT NULL,
      source_record_id VARCHAR(255) NOT NULL,
      source_record_label VARCHAR(500),
      source_url TEXT NOT NULL,
      assistant_name VARCHAR(255) NOT NULL,
      user_id VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT 'open',
      requires_approval INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `));
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS odm_talk_messages (
      id SERIAL PRIMARY KEY,
      thread_id INTEGER NOT NULL REFERENCES odm_talk_threads(id),
      role VARCHAR(50) NOT NULL DEFAULT 'assistant',
      content TEXT NOT NULL,
      share_type VARCHAR(100) NOT NULL DEFAULT 'AI summary',
      is_ai_generated INTEGER NOT NULL DEFAULT 1,
      source_module VARCHAR(150) NOT NULL,
      source_page VARCHAR(255) NOT NULL,
      source_record_id VARCHAR(255) NOT NULL,
      source_record_label VARCHAR(500),
      source_url TEXT NOT NULL,
      assistant_name VARCHAR(255) NOT NULL,
      user_id VARCHAR(255),
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `));
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS odm_talk_notifications (
      id SERIAL PRIMARY KEY,
      thread_id INTEGER NOT NULL REFERENCES odm_talk_threads(id),
      message_id INTEGER REFERENCES odm_talk_messages(id),
      notification_type VARCHAR(100) NOT NULL,
      title VARCHAR(500) NOT NULL,
      body TEXT,
      user_id VARCHAR(255),
      read_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS odm_talk_threads_source_idx ON odm_talk_threads(source_module, source_record_id)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS odm_talk_threads_type_idx ON odm_talk_threads(thread_type)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS odm_talk_messages_thread_idx ON odm_talk_messages(thread_id)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS odm_talk_messages_source_idx ON odm_talk_messages(source_module, source_record_id)`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS odm_talk_messages_share_idx ON odm_talk_messages(share_type)`));
}

export async function ensureOdmTalkTablesOnce() {
  if (!odmTalkTablesInitialization) {
    odmTalkTablesInitialization = ensureOdmTalkTables().catch((error) => {
      odmTalkTablesInitialization = null;
      throw error;
    });
  }
  return odmTalkTablesInitialization;
}

export function requiresApprovalForThreadType(threadType?: string) {
  return (threadType || "").includes("Decision") ? 1 : 0;
}

function defaultThreadTitle(input: OdmTalkBridgePayload) {
  const record = input.sourceRecordLabel || input.sourceRecordId;
  return `${input.threadType || "General Discussion"}: ${record}`;
}

function notificationFor(input: OdmTalkBridgePayload, threadId: number, messageId: number) {
  if ((input.threadType || "").includes("Decision")) {
    return {
      threadId,
      messageId,
      notificationType: "discussion_requires_approval",
      title: "ODM Talk decision thread requires approval",
      body: `${input.assistantName} opened or updated a decision discussion for ${input.sourceModule}.`,
      userId: input.userId || null,
    };
  }
  if ((input.shareType || "").includes("action")) {
    return {
      threadId,
      messageId,
      notificationType: "assistant_action_item",
      title: "Assistant added ODM Talk action items",
      body: `${input.assistantName} shared action items from ${input.sourceModule}.`,
      userId: input.userId || null,
    };
  }
  return {
    threadId,
    messageId,
    notificationType: "assistant_contribution",
    title: "Assistant contributed to ODM Talk",
    body: `${input.assistantName} shared ${input.shareType || "AI output"} from ${input.sourceModule}.`,
    userId: input.userId || null,
  };
}

export async function postAssistantBridgeMessage(input: OdmTalkBridgePayload) {
  await ensureOdmTalkTablesOnce();

  return db.transaction(async (tx) => {
    let threadId = input.threadId;
    if (!threadId) {
      const inserted = await tx.insert(odmTalkThreads).values({
        title: input.title || defaultThreadTitle(input),
        threadType: input.threadType || "General Discussion",
        sourceModule: input.sourceModule,
        sourcePage: input.sourcePage,
        sourceRecordId: input.sourceRecordId,
        sourceRecordLabel: input.sourceRecordLabel || null,
        sourceUrl: input.sourceUrl,
        assistantName: input.assistantName,
        userId: input.userId || null,
        requiresApproval: requiresApprovalForThreadType(input.threadType),
      }).returning({ id: odmTalkThreads.id });
      threadId = inserted[0].id;
    }

    const messageRows = await tx.insert(odmTalkMessages).values({
      threadId,
      role: "assistant",
      content: input.content,
      shareType: input.shareType || "AI summary",
      isAiGenerated: 1,
      sourceModule: input.sourceModule,
      sourcePage: input.sourcePage,
      sourceRecordId: input.sourceRecordId,
      sourceRecordLabel: input.sourceRecordLabel || null,
      sourceUrl: input.sourceUrl,
      assistantName: input.assistantName,
      userId: input.userId || null,
      metadata: {
        aiGenerated: true,
        threadType: input.threadType || "General Discussion",
        createdByBridge: "aiAssistantBridge",
      },
    }).returning({ id: odmTalkMessages.id });

    await tx.update(odmTalkThreads).set({ updatedAt: new Date() }).where(eq(odmTalkThreads.id, threadId));

    const notification = notificationFor(input, threadId, messageRows[0].id);
    await tx.insert(odmTalkNotifications).values(notification);

    return { threadId, messageId: messageRows[0].id };
  });
}

export async function getRelatedOdmTalkThreads(source: Pick<OdmTalkSource, "sourceModule" | "sourceRecordId">) {
  await ensureOdmTalkTablesOnce();
  return db.select().from(odmTalkThreads)
    .where(and(eq(odmTalkThreads.sourceModule, source.sourceModule), eq(odmTalkThreads.sourceRecordId, source.sourceRecordId)))
    .orderBy(desc(odmTalkThreads.updatedAt))
    .limit(10);
}

export async function searchOdmTalk(query: string) {
  await ensureOdmTalkTablesOnce();
  const q = `%${query}%`;
  return db.select({ thread: odmTalkThreads, message: odmTalkMessages }).from(odmTalkMessages)
    .innerJoin(odmTalkThreads, eq(odmTalkMessages.threadId, odmTalkThreads.id))
    .where(or(
      ilike(odmTalkThreads.title, q),
      ilike(odmTalkMessages.content, q),
      ilike(odmTalkMessages.shareType, q),
      ilike(odmTalkThreads.sourceModule, q),
      ilike(odmTalkThreads.sourceRecordId, q),
      ilike(odmTalkThreads.sourceRecordLabel, q)
    ))
    .orderBy(desc(odmTalkMessages.createdAt))
    .limit(50);
}

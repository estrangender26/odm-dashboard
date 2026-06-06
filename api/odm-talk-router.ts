import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { odmTalkMessages, odmTalkNotifications, odmTalkThreads } from "@db/schema";
import { createRouter, publicQuery } from "./middleware";
import {
  ensureOdmTalkTables,
  getRelatedOdmTalkThreads,
  odmTalkBridgeInputSchema,
  odmTalkSourceInputSchema,
  ODM_TALK_SHARE_TYPES,
  ODM_TALK_THREAD_TYPES,
  postAssistantBridgeMessage,
  searchOdmTalk,
} from "./ai-assistant-bridge";
import { db } from "./queries/connection";

export const odmTalkRouter = createRouter({
  threadTypes: publicQuery.query(() => ODM_TALK_THREAD_TYPES),
  shareTypes: publicQuery.query(() => ODM_TALK_SHARE_TYPES),

  createThread: publicQuery
    .input(odmTalkBridgeInputSchema)
    .mutation(async ({ input, ctx }) => {
      return postAssistantBridgeMessage({
        ...input,
        userId: input.userId || ctx.user?.id?.toString(),
      });
    }),

  postToThread: publicQuery
    .input(odmTalkBridgeInputSchema.extend({ threadId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      return postAssistantBridgeMessage({
        ...input,
        userId: input.userId || ctx.user?.id?.toString(),
      });
    }),

  related: publicQuery
    .input(odmTalkSourceInputSchema.pick({ sourceModule: true, sourceRecordId: true }))
    .query(async ({ input }) => getRelatedOdmTalkThreads(input)),

  listThreads: publicQuery
    .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional())
    .query(async ({ input }) => {
      await ensureOdmTalkTables();
      return db.select().from(odmTalkThreads).orderBy(desc(odmTalkThreads.updatedAt)).limit(input?.limit || 25);
    }),

  getThread: publicQuery
    .input(z.object({ threadId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await ensureOdmTalkTables();
      const [thread] = await db.select().from(odmTalkThreads).where(eq(odmTalkThreads.id, input.threadId)).limit(1);
      const messages = await db.select().from(odmTalkMessages)
        .where(eq(odmTalkMessages.threadId, input.threadId))
        .orderBy(odmTalkMessages.createdAt);
      return { thread: thread || null, messages };
    }),

  search: publicQuery
    .input(z.object({ query: z.string().min(1).max(255) }))
    .query(async ({ input }) => searchOdmTalk(input.query)),

  notifications: publicQuery
    .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional())
    .query(async ({ input, ctx }) => {
      await ensureOdmTalkTables();
      const userId = ctx.user?.id?.toString();
      const rows = await db.select().from(odmTalkNotifications)
        .where(userId ? eq(odmTalkNotifications.userId, userId) : undefined)
        .orderBy(desc(odmTalkNotifications.createdAt))
        .limit(input?.limit || 25);
      return rows;
    }),
});

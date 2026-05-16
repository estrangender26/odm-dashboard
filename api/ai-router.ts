import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";

const SYSTEM_PROMPT = `You are a senior maintenance and reliability engineering advisor for water and wastewater facilities. You help users analyze maintenance issues, inspection findings, preventive maintenance plans, O&M documentation, SAP PM/CMMS workflows, maintenance KPIs, vendor scoping, and operational risks. Give practical, field-oriented, concise recommendations. Ask clarifying questions only when essential.`;

export const aiRouter = createRouter({
  /* ── Maintenance Expert Chat ── */
  maintenanceChat: publicQuery
    .input(
      z.object({
        message: z.string().min(1).max(4000),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
            })
          )
          .max(20)
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return {
          reply: "AI service is not configured. Please set OPENAI_API_KEY environment variable.",
          error: "MISSING_API_KEY",
        };
      }

      const messages = [
        { role: "system" as const, content: SYSTEM_PROMPT },
        ...(input.history || []).map((h) => ({
          role: h.role as "user" | "assistant",
          content: h.content,
        })),
        { role: "user" as const, content: input.message },
      ];

      try {
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: process.env.AI_MODEL || "gpt-4o-mini",
            messages,
            temperature: 0.7,
            max_tokens: 1500,
          }),
        });

        if (!resp.ok) {
          const err = await resp.text();
          console.error("OpenAI error:", err);
          return {
            reply: "AI service temporarily unavailable. Please try again later.",
            error: "API_ERROR",
          };
        }

        const data = (await resp.json()) as any;
        const reply = data.choices?.[0]?.message?.content?.trim() || "No response from AI.";
        return { reply, error: null };
      } catch (e: any) {
        console.error("AI chat error:", e);
        return {
          reply: "Connection error. Please check your network and try again.",
          error: "NETWORK_ERROR",
        };
      }
    }),
});

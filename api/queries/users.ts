import { eq, and, isNull, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import type { User } from "@db/schema";
import { db } from "./connection";
import { env } from "../lib/env";

export type ProviderIdentityInput = {
  provider: string;
  subject: string;
  name: string;
  email: string;
  avatar?: string | null;
  lastSignInAt: Date;
};

export async function findUserByAuthSubject(provider: string, subject: string) {
  const rows = await db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.authProvider, provider),
        eq(schema.users.authSubject, subject),
      ),
    )
    .limit(1);
  return rows.at(0);
}

/**
 * Server-side OWNER check: the immutable provider subject is compared against
 * the configured OWNER identity. This is the ONLY way a user becomes admin —
 * the frontend cannot influence it.
 */
export function isConfiguredOwner(provider: string, subject: string): boolean {
  return (
    provider === "google" &&
    Boolean(env.ownerGoogleSub) &&
    subject === env.ownerGoogleSub
  );
}

/**
 * Finds the legacy OWNER row created before provider identity columns existed
 * (role=admin, no auth_provider/auth_subject yet — e.g. the production OWNER
 * row from the Kimi era). Used for deterministic first-login reconciliation so
 * the existing OWNER account is updated in place instead of duplicated.
 */
async function findLegacyAdminRow(): Promise<schema.User | undefined> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.role, "admin"),
        isNull(schema.users.authProvider),
        isNull(schema.users.authSubject),
      ),
    )
    .orderBy(schema.users.id)
    .limit(1);
  return rows.at(0);
}

/**
 * Creates or updates the user identified by (provider, subject) and returns
 * the row. OWNER/admin assignment is computed here from the verified provider
 * subject ONLY. Reconciliation rules:
 *  - OWNER first login: if no (provider, subject) row exists but a legacy
 *    role=admin row exists (no provider columns), that row is updated in place
 *    with the new identity — the existing OWNER account is preserved, no
 *    duplicate is created.
 *  - Non-owner logins: (provider, subject) row is upserted with role "user".
 *  - An existing admin row is never downgraded by a later login.
 */
export async function upsertUserByProvider(
  input: ProviderIdentityInput,
): Promise<User | undefined> {
  const { provider, subject, name, email, avatar, lastSignInAt } = input;
  const isOwner = isConfiguredOwner(provider, subject);
  const desiredRole = isOwner ? "admin" : "user";

  const existing = await findUserByAuthSubject(provider, subject);

  if (!existing && isOwner) {
    // First login of the configured OWNER via a provider. Reconcile with any
    // legacy admin row so the existing production OWNER account is preserved.
    const legacy = await findLegacyAdminRow();
    if (legacy) {
      const rows = await db
        .update(schema.users)
        .set({
          authProvider: provider,
          authSubject: subject,
          name,
          email,
          avatar: avatar ?? null,
          role: "admin",
          lastSignInAt,
        })
        .where(eq(schema.users.id, legacy.id))
        .returning();
      return rows.at(0);
    }
  }

  const rows = await db
    .insert(schema.users)
    .values({
      authProvider: provider,
      authSubject: subject,
      name,
      email,
      avatar: avatar ?? null,
      role: desiredRole,
      lastSignInAt,
    })
    .onConflictDoUpdate({
      target: [schema.users.authProvider, schema.users.authSubject],
      targetWhere: and(
        sql`${schema.users.authProvider} IS NOT NULL`,
        sql`${schema.users.authSubject} IS NOT NULL`,
      ),
      set: {
        name,
        email,
        avatar: avatar ?? null,
        // Never downgrade an existing admin row; preserve server-assigned role.
        role: sql`CASE WHEN ${schema.users.role} = 'admin' THEN 'admin' ELSE ${desiredRole} END`,
        lastSignInAt,
      },
    })
    .returning();
  return rows.at(0);
}

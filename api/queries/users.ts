import { eq, and, isNull, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import type { User } from "@db/schema";
import { db } from "./connection";
import { env } from "../lib/env";

export type ProviderIdentityInput = {
  provider: string;
  subject: string;
  name: string;
  /** Verified provider email (null when the provider did not verify it). */
  email: string | null;
  emailVerified: boolean | null;
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
 * Server-side OWNER check by immutable provider subject. When OWNER_GOOGLE_SUB
 * is configured it is the SOLE first-login authority (email bootstrap is
 * disabled while it is set). When it is unset, first-login bootstrap uses the
 * verified OWNER_GOOGLE_EMAIL (see emailBootstrapEligible). The frontend
 * cannot influence either path.
 */
export function isConfiguredOwner(provider: string, subject: string): boolean {
  return (
    provider === "google" &&
    Boolean(env.ownerGoogleSub) &&
    subject === env.ownerGoogleSub
  );
}

/**
 * One-time OWNER bootstrap eligibility via a VERIFIED provider email. Used
 * only when OWNER_GOOGLE_SUB is not configured, only for reconciling the
 * existing legacy OWNER row, and only while that row still has no provider
 * identity attached. An unverified email can never claim the OWNER row.
 */
export function emailBootstrapEligible(input: ProviderIdentityInput): boolean {
  return (
    input.provider === "google" &&
    Boolean(env.ownerGoogleEmail) &&
    input.emailVerified === true &&
    input.email === env.ownerGoogleEmail
  );
}

/**
 * All legacy OWNER rows: role=admin with no provider identity attached yet
 * (e.g. the Kimi-era production OWNER row). Returns every match so callers
 * can detect ambiguity instead of arbitrarily picking one.
 */
async function findLegacyAdminRows(): Promise<schema.User[]> {
  return db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.role, "admin"),
        isNull(schema.users.authProvider),
        isNull(schema.users.authSubject),
      ),
    )
    .orderBy(schema.users.id);
}

/** The admin row already bound to this provider, if any. */
async function findAdminRowByProvider(provider: string): Promise<schema.User | undefined> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.role, "admin"),
        eq(schema.users.authProvider, provider),
      ),
    )
    .orderBy(schema.users.id)
    .limit(1);
  return rows.at(0);
}

function displayEmail(input: ProviderIdentityInput): string {
  return input.emailVerified && input.email
    ? input.email
    : `${input.subject}@${input.provider}.placeholder.local`;
}

/**
 * Creates or updates the user identified by (provider, subject) and returns
 * the row. OWNER/admin assignment is computed here from the verified provider
 * identity ONLY. Rules:
 *
 * 1. Existing (provider, subject) row — normal path: display fields update;
 *    an existing admin role is never downgraded.
 * 2. No existing row + OWNER_GOOGLE_SUB configured + subject matches —
 *    the row is created with role=admin (fresh-environment path).
 * 3. No existing row + OWNER_GOOGLE_SUB NOT configured + verified email
 *    exactly matches OWNER_GOOGLE_EMAIL + exactly ONE legacy role=admin row
 *    exists (no provider identity) — that legacy row is reconciled IN PLACE
 *    (auth_provider/auth_subject stamped, role=admin retained, display fields
 *    updated). No new row is created. This is the safe one-time bootstrap.
 * 4. Ambiguity / conflict FAILS CLOSED (throws, no row mutated):
 *    - more than one legacy admin row exists while a claim is attempted;
 *    - an ordinary Google row with this identity already exists (accidental
 *      pre-bootstrap row) while a legacy admin row is still unclaimed;
 *    - OWNER_GOOGLE_SUB is configured to a different subject than the
 *      already-persisted OWNER identity.
 * 5. Any other login (non-matching email, unverified email, non-owner) gets
 *    a normal role=user row and never touches a legacy admin row.
 */
export async function upsertUserByProvider(
  input: ProviderIdentityInput,
): Promise<User | undefined> {
  const { provider, subject, name, avatar, lastSignInAt } = input;
  const email = displayEmail(input);
  const isOwnerBySub = isConfiguredOwner(provider, subject);
  const emailBootstrap = !env.ownerGoogleSub && emailBootstrapEligible(input);
  const desiredRole = isOwnerBySub ? "admin" : "user";

  const existing = await findUserByAuthSubject(provider, subject);

  if (existing) {
    // Normal path (including the OWNER's second+ login). If the existing row
    // is an accidental pre-bootstrap role=user row while a legacy admin row is
    // still unclaimed, fail closed instead of silently merging/promoting.
    if (
      existing.role !== "admin" &&
      emailBootstrap &&
      !isOwnerBySub
    ) {
      const legacy = await findLegacyAdminRows();
      if (legacy.length === 1) {
        throw new Error(
          `[auth] OWNER bootstrap conflict: an ordinary Google row (${provider}:${subject}) already exists while the legacy admin row (id=${legacy[0].id}) is still unclaimed. Refusing to merge or delete rows automatically; reconcile manually or configure OWNER_GOOGLE_SUB.`,
        );
      }
    }
    // Effective role: an existing admin is never downgraded; a subject-matched
    // OWNER (e.g. an accidental pre-bootstrap row) is promoted in place.
    const effectiveRole =
      existing.role === "admin" || isOwnerBySub ? "admin" : "user";
    const rows = await db
      .update(schema.users)
      .set({
        name,
        email,
        avatar: avatar ?? null,
        role: effectiveRole,
        lastSignInAt,
      })
      .where(
        and(
          eq(schema.users.authProvider, provider),
          eq(schema.users.authSubject, subject),
        ),
      )
      .returning();
    return rows.at(0);
  }

  // No (provider, subject) row exists yet.
  const legacy = await findLegacyAdminRows();

  const claimingOwner = isOwnerBySub || emailBootstrap;
  if (claimingOwner && legacy.length > 1) {
    // Ambiguous legacy OWNER rows — fail closed rather than picking one.
    throw new Error(
      `[auth] OWNER bootstrap ambiguity: ${legacy.length} legacy role=admin rows have no provider identity (ids=${legacy.map((r) => r.id).join(",")}). Refusing to choose one; reconcile manually.`,
    );
  }

  if (claimingOwner && legacy.length === 1) {
    // Safe one-time bootstrap (subject path or verified-email path): reconcile
    // the single legacy admin row IN PLACE. No duplicate is created.
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
      .where(eq(schema.users.id, legacy[0].id))
      .returning();
    const row = rows.at(0);
    if (row) {
      console.info(
        `[auth] OWNER first-login bootstrap: reconciled legacy admin row id=${row.id} with ${provider} subject ${subject}`,
      );
    }
    return row;
  }

  // New row (ordinary user, or a fresh-environment admin via OWNER_GOOGLE_SUB).
  if (desiredRole === "admin") {
    // Hardening: never create a second admin row for a provider that already
    // has one with a DIFFERENT subject (e.g. OWNER_GOOGLE_SUB misconfigured
    // after an email bootstrap persisted a different subject).
    const existingOwner = await findAdminRowByProvider(provider);
    if (existingOwner && existingOwner.authSubject !== subject) {
      throw new Error(
        `[auth] OWNER identity conflict: provider ${provider} already has admin row id=${existingOwner.id} with subject ${existingOwner.authSubject}; OWNER_GOOGLE_SUB (${subject}) does not match. Refusing to create a duplicate admin.`,
      );
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

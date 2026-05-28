import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import type { InsertUser } from "@db/schema";
import { db } from "./connection";
import { env } from "../lib/env";

export async function findUserByUnionId(unionId: string) {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.unionId, unionId))
    .limit(1);
  return rows.at(0);
}

export async function upsertUser(data: InsertUser) {
  const values = { ...data };
  const updateSet: Partial<InsertUser> = {
    lastSignInAt: new Date(),
    ...data,
  };

  if (
    values.role === undefined &&
    values.unionId &&
    values.unionId === env.ownerUnionId
  ) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  const result = await db.execute(sql`
    INSERT INTO users (union_id, name, avatar, role, last_sign_in_at)
    VALUES (
      ${values.unionId},
      ${values.name ?? null},
      ${values.avatar ?? null},
      ${values.role ?? null},
      ${values.lastSignInAt ?? null}
    )
    ON CONFLICT (union_id)
    DO UPDATE SET
      name = ${updateSet.name ?? null},
      avatar = ${updateSet.avatar ?? null},
      role = ${updateSet.role ?? null},
      last_sign_in_at = ${updateSet.lastSignInAt ?? null}
    RETURNING *
  `);

  return result.rows.at(0);
}

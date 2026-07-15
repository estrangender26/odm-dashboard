import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { docFolders } from "../db/schema";

describe("doc_folders schema", () => {
  it("resolves the parent folder foreign key back to doc_folders.id", () => {
    const config = getTableConfig(docFolders);
    const parentForeignKey = config.foreignKeys.find((foreignKey) =>
      foreignKey.reference().columns.includes(docFolders.parentId),
    );

    expect(parentForeignKey).toBeDefined();
    const reference = parentForeignKey!.reference();
    expect(reference.foreignTable).toBe(docFolders);
    expect(reference.foreignColumns).toEqual([docFolders.id]);
  });
});

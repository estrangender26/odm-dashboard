import { describe, expect, it } from "vitest";
import { getPostgresOptions } from "./connection";

describe("postgres.js connection configuration", () => {
  it("sends the 15 second statement timeout as a postgres.js startup connection parameter", () => {
    const options = getPostgresOptions("require");

    expect(options).not.toHaveProperty("statement_timeout");
    expect(options.connection).toMatchObject({ statement_timeout: 15000 });
    expect(options.max).toBe(10);
    expect(options.ssl).toBe("require");
  });

  it("preserves disabled SSL behavior", () => {
    expect(getPostgresOptions("disable").ssl).toBe(false);
  });
});

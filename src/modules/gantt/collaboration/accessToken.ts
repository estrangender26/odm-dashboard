/**
 * accessToken.ts — cryptographically random share tokens for ODM Primavera Lite
 *
 * Tokens are long, unguessable, and stored only as SHA-256 hashes.
 * The plaintext token is shown once to the project owner and then discarded.
 */

const TOKEN_BYTES = 32;

export type AccessRole = "editor" | "viewer";

export interface ShareTokens {
  editorToken: string;
  editorHash: string;
  viewToken: string;
  viewHash: string;
}

/** Generate a URL-safe random token and its SHA-256 hash. */
export async function generateTokenWithHash(): Promise<{
  plaintext: string;
  hash: string;
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  const plaintext = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hash = await sha256Hex(plaintext);
  return { plaintext, hash };
}

/** Generate a fresh editor + view token pair. */
export async function generateShareTokens(): Promise<ShareTokens> {
  const [editor, view] = await Promise.all([
    generateTokenWithHash(),
    generateTokenWithHash(),
  ]);
  return {
    editorToken: editor.plaintext,
    editorHash: editor.hash,
    viewToken: view.plaintext,
    viewHash: view.hash,
  };
}

/** Hash a supplied plaintext token for comparison. */
export async function hashToken(plaintext: string): Promise<string> {
  return sha256Hex(plaintext);
}

function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  return crypto.subtle
    .digest("SHA-256", encoder.encode(input))
    .then((buf) =>
      Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    );
}

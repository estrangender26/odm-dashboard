import { describe, expect, it, vi, beforeEach } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
}));

vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-secret");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");
vi.stubEnv("SUPABASE_URL", "https://project-ref.supabase.co");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
vi.stubEnv("SUPABASE_STORAGE_URL", "https://project-ref.storage.supabase.co");

vi.mock("./auth/authenticate", () => ({
  authenticateRequest: (...args: any[]) => mocks.authenticateRequest(...args),
}));

import app from "./boot";

async function buildPdfBuffer(lines: string[]): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  let y = 750;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 10, font });
    y -= 14;
  }
  return Buffer.from(await pdfDoc.save());
}

function makeMultipartBody(buffer: Buffer, filename: string, mimeType: string): { body: Blob; headers: Record<string, string> } {
  const boundary = "----testBoundary";
  const preamble = `------testBoundary\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const postscript = "\r\n------testBoundary--\r\n";
  const combined = Buffer.concat([Buffer.from(preamble, "binary"), buffer, Buffer.from(postscript, "binary")]);
  return {
    body: new Blob([combined], { type: `multipart/form-data; boundary=${boundary}` }),
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
  };
}

async function postExtract(file: File | { buffer: Buffer; name: string; type: string }) {
  const buffer = "buffer" in file ? file.buffer : Buffer.from(await file.arrayBuffer());
  const { body, headers } = makeMultipartBody(buffer, file.name, file.type);
  return app.fetch(new Request("http://localhost/api/smp/extract", {
    method: "POST",
    headers,
    body,
  }));
}

describe("POST /api/smp/extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({ id: 7, name: "Operator", role: "admin" });
  });

  it("rejects non-PDF files", async () => {
    const res = await postExtract({ buffer: Buffer.from("not a pdf"), name: "notes.txt", type: "text/plain" });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toMatch(/Only PDF/);
  });

  it("returns structured extraction for a valid PDF", async () => {
    const pdf = await buildPdfBuffer([
      "Reference Number: MW-ENGG-SP-1.0",
      "Title: Pump System",
      "Revision: Rev. 0",
    ]);
    const res = await postExtract({ buffer: pdf, name: "MW-ENGG-SP-1.0.pdf", type: "application/pdf" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { extraction: { code: string; title: string; revision: string } };
    expect(data.extraction.code).toBe("MW-ENGG-SP-1.0");
    expect(data.extraction.title).toBe("Pump System");
    expect(data.extraction.revision).toBe("Rev. 0");
  });

  it("requires authentication", async () => {
    mocks.authenticateRequest.mockRejectedValue(new Error("Unauthorized"));
    const pdf = await buildPdfBuffer(["Reference Number: MW-ENGG-SP-1.0", "Title: Pump System", "Revision: Rev. 0"]);
    const res = await postExtract({ buffer: pdf, name: "MW-ENGG-SP-1.0.pdf", type: "application/pdf" });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toMatch(/Unauthorized|PDF extraction failed/);
  });
});

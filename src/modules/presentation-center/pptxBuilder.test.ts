import { inflateRawSync } from "node:zlib";
import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { createPresentation } from "./pptxBuilder";

const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function readUint16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

async function readZipEntries(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const decoder = new TextDecoder();
  const entries = new Map<string, string>();
  let eocdOffset = -1;
  const eocdSearchStart = Math.max(0, bytes.length - 66000);

  for (let offset = bytes.length - 22; offset >= eocdSearchStart; offset -= 1) {
    if (readUint32(bytes, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  expect(eocdOffset).toBeGreaterThanOrEqual(0);

  const entryCount = readUint16(bytes, eocdOffset + 10);
  let offset = readUint32(bytes, eocdOffset + 16);

  for (let index = 0; index < entryCount; index += 1) {
    expect(readUint32(bytes, offset)).toBe(0x02014b50);

    const compressionMethod = readUint16(bytes, offset + 10);
    const compressedSize = readUint32(bytes, offset + 20);
    const fileNameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const localHeaderOffset = readUint32(bytes, offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    const name = decoder.decode(bytes.slice(nameStart, nameEnd));

    expect(readUint32(bytes, localHeaderOffset)).toBe(0x04034b50);
    const localFileNameLength = readUint16(bytes, localHeaderOffset + 26);
    const localExtraLength = readUint16(bytes, localHeaderOffset + 28);
    const contentStart =
      localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const contentEnd = contentStart + compressedSize;
    const compressed = bytes.slice(contentStart, contentEnd);
    const content =
      compressionMethod === 0
        ? compressed
        : compressionMethod === 8
          ? inflateRawSync(compressed)
          : null;

    expect(
      content,
      `Unsupported ZIP method ${compressionMethod}`
    ).not.toBeNull();

    entries.set(name, decoder.decode(content ?? new Uint8Array()));
    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function makeDeck() {
  return createPresentation([
    {
      elements: [
        {
          type: "text",
          text: "Monthly KPI Scorecard\nAll Business Units\nMay 2026",
          x: 0.65,
          y: 1.25,
          w: 8.2,
          h: 1.95,
          fontSize: 34,
          bold: true,
        },
        {
          type: "text",
          text: "Unsafe XML chars are stripped: \u0001 & < >",
          x: 0.65,
          y: 3.65,
          w: 6,
          h: 0.8,
        },
        {
          type: "table",
          rows: [
            ["Business Unit", "PM Compliance", "Notes"],
            ["AMD-EZ", "0.00%", "Explicit zero retained"],
            ["Laguna Water", "99.98%", "Database note rendered"],
            ["Clark Water", "--", ""],
            ["Tagum Water", "95.10%", ""],
            ["Estate Water", "96.20%", ""],
          ],
          x: 0.45,
          y: 4.4,
          w: 10,
          h: 1.6,
          fontSize: 8,
        },
      ],
    },
    {
      elements: [
        {
          type: "bars",
          title: "PM Compliance by Business Unit",
          labels: ["AMD-EZ", "Laguna Water", "Clark Water"],
          values: [0, 99.98, 95.1],
          x: 0.75,
          y: 1.05,
          w: 5.85,
          h: 4.9,
          max: 100,
        },
      ],
    },
    {
      elements: [
        {
          type: "text",
          text: "KPI Scorecard Table",
          x: 0.5,
          y: 0.5,
          w: 6,
          h: 1,
        },
      ],
    },
    {
      elements: [
        {
          type: "text",
          text: "KPI Charts Summary",
          x: 0.5,
          y: 0.5,
          w: 6,
          h: 1,
        },
      ],
    },
    {
      elements: [
        {
          type: "text",
          text: "Recorded Notes\nAMD-EZ\nDatabase note rendered",
          x: 0.5,
          y: 0.5,
          w: 8,
          h: 2,
        },
      ],
    },
  ]);
}

function slideXmlParts(entries: Map<string, string>) {
  return Array.from(entries.entries())
    .filter(([path]) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .map(([, content]) => content)
    .join("\n");
}

describe("Presentation Center PPTX builder", () => {
  it("creates a valid PPTX blob with required package entries", async () => {
    const blob = await makeDeck();
    const entries = await readZipEntries(blob);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(PPTX_MIME_TYPE);
    expect(blob.size).toBeGreaterThan(0);

    expect(entries.has("[Content_Types].xml")).toBe(true);
    expect(entries.has("_rels/.rels")).toBe(true);
    expect(entries.has("ppt/presentation.xml")).toBe(true);
    expect(entries.has("ppt/_rels/presentation.xml.rels")).toBe(true);

    const slidePaths = Array.from(entries.keys()).filter(path =>
      /^ppt\/slides\/slide\d+\.xml$/.test(path)
    );
    expect(slidePaths).toHaveLength(5);
  });

  it("generates well-formed XML parts", async () => {
    const entries = await readZipEntries(await makeDeck());

    entries.forEach((content, path) => {
      if (!path.endsWith(".xml") && !path.endsWith(".rels")) return;
      expect(XMLValidator.validate(content), path).toBe(true);
    });
  });

  it("writes title, KPI table, chart, and notes content into slide XML", async () => {
    const entries = await readZipEntries(await makeDeck());
    const xml = slideXmlParts(entries);

    expect(xml).toContain("Monthly KPI Scorecard");
    expect(xml).toContain("All Business Units");
    expect(xml).toContain("May 2026");
    expect(xml).toContain("PM Compliance");
    expect(xml).toContain("0.00%");
    expect(xml).toContain("Explicit zero retained");
    expect(xml).toContain("Recorded Notes");
    expect(xml).toContain("Database note rendered");
  });

  it("preserves blank table cells and spacer paragraphs without dropping content", async () => {
    const entries = await readZipEntries(
      await createPresentation([
        {
          elements: [
            {
              type: "table",
              rows: [
                ["Business Unit", "Notes"],
                ["AMD-EZ", ""],
              ],
              x: 0.5,
              y: 0.5,
              w: 6,
              h: 1,
            },
            {
              type: "text",
              text: "Recorded Notes\n\nLaguna Water",
              x: 0.5,
              y: 2,
              w: 6,
              h: 1.5,
            },
          ],
        },
      ])
    );
    const xml = slideXmlParts(entries);

    expect(xml).toContain("Business Unit");
    expect(xml).toContain("AMD-EZ");
    expect(xml).toContain("Recorded Notes");
    expect(xml).toContain("Laguna Water");
  });
});

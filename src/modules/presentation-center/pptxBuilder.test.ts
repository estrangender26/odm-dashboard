import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { createPresentation } from "./pptxBuilder";

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
  let offset = 0;

  while (offset < bytes.length) {
    const signature = readUint32(bytes, offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    expect(signature).toBe(0x04034b50);

    const compressionMethod = readUint16(bytes, offset + 8);
    const compressedSize = readUint32(bytes, offset + 18);
    const fileNameLength = readUint16(bytes, offset + 26);
    const extraLength = readUint16(bytes, offset + 28);
    expect(compressionMethod).toBe(0);

    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const contentStart = nameEnd + extraLength;
    const contentEnd = contentStart + compressedSize;
    const name = decoder.decode(bytes.slice(nameStart, nameEnd));
    const content = decoder.decode(bytes.slice(contentStart, contentEnd));

    entries.set(name, content);
    offset = contentEnd;
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

function xmlParts(entries: Map<string, string>) {
  return Array.from(entries.entries())
    .filter(([path]) => path.endsWith(".xml") || path.endsWith(".rels"))
    .map(([, content]) => content)
    .join("\n");
}

describe("Presentation Center PPTX builder", () => {
  it("creates a PowerPoint package with required presentation relationships", async () => {
    const entries = await readZipEntries(makeDeck());

    expect(entries.has("[Content_Types].xml")).toBe(true);
    expect(entries.has("_rels/.rels")).toBe(true);
    expect(entries.has("ppt/presentation.xml")).toBe(true);
    expect(entries.has("ppt/_rels/presentation.xml.rels")).toBe(true);
    expect(entries.has("ppt/slideMasters/slideMaster1.xml")).toBe(true);
    expect(entries.has("ppt/slideLayouts/slideLayout1.xml")).toBe(true);
    expect(entries.has("ppt/theme/theme1.xml")).toBe(true);

    const slidePaths = Array.from(entries.keys()).filter(path =>
      /^ppt\/slides\/slide\d+\.xml$/.test(path)
    );
    expect(slidePaths).toHaveLength(5);
    slidePaths.forEach(path => {
      const slideNumber = path.match(/slide(\d+)\.xml$/)?.[1];
      expect(entries.has(`ppt/slides/_rels/slide${slideNumber}.xml.rels`)).toBe(
        true
      );
    });

    expect(entries.get("ppt/presentation.xml")).toContain("p:sldMasterIdLst");
    expect(entries.get("ppt/_rels/presentation.xml.rels")).toContain(
      "relationships/slideMaster"
    );
  });

  it("generates well-formed XML parts", async () => {
    const entries = await readZipEntries(makeDeck());

    entries.forEach((content, path) => {
      if (!path.endsWith(".xml") && !path.endsWith(".rels")) return;
      expect(XMLValidator.validate(content), path).toBe(true);
    });
  });

  it("does not emit empty DrawingML text nodes", async () => {
    const entries = await readZipEntries(makeDeck());
    const xml = xmlParts(entries);

    expect(xml).not.toContain("<a:t/>");
    expect(xml).not.toContain("<a:t></a:t>");
    expect(xml).not.toMatch(/<a:t\b[^>]*\/>/);
    expect(xml).not.toMatch(/<a:t\b[^>]*><\/a:t>/);
  });

  it("uses safe preserved spaces for blank table cells and spacer paragraphs", async () => {
    const entries = await readZipEntries(
      createPresentation([
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
            {
              type: "text",
              text: " leading and trailing ",
              x: 0.5,
              y: 4,
              w: 6,
              h: 0.5,
            },
          ],
        },
      ])
    );
    const slide = entries.get("ppt/slides/slide1.xml") ?? "";

    expect(slide.match(/<a:t xml:space="preserve"> <\/a:t>/g)).toHaveLength(2);
    expect(slide).toContain(
      '<a:t xml:space="preserve"> leading and trailing </a:t>'
    );
  });

  it("assigns unique non-visual shape ids within each slide", async () => {
    const entries = await readZipEntries(makeDeck());

    entries.forEach((content, path) => {
      if (!/^ppt\/slides\/slide\d+\.xml$/.test(path)) return;
      const ids = Array.from(content.matchAll(/<p:cNvPr id="(\d+)"/g)).map(
        match => match[1]
      );
      expect(new Set(ids).size, path).toBe(ids.length);
    });
  });
});

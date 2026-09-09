import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { XMLSerializer } from "@xmldom/xmldom";
import { cleanMonthlyKpiPresentationZip, isMonthlyKpiBodyPart } from "./presentationCleanup";
import { getElementsByTagNameNS, parseXml } from "./xml";

/**
 * Regression coverage for the PR #426 PPTX-integrity hotfix.
 *
 * cleanMonthlyKpiPresentationZip() removes the legacy MTTR methodology
 * paragraph ("MTTR – Calculation methodology is currently being realigned …")
 * from slide/notes bodies. PR #424 removed the whole <a:p> with raw string
 * slicing, and when that paragraph was the ONLY paragraph of a text body
 * (the donor "TextBox 1" note) it left
 *
 *   <p:txBody><a:bodyPr/><a:lstStyle/></p:txBody>
 *
 * with ZERO <a:p> children. CT_TextBody requires at least one paragraph, so
 * PowerPoint reports "found a problem with content" and repairs the deck.
 *
 * These tests pin the corrected behavior: the marker paragraph may be removed,
 * but the owning text body must NEVER end up with zero <a:p> children, and
 * unrelated paragraphs must be preserved byte-for-byte.
 */

const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";

const MTTR_TEXT =
  "MTTR – Calculation methodology is currently being realigned. Indicative MTTR " +
  "stands at 121 calendar days for SLA and 74 calendar days for in-house cases.";

function textBox1Slide(markerParagraph: string, extraParagraphs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="TextBox 1"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="320221" y="7048500"/><a:ext cx="7995557" cy="200000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="t">
            <a:spAutoFit/>
          </a:bodyPr>
          <a:lstStyle/>
          ${markerParagraph}
          ${extraParagraphs.join("\n          ")}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

const markerParagraph = `<a:p><a:pPr marL="285750" indent="-285750"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-PH"/><a:t>${MTTR_TEXT}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>`;

const unrelatedParagraph = `<a:p><a:pPr marL="285750" indent="-285750"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-PH"/><a:t>Second unrelated bullet stays intact.</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>`;

async function runCleanup(parts: Record<string, string>): Promise<JSZip> {
  const zip = new JSZip();
  for (const [name, xml] of Object.entries(parts)) zip.file(name, xml);
  await cleanMonthlyKpiPresentationZip(zip);
  return zip;
}

/** Serialized <a:p> list of the "TextBox 1" shape, for deterministic equality. */
function textBox1Paragraphs(xml: string): string[] {
  const doc = parseXml(xml);
  for (const sp of getElementsByTagNameNS(doc, "p", "sp")) {
    const cNvPr = getElementsByTagNameNS(sp, "p", "cNvPr")[0];
    if (!cNvPr || cNvPr.getAttribute("name") !== "TextBox 1") continue;
    const body = getElementsByTagNameNS(sp, "p", "txBody")[0];
    if (!body) continue;
    return getElementsByTagNameNS(body, "a", "p").map((p) =>
      new XMLSerializer().serializeToString(p)
    );
  }
  return [];
}

/** Every shape text body in the document must keep at least one <a:p>. */
function emptyTextBodies(xml: string): string[] {
  const doc = parseXml(xml);
  const empty: string[] = [];
  for (const sp of getElementsByTagNameNS(doc, "p", "sp")) {
    const cNvPr = getElementsByTagNameNS(sp, "p", "cNvPr")[0];
    const name = cNvPr ? cNvPr.getAttribute("name") ?? "" : "";
    const body = getElementsByTagNameNS(sp, "p", "txBody")[0];
    if (body && getElementsByTagNameNS(body, "a", "p").length === 0) {
      empty.push(name);
    }
  }
  return empty;
}

/** Serialized <a:p> list across every <p:txBody> of the document. */
function allBodyParagraphs(xml: string): string[] {
  const doc = parseXml(xml);
  const out: string[] = [];
  for (const sp of getElementsByTagNameNS(doc, "p", "sp")) {
    const body = getElementsByTagNameNS(sp, "p", "txBody")[0];
    if (!body) continue;
    for (const paragraph of getElementsByTagNameNS(body, "a", "p")) {
      out.push(new XMLSerializer().serializeToString(paragraph));
    }
  }
  return out;
}

describe("isMonthlyKpiBodyPart — canonical slide/notesSlide part selection", () => {
  it("matches BOTH canonical forms: ppt/slides/slideN.xml and ppt/notesSlides/notesSlideN.xml", () => {
    expect(isMonthlyKpiBodyPart("ppt/slides/slide1.xml")).toBe(true);
    expect(isMonthlyKpiBodyPart("ppt/slides/slide15.xml")).toBe(true);
    expect(isMonthlyKpiBodyPart("ppt/notesSlides/notesSlide1.xml")).toBe(true);
    expect(isMonthlyKpiBodyPart("ppt/notesSlides/notesSlide3.xml")).toBe(true);
  });

  it("rejects relationship parts, masters, layouts and other package parts", () => {
    expect(isMonthlyKpiBodyPart("ppt/slides/_rels/slide1.xml.rels")).toBe(false);
    expect(isMonthlyKpiBodyPart("ppt/notesSlides/_rels/notesSlide1.xml.rels")).toBe(false);
    expect(isMonthlyKpiBodyPart("ppt/notesSlides/notesSlide1.xml.rels")).toBe(false);
    expect(isMonthlyKpiBodyPart("ppt/slideMasters/slideMaster1.xml")).toBe(false);
    expect(isMonthlyKpiBodyPart("ppt/slideLayouts/slideLayout1.xml")).toBe(false);
    expect(isMonthlyKpiBodyPart("ppt/presentation.xml")).toBe(false);
    expect(isMonthlyKpiBodyPart("[Content_Types].xml")).toBe(false);
    // Non-canonical spelling of the notes form must NOT match either.
    expect(isMonthlyKpiBodyPart("ppt/notesSlides/slide1.xml")).toBe(false);
  });
});

describe("cleanMonthlyKpiPresentationZip — MTTR methodology cleanup keeps every txBody schema-valid", () => {
  it("marker paragraph is removed; a single-paragraph body keeps one valid empty <a:p>", async () => {
    const zip = await runCleanup({
      "ppt/slides/slide2.xml": textBox1Slide(markerParagraph, []),
    });
    const xml = await zip.file("ppt/slides/slide2.xml")!.async("string");

    expect(xml).not.toContain("Calculation methodology");

    const paragraphs = textBox1Paragraphs(xml);
    expect(paragraphs.length).toBe(1);
    // PowerPoint-equivalent minimal paragraph: <a:p><a:endParaRPr/></a:p>
    expect(paragraphs[0]).toContain("<a:endParaRPr");
    expect(paragraphs[0]).not.toContain("<a:t>");
    expect(paragraphs[0]).toContain("<a:p");
    expect(emptyTextBodies(xml)).toEqual([]);
  });

  it("multi-paragraph body: only the MTTR paragraph is removed; the remaining paragraph is preserved byte-for-byte", async () => {
    const withMarker = await runCleanup({
      "ppt/slides/slide4.xml": textBox1Slide(markerParagraph, [unrelatedParagraph]),
    });
    const cleanedXml = await withMarker.file("ppt/slides/slide4.xml")!.async("string");
    expect(cleanedXml).not.toContain("Calculation methodology");

    // Control: same slide with ONLY the unrelated paragraph (no marker) — the
    // cleanup must leave it untouched, so its paragraph serializes identically.
    const control = await runCleanup({
      "ppt/slides/slide4.xml": textBox1Slide(unrelatedParagraph, []),
    });
    const controlXml = await control.file("ppt/slides/slide4.xml")!.async("string");

    const cleanedParagraphs = textBox1Paragraphs(cleanedXml);
    const controlParagraphs = textBox1Paragraphs(controlXml);
    expect(cleanedParagraphs.length).toBe(1);
    expect(controlParagraphs.length).toBe(1);
    expect(cleanedParagraphs[0]).toBe(controlParagraphs[0]);
    expect(emptyTextBodies(cleanedXml)).toEqual([]);
  });

  it("parts without the marker are left untouched", async () => {
    const cleanSlide = textBox1Slide(
      `<a:p><a:r><a:t>No MTTR note here.</a:t></a:r></a:p>`,
      []
    );
    const zip = await runCleanup({ "ppt/slides/slide1.xml": cleanSlide });
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toBe(cleanSlide);
  });
});

function notesSlideXml(bodyParagraphs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:p="${P}" xmlns:a="${A}">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Notes Placeholder"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="6858000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" anchor="t"><a:normAutofit/></a:bodyPr>
          <a:lstStyle/>
          ${bodyParagraphs.join("\n          ")}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`;
}

describe("cleanMonthlyKpiPresentationZip — canonical ppt/notesSlides/notesSlideN.xml parts", () => {
  it("processes notesSlide1.xml whose sole paragraph is the MTTR marker and keeps a valid empty <a:p>", async () => {
    const zip = await runCleanup({
      "ppt/notesSlides/notesSlide1.xml": notesSlideXml([markerParagraph]),
    });
    const xml = await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string");

    // Part was actually processed: the marker paragraph is gone. Under the
    // pre-correction matcher this part was never selected, so the marker
    // stayed and this assertion failed.
    expect(xml).not.toContain("Calculation methodology");

    const paragraphs = allBodyParagraphs(xml);
    expect(paragraphs.length).toBe(1);
    expect(paragraphs[0]).toContain("<a:p");
    expect(paragraphs[0]).toContain("<a:endParaRPr");
    expect(paragraphs[0]).not.toContain("<a:t>");
    expect(emptyTextBodies(xml)).toEqual([]);
  });

  it("leaves a marker-free notesSlide part completely unchanged", async () => {
    const controlNotes = notesSlideXml([
      `<a:p><a:r><a:t>Keep this speaker note verbatim.</a:t></a:r></a:p>`,
    ]);
    const zip = await runCleanup({
      "ppt/notesSlides/notesSlide2.xml": controlNotes,
    });
    const xml = await zip.file("ppt/notesSlides/notesSlide2.xml")!.async("string");
    expect(xml).toBe(controlNotes);
  });
});

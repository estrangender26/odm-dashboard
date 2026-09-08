import { describe, expect, it } from "vitest";
import { parseXml, serializeXml } from "./xml";
import { storedNotesSituationLines, writeReadoutLines } from "./readoutText";
import type { XmlDocument, XmlElement } from "./types";

/**
 * The Monthly KPI readout writer must OWN the visible Notes / Situation
 * content: paragraphs and runs are constructed from scratch with explicit
 * formatting and must NEVER depend on the donor/template paragraph's run
 * state, rPr, scheme/theme colors, or placeholder text.
 *
 *   headings: no bullet (buNone), bold, #172B47, 12pt, Aptos
 *   bullets:  "•" bullet, regular, #111111, 12pt, Aptos
 */

const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";

/** Donor variants that must ALL produce byte-identical canonical readouts. */
function donorShapeXml(variant: "weird-run" | "no-run" | "rich"): string {
  const weirdRun = `
      <a:r>
        <a:rPr lang="en-US" sz="900" baseline="0">
          <a:highlight><a:srgbClr val="FFFF00"/></a:highlight>
          <a:solidFill><a:schemeClr val="accent1"/></a:solidFill>
          <a:latin typeface="Calibri"/><a:ea typeface="Calibri"/><a:cs typeface="Calibri"/>
        </a:rPr>
        <a:t>DONOR MUST NOT LEAK</a:t>
      </a:r>`;
  const body =
    variant === "weird-run"
      ? `<a:p><a:pPr marL="285750" indent="-285750" defTabSz="609630"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>${weirdRun}</a:p>`
      : variant === "no-run"
        ? `<a:p><a:pPr marL="285750" indent="-285750" defTabSz="609630"><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr/></a:pPr><a:endParaRPr lang="en-US" sz="1400"/></a:p>`
        : // Rich donor: several paragraphs with runs and mixed formatting.
          `<a:p><a:pPr marL="0" indent="0"><a:buNone/></a:pPr>${weirdRun}</a:p><a:p><a:pPr marL="285750" indent="-285750"><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-US" sz="1800" b="1"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:rPr><a:t>placeholder one</a:t></a:r></a:p>`;
  return `<?xml version="1.0"?>
<p:sp xmlns:p="${P_NS}" xmlns:a="${A_NS}">
  <p:txBody>
    <a:bodyPr/><a:lstStyle/>
    ${body}
  </p:txBody>
</p:sp>`;
}

type ParaInfo = {
  text: string;
  pPr: string;
  runRPr: string[];
};

function paragraphInfos(shapeXml: string): ParaInfo[] {
  const out: ParaInfo[] = [];
  for (const m of shapeXml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)) {
    const p = m[0];
    const text = [...p.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
      .map((x) => x[1])
      .join("");
    const pPr = p.match(/<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/)?.[0] ?? "";
    const runRPr = [...p.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)].map((rm) => {
      const rp = rm[1].match(/<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/);
      return rp ? rp[0] : "";
    });
    out.push({ text, pPr, runRPr });
  }
  return out;
}

describe("writeReadoutLines - deterministic, donor-independent readout", () => {
  it.each(["weird-run", "no-run", "rich"] as const)(
    "builds the exact canonical readout regardless of donor state (%s)",
    (variant) => {
      const doc = parseXml(donorShapeXml(variant)) as XmlDocument;
      const shape = doc.getElementsByTagNameNS(P_NS, "sp")[0] as unknown as XmlElement;
      const lines = storedNotesSituationLines(
        "Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44",
        null
      );
      writeReadoutLines(shape, lines);
      const xml = serializeXml(doc);

      // Donor text/formatting never leaks.
      expect(xml).not.toContain("DONOR MUST NOT LEAK");
      expect(xml).not.toContain("placeholder");
      expect(xml).not.toContain("Calibri");
      expect(xml).not.toContain("schemeClr");
      expect(xml).not.toContain("accent");

      const paras = paragraphInfos(xml);
      expect(paras.map((p) => p.text)).toEqual([
        "Notes / Commentary",
        "Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44",
        "Situation",
        "No situation submitted.",
      ]);

      // Headings: no bullet, bold navy 172B47, 12pt, Aptos.
      for (const idx of [0, 2]) {
        const para = paras[idx];
        expect(para.pPr).toContain('marL="0"');
        expect(para.pPr).toContain('indent="0"');
        expect(para.pPr).toContain("<a:buNone/>");
        expect(para.pPr).not.toContain("buChar");
        expect(para.runRPr.length).toBe(1);
        const rPr = para.runRPr[0];
        expect(rPr).toMatch(/lang="en-PH"/);
        expect(rPr).toMatch(/sz="1200"/);
        expect(rPr).toMatch(/ b="1"/);
        expect(rPr).toContain('<a:srgbClr val="172B47"/>');
        expect((rPr.match(/typeface="Aptos"/g) || []).length).toBe(3);
        expect((rPr.match(/<a:solidFill>/g) || []).length).toBe(1);
        expect((rPr.match(/<a:srgbClr/g) || []).length).toBe(1);
      }

      // Bullets: bullet char + hanging indent, regular black 111111, Aptos.
      for (const idx of [1, 3]) {
        const para = paras[idx];
        expect(para.pPr).toContain('marL="285750"');
        expect(para.pPr).toContain('indent="-285750"');
        expect(para.pPr).toContain('<a:buChar char="•"/>');
        expect(para.pPr).not.toContain("buNone");
        expect(para.runRPr.length).toBe(1);
        const rPr = para.runRPr[0];
        expect(rPr).toMatch(/lang="en-PH"/);
        expect(rPr).toMatch(/sz="1200"/);
        expect(rPr).toMatch(/ b="0"/);
        expect(rPr).toContain('<a:srgbClr val="111111"/>');
        expect((rPr.match(/typeface="Aptos"/g) || []).length).toBe(3);
        expect((rPr.match(/<a:solidFill>/g) || []).length).toBe(1);
      }

      // Schema-valid ordering: rPr before t inside each run; one rPr per run.
      for (const rm of xml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
        expect(rm[1].indexOf("<a:rPr")).toBeLessThan(rm[1].indexOf("<a:t"));
        expect(rm[1]).not.toContain("<a:r>");
        expect((rm[1].match(/<a:rPr\b/g) || []).length).toBe(1);
      }
      expect((xml.match(/<a:r\b/g) || []).length).toBe(4);
      expect((xml.match(/<a:rPr\b/g) || []).length).toBe(4);
    }
  );

  it("renders multi-line notes and a stored situation as separate formatted lines", () => {
    const doc = parseXml(donorShapeXml("weird-run")) as XmlDocument;
    const shape = doc.getElementsByTagNameNS(P_NS, "sp")[0] as unknown as XmlElement;
    writeReadoutLines(shape, storedNotesSituationLines("Line one.\nLine two.", "Stored situation text."));
    const xml = serializeXml(doc);
    const paras = paragraphInfos(xml);
    expect(paras.map((p) => p.text)).toEqual([
      "Notes / Commentary",
      "Line one.",
      "Line two.",
      "Situation",
      "Stored situation text.",
    ]);
    for (const [idx, color, bold] of [
      [0, "172B47", "1"],
      [1, "111111", "0"],
      [2, "111111", "0"],
      [3, "172B47", "1"],
      [4, "111111", "0"],
    ] as const) {
      const rPr = paras[idx].runRPr[0];
      expect(rPr).toContain(`<a:srgbClr val="${color}"/>`);
      expect(rPr).toMatch(new RegExp(` b="${bold}"`));
      expect(rPr).toMatch(/sz="1200"/);
    }
  });

  it("handles a shape with NO donor paragraph at all", () => {
    const xml0 = `<?xml version="1.0"?>
<p:sp xmlns:p="${P_NS}" xmlns:a="${A_NS}"><p:txBody><a:bodyPr/></p:txBody></p:sp>`;
    const doc = parseXml(xml0) as XmlDocument;
    const shape = doc.getElementsByTagNameNS(P_NS, "sp")[0] as unknown as XmlElement;
    writeReadoutLines(shape, storedNotesSituationLines("Note text.", null));
    const paras = paragraphInfos(serializeXml(doc));
    expect(paras.map((p) => p.text)).toEqual([
      "Notes / Commentary",
      "Note text.",
      "Situation",
      "No situation submitted.",
    ]);
    expect(paras[0].runRPr[0]).toContain('<a:srgbClr val="172B47"/>');
    expect(paras[1].runRPr[0]).toContain('<a:srgbClr val="111111"/>');
  });
});

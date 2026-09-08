import { describe, expect, it } from "vitest";
import { parseXml, serializeXml } from "./xml";
import { storedNotesSituationLines, writeReadoutLines } from "./readoutText";
import type { XmlDocument, XmlElement } from "./types";

/**
 * Regression tests for deterministic readout RUN formatting.
 *
 * The Executive Readout writer clones the template donor paragraph. If that
 * donor ever carries a run (placeholder text), the old setParagraphText kept
 * the donor's <a:rPr> untouched (opts ignored), so an inherited light/scheme
 * color or oversized donor font could make the injected Notes/Situation text
 * invisible or visually wrong while still present in the XML.
 *
 * These tests drive a DONOR THAT HAS A RUN with conflicting formatting and
 * assert the retained run is normalized to the canonical visible formatting:
 *   headings: b="1" sz="1200" color 172B47, Aptos
 *   bullets:  b="0" sz="1200" color 111111, Aptos
 */

const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";

function donorShapeXml(): string {
  return `<?xml version="1.0"?>
<p:sp xmlns:p="${P_NS}" xmlns:a="${A_NS}">
  <p:txBody>
    <a:bodyPr/><a:lstStyle/>
    <a:p>
      <a:pPr marL="285750" indent="-285750" defTabSz="609630">
        <a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/>
        <a:buChar char="•"/>
        <a:defRPr/>
      </a:pPr>
      <a:endParaRPr lang="en-US" sz="1400"><a:solidFill><a:srgbClr val="999999"/></a:solidFill></a:endParaRPr>
      <a:r>
        <a:rPr lang="en-US" sz="900" baseline="0">
          <a:highlight><a:srgbClr val="FFFF00"/></a:highlight>
          <a:solidFill><a:schemeClr val="accent1"/></a:solidFill>
          <a:latin typeface="Calibri"/><a:ea typeface="Calibri"/><a:cs typeface="Calibri"/>
        </a:rPr>
        <a:t>placeholder</a:t>
      </a:r>
    </a:p>
  </p:txBody>
</p:sp>`;
}

type ParaInfo = {
  text: string;
  buNone: boolean;
  buChar: boolean;
  runRPr: string[];
};

function paragraphInfos(shapeXml: string): ParaInfo[] {
  const out: ParaInfo[] = [];
  for (const m of shapeXml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)) {
    const p = m[0];
    const text = [...p.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
      .map((x) => x[1])
      .join("");
    const runs = [...p.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)].map((rm) => rm[1]);
    const runRPr = runs.map((run) => {
      const rp = run.match(/<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/);
      return rp ? rp[0] : "";
    });
    out.push({
      text,
      buNone: /<a:buNone\b[^>]*\/>/.test(p),
      buChar: /<a:buChar\b[^>]*char="•"/.test(p),
      runRPr,
    });
  }
  return out;
}

function runBody(paragraph: ParaInfo, index = 0): string {
  return paragraph.runRPr[index] ?? "";
}

describe("writeReadoutLines run formatting (donor run retained)", () => {
  it("normalizes a retained donor run to heading formatting (1727B47 bold Aptos) when a donor run with conflicting rPr exists", () => {
    const doc = parseXml(donorShapeXml()) as XmlDocument;
    const shape = doc.getElementsByTagNameNS(P_NS, "sp")[0] as unknown as XmlElement;
    const lines = storedNotesSituationLines(
      "Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44",
      null
    );
    writeReadoutLines(shape, lines);
    const xml = serializeXml(doc);
    const paras = paragraphInfos(xml);

    expect(paras.map((p) => p.text)).toEqual([
      "Notes / Commentary",
      "Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44",
      "Situation",
      "No situation submitted.",
    ]);

    // Headings: bold navy 172B47, 12pt, Aptos, no bullet, no nested run.
    for (const idx of [0, 2]) {
      const para = paras[idx];
      expect(para.buNone).toBe(true);
      expect(para.buChar).toBe(false);
      expect(para.runRPr.length).toBe(1);
      const rPr = runBody(para);
      expect(rPr).toMatch(/lang="en-PH"/);
      expect(rPr).toMatch(/sz="1200"/);
      expect(rPr).toMatch(/ b="1"/);
      expect(rPr).toContain('<a:srgbClr val="172B47"/>');
      expect((rPr.match(/typeface="Aptos"/g) || []).length).toBe(3);
      expect(rPr).not.toContain("schemeClr");
      expect(rPr).not.toContain("Calibri");
      expect(rPr).not.toContain("highlight");
      expect((rPr.match(/<a:solidFill>/g) || []).length).toBe(1);
      expect((rPr.match(/<a:srgbClr/g) || []).length).toBe(1);
    }

    // Bullets: regular black 111111, 12pt, Aptos, bullet preserved.
    for (const idx of [1, 3]) {
      const para = paras[idx];
      expect(para.buNone).toBe(false);
      expect(para.buChar).toBe(true);
      expect(para.runRPr.length).toBe(1);
      const rPr = runBody(para);
      expect(rPr).toMatch(/lang="en-PH"/);
      expect(rPr).toMatch(/sz="1200"/);
      expect(rPr).toMatch(/ b="0"/);
      expect(rPr).toContain('<a:srgbClr val="111111"/>');
      expect((rPr.match(/typeface="Aptos"/g) || []).length).toBe(3);
      expect(rPr).not.toContain("schemeClr");
      expect((rPr.match(/<a:solidFill>/g) || []).length).toBe(1);
    }

    // Run child order stays schema-valid: rPr before t, no nested a:r.
    for (const rm of xml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
      const run = rm[1];
      expect(run.indexOf("<a:rPr")).toBeLessThan(run.indexOf("<a:t"));
      expect(run).not.toContain("<a:r>");
    }
    // No duplicate rPr anywhere in the readout body.
    expect((xml.match(/<a:rPr\b/g) || []).length).toBe(4); // one per line
    expect((xml.match(/<a:r\b/g) || []).length).toBe(4);
  });

  it("normalizes retained runs for multi-line notes and a stored situation (all bullets 111111, headings 172B47)", () => {
    const doc = parseXml(donorShapeXml()) as XmlDocument;
    const shape = doc.getElementsByTagNameNS(P_NS, "sp")[0] as unknown as XmlElement;
    const lines = storedNotesSituationLines("Line one.\nLine two.", "Stored situation text.");
    writeReadoutLines(shape, lines);
    const xml = serializeXml(doc);
    const paras = paragraphInfos(xml);
    expect(paras.map((p) => p.text)).toEqual([
      "Notes / Commentary",
      "Line one.",
      "Line two.",
      "Situation",
      "Stored situation text.",
    ]);
    for (const [idx, expectedColor] of [
      [0, "172B47"],
      [1, "111111"],
      [2, "111111"],
      [3, "172B47"],
      [4, "111111"],
    ] as const) {
      const rPr = runBody(paras[idx]);
      expect(rPr).toContain(`<a:srgbClr val="${expectedColor}"/>`);
      expect(rPr).toMatch(/sz="1200"/);
    }
    // No nested run, no duplicate solidFill inside any run.
    for (const rm of xml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
      expect(rm[1]).not.toContain("<a:r>");
      expect((rm[1].match(/<a:solidFill>/g) || []).length).toBeLessThanOrEqual(1);
    }
  });

  it("creates a missing rPr in schema-valid position when the retained run has none", () => {
    const donor = donorShapeXml().replace(
      /<a:rPr[\s\S]*?<\/a:rPr>/,
      ""
    );
    const doc = parseXml(donor) as XmlDocument;
    const shape = doc.getElementsByTagNameNS(P_NS, "sp")[0] as unknown as XmlElement;
    writeReadoutLines(shape, storedNotesSituationLines("Note text.", null));
    const xml = serializeXml(doc);
    const paras = paragraphInfos(xml);
    expect(runBody(paras[0])).toContain('<a:srgbClr val="172B47"/>');
    expect(runBody(paras[1])).toContain('<a:srgbClr val="111111"/>');
    for (const rm of xml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
      expect(rm[1].indexOf("<a:rPr")).toBeLessThan(rm[1].indexOf("<a:t"));
    }
  });

  it("collapses duplicate rPr elements on a retained run", () => {
    const donor = donorShapeXml().replace(
      "</a:rPr>",
      "</a:rPr><a:rPr lang=\"en-US\" sz=\"700\"><a:solidFill><a:srgbClr val=\"FF0000\"/></a:solidFill></a:rPr>"
    );
    const doc = parseXml(donor) as XmlDocument;
    const shape = doc.getElementsByTagNameNS(P_NS, "sp")[0] as unknown as XmlElement;
    writeReadoutLines(shape, storedNotesSituationLines("Note text.", "Situation text."));
    const xml = serializeXml(doc);
    const paras = paragraphInfos(xml);
    expect(runBody(paras[0])).toContain('<a:srgbClr val="172B47"/>');
    expect(runBody(paras[1])).toContain('<a:srgbClr val="111111"/>');
    // one rPr per run only
    for (const rm of xml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
      expect((rm[1].match(/<a:rPr\b/g) || []).length).toBe(1);
    }
  });
});

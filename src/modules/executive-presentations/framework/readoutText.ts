/**
 * Shared Slide-1 commentary (Notes / Situation) text layout.
 *
 * Both the All-Business-Units deck and the single-BU executive deck render the
 * stored Notes/Commentary and Situation of the effective-month record in the
 * approved Manila Water "Executive Readout" area below the KPI table:
 *
 *   Notes / Commentary
 *     • <stored note line(s)>            (or "No commentary submitted.")
 *   Situation
 *     • <stored situation line(s)>       (or "No situation submitted.")
 *
 * Only stored wording is used; no threshold or missing-data narrative.
 */

import { createElementNS, getElementsByTagNameNS } from "./xml";
import type { XmlDocument, XmlElement } from "./types";

export const NO_COMMENTARY_SUBMITTED = "No commentary submitted.";
export const NO_SITUATION_SUBMITTED = "No situation submitted.";

export interface ReadoutLine {
  kind: "heading" | "bullet";
  text: string;
}

/** Trim + line-ending normalization only (never rewrites stored wording). */
export function splitStoredLines(
  value: string | null | undefined
): string[] {
  if (value === null || value === undefined) return [];
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Build the readout line list for stored Notes + Situation. Each section
 * always appears with its heading; blank sections get their neutral line.
 */
export function storedNotesSituationLines(
  notes: string | null,
  situation: string | null
): ReadoutLine[] {
  const lines: ReadoutLine[] = [{ kind: "heading", text: "Notes / Commentary" }];

  const noteLines = splitStoredLines(notes);
  if (noteLines.length === 0) {
    lines.push({ kind: "bullet", text: NO_COMMENTARY_SUBMITTED });
  } else {
    for (const line of noteLines) lines.push({ kind: "bullet", text: line });
  }

  lines.push({ kind: "heading", text: "Situation" });

  const situationLines = splitStoredLines(situation);
  if (situationLines.length === 0) {
    lines.push({ kind: "bullet", text: NO_SITUATION_SUBMITTED });
  } else {
    for (const line of situationLines) {
      lines.push({ kind: "bullet", text: line });
    }
  }

  return lines;
}

function appendSolidFill(ownerDoc: XmlDocument, color: string): XmlElement {
  const solidFill = createElementNS(ownerDoc, "a", "solidFill");
  const srgbClr = createElementNS(ownerDoc, "a", "srgbClr");
  srgbClr.setAttribute("val", color);
  solidFill.appendChild(srgbClr);
  return solidFill;
}

function appendAptosTypefaces(ownerDoc: XmlDocument, rPr: XmlElement): void {
  for (const name of ["latin", "ea", "cs"]) {
    const el = createElementNS(ownerDoc, "a", name);
    el.setAttribute("typeface", "Aptos");
    rPr.appendChild(el);
  }
}

/**
 * Build a canonical <a:rPr> for one readout run. Children are written in
 * schema-valid order (solidFill before latin/ea/cs) so the visible formatting
 * is deterministic: dark text on the slide background, Aptos, at the requested
 * size/boldness, with no inherited highlight/outline/scheme color.
 */
function buildCanonicalRunProperties(
  ownerDoc: XmlDocument,
  opts: { bold?: boolean; size?: number; color?: string }
): XmlElement {
  const rPr = createElementNS(ownerDoc, "a", "rPr");
  rPr.setAttribute("lang", "en-PH");
  rPr.setAttribute("sz", String(opts.size ?? 1200));
  rPr.setAttribute("b", opts.bold ? "1" : "0");
  rPr.appendChild(appendSolidFill(ownerDoc, opts.color ?? "111111"));
  appendAptosTypefaces(ownerDoc, rPr);
  return rPr;
}

function createTextRun(
  ownerDoc: XmlDocument,
  text: string,
  opts: { bold?: boolean; size?: number; color?: string }
): XmlElement {
  const run = createElementNS(ownerDoc, "a", "r");
  run.appendChild(buildCanonicalRunProperties(ownerDoc, opts));
  const t = createElementNS(ownerDoc, "a", "t");
  t.textContent = text;
  run.appendChild(t);
  return run;
}

/**
 * Build one deterministic readout paragraph from scratch.
 *
 * Nothing is cloned or inherited from the donor/template paragraph: every
 * <a:pPr> (bullet marker, indent, …) and every <a:r>/<a:rPr> (color, size,
 * bold, typeface) is constructed explicitly here, so the visible Notes /
 * Situation lines cannot depend on the donor's text-run state, scheme/theme
 * colors, or empty formatting.
 *
 *   headings: no bullet (buNone), bold, #172B47, 12pt Aptos
 *   bullets:  hanging bullet "•", regular, #111111, 12pt Aptos
 */
function makeReadoutParagraph(
  ownerDoc: XmlDocument,
  kind: ReadoutLine["kind"],
  text: string
): XmlElement {
  const paragraph = createElementNS(ownerDoc, "a", "p");
  const pPr = createElementNS(ownerDoc, "a", "pPr");

  if (kind === "heading") {
    pPr.setAttribute("marL", "0");
    pPr.setAttribute("indent", "0");
    pPr.appendChild(createElementNS(ownerDoc, "a", "buNone"));
  } else {
    // Hanging bullet indentation matching the approved Executive Readout.
    pPr.setAttribute("marL", "285750");
    pPr.setAttribute("indent", "-285750");
    pPr.setAttribute("defTabSz", "609630");
    const buFont = createElementNS(ownerDoc, "a", "buFont");
    buFont.setAttribute("typeface", "Arial");
    buFont.setAttribute("panose", "020B0604020202020204");
    buFont.setAttribute("pitchFamily", "34");
    buFont.setAttribute("charset", "0");
    pPr.appendChild(buFont);
    const buChar = createElementNS(ownerDoc, "a", "buChar");
    buChar.setAttribute("char", "•");
    pPr.appendChild(buChar);
  }
  paragraph.appendChild(pPr);

  paragraph.appendChild(
    createTextRun(ownerDoc, text, {
      bold: kind === "heading",
      size: 1200,
      color: kind === "heading" ? "172B47" : "111111",
    })
  );
  return paragraph;
}

/**
 * Render the heading/bullet lines into the Executive Readout shape.
 *
 * The readout is REBUILT deterministically: all donor/template paragraphs are
 * removed and every output paragraph is constructed from scratch (see
 * makeReadoutParagraph). The result never depends on the donor's runs, rPr,
 * colors, or placeholder state - the generator owns the visible content.
 */
export function writeReadoutLines(
  shape: XmlElement,
  lines: ReadoutLine[]
): void {
  const txBody = getElementsByTagNameNS(shape, "p", "txBody")[0];
  if (!txBody) return;
  const ownerDoc = txBody.ownerDocument as XmlDocument;

  // Drop any donor/placeholder paragraphs; content paragraphs are appended
  // fresh below, so no donor mutation or formatting can leak into them.
  let live = getElementsByTagNameNS(txBody, "a", "p");
  while (live.length > 0) {
    txBody.removeChild(live[live.length - 1]);
    live = getElementsByTagNameNS(txBody, "a", "p");
  }

  for (const line of lines) {
    txBody.appendChild(makeReadoutParagraph(ownerDoc, line.kind, line.text));
  }
}

/**
 * Size the Executive Readout box by its real plot frame height (the a:ext
 * inside a:xfrm) so PowerPoint autofit keeps the injected lines readable.
 * (Earlier code accidentally wrote cy on the first a:ext descendant, which is
 * the creationId extension inside cNvPr, not the frame ext.)
 */
export function fitReadoutBoxHeight(
  shape: XmlElement,
  lineCount: number,
  minHeightEmu = 700000
): void {
  const xfrm = getElementsByTagNameNS(shape, "a", "xfrm")[0];
  const ext = xfrm ? getElementsByTagNameNS(xfrm, "a", "ext")[0] : null;
  if (!ext) return;
  const fitted = Math.max(
    minHeightEmu,
    Math.min(Math.max(lineCount, 1), 14) * 120000
  );
  ext.setAttribute("cy", String(Math.round(fitted)));
}

export type ReadoutGeometry = { x: number; y: number; cx: number; cy: number };

/** Read a shape's plot-frame bbox (the a:xfrm inside spPr) in EMU. */
export function readoutShapeGeometry(
  shape: XmlElement
): ReadoutGeometry | null {
  const xfrm = getElementsByTagNameNS(shape, "a", "xfrm")[0];
  if (!xfrm) return null;
  const off = getElementsByTagNameNS(xfrm, "a", "off")[0];
  const ext = getElementsByTagNameNS(xfrm, "a", "ext")[0];
  if (!off || !ext) return null;
  return {
    x: Number(off.getAttribute("x") ?? 0),
    y: Number(off.getAttribute("y") ?? 0),
    cx: Number(ext.getAttribute("cx") ?? 0),
    cy: Number(ext.getAttribute("cy") ?? 0),
  };
}

/** Remove a shape element from the slide tree. */
export function removeReadoutShape(shape: XmlElement): void {
  const parent = shape.parentNode;
  if (parent) parent.removeChild(shape);
}

function nextShapeId(doc: XmlDocument): number {
  const cNvPrs = getElementsByTagNameNS(doc, "p", "cNvPr");
  let maxId = 0;
  for (const el of cNvPrs) {
    const id = Number(el.getAttribute("id"));
    if (Number.isFinite(id) && id > maxId) maxId = id;
  }
  return maxId + 1;
}

/**
 * Build a BRAND-NEW <p:sp> text box that owns the visible Notes / Situation
 * content. Nothing is cloned from any donor/template shape: the sp envelope,
 * spPr, bodyPr, every paragraph and every run are constructed from scratch
 * with explicit geometry and explicit srgb formatting (see
 * makeReadoutParagraph). It must be appended to the slide's shape tree by the
 * caller.
 */
export function createReadoutTextBox(
  doc: XmlDocument,
  geometry: ReadoutGeometry,
  lines: ReadoutLine[]
): XmlElement {
  const sp = createElementNS(doc, "p", "sp");

  // p:nvSpPr — brand new shape id + the "Executive Readout" name so viewers
  // and tooling that locate the readout area keep working on the NEW object.
  const nvSpPr = createElementNS(doc, "p", "nvSpPr");
  const cNvPr = createElementNS(doc, "p", "cNvPr");
  cNvPr.setAttribute("id", String(nextShapeId(doc)));
  cNvPr.setAttribute("name", "Executive Readout");
  nvSpPr.appendChild(cNvPr);
  const cNvSpPr = createElementNS(doc, "p", "cNvSpPr");
  const spLocks = createElementNS(doc, "a", "spLocks");
  spLocks.setAttribute("noGrp", "1");
  cNvSpPr.appendChild(spLocks);
  cNvSpPr.appendChild(createElementNS(doc, "p", "txBox"));
  nvSpPr.appendChild(cNvSpPr);
  nvSpPr.appendChild(createElementNS(doc, "p", "nvPr"));
  sp.appendChild(nvSpPr);

  // p:spPr — explicit geometry, transparent fill, no outline.
  const spPr = createElementNS(doc, "p", "spPr");
  const xfrm = createElementNS(doc, "a", "xfrm");
  const off = createElementNS(doc, "a", "off");
  off.setAttribute("x", String(Math.round(geometry.x)));
  off.setAttribute("y", String(Math.round(geometry.y)));
  const ext = createElementNS(doc, "a", "ext");
  ext.setAttribute("cx", String(Math.round(geometry.cx)));
  ext.setAttribute("cy", String(Math.round(geometry.cy)));
  xfrm.appendChild(off);
  xfrm.appendChild(ext);
  spPr.appendChild(xfrm);
  const prstGeom = createElementNS(doc, "a", "prstGeom");
  prstGeom.setAttribute("prst", "rect");
  prstGeom.appendChild(createElementNS(doc, "a", "avLst"));
  spPr.appendChild(prstGeom);
  spPr.appendChild(createElementNS(doc, "a", "noFill"));
  sp.appendChild(spPr);

  // p:txBody — explicitly constructed paragraphs only.
  const txBody = createElementNS(doc, "p", "txBody");
  const bodyPr = createElementNS(doc, "a", "bodyPr");
  bodyPr.setAttribute("wrap", "square");
  bodyPr.setAttribute("lIns", "19050");
  bodyPr.setAttribute("tIns", "9525");
  bodyPr.setAttribute("rIns", "38100");
  bodyPr.setAttribute("bIns", "9525");
  bodyPr.setAttribute("anchor", "t");
  // Schema-valid autofit: PowerPoint scales text down (never clips) when the
  // content exceeds the box, while 12pt remains the authored size for normal
  // content. This is the safety net for very long wrapped commentary.
  bodyPr.appendChild(createElementNS(doc, "a", "normAutofit"));
  txBody.appendChild(bodyPr);
  txBody.appendChild(createElementNS(doc, "a", "lstStyle"));
  for (const line of lines) {
    txBody.appendChild(makeReadoutParagraph(doc, line.kind, line.text));
  }
  sp.appendChild(txBody);

  return sp;
}

/**
 * Deterministic, conservative estimate of how many VISUAL lines a readout
 * line occupies after word-wrap, so the box height is allocated before
 * PowerPoint lays text out.
 *
 * A single paragraph can wrap across several visual lines even though it is
 * one <a:p>. At the authored 12pt size, an average Aptos glyph is roughly
 * 6.6pt wide; chars per line = usable width (pt) / 6.6. Long real commentary
 * (e.g. TWCI / WAWA/JVC August notes) wraps to many visual lines.
 */
export function estimateReadoutVisualLines(text: string, usableWidthEmu: number): number {
  if (!text) return 0;
  const usableWidthPt = usableWidthEmu / 12700; // 1pt = 12700 EMU
  const avgCharWidthPt = 6.6;
  const charsPerLine = Math.max(8, Math.floor(usableWidthPt / avgCharWidthPt));
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

/**
 * Required box height for the readout lines, accounting for wrapped visual
 * lines. Each visual line is budgeted 190000 EMU (~12pt at 1.3 line spacing
 * plus a small paragraph gap) plus an 80000 EMU paragraph lead-in.
 */
export function requiredReadoutHeightEmu(
  lines: ReadoutLine[],
  usableWidthEmu: number,
  minHeightEmu: number
): number {
  let visualLines = 0;
  for (const line of lines) {
    visualLines += estimateReadoutVisualLines(line.text, usableWidthEmu);
  }
  const lineBudgetEmu = 190000;
  const paragraphLeadEmu = 80000;
  return Math.max(
    minHeightEmu,
    visualLines * lineBudgetEmu + paragraphLeadEmu
  );
}

/**
 * Replace the donor "Executive Readout" shape with a freshly generated text
 * box that owns the visible Notes / Situation content.
 *
 * The donor is consulted ONLY for its horizontal geometry (x/cx of the
 * lower-left readout area). Its text body is never used. The new shape is
 * appended last in the slide shape tree (topmost z-order) at the caller's
 * computed top Y, sized for the line count.
 */
export function writeNotesSituationReadout(
  doc: XmlDocument,
  donorShape: XmlElement | null,
  lines: ReadoutLine[],
  topY: number,
  heightMinEmu = 700000,
  fallback: { x: number; cx: number } = { x: 327478, cx: 8561614 },
  slideHeightEmu = 6858000,
  bottomPadEmu = 140000
): XmlElement | null {
  const donorGeometry = donorShape ? readoutShapeGeometry(donorShape) : null;
  const x = donorGeometry ? donorGeometry.x : fallback.x;
  const cx = donorGeometry ? donorGeometry.cx : fallback.cx;

  // Conservative wrapped-content height: long single paragraphs (EWG/LAWC/
  // TWCI/WAWA/JVC August commentary) wrap across several VISUAL lines and must
  // never be clipped. Cap the box so it stays on-slide above the footer/bottom
  // margin; the bodyPr normAutofit is the final safety net for extreme text.
  const usableWidthEmu = Math.max(cx - 19050 - 38100, 100000);
  const neededHeight = requiredReadoutHeightEmu(lines, usableWidthEmu, heightMinEmu);
  const availableHeight = Math.max(heightMinEmu, slideHeightEmu - topY - bottomPadEmu);
  const cy = Math.min(neededHeight, availableHeight);

  // Remove the donor shape entirely; its text state can no longer influence
  // what PowerPoint shows.
  if (donorShape) removeReadoutShape(donorShape);

  const textBox = createReadoutTextBox(doc, { x, y: topY, cx, cy }, lines);

  // Append to the end of the slide shape tree so the readout is a real,
  // topmost slide object (nothing can cover it).
  const spTree = getElementsByTagNameNS(doc, "p", "spTree")[0];
  if (spTree) spTree.appendChild(textBox);
  return textBox;
}

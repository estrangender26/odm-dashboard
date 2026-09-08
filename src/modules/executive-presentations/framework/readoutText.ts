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
 * Make a run's effective formatting deterministic from `opts` even when the
 * run was retained from a donor paragraph:
 *
 * - collapses duplicate <a:rPr> elements (keeps the first, removes the rest);
 * - creates a missing <a:rPr> as the FIRST child of <a:r> (before <a:t>);
 * - resets lang/sz/b from opts;
 * - REPLACES every inherited child of <a:rPr> (fills, highlight, outlines,
 *   typefaces, scheme colors, …) with the canonical solidFill + Aptos set, so
 *   no conflicting donor formatting (e.g. a light/background color that makes
 *   the text invisible) can survive.
 *
 * Never creates a nested <a:r> and never duplicates rPr/solidFill.
 */
function applyRunFormatting(
  run: XmlElement,
  opts: { bold?: boolean; size?: number; color?: string }
): void {
  const ownerDoc = run.ownerDocument as XmlDocument;
  const rPrs = getElementsByTagNameNS(run, "a", "rPr");
  for (let i = rPrs.length - 1; i >= 1; i--) {
    run.removeChild(rPrs[i]);
  }
  let rPr = rPrs[0];
  if (!rPr) {
    rPr = createElementNS(ownerDoc, "a", "rPr");
    // <a:r> children must be (rPr?, t): insert before any existing <a:t>.
    run.insertBefore(rPr, run.firstChild);
  } else {
    // Update in place: drop every inherited formatting child, then rebuild the
    // canonical set below (no duplicate solidFill, no leftover schemeClr).
    while (rPr.firstChild) rPr.removeChild(rPr.firstChild);
  }
  rPr.setAttribute("lang", "en-PH");
  rPr.setAttribute("sz", String(opts.size ?? 1200));
  rPr.setAttribute("b", opts.bold ? "1" : "0");
  rPr.appendChild(appendSolidFill(ownerDoc, opts.color ?? "111111"));
  appendAptosTypefaces(ownerDoc, rPr);
}

function setParagraphText(
  paragraph: XmlElement,
  text: string,
  opts: { bold?: boolean; size?: number; color?: string }
): void {
  const ownerDoc = paragraph.ownerDocument as XmlDocument;
  const runs = getElementsByTagNameNS(paragraph, "a", "r");
  for (let i = 1; i < runs.length; i++) paragraph.removeChild(runs[i]);
  const keep = runs[0];
  if (keep) {
    // Normalize the retained run's rPr from opts BEFORE writing text, so the
    // donor's inherited formatting can never make the line invisible or
    // visually inconsistent (e.g. a leftover light scheme color or a large
    // donor font size). Text is written into the existing run's <a:t> only -
    // appending a whole new <a:r> inside an existing <a:r> would nest runs.
    applyRunFormatting(keep, opts);
    const t = getElementsByTagNameNS(keep, "a", "t")[0];
    if (t) {
      t.textContent = text;
    } else {
      const textNode = createElementNS(ownerDoc, "a", "t");
      textNode.textContent = text;
      keep.appendChild(textNode);
    }
  } else {
    paragraph.appendChild(createTextRun(ownerDoc, text, opts));
  }
}

function makeHeadingParagraph(paragraph: XmlElement): void {
  // Headings carry no bullet marker and no hanging indent.
  const pPr = getElementsByTagNameNS(paragraph, "a", "pPr")[0];
  if (!pPr) return;
  pPr.setAttribute("marL", "0");
  pPr.setAttribute("indent", "0");
  for (const localName of ["buFont", "buChar"]) {
    const children = [...pPr.childNodes];
    for (const child of children) {
      const el = child as unknown as XmlElement;
      if (el && el.localName === localName) pPr.removeChild(child);
    }
  }
  if (getElementsByTagNameNS(pPr, "a", "buNone")[0]) return;

  const ownerDoc = paragraph.ownerDocument as XmlDocument;
  const buNone = createElementNS(ownerDoc, "a", "buNone");
  // DrawingML requires <a:buNone> BEFORE tabLst/defRPr/extLst inside <a:pPr>.
  // Inserting at the end (after defRPr) is schema-invalid and can make
  // PowerPoint reject the slide. Place it before the first later-property
  // element, mirroring where <a:buChar> used to sit.
  const pPrChildren = [...pPr.childNodes];
  const laterProperty = pPrChildren.find((child) => {
    const el = child as unknown as XmlElement;
    return (
      el &&
      el.namespaceURI === "http://schemas.openxmlformats.org/drawingml/2006/main" &&
      (el.localName === "tabLst" ||
        el.localName === "defRPr" ||
        el.localName === "extLst")
    );
  });
  if (laterProperty) {
    pPr.insertBefore(buNone, laterProperty);
  } else {
    pPr.appendChild(buNone);
  }
}

/**
 * Render the heading/bullet lines into the Executive Readout shape.
 *
 * A pristine copy of the template's bullet paragraph is captured BEFORE any
 * mutation and is never modified. Every output paragraph (headings AND
 * bullets) is a fresh clone of that pristine template: heading clones get
 * their bullet suppressed via buNone, bullet clones keep the original bullet
 * properties. Mutating one paragraph can therefore never leak "no bullet"
 * formatting onto content paragraphs.
 */
export function writeReadoutLines(
  shape: XmlElement,
  lines: ReadoutLine[]
): void {
  const txBody = getElementsByTagNameNS(shape, "p", "txBody")[0];
  if (!txBody) return;

  const pristineSource = getElementsByTagNameNS(txBody, "a", "p")[0];
  if (!pristineSource) return;

  // Canonical bullet paragraph template - captured before any mutation and
  // kept pristine for every content paragraph clone.
  const pristineBulletParagraph = pristineSource.cloneNode(true) as XmlElement;

  // Drop the donor's placeholder paragraph(s); every line is appended fresh
  // so no heading mutation can contaminate later bullet clones.
  let live = getElementsByTagNameNS(txBody, "a", "p");
  while (live.length > 0) {
    txBody.removeChild(live[live.length - 1]);
    live = getElementsByTagNameNS(txBody, "a", "p");
  }

  for (const line of lines) {
    const paragraph = pristineBulletParagraph.cloneNode(true) as XmlElement;
    if (line.kind === "heading") {
      makeHeadingParagraph(paragraph);
      setParagraphText(paragraph, line.text, {
        bold: true,
        size: 1200,
        color: "172B47",
      });
    } else {
      setParagraphText(paragraph, line.text, {
        bold: false,
        size: 1200,
        color: "111111",
      });
    }
    txBody.appendChild(paragraph);
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

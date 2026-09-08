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

function createTextRun(
  ownerDoc: XmlDocument,
  text: string,
  opts: { bold?: boolean; size?: number; color?: string }
): XmlElement {
  const run = createElementNS(ownerDoc, "a", "r");
  const rPr = createElementNS(ownerDoc, "a", "rPr");
  rPr.setAttribute("lang", "en-PH");
  rPr.setAttribute("sz", String(opts.size ?? 1200));
  rPr.setAttribute("b", opts.bold ? "1" : "0");
  const solidFill = createElementNS(ownerDoc, "a", "solidFill");
  const srgbClr = createElementNS(ownerDoc, "a", "srgbClr");
  srgbClr.setAttribute("val", opts.color ?? "111111");
  solidFill.appendChild(srgbClr);
  rPr.appendChild(solidFill);
  for (const name of ["latin", "ea", "cs"]) {
    const el = createElementNS(ownerDoc, "a", name);
    el.setAttribute("typeface", "Aptos");
    rPr.appendChild(el);
  }
  run.appendChild(rPr);
  const t = createElementNS(ownerDoc, "a", "t");
  t.textContent = text;
  run.appendChild(t);
  return run;
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
    const t = getElementsByTagNameNS(keep, "a", "t")[0];
    if (t) t.textContent = text;
    else keep.appendChild(createTextRun(ownerDoc, text, opts));
  } else {
    paragraph.appendChild(createTextRun(ownerDoc, text, opts));
  }
}

function makeHeadingParagraph(paragraph: XmlElement): void {
  // Headings carry no bullet marker.
  const pPr = getElementsByTagNameNS(paragraph, "a", "pPr")[0];
  if (!pPr) return;
  for (const localName of ["buFont", "buChar"]) {
    const children = [...pPr.childNodes];
    for (const child of children) {
      const el = child as unknown as XmlElement;
      if (el && el.localName === localName) pPr.removeChild(child);
    }
  }
  if (!getElementsByTagNameNS(pPr, "a", "buNone")[0]) {
    const buNone = createElementNS(
      paragraph.ownerDocument as XmlDocument,
      "a",
      "buNone"
    );
    pPr.appendChild(buNone);
  }
}

/**
 * Render the heading/bullet lines into the Executive Readout shape, reusing
 * the template paragraph (bullet char + autofit) for bullets and suppressing
 * the bullet for section headings.
 */
export function writeReadoutLines(
  shape: XmlElement,
  lines: ReadoutLine[]
): void {
  const txBody = getElementsByTagNameNS(shape, "p", "txBody")[0];
  if (!txBody) return;

  const templateParagraph = getElementsByTagNameNS(txBody, "a", "p")[0];
  if (!templateParagraph) return;

  // Trim any leftover paragraphs from earlier fills.
  let live = getElementsByTagNameNS(txBody, "a", "p");
  while (live.length > lines.length) {
    txBody.removeChild(live[live.length - 1]);
    live = getElementsByTagNameNS(txBody, "a", "p");
  }

  for (let i = 0; i < lines.length; i++) {
    live = getElementsByTagNameNS(txBody, "a", "p");
    const paragraph =
      i < live.length
        ? live[i]
        : (txBody.appendChild(templateParagraph.cloneNode(true)) as XmlElement);
    const line = lines[i];
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
  }

  live = getElementsByTagNameNS(txBody, "a", "p");
  while (live.length > lines.length) {
    txBody.removeChild(live[live.length - 1]);
    live = getElementsByTagNameNS(txBody, "a", "p");
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

/**
 * Presentation-only cleanup for generated Monthly KPI decks.
 *
 * 1. REMOVES the legacy MTTR methodology paragraph
 *      "MTTR – Calculation methodology is currently being realigned. Indicative
 *       MTTR stands at 121 calendar days for SLA and 74 calendar days ..."
 *    from every slide body and every speaker-notes part. MTTR KPI values,
 *    calculations and target semantics are NOT touched - this is display text
 *    cleanup only.
 *
 * 2. REMOVES ALL PowerPoint reviewer/collaboration comment artifacts:
 *    - comment parts (ppt/comments/comment*.xml and any legacy equivalents),
 *    - the presentation commentAuthors part,
 *    - relationship entries that point at comments/commentAuthors,
 *    - content-type overrides for those parts.
 *
 * Slides, charts, tables, themes, speaker notes content and required
 * metadata are preserved.
 */

import type JSZip from "jszip";
import { createElementNS, getElementsByTagNameNS, parseXml, serializeXml } from "./xml";
import type { XmlDocument, XmlElement } from "./types";

const MTTR_METHODOLOGY_MARKER =
  "MTTR – Calculation methodology is currently being realigned";

function partLooksLikeComments(name: string): boolean {
  const base = name.replace(/^\//, "").toLowerCase();
  return (
    base.startsWith("ppt/comments/") ||
    base.startsWith("ppt/commentauthors") ||
    /\/commentsl?ist/.test(base) ||
    /^ppt\/[^/]*comments/i.test(base)
  );
}

function isCommentPartReference(target: string): boolean {
  const t = target.toLowerCase();
  return (
    t.includes("/comments/") ||
    t.includes("commentauthors") ||
    t.includes("commentauthor") ||
    /comment_?\d/i.test(t)
  );
}

/**
 * Concatenated text of an <a:p> paragraph (all descendant <a:t> runs).
 */
function paragraphText(paragraph: XmlElement): string {
  return getElementsByTagNameNS(paragraph, "a", "t")
    .map((run) => run.textContent ?? "")
    .join("");
}

/**
 * Text bodies are <p:txBody> / <p:notesTxBody> elements whose children are
 * drawingml <a:p> paragraphs. CT_TextBody requires at least one <a:p>, so a
 * body must never be left empty after paragraph removal.
 */
function isTextBodyContainer(node: XmlElement): boolean {
  const local = node.localName ?? node.nodeName.replace(/^.*:/, "");
  return local === "txBody" || local === "notesTxBody";
}

function insertEmptyParagraph(body: XmlElement, doc: XmlDocument): void {
  const paragraph = createElementNS(doc, "a", "p");
  paragraph.appendChild(createElementNS(doc, "a", "endParaRPr"));
  body.appendChild(paragraph);
}

/**
 * Remove every <a:p> whose text contains the legacy MTTR methodology marker.
 *
 * Removal is done on the parsed XML tree (not raw string slicing). After each
 * affected text body loses paragraphs it is guaranteed to still hold at least
 * one <a:p> — when the marker paragraph was the ONLY paragraph, a minimal
 * schema-valid empty paragraph (<a:p><a:endParaRPr/></a:p>, equivalent to
 * PowerPoint's own repair) is appended. Unrelated paragraphs and shapes are
 * never touched. Returns the original string when nothing was removed.
 */
function removeMttrMethodologyParagraphs(xml: string): string {
  const doc = parseXml(xml);
  const offenders = getElementsByTagNameNS(doc, "a", "p").filter((paragraph) =>
    paragraphText(paragraph).includes(MTTR_METHODOLOGY_MARKER)
  );
  if (offenders.length === 0) return xml;

  const affectedBodies = new Set<XmlElement>();
  for (const paragraph of offenders) {
    const parent = paragraph.parentNode as XmlElement | null;
    if (!parent) continue;
    parent.removeChild(paragraph);
    if (isTextBodyContainer(parent)) affectedBodies.add(parent);
  }
  for (const body of affectedBodies) {
    if (getElementsByTagNameNS(body, "a", "p").length === 0) {
      insertEmptyParagraph(body, doc);
    }
  }
  return serializeXml(doc);
}

/**
 * Canonical Monthly KPI body parts that may carry slide/speaker-notes text:
 *   - ppt/slides/slide1.xml          (drawingml slide bodies)
 *   - ppt/notesSlides/notesSlide1.xml (speaker-notes bodies)
 *
 * Matching is explicit per canonical form so relationship parts
 * (ppt/slides/_rels/slide1.xml.rels, …/notesSlide1.xml.rels), masters,
 * layouts and any other package part are never selected.
 */
export function isMonthlyKpiBodyPart(name: string): boolean {
  const base = name.replace(/^\//, "");
  return (
    /^ppt\/slides\/slide\d+\.xml$/.test(base) ||
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(base)
  );
}

export async function cleanMonthlyKpiPresentationZip(zip: JSZip): Promise<void> {
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  // 1) Drop the MTTR methodology paragraph from slide AND speaker-notes
  //    bodies (both canonical slide/notesSlide part names). A body that
  //    hosted the marker is never left with zero <a:p> children (see
  //    removeMttrMethodologyParagraphs).
  for (const name of names) {
    if (!isMonthlyKpiBodyPart(name)) continue;
    const xml = await zip.file(name)!.async("string");
    if (!xml.includes(MTTR_METHODOLOGY_MARKER)) continue;
    const cleaned = removeMttrMethodologyParagraphs(xml);
    if (cleaned !== xml) zip.file(name, cleaned);
  }

  // 2) Remove comment/commentAuthors parts.
  for (const name of names) {
    if (partLooksLikeComments(name)) {
      zip.remove(name);
    }
  }

  // 3) Drop comment relationships from every .rels part.
  for (const name of names) {
    if (!name.endsWith(".rels")) continue;
    const rels = await zip.file(name)!.async("string");
    const kept = rels.replace(
      /<Relationship\b[^>]*Target="[^"]*"[^>]*\/>/g,
      (full) =>
        /Target="[^"]*"(?:[^>]*)?\/?>/.test(full) &&
        isCommentPartReference(/Target="([^"]+)"/.exec(full)?.[1] ?? "")
          ? ""
          : full
    );
    if (kept !== rels) zip.file(name, kept);
  }

  // 4) Drop content-type overrides for removed comment parts.
  const ctName = "[Content_Types].xml";
  if (zip.file(ctName)) {
    const ct = await zip.file(ctName)!.async("string");
    const kept = ct.replace(
      /<Override\b[^>]*PartName="[^"]*"[^>]*\/>/g,
      (full) =>
        /PartName="\/ppt\/comments\/[^"]+"|PartName="\/ppt\/commentAuthors\.xml"/i.test(full)
          ? ""
          : full
    );
    if (kept !== ct) zip.file(ctName, kept);
  }
}

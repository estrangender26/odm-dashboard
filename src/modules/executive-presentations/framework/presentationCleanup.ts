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

export async function cleanMonthlyKpiPresentationZip(zip: JSZip): Promise<void> {
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  // 1) Drop the MTTR methodology paragraph from slide/notes bodies.
  for (const name of names) {
    if (!/^ppt\/(slides|notesSlides)\/slide\d+\.xml$/.test(name)) continue;
    const xml = await zip.file(name)!.async("string");
    if (!xml.includes(MTTR_METHODOLOGY_MARKER)) continue;
    let next = xml;
    do {
      const markerIndex = next.indexOf(MTTR_METHODOLOGY_MARKER);
      if (markerIndex < 0) break;
      const paragraphStart = next.lastIndexOf("<a:p>", markerIndex);
      const paragraphEnd = next.indexOf("</a:p>", markerIndex);
      if (paragraphStart < 0 || paragraphEnd < 0) break;
      next = next.slice(0, paragraphStart) + next.slice(paragraphEnd + "</a:p>".length);
    } while (next.includes(MTTR_METHODOLOGY_MARKER));
    if (next !== xml) zip.file(name, next);
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

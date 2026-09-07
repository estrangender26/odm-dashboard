/**
 * Low-level PPTX package surgery used to assemble decks that clone donor
 * slides from a committed template (the All-Business-Units Monthly KPI deck).
 *
 * Every operation mutates a JSZip package and keeps the three registries
 * consistent:
 *  - [Content_Types].xml overrides
 *  - ppt/_rels/presentation.xml.rels (slide relationships)
 *  - ppt/presentation.xml <p:sldIdLst> (slide order)
 */

import type JSZip from "jszip";

export const SLIDE_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
export const CHART_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";

const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

export function slideContentTypesXml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<Relationships xmlns="${RELS_NS}"></Relationships>`
  );
}

export async function readText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`[SLIDE-PACKAGE] Missing part: ${path}`);
  return file.async("string");
}

export async function readBuffer(zip: JSZip, path: string): Promise<Buffer> {
  const file = zip.file(path);
  if (!file) throw new Error(`[SLIDE-PACKAGE] Missing part: ${path}`);
  return file.async("nodebuffer");
}

/** Largest slide number currently present in ppt/slides (part-file based). */
export async function maxSlideNumber(zip: JSZip): Promise<number> {
  const names = Object.keys(zip.files);
  let max = 0;
  for (const name of names) {
    const m = name.match(/^ppt\/slides\/slide(\d+)\.xml$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Largest chart number currently present in ppt/charts. */
export async function maxChartNumber(zip: JSZip): Promise<number> {
  const names = Object.keys(zip.files);
  let max = 0;
  for (const name of names) {
    const m = name.match(/^ppt\/charts\/chart(\d+)\.xml$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

async function ensureContentTypeOverride(
  zip: JSZip,
  partName: string,
  contentType: string
): Promise<void> {
  const ctPath = "[Content_Types].xml";
  const xml = await readText(zip, ctPath);
  const escaped = partName.replace(/"/g, "&quot;");
  if (xml.includes(`PartName="${escaped}"`)) return;
  const marker = `</Types>`;
  const override = `<Override PartName="${escaped}" ContentType="${contentType}"/>`;
  if (!xml.includes(marker)) {
    throw new Error(`[SLIDE-PACKAGE] [Content_Types].xml missing </Types>`);
  }
  zip.file(ctPath, xml.replace(marker, `${override}${marker}`));
}

/**
 * Register a brand-new slide part (slide XML + its relationship file).
 * Content-type override is added and the caller is expected to rebuild the
 * presentation slide order afterwards via setPresentationSlideOrder.
 */
export async function addSlidePart(
  zip: JSZip,
  slideNumber: number,
  slideXml: string,
  relsXml: string
): Promise<string> {
  const slidePath = `ppt/slides/slide${slideNumber}.xml`;
  if (zip.file(slidePath)) {
    throw new Error(`[SLIDE-PACKAGE] Slide already exists: ${slidePath}`);
  }
  zip.file(slidePath, slideXml);
  zip.file(`ppt/slides/_rels/slide${slideNumber}.xml.rels`, relsXml);
  await ensureContentTypeOverride(
    zip,
    `/${slidePath}`,
    SLIDE_CONTENT_TYPE
  );
  return slidePath;
}

/** Delete a slide part plus its rels and content-type override. */
export async function removeSlidePart(
  zip: JSZip,
  slideNumber: number
): Promise<void> {
  const slidePath = `ppt/slides/slide${slideNumber}.xml`;
  zip.remove(slidePath);
  zip.remove(`ppt/slides/_rels/slide${slideNumber}.xml.rels`);
  const ctPath = "[Content_Types].xml";
  const xml = await readText(zip, ctPath);
  const needle = `<Override PartName="/${slidePath}" ContentType="${SLIDE_CONTENT_TYPE}"/>`;
  zip.file(ctPath, xml.split(needle).join(""));
}

/**
 * Clone chart parts (xml + its own rels + embedded workbook). The embedded
 * workbook referenced by the source chart part rels is copied under the new
 * chart number as well.
 */
export async function addChartClone(
  zip: JSZip,
  sourceChartNumber: number,
  targetChartNumber: number
): Promise<void> {
  const srcChart = `ppt/charts/chart${sourceChartNumber}.xml`;
  const tgtChart = `ppt/charts/chart${targetChartNumber}.xml`;
  if (zip.file(tgtChart)) {
    throw new Error(`[SLIDE-PACKAGE] Chart already exists: ${tgtChart}`);
  }
  const chartXml = await readText(zip, srcChart);
  zip.file(tgtChart, chartXml);

  const srcRels = `ppt/charts/_rels/chart${sourceChartNumber}.xml.rels`;
  const srcRelsXml = await readText(zip, srcRels);
  // The donor chart rel file references its embedded workbook by file name.
  const embedMatch = srcRelsXml.match(/Target="\.\.\/embeddings\/([^"]+)"/);
  if (!embedMatch) {
    throw new Error(`[SLIDE-PACKAGE] Chart rels missing embedding target: ${srcRels}`);
  }
  const embedName = embedMatch[1];
  const newEmbedName = embedName.replace(
    /Worksheet\d+/,
    `Worksheet${targetChartNumber}`
  );
  zip.file(
    `ppt/charts/_rels/chart${targetChartNumber}.xml.rels`,
    srcRelsXml.replace(
      new RegExp(`(\\.\\./embeddings/)${escapeRegExp(embedName)}`),
      `$1${newEmbedName}`
    )
  );
  const embedBuffer = await readBuffer(zip, `ppt/embeddings/${embedName}`);
  zip.file(`ppt/embeddings/${newEmbedName}`, embedBuffer);
  await ensureContentTypeOverride(zip, `/${tgtChart}`, CHART_CONTENT_TYPE);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rebuild ppt/presentation.xml so the deck plays exactly the supplied slide
 * order. Relationship entries are added for slide files that do not yet have
 * one; existing extra relationships are preserved.
 */
export async function setPresentationSlideOrder(
  zip: JSZip,
  slideNumbers: number[]
): Promise<void> {
  const presPath = "ppt/presentation.xml";
  const relsPath = "ppt/_rels/presentation.xml.rels";
  const pres = await readText(zip, presPath);
  const rels = await readText(zip, relsPath);

  const relIdByTarget = new Map<string, string>();
  let maxRId = 0;
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/Id="(rId\d+)"/)?.[1];
    const target = m[0].match(/Target="([^"]+)"/)?.[1];
    if (id && target) {
      relIdByTarget.set(target, id);
      const num = Number(id.replace("rId", ""));
      if (Number.isFinite(num)) maxRId = Math.max(maxRId, num);
    }
  }

  const newRels: string[] = [];
  const orderedSldIds: string[] = [];
  let usedId = 9000;
  for (const slideNumber of slideNumbers) {
    const target = `slides/slide${slideNumber}.xml`;
    let relId = relIdByTarget.get(target);
    if (!relId) {
      relId = `rId${++maxRId}`;
      newRels.push(
        `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${target}"/>`
      );
    }
    orderedSldIds.push(`<p:sldId id="${usedId++}" r:id="${relId}"/>`);
  }

  const nextPres = pres.replace(
    /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
    `<p:sldIdLst>${orderedSldIds.join("")}</p:sldIdLst>`
  );
  zip.file(presPath, nextPres);

  if (newRels.length > 0) {
    zip.file(
      relsPath,
      rels.replace("</Relationships>", `${newRels.join("")}</Relationships>`)
    );
  }
}

/** Add an xlsx Default content type when missing (used by chart parts). */
export async function ensureXlsxDefault(zip: JSZip): Promise<void> {
  const ctPath = "[Content_Types].xml";
  const xml = await readText(zip, ctPath);
  if (xml.includes('Extension="xlsx"')) return;
  zip.file(
    ctPath,
    xml.replace(
      "</Types>",
      '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/></Types>'
    )
  );
}

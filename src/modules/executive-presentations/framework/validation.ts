/**
 * Template-output validation helpers.
 */

import type JSZip from "jszip";
import { parseXml } from "./xml";
import { hundredthsToPoints } from "./typography";
import { getElementsByTagNameNS } from "./xml";

export async function getSlideCount(zip: JSZip): Promise<number> {
  const xml = await zip.file("ppt/presentation.xml")?.async("string");
  if (!xml) return 0;
  const doc = parseXml(xml);
  return doc.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/presentationml/2006/main",
    "sldId"
  ).length;
}

export async function getShapeCounts(zip: JSZip): Promise<
  Record<
    string,
    { sp: number; graphicFrame: number }
  >
> {
  const result: Record<string, { sp: number; graphicFrame: number }> = {};
  const slideFiles = Object.keys(zip.files).filter(
    (f) => f.startsWith("ppt/slides/slide") && f.endsWith(".xml")
  );
  for (const slideFile of slideFiles.sort()) {
    const xml = await zip.file(slideFile)?.async("string");
    if (!xml) continue;
    const doc = parseXml(xml);
    result[slideFile] = {
      sp: doc.getElementsByTagNameNS(
        "http://schemas.openxmlformats.org/presentationml/2006/main",
        "sp"
      ).length,
      graphicFrame: doc.getElementsByTagNameNS(
        "http://schemas.openxmlformats.org/presentationml/2006/main",
        "graphicFrame"
      ).length,
    };
  }
  return result;
}

export async function getMinimumFontSizeHundredths(
  zip: JSZip
): Promise<number | null> {
  let minimum: number | null = null;
  const slideFiles = Object.keys(zip.files).filter(
    (f) => f.startsWith("ppt/slides/slide") && f.endsWith(".xml")
  );
  for (const slideFile of slideFiles) {
    const xml = await zip.file(slideFile)?.async("string");
    if (!xml) continue;
    const doc = parseXml(xml);
    for (const el of getElementsByTagNameNS(doc as any, "a", "defRPr")) {
      const sz = el.getAttribute("sz");
      if (sz) {
        const value = Number.parseInt(sz, 10);
        if (Number.isFinite(value)) {
          minimum = minimum === null ? value : Math.min(minimum, value);
        }
      }
    }
    for (const el of getElementsByTagNameNS(doc as any, "a", "rPr")) {
      const sz = el.getAttribute("sz");
      if (sz) {
        const value = Number.parseInt(sz, 10);
        if (Number.isFinite(value)) {
          minimum = minimum === null ? value : Math.min(minimum, value);
        }
      }
    }
  }
  return minimum;
}

export async function getMinimumFontSizePoints(
  zip: JSZip
): Promise<number | null> {
  const hundredths = await getMinimumFontSizeHundredths(zip);
  return hundredths === null ? null : hundredthsToPoints(hundredths);
}

export function collectPlaceholderLeakage(
  zip: JSZip,
  placeholders: string[]
): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  const slideFiles = Object.keys(zip.files).filter(
    (f) => f.startsWith("ppt/slides/slide") && f.endsWith(".xml")
  );
  const checks = placeholders.map((placeholder) => ({
    placeholder,
    regex: new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
  }));

  return (async () => {
    for (const slideFile of slideFiles) {
      const xml = await zip.file(slideFile)?.async("string");
      if (!xml) continue;
      for (const { placeholder, regex } of checks) {
        if (regex.test(xml)) {
          (result[slideFile] ??= []).push(placeholder);
        }
      }
    }
    return result;
  })();
}

export function hasPlaceholderLeakage(
  zip: JSZip,
  placeholders: string[]
): Promise<boolean> {
  return collectPlaceholderLeakage(zip, placeholders).then(
    (leakage) => Object.keys(leakage).length > 0
  );
}

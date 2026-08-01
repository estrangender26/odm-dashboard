/**
 * Low-level PPTX package operations.
 */

import fs from "fs";
import JSZip from "jszip";
import { parseXml, serializeXml } from "./xml";
import type { GenerateOptions, XmlDocument } from "./types";

export async function loadPptxTemplate(templatePath: string): Promise<JSZip> {
  const buffer = fs.readFileSync(templatePath);
  return JSZip.loadAsync(buffer);
}

export async function cloneTemplatePackage(zip: JSZip): Promise<JSZip> {
  // JSZip objects are not deeply immutable, so we serialize and reload to
  // guarantee isolated mutations between generator runs.
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "STORE",
  });
  return JSZip.loadAsync(buffer);
}

export async function loadSlideXml(
  zip: JSZip,
  slidePath: string
): Promise<XmlDocument> {
  const xml = await zip.file(slidePath)?.async("string");
  if (!xml) throw new Error(`[TEMPLATE] Missing slide XML: ${slidePath}`);
  return parseXml(xml);
}

export function saveSlideXml(
  zip: JSZip,
  slidePath: string,
  doc: XmlDocument
): void {
  zip.file(slidePath, serializeXml(doc));
}

export async function generatePptxBlob(
  zip: JSZip,
  options: GenerateOptions = {}
): Promise<Blob> {
  const { compression = "DEFLATE", compressionLevel = 6 } = options;
  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    compression,
    compressionOptions:
      compression === "DEFLATE" ? { level: compressionLevel } : undefined,
  });
}

export async function generatePptxArrayBuffer(
  zip: JSZip,
  options: GenerateOptions = {}
): Promise<ArrayBuffer> {
  const blob = await generatePptxBlob(zip, options);
  return blob.arrayBuffer();
}

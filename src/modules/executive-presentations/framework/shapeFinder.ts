/**
 * Locate named shapes and graphic frames inside slide XML.
 */

import { NS, getElementsByTagNameNS } from "./xml";
import type { XmlDocument, XmlElement } from "./types";

export function getShapeName(shape: XmlElement): string {
  const cNvPr = getElementsByTagNameNS(shape, "p", "cNvPr")[0];
  return cNvPr?.getAttribute("name") ?? "";
}

export function findShapeByName(
  doc: XmlDocument,
  name: string
): XmlElement | null {
  const shapes = doc.getElementsByTagNameNS(NS.p, "sp");
  for (let i = 0; i < shapes.length; i++) {
    if (getShapeName(shapes[i] as XmlElement) === name) {
      return shapes[i] as XmlElement;
    }
  }
  return null;
}

export function findGraphicFrameByName(
  doc: XmlDocument,
  name: string
): XmlElement | null {
  const frames = doc.getElementsByTagNameNS(NS.p, "graphicFrame");
  for (let i = 0; i < frames.length; i++) {
    if (getShapeName(frames[i] as XmlElement) === name) {
      return frames[i] as XmlElement;
    }
  }
  return null;
}

export function getTableRows(frame: XmlElement): XmlElement[] {
  const tbl = getElementsByTagNameNS(frame, "a", "tbl")[0];
  if (!tbl) return [];
  return getElementsByTagNameNS(tbl, "a", "tr");
}

export function getCells(row: XmlElement): XmlElement[] {
  return getElementsByTagNameNS(row, "a", "tc");
}

export function getCellText(cell: XmlElement): string {
  const paragraphs = getElementsByTagNameNS(cell, "a", "p");
  const parts: string[] = [];
  for (const p of paragraphs) {
    for (const t of getElementsByTagNameNS(p, "a", "t")) {
      parts.push(t.textContent ?? "");
    }
  }
  return parts.join("");
}

export function getShapeParagraphs(shape: XmlElement): XmlElement[] {
  const txBody = getElementsByTagNameNS(shape, "p", "txBody")[0];
  if (!txBody) return [];
  return getElementsByTagNameNS(txBody, "a", "p");
}

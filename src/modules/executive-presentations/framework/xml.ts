/**
 * XML namespace-aware helpers for OOXML PPTX manipulation.
 */

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { XmlDocument, XmlElement } from "./types";

export const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  rel: "http://schemas.openxmlformats.org/package/2006/relationships",
  ct: "http://schemas.openxmlformats.org/package/2006/content-types",
} as const;

export function parseXml(xml: string): XmlDocument {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  if (!doc.documentElement) {
    throw new Error("[XML] Failed to parse XML document");
  }
  return doc as XmlDocument;
}

export function serializeXml(doc: XmlDocument): string {
  const serializer = new XMLSerializer();
  return serializer.serializeToString(doc);
}

export function createElementNS(
  ownerDoc: XmlDocument,
  namespace: keyof typeof NS,
  localName: string
): XmlElement {
  return ownerDoc.createElementNS(NS[namespace], `${namespace}:${localName}`) as XmlElement;
}

export function getElementsByTagNameNS(
  parent: XmlElement | XmlDocument,
  namespace: keyof typeof NS,
  localName: string
): XmlElement[] {
  const collection = parent.getElementsByTagNameNS(NS[namespace], localName);
  const result: XmlElement[] = [];
  for (let i = 0; i < collection.length; i++) {
    result.push(collection[i] as XmlElement);
  }
  return result;
}

export function getFirstElementByTagNameNS(
  parent: XmlElement | XmlDocument,
  namespace: keyof typeof NS,
  localName: string
): XmlElement | null {
  const elements = getElementsByTagNameNS(parent, namespace, localName);
  return elements[0] ?? null;
}

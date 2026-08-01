/**
 * Minimal relationship-file helpers used when constructing or inspecting
 * PPTX packages from templates.
 */

import { parseXml, serializeXml } from "./xml";
import type { XmlDocument, XmlElement } from "./types";

export function parseRelationshipsXml(xml: string): XmlDocument {
  return parseXml(xml);
}

export function serializeRelationshipsXml(doc: XmlDocument): string {
  return serializeXml(doc);
}

export function findRelationshipByType(
  doc: XmlDocument,
  typeFragment: string
): XmlElement | null {
  const rels = doc.getElementsByTagName("Relationship");
  for (let i = 0; i < rels.length; i++) {
    const type = rels[i].getAttribute("Type") ?? "";
    if (type.includes(typeFragment)) {
      return rels[i] as XmlElement;
    }
  }
  return null;
}

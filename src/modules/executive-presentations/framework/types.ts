/**
 * Shared types for the Executive Presentation Framework.
 *
 * The framework intentionally does not model every OOXML construct. It only
 * exposes the operations that both Monthly KPI and Governance generators
 * need to update text, tables, and relationships inside a committed PPTX
 * template while preserving the corporate master, theme, and formatting.
 */

import type JSZip from "jszip";
import type { Document as XmlDocument, Element as XmlElement } from "@xmldom/xmldom";

export type { XmlDocument, XmlElement };

export interface PptxPackage {
  zip: JSZip;
}

export interface SlideDefinition<TData> {
  name: string;
  updater: (doc: XmlDocument, data: TData) => void;
}

export interface GenerateOptions {
  compression?: "DEFLATE" | "STORE";
  compressionLevel?: number;
}

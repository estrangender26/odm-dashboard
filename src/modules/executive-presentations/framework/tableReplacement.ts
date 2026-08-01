/**
 * Table cell replacement helpers.
 */

import { setTextInParagraph } from "./textReplacement";
import { getElementsByTagNameNS } from "./xml";
import type { XmlElement } from "./types";

export function setCellText(cell: XmlElement, text: string): void {
  const txBody = getElementsByTagNameNS(cell, "a", "txBody")[0];
  if (!txBody) return;
  const paragraphs = getElementsByTagNameNS(txBody, "a", "p");
  for (const p of paragraphs) {
    setTextInParagraph(p, text);
  }
}

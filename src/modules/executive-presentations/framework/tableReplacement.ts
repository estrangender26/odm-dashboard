/**
 * Table cell replacement helpers.
 *
 * Replacing a cell's text collapses any existing multi-paragraph structure
 * into a single paragraph with the supplied text. This prevents duplicated
 * text when a template cell uses multiple paragraphs purely for line-break
 * layout (e.g. "PM" / "Compliance" header cells) while keeping the resulting
 * cell content deterministic.
 */

import { setTextInParagraph } from "./textReplacement";
import { getElementsByTagNameNS } from "./xml";
import type { XmlElement } from "./types";

export function setCellText(cell: XmlElement, text: string): void {
  const txBody = getElementsByTagNameNS(cell, "a", "txBody")[0];
  if (!txBody) return;
  const paragraphs = getElementsByTagNameNS(txBody, "a", "p");
  if (paragraphs.length === 0) return;

  // Replace the first paragraph and remove any additional paragraphs so the
  // cell contains exactly one paragraph of text.
  setTextInParagraph(paragraphs[0], text);
  for (let i = 1; i < paragraphs.length; i++) {
    txBody.removeChild(paragraphs[i]);
  }
}

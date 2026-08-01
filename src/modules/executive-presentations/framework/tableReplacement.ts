/**
 * Table cell replacement helpers.
 *
 * A table cell is a shape-like text body. We replace only the first
 * paragraph's visible text, preserve the cell's bodyPr/lstStyle, paragraph
 * properties, and the first run's rPr. Extra paragraphs are removed so cells
 * remain deterministic.
 */

import { NS, createElementNS } from "./xml";
import { setTextInParagraph } from "./textReplacement";
import { getElementsByTagNameNS } from "./xml";
import type { XmlElement } from "./types";

const DEFAULT_BODY_TEXT_COLOR = "172B47";

/**
 * Ensure a run has explicit body-cell formatting. If the run already has an
 * a:rPr we leave it untouched (template formatting is authoritative). If it is
 * missing, add a default 10 pt Aptos run property so empty cells that receive
 * data do not inherit a large endParaRPr/default theme size.
 */
function ensureRunProperties(run: XmlElement): void {
  const ownerDoc = run.ownerDocument;
  if (!ownerDoc) return;

  for (let i = 0; i < run.childNodes.length; i++) {
    const child = run.childNodes[i] as unknown as XmlElement;
    if (child.localName === "rPr" && child.namespaceURI === NS.a) {
      return;
    }
  }

  const rPr = createElementNS(ownerDoc, "a", "rPr");
  rPr.setAttribute("sz", "1000");
  rPr.setAttribute("b", "0");
  rPr.setAttribute("i", "0");
  rPr.setAttribute("u", "none");
  rPr.setAttribute("strike", "noStrike");
  rPr.setAttribute("kern", "1200");

  const solidFill = createElementNS(ownerDoc, "a", "solidFill");
  const srgbClr = createElementNS(ownerDoc, "a", "srgbClr");
  srgbClr.setAttribute("val", DEFAULT_BODY_TEXT_COLOR);
  solidFill.appendChild(srgbClr);
  rPr.appendChild(solidFill);

  const latin = createElementNS(ownerDoc, "a", "latin");
  latin.setAttribute("typeface", "Aptos");
  rPr.appendChild(latin);

  const ea = createElementNS(ownerDoc, "a", "ea");
  ea.setAttribute("typeface", "Aptos");
  rPr.appendChild(ea);

  const cs = createElementNS(ownerDoc, "a", "cs");
  cs.setAttribute("typeface", "Aptos");
  rPr.appendChild(cs);

  // Insert rPr before any text container children.
  const firstTextContainer = (() => {
    for (let i = 0; i < run.childNodes.length; i++) {
      const child = run.childNodes[i] as unknown as XmlElement;
      if (
        child.localName === "t" ||
        child.localName === "fld" ||
        child.localName === "ruby"
      ) {
        return run.childNodes[i];
      }
    }
    return null;
  })();

  if (firstTextContainer) {
    run.insertBefore(rPr, firstTextContainer);
  } else {
    run.appendChild(rPr);
  }
}

/**
 * Set a table cell's solid background fill to a specific sRGB hex color.
 * Creates or replaces the a:tcPr/a:solidFill/a:srgbClr value. Existing cell
 * properties such as borders and margins are preserved.
 */
export function setCellFill(cell: XmlElement, hexColor: string): void {
  const ownerDoc = cell.ownerDocument;
  if (!ownerDoc) return;

  let tcPr = getElementsByTagNameNS(cell, "a", "tcPr")[0];
  if (!tcPr) {
    tcPr = createElementNS(ownerDoc, "a", "tcPr");
    // Insert tcPr before txBody if present so OOXML order is correct.
    const txBody = getElementsByTagNameNS(cell, "a", "txBody")[0];
    if (txBody) {
      cell.insertBefore(tcPr, txBody);
    } else {
      cell.appendChild(tcPr);
    }
  }

  let solidFill = getElementsByTagNameNS(tcPr, "a", "solidFill")[0];
  if (!solidFill) {
    solidFill = createElementNS(ownerDoc, "a", "solidFill");
    tcPr.appendChild(solidFill);
  }

  // Remove existing srgbClr/prstClr children.
  for (let i = solidFill.childNodes.length - 1; i >= 0; i--) {
    const child = solidFill.childNodes[i] as unknown as XmlElement;
    if (child && (child.localName === "srgbClr" || child.localName === "prstClr")) {
      solidFill.removeChild(child);
    }
  }

  const srgbClr = createElementNS(ownerDoc, "a", "srgbClr");
  srgbClr.setAttribute("val", hexColor.replace("#", "").toUpperCase());
  solidFill.appendChild(srgbClr);
}

export function setCellText(cell: XmlElement, text: string): void {
  const txBody = getElementsByTagNameNS(cell, "a", "txBody")[0];
  if (!txBody) return;
  const paragraphs = getElementsByTagNameNS(txBody, "a", "p");
  if (paragraphs.length === 0) return;

  const firstParagraph = paragraphs[0];
  setTextInParagraph(firstParagraph, text);

  // Remove extra paragraphs so placeholder line-break artifacts do not remain.
  for (let i = 1; i < paragraphs.length; i++) {
    txBody.removeChild(paragraphs[i]);
  }

  // Ensure the replacement run has explicit body-cell formatting. This is
  // especially important for cells that were empty in the template and only
  // had an a:endParaRPr.
  const runs = getElementsByTagNameNS(firstParagraph, "a", "r");
  for (const run of runs) {
    ensureRunProperties(run);
  }
}

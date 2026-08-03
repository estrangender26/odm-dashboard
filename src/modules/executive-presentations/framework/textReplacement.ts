/**
 * Text replacement helpers that preserve paragraph and run formatting.
 *
 * Design rule: locate the intended paragraph/run, replace only its visible
 * text value, and leave pPr, rPr, bodyPr, txBody, shape geometry, and autofit
 * settings untouched.
 */

import { NS, createElementNS } from "./xml";
import type { XmlElement } from "./types";
import { getShapeParagraphs } from "./shapeFinder";
import type { Node as XmlNode } from "@xmldom/xmldom";

function asElement(node: XmlNode): XmlElement | null {
  if (node.nodeType === 1) {
    return node as unknown as XmlElement;
  }
  return null;
}

function findDirectChild(
  parent: XmlElement,
  namespace: keyof typeof NS,
  localName: string
): XmlElement | null {
  for (let i = 0; i < parent.childNodes.length; i++) {
    const el = asElement(parent.childNodes[i]);
    if (el && el.localName === localName && el.namespaceURI === NS[namespace]) {
      return el;
    }
  }
  return null;
}

function isTextContainer(el: XmlElement): boolean {
  return (
    (el.localName === "t" || el.localName === "fld" || el.localName === "ruby") &&
    el.namespaceURI === NS.a
  );
}

/**
 * Replace the visible text of a single run while preserving its rPr.
 * Any nested fld/ruby children are removed because they can leak placeholder
 * text; the caller is replacing the run's visible content with a single string.
 */
function setRunText(run: XmlElement, text: string): void {
  const ownerDoc = run.ownerDocument;
  if (!ownerDoc) return;

  const toRemove: XmlNode[] = [];
  for (let i = 0; i < run.childNodes.length; i++) {
    const child = run.childNodes[i];
    const el = asElement(child);
    if (el && isTextContainer(el)) {
      toRemove.push(child);
    }
  }
  for (const node of toRemove) {
    run.removeChild(node);
  }

  const t = createElementNS(ownerDoc, "a", "t");
  t.textContent = text;
  run.appendChild(t);
}

/**
 * Replace the text content of a paragraph while preserving pPr and the rPr of
 * the first run. Extra runs are collapsed into the first run because the
 * replacement is a single plain string.
 *
 * If the paragraph has no runs, a new run is created and inserted after pPr
 * (or before endParaRPr) so OOXML ordering is preserved.
 */
export function setTextInParagraph(p: XmlElement, text: string): void {
  const ownerDoc = p.ownerDocument;
  if (!ownerDoc) return;

  const pPr = findDirectChild(p, "a", "pPr");
  const endParaRPr = findDirectChild(p, "a", "endParaRPr");

  // Collect direct a:r children. getElementsByTagNameNS would return nested
  // runs from fld/ruby as well; we only want direct children of the paragraph.
  const runs: XmlElement[] = [];
  for (let i = 0; i < p.childNodes.length; i++) {
    const el = asElement(p.childNodes[i]);
    if (el && el.localName === "r" && el.namespaceURI === NS.a) {
      runs.push(el);
    }
  }

  // Remove extra runs so multi-run placeholder text is not duplicated.
  for (let i = 1; i < runs.length; i++) {
    p.removeChild(runs[i]);
  }

  let firstRun = runs[0];
  if (!firstRun) {
    firstRun = createElementNS(ownerDoc, "a", "r");
    if (pPr && pPr.nextSibling) {
      p.insertBefore(firstRun, pPr.nextSibling);
    } else if (pPr) {
      p.appendChild(firstRun);
    } else if (endParaRPr) {
      p.insertBefore(firstRun, endParaRPr);
    } else {
      p.appendChild(firstRun);
    }
  }

  setRunText(firstRun, text);
}

/**
 * Replace the text of every run in a paragraph with the supplied text. This
 * preserves multi-run formatting (e.g. mixed bold/italic) when the caller wants
 * to update existing runs individually. Used for paragraphs that must keep
 * their run structure.
 */
export function setTextInParagraphRuns(p: XmlElement, text: string): void {
  const ownerDoc = p.ownerDocument;
  if (!ownerDoc) return;

  const runs: XmlElement[] = [];
  for (let i = 0; i < p.childNodes.length; i++) {
    const el = asElement(p.childNodes[i]);
    if (el && el.localName === "r" && el.namespaceURI === NS.a) {
      runs.push(el);
    }
  }

  for (const run of runs) {
    setRunText(run, text);
  }
}

/**
 * Replace only the first paragraph's text and remove any extra paragraphs.
 * Preserves txBody/bodyPr/lstStyle and all shape geometry.
 */
export function setShapeText(shape: XmlElement, text: string): void {
  const txBody = shape.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/presentationml/2006/main",
    "txBody"
  )[0] as XmlElement | undefined;
  if (!txBody) return;

  const liveParagraphs = txBody.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p"
  );
  if (liveParagraphs.length === 0) return;
  setTextInParagraph(liveParagraphs[0] as XmlElement, text);

  // Use the live collection so each iteration removes the current second
  // paragraph; a static snapshot would repeatedly attempt to remove the same
  // detached node.
  while (liveParagraphs.length > 1) {
    txBody.removeChild(liveParagraphs[1]);
  }
}

/**
 * Replace the text in a specific paragraph of a shape. Other paragraphs are
 * left untouched.
 */
export function setShapeParagraphText(
  shape: XmlElement,
  paragraphIndex: number,
  text: string
): void {
  const paragraphs = getShapeParagraphs(shape);
  if (paragraphIndex >= paragraphs.length) return;
  setTextInParagraph(paragraphs[paragraphIndex], text);
}

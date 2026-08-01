/**
 * Text replacement helpers that preserve run formatting on the first run.
 */

import { NS, createElementNS, getElementsByTagNameNS } from "./xml";
import type { XmlElement } from "./types";
import { getShapeParagraphs } from "./shapeFinder";
import type { Node as XmlNode } from "@xmldom/xmldom";

function asElement(node: XmlNode): XmlElement | null {
  if (node.nodeType === 1) {
    return node as unknown as XmlElement;
  }
  return null;
}

function isDirectTextNode(node: XmlNode): boolean {
  const el = asElement(node);
  return el !== null && el.localName === "t" && el.namespaceURI === NS.a;
}

export function setTextInParagraph(p: XmlElement, text: string): void {
  const ownerDoc = p.ownerDocument;
  if (!ownerDoc) return;

  const runs = getElementsByTagNameNS(p, "a", "r");
  let firstRun: XmlElement | null = runs[0] ?? null;

  if (firstRun) {
    // Remove direct a:t children from the first run. Some runs may contain
    // fields (a:fld) or other nested markup; we preserve formatting properties
    // on the run and simply replace the visible text nodes.
    const directTextNodes: XmlElement[] = [];
    for (let i = 0; i < firstRun.childNodes.length; i++) {
      const child = firstRun.childNodes[i] as XmlNode;
      if (isDirectTextNode(child)) {
        directTextNodes.push(asElement(child)!);
      }
    }
    for (const t of directTextNodes) {
      firstRun.removeChild(t);
    }

    // If nested a:t remain (e.g. inside a:fld) they could leak placeholder
    // text, so remove any a:fld or a:ruby children that contain text.
    const nestedContainers: XmlElement[] = [];
    for (let i = 0; i < firstRun.childNodes.length; i++) {
      const childEl = asElement(firstRun.childNodes[i] as XmlNode);
      if (childEl && (childEl.localName === "fld" || childEl.localName === "ruby")) {
        nestedContainers.push(childEl);
      }
    }
    for (const container of nestedContainers) {
      firstRun.removeChild(container);
    }

    const t = createElementNS(ownerDoc, "a", "t");
    t.textContent = text;
    firstRun.appendChild(t);
  } else {
    const run = createElementNS(ownerDoc, "a", "r");
    const t = createElementNS(ownerDoc, "a", "t");
    t.textContent = text;
    run.appendChild(t);
    p.insertBefore(run, p.firstChild);
  }

  // Remove extra runs so multi-paragraph placeholder text is not duplicated.
  for (let i = 1; i < runs.length; i++) {
    p.removeChild(runs[i]);
  }
}

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

export function setShapeParagraphText(
  shape: XmlElement,
  paragraphIndex: number,
  text: string
): void {
  const paragraphs = getShapeParagraphs(shape);
  if (paragraphIndex >= paragraphs.length) return;
  setTextInParagraph(paragraphs[paragraphIndex], text);
}

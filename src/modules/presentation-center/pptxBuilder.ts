import pptxgenjs from "pptxgenjs";

type SlideElement =
  | {
      type: "text";
      text: string;
      x: number;
      y: number;
      w: number;
      h: number;
      fontSize?: number;
      bold?: boolean;
      color?: string;
      fill?: string;
      align?: "l" | "ctr" | "r";
    }
  | {
      type: "shape";
      x: number;
      y: number;
      w: number;
      h: number;
      fill: string;
      line?: string;
    }
  | {
      type: "table";
      rows: string[][];
      cellFills?: (string | undefined)[][];
      cellColors?: (string | undefined)[][];
      cellBold?: (boolean | undefined)[][];
      colWidths?: number[];
      rowHeights?: number[];
      x: number;
      y: number;
      w: number;
      h: number;
      fontSize?: number;
    }
  | {
      type: "bars";
      title: string;
      labels: string[];
      values: number[];
      x: number;
      y: number;
      w: number;
      h: number;
      max?: number;
      colors?: string[];
    };

type Slide = { elements: SlideElement[]; notes?: string };
type PptxPresentation = InstanceType<typeof pptxgenjs>;
type PptxSlide = ReturnType<PptxPresentation["addSlide"]>;

const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DEFAULT_FONT_FACE = "Aptos";
const DEFAULT_TEXT_COLOR = "1F2937";
const MIN_FONT_SIZE = 14;
const TABLE_BORDER = { type: "solid" as const, color: "E5E7EB", pt: 0.5 };
const TABLE_MARGIN: [number, number, number, number] = [0.03, 0.04, 0.03, 0.04];
const TEXT_MARGIN: [number, number, number, number] = [3.5, 5, 3.5, 5];
const TRANSPARENT_FILL = { color: "FFFFFF", transparency: 100 };
const TRANSPARENT_LINE = { color: "FFFFFF", transparency: 100 };
const PptxGenConstructor =
  typeof pptxgenjs === "function"
    ? pptxgenjs
    : (pptxgenjs as unknown as { default: typeof pptxgenjs }).default;

function cleanText(value: string | number) {
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function safeText(value: string | number) {
  const text = cleanText(value);
  return text.length ? text : " ";
}

function safeFontSize(value: number | undefined, fallback = MIN_FONT_SIZE) {
  return Math.max(MIN_FONT_SIZE, value || fallback);
}

function align(value?: "l" | "ctr" | "r") {
  if (value === "ctr") return "center";
  if (value === "r") return "right";
  return "left";
}

function addText(
  slide: PptxSlide,
  element: Extract<SlideElement, { type: "text" }>
) {
  slide.addText(safeText(element.text), {
    x: element.x,
    y: element.y,
    w: element.w,
    h: element.h,
    fontFace: DEFAULT_FONT_FACE,
    fontSize: safeFontSize(element.fontSize, 16),
    bold: element.bold,
    color: element.color || DEFAULT_TEXT_COLOR,
    align: align(element.align),
    valign: "top",
    margin: TEXT_MARGIN,
    fit: "none",
    breakLine: false,
    fill: element.fill ? { color: element.fill } : TRANSPARENT_FILL,
    line: TRANSPARENT_LINE,
    isTextBox: true,
  });
}

function addShape(
  slide: PptxSlide,
  pptx: PptxPresentation,
  element: Extract<SlideElement, { type: "shape" }>
) {
  slide.addShape(pptx.ShapeType.rect, {
    x: element.x,
    y: element.y,
    w: element.w,
    h: element.h,
    fill: { color: element.fill },
    line: element.line
      ? { color: element.line, transparency: 0 }
      : TRANSPARENT_LINE,
  });
}

function addTable(
  slide: PptxSlide,
  element: Extract<SlideElement, { type: "table" }>
) {
  const rows = element.rows.length ? element.rows : [[]];
  const colCount = Math.max(1, ...rows.map(row => row.length));
  const rowCount = Math.max(1, rows.length);
  const tableRows = rows.map((row, rowIndex) =>
    Array.from({ length: colCount }).map((_, colIndex) => {
      const isHeader = rowIndex === 0;
      const isEvenBodyRow = rowIndex > 0 && rowIndex % 2 === 0;
      const fill =
        element.cellFills?.[rowIndex]?.[colIndex] ||
        (isHeader ? "16324F" : isEvenBodyRow ? "F8FAFC" : "FFFFFF");
      const color =
        element.cellColors?.[rowIndex]?.[colIndex] ||
        (isHeader ? "FFFFFF" : DEFAULT_TEXT_COLOR);
      return {
        text: safeText(row[colIndex] ?? ""),
        options: {
          bold: Boolean(element.cellBold?.[rowIndex]?.[colIndex] ?? isHeader),
          color,
          fill: { color: fill },
          fontFace: DEFAULT_FONT_FACE,
          fontSize: safeFontSize(element.fontSize, 14),
          margin: TABLE_MARGIN,
          valign: "middle" as const,
          border: TABLE_BORDER,
        },
      };
    })
  );

  slide.addTable(tableRows, {
    x: element.x,
    y: element.y,
    w: element.w,
    h: element.h,
    colW:
      element.colWidths ||
      Array.from({ length: colCount }, () => element.w / colCount),
    rowH:
      element.rowHeights ||
      Array.from({ length: rowCount }, () => element.h / rowCount),
    border: TABLE_BORDER,
    fontFace: DEFAULT_FONT_FACE,
    fontSize: safeFontSize(element.fontSize, 14),
    color: DEFAULT_TEXT_COLOR,
    margin: TABLE_MARGIN,
  });
}

function addBars(
  slide: PptxSlide,
  pptx: PptxPresentation,
  element: Extract<SlideElement, { type: "bars" }>
) {
  const max =
    element.max && element.max > 0
      ? element.max
      : Math.max(...element.values, 100);
  const gap = 0.08;

  addText(slide, {
    type: "text",
    text: element.title,
    x: element.x,
    y: element.y,
    w: element.w,
    h: 0.35,
    fontSize: 16,
    bold: true,
    color: "0B1D44",
  });

  if (element.values.length === 0) return;

  const barH = Math.max(0.12, (element.h - 0.7) / element.values.length - gap);
  element.values.forEach((value, index) => {
    const y = element.y + 0.55 + index * (barH + gap);
    const barW = Math.max(0.05, ((element.w - 3.15) * value) / max);
    const fill =
      element.colors?.[index] ||
      (value >= 95 ? "0A9B6E" : value >= 90 ? "D97706" : "DC2626");

    addText(slide, {
      type: "text",
      text: element.labels[index] || "",
      x: element.x,
      y,
      w: 2.15,
      h: barH,
      fontSize: 14,
      color: "334155",
    });

    slide.addShape(pptx.ShapeType.rect, {
      x: element.x + 2.25,
      y,
      w: barW,
      h: barH,
      fill: { color: fill },
      line: { color: fill, transparency: 100 },
    });

    slide.addText(`${value.toFixed(1)}%`, {
      x: element.x + 2.34,
      y,
      w: Math.max(0.92, barW - 0.12),
      h: barH,
      fontFace: DEFAULT_FONT_FACE,
      fontSize: 14,
      bold: true,
      color: barW >= 0.8 ? "FFFFFF" : DEFAULT_TEXT_COLOR,
      margin: 0,
      fit: "none",
      valign: "middle",
      line: TRANSPARENT_LINE,
      fill: TRANSPARENT_FILL,
      isTextBox: true,
    });
  });
}

export async function createPresentation(slides: Slide[]) {
  const pptx = new PptxGenConstructor();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "ODM Dashboard";
  pptx.company = "ODM Dashboard";
  pptx.subject = "Presentation Center export";
  pptx.title = "ODM Dashboard Presentation";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: DEFAULT_FONT_FACE,
  };

  slides.forEach(sourceSlide => {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    sourceSlide.elements.forEach(element => {
      if (element.type === "text") addText(slide, element);
      else if (element.type === "shape") addShape(slide, pptx, element);
      else if (element.type === "table") addTable(slide, element);
      else addBars(slide, pptx, element);
    });
    if (sourceSlide.notes) slide.addNotes(cleanText(sourceSlide.notes));
  });

  const output = await pptx.write({
    outputType: "arraybuffer",
    compression: true,
  });
  return new Blob([output as ArrayBuffer], { type: PPTX_MIME_TYPE });
}

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
      type: "table";
      rows: string[][];
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
    };

type Slide = { elements: SlideElement[]; notes?: string };
type PptxPresentation = InstanceType<typeof pptxgenjs>;
type PptxSlide = ReturnType<PptxPresentation["addSlide"]>;

const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DEFAULT_FONT_FACE = "Aptos";
const DEFAULT_TEXT_COLOR = "1F2937";
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
    fontSize: element.fontSize || 16,
    bold: element.bold,
    color: element.color || DEFAULT_TEXT_COLOR,
    align: align(element.align),
    valign: "top",
    margin: TEXT_MARGIN,
    fit: "shrink",
    breakLine: false,
    fill: element.fill ? { color: element.fill } : TRANSPARENT_FILL,
    line: TRANSPARENT_LINE,
    isTextBox: true,
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
      return {
        text: safeText(row[colIndex] ?? ""),
        options: {
          bold: isHeader,
          color: isHeader ? "FFFFFF" : DEFAULT_TEXT_COLOR,
          fill: {
            color: isHeader ? "16324F" : isEvenBodyRow ? "F8FAFC" : "FFFFFF",
          },
          fontFace: DEFAULT_FONT_FACE,
          fontSize: element.fontSize || 9,
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
    colW: Array.from({ length: colCount }, () => element.w / colCount),
    rowH: Array.from({ length: rowCount }, () => element.h / rowCount),
    border: TABLE_BORDER,
    fontFace: DEFAULT_FONT_FACE,
    fontSize: element.fontSize || 9,
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
    fontSize: 14,
    bold: true,
    color: "0B1D44",
  });

  if (element.values.length === 0) return;

  const barH = Math.max(0.12, (element.h - 0.7) / element.values.length - gap);
  element.values.forEach((value, index) => {
    const y = element.y + 0.55 + index * (barH + gap);
    const barW = Math.max(0.05, ((element.w - 2.4) * value) / max);
    const fill = value >= 95 ? "059669" : value >= 90 ? "D97706" : "DC2626";

    addText(slide, {
      type: "text",
      text: element.labels[index] || "",
      x: element.x,
      y,
      w: 1.5,
      h: barH,
      fontSize: 8,
      color: "334155",
    });

    slide.addShape(pptx.ShapeType.rect, {
      x: element.x + 1.6,
      y,
      w: barW,
      h: barH,
      fill: { color: fill },
      line: { color: fill, transparency: 100 },
    });

    slide.addText(`${value.toFixed(1)}%`, {
      x: element.x + 1.67,
      y,
      w: Math.max(0.72, barW - 0.08),
      h: barH,
      fontFace: DEFAULT_FONT_FACE,
      fontSize: 8,
      bold: true,
      color: barW >= 0.8 ? "FFFFFF" : DEFAULT_TEXT_COLOR,
      margin: 0,
      fit: "shrink",
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

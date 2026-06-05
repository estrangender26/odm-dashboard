type SlideElement =
  | { type: "text"; text: string; x: number; y: number; w: number; h: number; fontSize?: number; bold?: boolean; color?: string; fill?: string; align?: "l" | "ctr" | "r" }
  | { type: "table"; rows: string[][]; x: number; y: number; w: number; h: number; fontSize?: number }
  | { type: "bars"; title: string; labels: string[]; values: number[]; x: number; y: number; w: number; h: number; max?: number };

type Slide = { elements: SlideElement[]; notes?: string };

const EMU_PER_INCH = 914400;
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

function esc(value: string | number) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function emu(inches: number) {
  return Math.round(inches * EMU_PER_INCH);
}

function textShape(element: Extract<SlideElement, { type: "text" }>, id: number) {
  const fill = element.fill ? `<a:solidFill><a:srgbClr val="${element.fill}"/></a:solidFill>` : "<a:noFill/>";
  const color = element.color || "1F2937";
  const fontSize = Math.round((element.fontSize || 16) * 100);
  const bold = element.bold ? ' b="1"' : "";
  const align = element.align ? ` algn="${element.align}"` : "";
  const lines = element.text.split("\n");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(element.x)}" y="${emu(element.y)}"/><a:ext cx="${emu(element.w)}" cy="${emu(element.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}</p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"/><a:lstStyle/>${lines.map((line) => `<a:p><a:pPr${align}/><a:r><a:rPr lang="en-US" sz="${fontSize}"${bold}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Aptos"/></a:rPr><a:t>${esc(line)}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>`;
}

function tableShape(element: Extract<SlideElement, { type: "table" }>, idStart: number) {
  const colCount = Math.max(...element.rows.map((row) => row.length));
  const rowH = element.h / element.rows.length;
  const colW = element.w / colCount;
  let id = idStart;
  return element.rows
    .flatMap((row, rowIndex) =>
      Array.from({ length: colCount }).map((_, colIndex) => {
        id += 1;
        return textShape(
          {
            type: "text",
            text: row[colIndex] || "",
            x: element.x + colIndex * colW,
            y: element.y + rowIndex * rowH,
            w: colW,
            h: rowH,
            fontSize: element.fontSize || 9,
            bold: rowIndex === 0,
            color: rowIndex === 0 ? "FFFFFF" : "1F2937",
            fill: rowIndex === 0 ? "16324F" : rowIndex % 2 === 0 ? "F8FAFC" : "FFFFFF",
          },
          id,
        );
      }),
    )
    .join("");
}

function barShapes(element: Extract<SlideElement, { type: "bars" }>, idStart: number) {
  const max = element.max || Math.max(...element.values, 100);
  const gap = 0.08;
  const barH = (element.h - 0.7) / element.values.length - gap;
  let id = idStart;
  const title = textShape({ type: "text", text: element.title, x: element.x, y: element.y, w: element.w, h: 0.35, fontSize: 14, bold: true, color: "0B1D44" }, ++id);
  const bars = element.values
    .map((value, index) => {
      const y = element.y + 0.55 + index * (barH + gap);
      const label = textShape({ type: "text", text: element.labels[index], x: element.x, y, w: 1.5, h: barH, fontSize: 8, color: "334155" }, ++id);
      const width = Math.max(0.05, ((element.w - 2.4) * value) / max);
      const bar = textShape({ type: "text", text: `${value.toFixed(1)}%`, x: element.x + 1.6, y, w: width, h: barH, fontSize: 8, bold: true, color: "FFFFFF", fill: value >= 95 ? "059669" : value >= 90 ? "D97706" : "DC2626" }, ++id);
      return label + bar;
    })
    .join("");
  return title + bars;
}

function slideXml(slide: Slide) {
  let id = 10;
  const body = slide.elements
    .map((element) => {
      id += 20;
      if (element.type === "text") return textShape(element, id);
      if (element.type === "table") return tableShape(element, id);
      return barShapes(element, id);
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function crc32(bytes: Uint8Array) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function u16(value: number) {
  return [value & 255, (value >>> 8) & 255];
}

function u32(value: number) {
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
}

function makeZip(files: { path: string; content: string }[]) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const content = encoder.encode(file.content);
    const crc = crc32(content);
    const local = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(content.length), ...u32(content.length), ...u16(name.length), ...u16(0), ...name, ...content]);
    localParts.push(local);
    const central = new Uint8Array([0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(content.length), ...u32(content.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]);
    centralParts.push(central);
    offset += local.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
  return new Blob([...localParts, ...centralParts, end], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

export function createPresentation(slides: Slide[]) {
  const slideIds = slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join("");
  const rels = slides.map((_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join("");
  const contentTypes = slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  const files = [
    { path: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${contentTypes}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { path: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { path: "docProps/core.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>ODM Dashboard Presentation</dc:title><dc:creator>ODM Dashboard</dc:creator><cp:lastModifiedBy>ODM Dashboard</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified></cp:coreProperties>` },
    { path: "docProps/app.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>ODM Dashboard</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${slides.length}</Slides></Properties>` },
    { path: "ppt/presentation.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${emu(SLIDE_W)}" cy="${emu(SLIDE_H)}" type="wide"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>` },
    { path: "ppt/_rels/presentation.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>` },
    ...slides.map((slide, index) => ({ path: `ppt/slides/slide${index + 1}.xml`, content: slideXml(slide) })),
  ];
  return makeZip(files);
}

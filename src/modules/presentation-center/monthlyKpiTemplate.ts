import JSZip from "jszip";

const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const TEMPLATE_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.template";

export const MONTHLY_KPI_TEMPLATE_URL =
  "/templates/monthly-kpi-scorecard-template.potx";

export type MonthlyKpiTemplateStatus =
  | "success"
  | "warning"
  | "danger"
  | "no-data"
  | "none";

export type MonthlyKpiTemplateSlide = {
  sourceSlide: 1 | 2;
  title: string;
  tableName: "Table 2" | "Table 0";
  rows: string[][];
  statuses: MonthlyKpiTemplateStatus[][];
  commentary?: string[];
};

const STATUS_FILL: Record<MonthlyKpiTemplateStatus, string> = {
  success: "00B050",
  warning: "FFC000",
  danger: "C00000",
  "no-data": "E7EAED",
  none: "FFFFFF",
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function rewriteTextNodes(xml: string, values: string[]) {
  let index = 0;
  return xml.replace(/<a:t\b[^>]*>[\s\S]*?<\/a:t>/g, match => {
    const value = values[index++] ?? "";
    const openTag = match.slice(0, match.indexOf(">") + 1);
    return `${openTag}${escapeXml(value)}</a:t>`;
  });
}

function replaceNamedBlockText(
  slideXml: string,
  elementName: string,
  values: string[]
) {
  const marker = `name="${elementName}"`;
  const markerIndex = slideXml.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`Template element ${elementName} was not found.`);
  }
  const isTable = elementName.startsWith("Table ");
  const openTag = isTable ? "<p:graphicFrame" : "<p:sp";
  const closeTag = isTable ? "</p:graphicFrame>" : "</p:sp>";
  const start = slideXml.lastIndexOf(openTag, markerIndex);
  const closeStart = slideXml.indexOf(closeTag, markerIndex);
  if (start < 0 || closeStart < 0) {
    throw new Error(`Template element ${elementName} is malformed.`);
  }
  const end = closeStart + closeTag.length;
  const block = slideXml.slice(start, end);
  return `${slideXml.slice(0, start)}${rewriteTextNodes(block, values)}${slideXml.slice(end)}`;
}

function replaceNamedCommentary(
  slideXml: string,
  elementName: string,
  values: string[]
) {
  const marker = `name="${elementName}"`;
  const markerIndex = slideXml.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`Template element ${elementName} was not found.`);
  }
  const start = slideXml.lastIndexOf("<p:sp", markerIndex);
  const closeStart = slideXml.indexOf("</p:sp>", markerIndex);
  if (start < 0 || closeStart < 0) {
    throw new Error(`Template element ${elementName} is malformed.`);
  }
  const end = closeStart + "</p:sp>".length;
  const block = slideXml.slice(start, end);
  let valueIndex = 0;
  const updatedBlock = block.replace(
    /<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g,
    paragraph => {
      if (!paragraph.includes("<a:buChar") || !paragraph.includes("<a:t")) {
        return paragraph;
      }
      const value = values[valueIndex++] ?? "";
      const updatedParagraph = rewriteTextNodes(paragraph, [value]);
      return value
        ? updatedParagraph
        : updatedParagraph.replace(/<a:buChar\b[^>]*\/>/, "<a:buNone/>");
    }
  );
  if (valueIndex !== 5) {
    throw new Error(
      `Template commentary ${elementName} has ${valueIndex} bullet slots; 5 were expected.`
    );
  }
  return `${slideXml.slice(0, start)}${updatedBlock}${slideXml.slice(end)}`;
}

function setCellFill(cellXml: string, color: string) {
  const tcPrStart = cellXml.indexOf("<a:tcPr");
  const tcPrClose = cellXml.indexOf("</a:tcPr>", tcPrStart);
  if (tcPrStart < 0 || tcPrClose < 0) return cellXml;

  const tcPrEnd = tcPrClose + "</a:tcPr>".length;
  const tcPr = cellXml.slice(tcPrStart, tcPrEnd);
  const fill = `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  const borderEnd = tcPr.lastIndexOf("</a:lnB>");
  const noFillStart = tcPr.lastIndexOf("<a:noFill/");
  const solidFillStart = tcPr.lastIndexOf("<a:solidFill>");
  const existingStart = Math.max(noFillStart, solidFillStart);
  let updatedTcPr: string;

  if (existingStart > borderEnd) {
    const existingEnd =
      existingStart === noFillStart
        ? tcPr.indexOf("/>", existingStart) + 2
        : tcPr.indexOf("</a:solidFill>", existingStart) +
          "</a:solidFill>".length;
    updatedTcPr = `${tcPr.slice(0, existingStart)}${fill}${tcPr.slice(existingEnd)}`;
  } else {
    updatedTcPr = `${tcPr.slice(0, tcPr.length - "</a:tcPr>".length)}${fill}</a:tcPr>`;
  }

  return `${cellXml.slice(0, tcPrStart)}${updatedTcPr}${cellXml.slice(tcPrEnd)}`;
}

function rewriteCell(
  cellXml: string,
  value: string,
  status: MonthlyKpiTemplateStatus
) {
  return setCellFill(rewriteTextNodes(cellXml, [value]), STATUS_FILL[status]);
}

function rewriteTable(
  slideXml: string,
  tableName: string,
  rows: string[][],
  statuses: MonthlyKpiTemplateStatus[][]
) {
  const markerIndex = slideXml.indexOf(`name="${tableName}"`);
  if (markerIndex < 0) {
    throw new Error(`Template table ${tableName} was not found.`);
  }
  const tableStart = slideXml.indexOf("<a:tbl>", markerIndex);
  const tableClose = slideXml.indexOf("</a:tbl>", tableStart);
  if (tableStart < 0 || tableClose < 0) {
    throw new Error(`Template table ${tableName} is malformed.`);
  }
  const tableEnd = tableClose + "</a:tbl>".length;
  const tableXml = slideXml.slice(tableStart, tableEnd);
  let rowIndex = 0;
  const updatedTable = tableXml.replace(/<a:tr\b[\s\S]*?<\/a:tr>/g, rowXml => {
    const values = rows[rowIndex];
    const rowStatuses = statuses[rowIndex];
    rowIndex += 1;
    if (!values) return rowXml;
    if (rowIndex === 1) return rowXml;
    let cellIndex = 0;
    return rowXml.replace(/<a:tc>[\s\S]*?<\/a:tc>/g, cellXml => {
      const value = values[cellIndex] ?? "";
      const status = rowStatuses?.[cellIndex] ?? "none";
      cellIndex += 1;
      return rewriteCell(cellXml, value, status);
    });
  });
  if (rowIndex !== rows.length) {
    throw new Error(
      `Template table ${tableName} has ${rowIndex} rows; ${rows.length} were supplied.`
    );
  }
  return `${slideXml.slice(0, tableStart)}${updatedTable}${slideXml.slice(tableEnd)}`;
}

function populateSlide(sourceXml: string, slide: MonthlyKpiTemplateSlide) {
  let xml = replaceNamedBlockText(sourceXml, "TextBox 4", [slide.title]);
  xml = rewriteTable(xml, slide.tableName, slide.rows, slide.statuses);
  if (slide.sourceSlide === 1) {
    xml = replaceNamedCommentary(
      xml,
      "TextBox 6",
      (slide.commentary ?? []).slice(0, 5)
    );
  }
  return xml.replace(
    /<p:ext\b[^>]*>\s*<p188:commentRel\b[^>]*\/>\s*<\/p:ext>/g,
    ""
  );
}

function removeRelationshipTypes(xml: string, fragments: string[]) {
  return xml.replace(/<Relationship\b[^>]*\/>/g, relationship =>
    fragments.some(fragment => relationship.includes(fragment))
      ? ""
      : relationship
  );
}

function updatePresentationXml(xml: string, slideCount: number) {
  const slideIds = Array.from(
    { length: slideCount },
    (_, index) =>
      `<p:sldId id="${2147483000 + index}" r:id="rId${10 + index}"/>`
  ).join("");
  return xml.replace(
    /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
    `<p:sldIdLst>${slideIds}</p:sldIdLst>`
  );
}

function updatePresentationRelationships(xml: string, slideCount: number) {
  const withoutSlides = removeRelationshipTypes(xml, [
    '/relationships/slide"',
    '/relationships/authors"',
  ]);
  const slideRelationships = Array.from(
    { length: slideCount },
    (_, index) =>
      `<Relationship Id="rId${10 + index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`
  ).join("");
  return withoutSlides.replace(
    "</Relationships>",
    `${slideRelationships}</Relationships>`
  );
}

function updateContentTypes(xml: string, slideCount: number) {
  let updated = xml.replace(
    "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"
  );
  updated = updated.replace(
    /<Override\b[^>]*PartName="\/ppt\/(?:slides\/slide\d+\.xml|notesSlides\/notesSlide\d+\.xml|comments\/[^\"]+|authors\.xml)"[^>]*\/>/g,
    ""
  );
  const slideOverrides = Array.from(
    { length: slideCount },
    (_, index) =>
      `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
  ).join("");
  return updated.replace("</Types>", `${slideOverrides}</Types>`);
}

function updateAppProperties(xml: string, slideCount: number) {
  return xml.replace(/<Slides>\d+<\/Slides>/, `<Slides>${slideCount}</Slides>`);
}

async function requiredText(zip: JSZip, path: string) {
  const file = zip.file(path);
  if (!file) throw new Error(`The PowerPoint template is missing ${path}.`);
  return file.async("string");
}

export async function loadMonthlyKpiTemplate() {
  const response = await fetch(MONTHLY_KPI_TEMPLATE_URL, {
    headers: { Accept: TEMPLATE_MIME_TYPE },
  });
  if (!response.ok) {
    throw new Error("Unable to load the Monthly KPI PowerPoint template.");
  }
  return response.arrayBuffer();
}

export async function createMonthlyKpiTemplatePresentation(
  template: ArrayBuffer | Uint8Array,
  slides: MonthlyKpiTemplateSlide[]
) {
  if (!slides.length) {
    throw new Error("At least one Monthly KPI template slide is required.");
  }
  const zip = await JSZip.loadAsync(template);
  const sourceSlides = new Map<number, string>();
  const sourceRelationships = new Map<number, string>();
  for (const sourceSlide of new Set(slides.map(slide => slide.sourceSlide))) {
    sourceSlides.set(
      sourceSlide,
      await requiredText(zip, `ppt/slides/slide${sourceSlide}.xml`)
    );
    sourceRelationships.set(
      sourceSlide,
      await requiredText(zip, `ppt/slides/_rels/slide${sourceSlide}.xml.rels`)
    );
  }

  zip.remove("ppt/slides");
  zip.remove("ppt/notesSlides");
  zip.remove("ppt/comments");
  zip.remove("ppt/authors.xml");

  slides.forEach((slide, index) => {
    const sourceXml = sourceSlides.get(slide.sourceSlide);
    const sourceRels = sourceRelationships.get(slide.sourceSlide);
    if (!sourceXml || !sourceRels) {
      throw new Error(`Template source slide ${slide.sourceSlide} is missing.`);
    }
    zip.file(
      `ppt/slides/slide${index + 1}.xml`,
      populateSlide(sourceXml, slide)
    );
    zip.file(
      `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      removeRelationshipTypes(sourceRels, [
        "/relationships/comments",
        "/relationships/notesSlide",
      ])
    );
  });

  zip.file(
    "ppt/presentation.xml",
    updatePresentationXml(
      await requiredText(zip, "ppt/presentation.xml"),
      slides.length
    )
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    updatePresentationRelationships(
      await requiredText(zip, "ppt/_rels/presentation.xml.rels"),
      slides.length
    )
  );
  zip.file(
    "[Content_Types].xml",
    updateContentTypes(
      await requiredText(zip, "[Content_Types].xml"),
      slides.length
    )
  );
  const appProperties = zip.file("docProps/app.xml");
  if (appProperties) {
    zip.file(
      "docProps/app.xml",
      updateAppProperties(await appProperties.async("string"), slides.length)
    );
  }

  return zip.generateAsync({
    type: "blob",
    mimeType: PPTX_MIME_TYPE,
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

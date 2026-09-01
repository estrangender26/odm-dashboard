import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export type SmpPdfSection = {
  sectionKey: string;
  title: string;
  body: string;
  position: number;
};

export type SmpPdfTaskCategory =
  | "operator_driven"
  | "technician_pm"
  | "technician_cbm"
  | "corrective";

export type SmpPdfTask = {
  category: SmpPdfTaskCategory;
  responsibilityType?: string;
  maintenanceClass?: string;
  taskText: string;
  frequency?: string;
  toolsMaterials?: string;
  safetyControls?: string;
  fieldCaptureData?: string[];
  escalationTrigger?: string;
  failureMode?: string;
  applicabilityTags?: string[];
  displayOrder: number;
};

export type SmpPdfExtraction = {
  code: string | null;
  smpId: string | null;
  title: string | null;
  smpFamily: string | null;
  revision: string | null;
  effectivityDate: string | null;
  assetName: string | null;
  assetType: string | null;
  equipmentType: string | null;
  facilityType: string | null;
  criticality: string | null;
  documentOwner: string | null;
  preparedBy: string | null;
  reviewedBy: string | null;
  approvedBy: string | null;
  applicability: string[];
  sections: SmpPdfSection[];
  tasks: SmpPdfTask[];
  warnings: string[];
  isEmpty: boolean;
};

type TextItem = {
  str: string;
  dir: string;
  width: number;
  height: number;
  transform: number[];
  fontName: string;
  hasEOL: boolean;
};

export type PageLines = {
  pageNumber: number;
  lines: string[];
};

const KNOWN_APPLICABILITY_TAGS = new Set([
  "All", "Belt", "Filter", "Screw", "Volute", "Decanter", "PLC", "SCADA", "UPS",
  "Pneumatic", "Turbo", "Screw Blower", "MV", "LV", "VFD-driven", "Grease", "Oil",
]);

const FREQUENCY_KEYWORDS = [
  "daily", "weekly", "monthly", "quarterly", "semi-annual", "semiannual", "annual",
  "yearly", "bi-weekly", "fortnightly", "as needed", "as-needed", "per shift",
  "per run", "continuous", "hourly", "every",
];

const SECTION_HEADING_RE = /^(?:\d+(?:\.\d+)*\.?\s+)?(Purpose|Scope|Definitions|References|Responsibilities|Procedure|Procedures|Safety|General|Maintenance|Inspection|Checks|Records|Attachments|Appendix|Overview)(?:\s*[:.-]?\s*|$)/i;

const CATEGORY_HEADINGS: Array<[SmpPdfTaskCategory, RegExp, string?]> = [
  ["operator_driven", /operator[\s\-]?driven|operator\s+tasks/i, undefined],
  ["technician_pm", /preventive\s+maintenance|technician.*pm|pm\s+tasks/i, "Preventive Maintenance"],
  ["technician_cbm", /condition[\s\-]?based\s+maintenance|technician.*cbm|cbm\s+tasks/i, "Condition-Based Maintenance"],
  ["corrective", /corrective\s+maintenance|breakdown|repair\s+tasks|failure\s+modes/i, undefined],
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractFirstMatch(
  lines: string[],
  patterns: RegExp[],
): string | null {
  for (const line of lines) {
    for (const re of patterns) {
      const m = line.match(re);
      if (m && m[1]?.trim()) return m[1].trim();
    }
  }
  return null;
}

function parseDate(value: string): string | null {
  const cleaned = value.replace(/[,]/g, " ").trim();
  // ISO-like yyyy-mm-dd or yyyy/mm/dd
  let m = cleaned.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const y = Number(m[1]);
    const month = Number(m[2]);
    const d = Number(m[3]);
    if (month >= 1 && month <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  // dd Month yyyy
  m = cleaned.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (m) {
    const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    const mon = monthNames.findIndex((n) => n.startsWith(m![2].toLowerCase())) + 1;
    if (mon > 0) {
      const d = Number(m[1]);
      return `${m[3]}-${String(mon).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

function buildPageLines(textContent: { items: TextItem[] }): string[] {
  const rows = new Map<number, TextItem[]>();
  for (const item of textContent.items) {
    if (!item.str?.trim()) continue;
    const y = item.transform[5];
    const roundedY = Math.round(y * 10) / 10;
    const list = rows.get(roundedY) ?? [];
    list.push(item);
    rows.set(roundedY, list);
  }
  const sortedY = [...rows.entries()].sort((a, b) => b[0] - a[0]);
  const lines: string[] = [];
  for (const [, items] of sortedY) {
    items.sort((a, b) => a.transform[4] - b.transform[4]);
    const line = normalizeWhitespace(items.map((i) => i.str).join(" "));
    if (line) lines.push(line);
  }
  return lines;
}

export async function extractSmpFromPdf(buffer: Buffer): Promise<SmpPdfExtraction> {
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const pages: PageLines[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push({ pageNumber: i, lines: buildPageLines(content as { items: TextItem[] }) });
  }
  return parseSmpPages(pages);
}

export function parseSmpPages(pages: PageLines[]): SmpPdfExtraction {
  const allLines = pages.flatMap((p) => p.lines);
  const warnings: string[] = [];

  if (allLines.length === 0) {
    return emptyResult(true, ["No readable text found in the PDF. It may be scanned/image-only; manual review required."]);
  }

  const code = extractFirstMatch(allLines, [
    /Reference\s*(?:Number|No\.?|#)[:\s]+([A-Za-z0-9\-._\/]+)/i,
    /SMP\s*(?:Reference|No\.?|#)[:\s]+([A-Za-z0-9\-._\/]+)/i,
    /Document\s*(?:No\.?|Number|#)[:\s]+([A-Za-z0-9\-._\/]+)/i,
    /Ref\.?\s*(?:No\.?)?[:\s]+([A-Za-z0-9\-._\/]+)/i,
  ]);

  const title = extractFirstMatch(allLines, [
    /(?:Document\s*)?Title[:\s]+(.+)/i,
    /SMP\s*Title[:\s]+(.+)/i,
    /^\s*Title[:\s]+(.+)/i,
  ]);

  const smpId = extractFirstMatch(allLines, [
    /SMP\s*(?:ID|#)[:\s]+([A-Za-z0-9\-._\/]+)/i,
    /System\s*Maintenance\s*Plan\s*(?:ID|#)[:\s]+([A-Za-z0-9\-._\/]+)/i,
  ]);

  const revision = extractFirstMatch(allLines, [
    /Revision[:\s]+(?:Rev\.?\s*)?(\d+)/i,
    /Rev\.?[:\s]+(\d+|Rev\.?\s*\d+)/i,
    /Revision\s*Number[:\s]+(\d+)/i,
  ]);

  const effectivityRaw = extractFirstMatch(allLines, [
    /Effectivity\s*Date[:\s]+(.+)/i,
    /Effective\s*Date[:\s]+(.+)/i,
    /Date\s*(?:Issued|Effective)[:\s]+(.+)/i,
  ]);
  const effectivityDate = effectivityRaw ? parseDate(effectivityRaw) : null;

  const smpFamily = extractFirstMatch(allLines, [
    /SMP\s*Family[:\s]+(.+)/i,
    /Family[:\s]+(.+)/i,
  ]);

  const assetName = extractFirstMatch(allLines, [
    /Asset\s*Name[:\s]+(.+)/i,
    /Equipment\s*Name[:\s]+(.+)/i,
  ]);

  const assetType = extractFirstMatch(allLines, [
    /Asset\s*Type[:\s]+(.+)/i,
  ]);

  const equipmentType = extractFirstMatch(allLines, [
    /Equipment\s*Type[:\s]+(.+)/i,
  ]);

  const facilityType = extractFirstMatch(allLines, [
    /Facility\s*Type[:\s]+(.+)/i,
  ]);

  const criticality = extractFirstMatch(allLines, [
    /Criticality[:\s]+([ABC])/i,
    /ABC\s*Criticality[:\s]+([ABC])/i,
  ]);

  const documentOwner = extractFirstMatch(allLines, [
    /Document\s*Owner[:\s]+(.+)/i,
    /Owner[:\s]+(.+)/i,
  ]);

  const preparedBy = extractFirstMatch(allLines, [
    /Prepared\s*(?:By)[:\s]+(.+)/i,
  ]);

  const reviewedBy = extractFirstMatch(allLines, [
    /Reviewed\s*(?:By)[:\s]+(.+)/i,
  ]);

  const approvedBy = extractFirstMatch(allLines, [
    /Approved\s*(?:By)[:\s]+(.+)/i,
  ]);

  const applicabilityRaw = extractFirstMatch(allLines, [
    /Applicability[:\s]+(.+)/i,
  ]);
  const applicability = parseApplicability(applicabilityRaw);

  const { sections, sectionWarnings } = extractSections(allLines);
  warnings.push(...sectionWarnings);

  const { tasks, taskWarnings } = extractTasks(allLines);
  warnings.push(...taskWarnings);

  if (!code) warnings.push("Could not extract reference number from the PDF.");
  if (!title) warnings.push("Could not extract title from the PDF.");
  if (effectivityRaw && !effectivityDate) warnings.push(`Could not parse effectivity date: "${effectivityRaw}".`);

  return {
    code,
    smpId,
    title,
    smpFamily,
    revision: normalizeRevision(revision),
    effectivityDate,
    assetName,
    assetType,
    equipmentType,
    facilityType,
    criticality,
    documentOwner,
    preparedBy,
    reviewedBy,
    approvedBy,
    applicability,
    sections,
    tasks,
    warnings,
    isEmpty: false,
  };
}

function emptyResult(isEmpty: boolean, warnings: string[]): SmpPdfExtraction {
  return {
    code: null,
    smpId: null,
    title: null,
    smpFamily: null,
    revision: null,
    effectivityDate: null,
    assetName: null,
    assetType: null,
    equipmentType: null,
    facilityType: null,
    criticality: null,
    documentOwner: null,
    preparedBy: null,
    reviewedBy: null,
    approvedBy: null,
    applicability: [],
    sections: [],
    tasks: [],
    warnings,
    isEmpty,
  };
}

function normalizeRevision(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (/^Rev\.?\s*\d+$/i.test(cleaned)) return cleaned.replace(/Rev\.?/i, "Rev.");
  const m = cleaned.match(/^(\d+)$/);
  if (m) return `Rev. ${m[1]}`;
  return cleaned;
}

function parseApplicability(raw: string | null): string[] {
  if (!raw) return [];
  const tags = raw
    .split(/[,;]/)
    .map((s) => s.replace(/^[\s\[(]+|[\s\])]+$/g, "").trim())
    .filter(Boolean);
  return [...new Set(tags)];
}

function extractSections(lines: string[]): { sections: SmpPdfSection[]; sectionWarnings: string[] } {
  const sections: SmpPdfSection[] = [];
  const warnings: string[] = [];
  const headingIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_HEADING_RE.test(lines[i])) headingIndices.push(i);
  }

  if (headingIndices.length === 0) {
    return { sections, sectionWarnings: warnings };
  }

  for (let h = 0; h < headingIndices.length; h++) {
    const start = headingIndices[h];
    const end = headingIndices[h + 1] ?? lines.length;
    const heading = lines[start];
    const match = heading.match(SECTION_HEADING_RE);
    const title = match ? `${match[1]}` : heading;
    const keyBase = heading.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 64);
    const body = lines.slice(start + 1, end).join("\n").trim();
    sections.push({
      sectionKey: `sec_${keyBase || sections.length + 1}`,
      title,
      body,
      position: h,
    });
  }
  return { sections, sectionWarnings: warnings };
}

function extractTasks(lines: string[]): { tasks: SmpPdfTask[]; taskWarnings: string[] } {
  const tasks: SmpPdfTask[] = [];
  const warnings: string[] = [];
  let currentCategory: SmpPdfTaskCategory | null = null;
  let maintenanceClass: string | undefined;
  let displayOrder = 0;
  let inCategory = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const categoryHit = CATEGORY_HEADINGS.find(([_, re]) => re.test(line));
    if (categoryHit) {
      currentCategory = categoryHit[0];
      maintenanceClass = categoryHit[2];
      inCategory = true;
      continue;
    }

    if (inCategory && isSectionHeading(line)) {
      inCategory = false;
      currentCategory = null;
      continue;
    }

    if (!currentCategory) continue;
    if (looksLikeHeaderRow(line) || isTableBoundary(line)) continue;

    const task = parseTaskLine(line, currentCategory, maintenanceClass, ++displayOrder);
    if (task) tasks.push(task);
  }

  return { tasks, taskWarnings: warnings };
}

function isSectionHeading(line: string): boolean {
  return SECTION_HEADING_RE.test(line) || /^(?:Records|Attachments|Appendix|Notes|References|Safety)/i.test(line);
}

function looksLikeHeaderRow(line: string): boolean {
  return /^(?:Tasks?|Frequency|Tools\\s*(?:\\&|\\+)\\s*Materials|Safety\\s*Controls|Field\\s*Capture|Escalation|Failure\\s*Mode|Responsibility|Category)\\b(?!\\s*:)/i.test(line);
}

function isTableBoundary(line: string): boolean {
  return /^[-=]{3,}$/.test(line) || /^\|/.test(line);
}

function parseTaskLine(
  line: string,
  category: SmpPdfTaskCategory,
  maintenanceClass: string | undefined,
  displayOrder: number,
): SmpPdfTask | null {
  let remaining = line.trim();
  if (remaining.length < 3) return null;

  // Extract bracketed applicability tags at end, e.g. "... [Filter, Belt]"
  const tags: string[] = [];
  const bracketMatch = remaining.match(/\[([^\]]{1,200})\]\s*$/);
  if (bracketMatch) {
    const rawTags = bracketMatch[1].split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    for (const t of rawTags) {
      const normalized = t.replace(/\.$/, "");
      if (KNOWN_APPLICABILITY_TAGS.has(normalized) || rawTags.length <= 5) {
        tags.push(normalized);
      }
    }
    remaining = remaining.slice(0, bracketMatch.index).trim().replace(/[,;]$/, "").trim();
  }

  // Extract frequency if present as a prefix like "Daily: ..." or inline "Frequency: ..."
  let frequency: string | undefined;
  const freqPrefixMatch = remaining.match(/^([A-Za-z\s\-]+):\s*(.+)$/);
  if (freqPrefixMatch && FREQUENCY_KEYWORDS.some((kw) => freqPrefixMatch[1].toLowerCase().includes(kw))) {
    frequency = normalizeWhitespace(freqPrefixMatch[1]);
    remaining = freqPrefixMatch[2];
  }
  const freqInlineMatch = remaining.match(/Frequency[:\s]+([A-Za-z0-9\s\-]+(?:,\s*[A-Za-z0-9\s\-]+)?)/i);
  if (freqInlineMatch) {
    frequency = normalizeWhitespace(freqInlineMatch[1]);
    remaining = remaining.replace(freqInlineMatch[0], " ").trim();
  }

  // Extract safety controls if inline
  let safetyControls: string | undefined;
  const safetyMatch = remaining.match(/Safety\s*Controls?[:\s]+(.+)/i);
  if (safetyMatch) {
    safetyControls = normalizeWhitespace(safetyMatch[1]);
    remaining = remaining.replace(safetyMatch[0], " ").trim();
  }

  // Extract escalation trigger
  let escalationTrigger: string | undefined;
  const escalationMatch = remaining.match(/Escalation(?:\s*Trigger)?:\s*(.+)/i);
  if (escalationMatch) {
    escalationTrigger = normalizeWhitespace(escalationMatch[1]);
    remaining = remaining.replace(escalationMatch[0], " ").trim();
  }

  // Extract tools/materials
  let toolsMaterials: string | undefined;
  const toolsMatch = remaining.match(/Tools\s*(?:\&|\+)\s*Materials[:\s]+(.+)/i);
  if (toolsMatch) {
    toolsMaterials = normalizeWhitespace(toolsMatch[1]);
    remaining = remaining.replace(toolsMatch[0], " ").trim();
  }

  // Field capture data labels
  let fieldCaptureData: string[] | undefined;
  const captureMatch = remaining.match(/Field\s*Capture(?:\s*Data)?:\s*(.+)/i);
  if (captureMatch) {
    fieldCaptureData = captureMatch[1].split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
    remaining = remaining.replace(captureMatch[0], " ").trim();
  }

  // Failure mode for corrective tasks
  let failureMode: string | undefined;
  if (category === "corrective") {
    const failureMatch = remaining.match(/Failure\s*Mode[:\s]+(.+?)(?:\s*[—–-]\s*(.+))?$/i);
    if (failureMatch) {
      failureMode = normalizeWhitespace(failureMatch[1]);
      if (failureMatch[2]) {
        remaining = failureMatch[2];
      } else {
        remaining = failureMatch[1];
      }
    }
  }

  let taskText = normalizeWhitespace(remaining);
  if (taskText.length < 3) {
    // If a structured field was extracted but no narrative remains, use the
    // extracted structured value as the task text so the line is not lost.
    const fallback = toolsMaterials || safetyControls || escalationTrigger || failureMode;
    if (!fallback) return null;
    taskText = fallback;
  }

  return {
    category,
    responsibilityType: category === "operator_driven" ? "Operator" : "Technician",
    maintenanceClass,
    taskText,
    frequency,
    toolsMaterials,
    safetyControls,
    fieldCaptureData,
    escalationTrigger,
    failureMode,
    applicabilityTags: tags.length ? tags : undefined,
    displayOrder,
  };
}
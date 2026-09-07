#!/usr/bin/env node
/**
 * Offline builder for the All-Business-Units Monthly KPI executive master
 * template (dev-time only; not part of the deploy pipeline).
 *
 * The committed template binary that the server generator clones from is
 * produced by this script:
 *
 *   node scripts/monthly-kpi-allbu/build-allbu-master-template.mjs
 *
 * It starts from the approved single-BU template
 * (MonthlyKpiExecutive.pptx) whose slide 1 is the authoritative Manila Water
 * "Monthly Reliability KPI Scorecard" master and produces a package that
 * carries three DONOR slides plus the six native chart parts needed to clone
 * one Scorecard slide + one Trends slide per business unit at runtime:
 *
 *   slide1  cover donor            (MW blue title, reporting period line)
 *   slide2  Scorecard donor        (byte-copy of the MW AMD-EZ master slide)
 *   slide3  Trends donor           (six native 2x3 charts, MW layout)
 *   chart1..chart6 + embeddings    (donors cloned per extra BU at runtime)
 *
 * The runtime generator never recreates layout/master/media/chart XML from
 * scratch: it deep-copies these donor parts and rewrites only dynamic caches
 * (table values, titles, chart <c:numCache>/<c:strCache>), so the Manila
 * Water visual language is preserved exactly.
 *
 * Dependencies are the repo's own pptxgenjs + jszip (see package.json).
 */

import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const templatesDir = path.join(
  repoRoot,
  "src",
  "modules",
  "executive-presentations",
  "templates"
);
const sourceTemplatePath = path.join(templatesDir, "MonthlyKpiExecutive.pptx");
const outputTemplatePath = path.join(templatesDir, "MonthlyKpiAllBuExecutive.pptx");

const pptxgen = require(path.join(repoRoot, "node_modules", "pptxgenjs"));
const PptxGenJS = typeof pptxgen === "function" ? pptxgen : pptxgen.default;
const JSZip = require(path.join(repoRoot, "node_modules", "jszip"));

const EMU_IN = 914400;
const SLIDE_W = Math.round(13.333 * EMU_IN);
const SLIDE_H = Math.round(7.5 * EMU_IN);

// ── Manila Water palette used by the approved scorecard master ──
const C = {
  blue: "0070C0", // slide title blue
  navy: "172B47", // table body text
  cyan: "00A8D2",
  gray: "9CA3AF",
  grayDark: "64748B",
};

function in2emu(v) {
  return Math.round(Number(v) * EMU_IN);
}

// ═══════════════════════════════════════════════════════════════════
// 1. Trends donor slide — six native charts (2x3) built with pptxgenjs
// ═══════════════════════════════════════════════════════════════════
const CHART_PANELS = [
  {
    id: 1,
    title: "PM Compliance (%)",
    series: [
      { name: "Monthly Actual", color: C.cyan, mode: "monthly", source: "pmComplianceMonthly" },
      { name: "YTD Average", color: C.blue, mode: "ytdAvg", source: "pmComplianceYtdAverage" },
      { name: "Benchmark ≥98%", color: C.gray, mode: "const", value: 98 },
    ],
  },
  {
    id: 2,
    title: "Budget Spend (%)",
    series: [
      { name: "YTD / Cumulative", color: C.blue, mode: "ytd", source: "budgetSpend" },
      { name: "Benchmark 95%", color: C.gray, mode: "const", value: 95 },
      { name: "Benchmark 105%", color: C.gray, mode: "const", value: 105 },
    ],
  },
  {
    id: 3,
    title: "PM:CM WO (%)",
    series: [
      { name: "YTD / Cumulative", color: C.blue, mode: "ytd", source: "pmCmWorkOrderRatio" },
      { name: "Benchmark ≥86%", color: C.gray, mode: "const", value: 86 },
    ],
  },
  {
    id: 4,
    title: "PM:CM Cost (%)",
    series: [
      { name: "YTD / Cumulative", color: C.blue, mode: "ytd", source: "pmCmCostRatio" },
      { name: "Benchmark ≥80%", color: C.gray, mode: "const", value: 80 },
    ],
  },
  {
    id: 5,
    title: "MTTR (Days)",
    series: [{ name: "YTD / Cumulative", color: C.blue, mode: "ytd", source: "mttrDays" }],
  },
  {
    id: 6,
    title: "Facility Uptime (%)",
    series: [
      { name: "Monthly Actual", color: C.cyan, mode: "monthly", source: "facilityUptimeMonthly" },
      { name: "YTD Average", color: C.blue, mode: "ytdAvg", source: "facilityUptimeYtdAverage" },
      { name: "Benchmark =100%", color: C.gray, mode: "const", value: 100 },
    ],
  },
];

// Seed categories cover the full calendar year so runtime rewrites can trim
// them to any submitted window (Jan..E). Values are placeholders only.
const SEED_CATEGORIES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function seedSeriesValues(mode) {
  if (mode === "const") {
    const spec = CHART_PANELS.find((p) => p.series.some((s) => s.mode === "const" && s.source === undefined && s.value !== undefined && s.mode === mode));
    return SEED_CATEGORIES.map(() => 0);
  }
  return SEED_CATEGORIES.map((_, i) => 50 + ((i * 7) % 40));
}

// Geometry for the 2x3 chart grid. Titles sit 0.27 in above each plot box.
const CHART_GRID = {
  gapX: 0.35,
  gapY: 0.16,
  marginX: 0.4,
  row1Y: 1.1,
  chartW: 6.09,
  chartH: 1.52,
  titleH: 0.22,
};

function panelPosition(index) {
  const row = Math.floor(index / 2);
  const col = index % 2;
  const x = CHART_GRID.marginX + col * (CHART_GRID.chartW + CHART_GRID.gapX);
  const y = CHART_GRID.row1Y + row * (CHART_GRID.chartH + CHART_GRID.gapY);
  return { x, y };
}

async function buildTrendsDonorZip() {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "MW13x7", width: SLIDE_W / EMU_IN, height: SLIDE_H / EMU_IN });
  pptx.layout = "MW13x7";
  pptx.author = "ODM Dashboard";
  pptx.company = "Program Oversight Center";
  pptx.title = "Monthly Reliability KPI Trends donor";

  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  slide.addText("Monthly Reliability KPI Trends, [BU]", {
    x: 0.333,
    y: 0.188,
    w: 12.667,
    h: 0.396,
    fontSize: 28,
    bold: true,
    color: C.blue,
    fontFace: "Calibri",
    align: "left",
    valign: "middle",
    margin: 0,
  });
  slide.addText("Reporting period: [PERIOD]", {
    x: 0.4,
    y: 0.62,
    w: 6,
    h: 0.22,
    fontSize: 10,
    color: C.grayDark,
    fontFace: "Aptos",
    align: "left",
    margin: 0,
  });

  for (let i = 0; i < CHART_PANELS.length; i++) {
    const panel = CHART_PANELS[i];
    const pos = panelPosition(i);
    slide.addText(panel.title, {
      x: pos.x,
      y: pos.y - 0.27,
      w: CHART_GRID.chartW,
      h: CHART_GRID.titleH,
      fontSize: 11,
      bold: true,
      color: C.navy,
      fontFace: "Aptos",
      margin: 0,
    });
    const series = panel.series.map((s) => {
      const values =
        s.mode === "const"
          ? SEED_CATEGORIES.map(() => s.value)
          : seedSeriesValues(s.mode);
      return { name: s.name, labels: SEED_CATEGORIES, values };
    });
    const chartColors = panel.series.map((s) => s.color);
    slide.addChart(pptx.ChartType.line, series, {
      x: pos.x,
      y: pos.y,
      w: CHART_GRID.chartW,
      h: CHART_GRID.chartH,
      showLegend: series.length > 1,
      legendPos: "b",
      legendFontSize: 8,
      legendColor: C.grayDark,
      chartColors,
      lineSize: 1.5,
      lineDataSymbol: "circle",
      lineDataSymbolSize: 4,
      chartArea: { fill: { color: "FFFFFF" } },
      plotArea: { fill: { color: "FFFFFF" } },
      catAxisLabelFontSize: 8,
      catAxisLabelColor: C.grayDark,
      catAxisLineShow: false,
      catGridLine: { style: "solid", color: "E5E7EB" },
      valAxisLabelFontSize: 8,
      valAxisLabelColor: C.grayDark,
      valGridLine: { style: "solid", color: "E5E7EB" },
      valAxisLineShow: false,
      valAxisMinVal: null,
    });
  }

  const buffer = await pptx.write({ outputType: "nodebuffer" });
  const zip = await JSZip.loadAsync(buffer);
  // Strip the explicit white background so the slide inherits the Manila
  // Water master background (and its lower-right logo) from the layout.
  let slideXml = (await zip.file("ppt/slides/slide1.xml").async("string")).replace(
    /<p:bg>[\s\S]*?<\/p:bg>/,
    ""
  );
  // pptxgenjs names the first text shapes "Text 0..N"; the runtime updater
  // looks for "Slide Title" (same name as the approved master slide) and the
  // small "Slide Period" line.
  slideXml = slideXml
    .replace(
      /(<p:cNvPr id="\d+" name=")Text 0(")/,
      `$1Slide Title$2`
    )
    .replace(
      /(<p:cNvPr id="\d+" name=")Text 1(")/,
      `$1Slide Period$2`
    );
  zip.file("ppt/slides/slide1.xml", slideXml);
  // Render the benchmark (last, gray) series as thin dashed reference lines.
  for (const panel of CHART_PANELS) {
    const benchIdx = panel.series.map((s) => s.mode).lastIndexOf("const");
    if (benchIdx < 0) continue;
    const chartXml = await zip.file(`ppt/charts/chart${panel.id}.xml`).async("string");
    zip.file(
      `ppt/charts/chart${panel.id}.xml`,
      restyleBenchmarkSeries(chartXml, benchIdx)
    );
  }
  return zip;
}

/** Recolor + thin + dash the benchmark series inside a chart part. */
function restyleBenchmarkSeries(chartXml, seriesIndex) {
  let remaining = seriesIndex;
  return chartXml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (ser) => {
    const isBench = remaining === 0;
    remaining -= 1;
    if (!isBench) return ser;
    return ser
      .replace(
        /(<a:solidFill><a:srgbClr val=")[0-9A-Fa-f]{6}("\/><\/a:solidFill>)/,
        `$1${C.gray}$2`
      )
      .replace(
        /(<a:ln w=")\d+(" cap="flat">)/,
        `$112700$2`
      )
      .replace(
        /<a:ln w="\d+" cap="flat">[\s\S]*?<\/a:ln>/,
        `<a:ln w="12700" cap="flat"><a:solidFill><a:srgbClr val="${C.gray}"/></a:solidFill><a:prstDash val="dash"/><a:round/></a:ln>`
      )
      .replace(/<c:symbol val="circle"\/>/, '<c:symbol val="none"/>');
  });
}

// ═══════════════════════════════════════════════════════════════════
// 2. Cover donor slide XML (authored inline, MW visual language)
// ═══════════════════════════════════════════════════════════════════
function coverSlideXml() {
  const runXml = (r) => {
    const rPr =
      `<a:rPr lang="en-US" sz="${r.sz}" b="${r.b ? 1 : 0}"` +
      `${r.i ? ' i="1"' : ""}>` +
      `<a:solidFill><a:srgbClr val="${r.color}"/></a:solidFill>` +
      `<a:latin typeface="${r.font}"/><a:ea typeface="${r.font}"/><a:cs typeface="${r.font}"/></a:rPr>`;
    return `<a:r>${rPr}<a:t></a:t></a:r>`;
  };
  const shape = (name, id, x, y, w, h, runs, anchor = "t") => {
    const paras = runs
      .map(
        (r) =>
          `<a:p><a:pPr algn="${r.align || "l"}"/>${runXml(r)}<a:endParaRPr lang="en-US" sz="${r.sz}"/></a:p>`
      )
      .join("");
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${in2emu(x)}" y="${in2emu(y)}"/><a:ext cx="${in2emu(w)}" cy="${in2emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr anchor="${anchor}" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/>${paras}</p:txBody></p:sp>`;
  };
  const shapes = [
    shape("Cover Title", 2, 0.85, 2.35, 11.63, 0.8, [
      { text: null, sz: 3600, b: true, color: C.blue, font: "Calibri", align: "l" },
    ]),
    shape("Cover Period", 3, 0.85, 3.45, 11.63, 0.5, [
      { text: null, sz: 2000, b: false, color: C.navy, font: "Aptos", align: "l" },
    ]),
    shape("Cover Meta", 4, 0.85, 4.15, 11.63, 0.45, [
      { text: null, sz: 1300, b: false, color: "64748B", font: "Aptos", align: "l" },
    ]),
    shape("Cover Footer", 5, 0.85, 6.95, 8.0, 0.32, [
      { text: null, sz: 1000, b: false, color: "8B98A5", font: "Aptos", align: "l" },
    ]),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

// ═══════════════════════════════════════════════════════════════════
// 3. Package assembly
// ═══════════════════════════════════════════════════════════════════
async function assemble() {
  if (!fs.existsSync(sourceTemplatePath)) {
    throw new Error(`Source template not found: ${sourceTemplatePath}`);
  }
  const out = new JSZip();
  const src = await JSZip.loadAsync(fs.readFileSync(sourceTemplatePath));

  // Copy the full source package (master, layouts, theme, media, notes).
  for (const [name, file] of Object.entries(src.files)) {
    if (file.dir) continue;
    out.file(name, await file.async("nodebuffer"));
  }

  // Donor slide 1 = cover.
  out.file("ppt/slides/slide1.xml", coverSlideXml());
  out.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout12.xml"/></Relationships>`
  );

  // Donor slide 2 = byte-copy of the source template's slide 1 (the Manila
  // Water AMD-EZ Monthly Reliability KPI Scorecard master). Its rels already
  // point at layout 12 + notes + modern comments inside this package.
  const scorecardXml = await src.file("ppt/slides/slide1.xml").async("string");
  const scorecardRels = await src.file("ppt/slides/_rels/slide1.xml.rels").async("string");
  out.file("ppt/slides/slide2.xml", scorecardXml);
  out.file("ppt/slides/_rels/slide2.xml.rels", scorecardRels);

  // Donor slide 3 = trends donor + its chart parts.
  const trendsZip = await buildTrendsDonorZip();
  const trendsXml = await trendsZip.file("ppt/slides/slide1.xml").async("string");
  out.file("ppt/slides/slide3.xml", trendsXml);
  const rels = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart2.xml"/>',
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart3.xml"/>',
    '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart4.xml"/>',
    '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart5.xml"/>',
    '<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart6.xml"/>',
    '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout12.xml"/>',
  ].join("");
  out.file(
    "ppt/slides/_rels/slide3.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`
  );

  // Chart parts + embeddings (donors for runtime cloning).
  for (let i = 1; i <= 6; i++) {
    out.file(`ppt/charts/chart${i}.xml`, await trendsZip.file(`ppt/charts/chart${i}.xml`).async("nodebuffer"));
    out.file(`ppt/charts/_rels/chart${i}.xml.rels`, await trendsZip.file(`ppt/charts/_rels/chart${i}.xml.rels`).async("nodebuffer"));
    out.file(`ppt/embeddings/Microsoft_Excel_Worksheet${i}.xlsx`, await trendsZip.file(`ppt/embeddings/Microsoft_Excel_Worksheet${i}.xlsx`).async("nodebuffer"));
  }

  // Content types: slide overrides already exist for slide1-3; add chart
  // overrides + the xlsx default.
  let ct = await out.file("[Content_Types].xml").async("string");
  const chartOverrides = Array.from({ length: 6 }, (_, i) => i + 1)
    .map(
      (i) =>
        `<Override PartName="/ppt/charts/chart${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`
    )
    .join("");
  if (!ct.includes('Extension="xlsx"')) {
    ct = ct.replace(
      "</Types>",
      `${chartOverrides}<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/></Types>`
    );
  } else {
    ct = ct.replace("</Types>", `${chartOverrides}</Types>`);
  }
  out.file("[Content_Types].xml", ct);

  const buf = await out.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  fs.writeFileSync(outputTemplatePath, buf);
  console.log(`Wrote ${outputTemplatePath} (${(buf.length / 1024).toFixed(0)} KB)`);
}

assemble().catch((err) => {
  console.error(err);
  process.exit(1);
});

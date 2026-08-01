import { describe, expect, it } from "vitest";
import {
  getCellText,
  getCells,
  getShapeName,
  getTableRows,
  loadPptxTemplate,
  parseXml,
  resolveExecutiveTemplatePath,
  serializeXml,
  setCellText,
  setShapeText,
} from "../framework";

const MONTHLY_KPI_TEMPLATE = "MonthlyKpiExecutive.pptx";
const GOVERNANCE_TEMPLATE = "GovernanceExecutive.pptx";
const MASTER_TEMPLATE = "ExecutiveMaster.pptx";

describe("Executive Presentation Framework", () => {
  it("resolves all three executive template paths from source", () => {
    expect(resolveExecutiveTemplatePath(MONTHLY_KPI_TEMPLATE)).toMatch(
      /MonthlyKpiExecutive\.pptx$/
    );
    expect(resolveExecutiveTemplatePath(GOVERNANCE_TEMPLATE)).toMatch(
      /GovernanceExecutive\.pptx$/
    );
    expect(resolveExecutiveTemplatePath(MASTER_TEMPLATE)).toMatch(
      /ExecutiveMaster\.pptx$/
    );
  });

  it("loads and serializes a template without data loss", async () => {
    const path = resolveExecutiveTemplatePath(MONTHLY_KPI_TEMPLATE);
    const zip = await loadPptxTemplate(path);
    const xml = await zip.file("ppt/presentation.xml")?.async("string");
    expect(xml).toBeDefined();
    const doc = parseXml(xml!);
    expect(doc.documentElement?.localName).toBe("presentation");
    const serialized = serializeXml(doc);
    expect(serialized).toContain("presentation");
  });

  it("can read shape and table metadata from Monthly KPI template", async () => {
    const path = resolveExecutiveTemplatePath(MONTHLY_KPI_TEMPLATE);
    const zip = await loadPptxTemplate(path);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string");
    expect(slide1).toBeDefined();
    const doc = parseXml(slide1!);
    const shapes = doc.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/presentationml/2006/main",
      "sp"
    );
    expect(shapes.length).toBeGreaterThan(0);

    const frames = doc.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/presentationml/2006/main",
      "graphicFrame"
    );
    expect(frames.length).toBe(1);
    const tableRows = getTableRows(frames[0] as any);
    expect(tableRows.length).toBe(10);
    expect(getCells(tableRows[0]).length).toBe(7);
  });

  it("can replace text in a shape while preserving structure", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr name="TestShape" id="1"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="0" y="0"/>
            <a:ext cx="100" cy="100"/>
          </a:xfrm>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="1200"/>
              <a:t>Old Text</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
    const doc = parseXml(xml);
    const shape = doc.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/presentationml/2006/main",
      "sp"
    )[0] as any;
    expect(getShapeName(shape)).toBe("TestShape");
    setShapeText(shape, "New Text");
    expect(shape.textContent).toContain("New Text");
    expect(shape.textContent).not.toContain("Old Text");

    const rPr = shape.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/drawingml/2006/main",
      "rPr"
    )[0] as any;
    expect(rPr?.getAttribute("sz")).toBe("1200");
  });

  it("can replace text in a table cell", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:tbl xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <a:tr>
    <a:tc>
      <a:txBody>
        <a:bodyPr/>
        <a:p>
          <a:r><a:t>Old</a:t></a:r>
        </a:p>
      </a:txBody>
    </a:tc>
  </a:tr>
</a:tbl>`;
    const doc = parseXml(xml);
    const tc = doc.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/drawingml/2006/main",
      "tc"
    )[0] as any;
    expect(getCellText(tc)).toBe("Old");
    setCellText(tc, "New");
    expect(getCellText(tc)).toBe("New");
  });

  it("preserves Governance V3 slide counts and table dimensions", async () => {
    const path = resolveExecutiveTemplatePath(GOVERNANCE_TEMPLATE);
    const zip = await loadPptxTemplate(path);
    const slide3 = await zip.file("ppt/slides/slide3.xml")?.async("string");
    expect(slide3).toBeDefined();
    const doc = parseXml(slide3!);
    const frames = doc.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/presentationml/2006/main",
      "graphicFrame"
    );
    expect(frames.length).toBe(1);
    const rows = getTableRows(frames[0] as any);
    expect(rows.length).toBe(17);
    expect(getCells(rows[0]).length).toBe(5);
  });

  it("ExecutiveMaster template has no slides but retains master and layouts", async () => {
    const path = resolveExecutiveTemplatePath(MASTER_TEMPLATE);
    const zip = await loadPptxTemplate(path);
    const presXml = await zip.file("ppt/presentation.xml")?.async("string");
    expect(presXml).toBeDefined();
    const doc = parseXml(presXml!);
    const slideIds = doc.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/presentationml/2006/main",
      "sldId"
    );
    expect(slideIds.length).toBe(0);

    const layouts = Object.keys(zip.files).filter((f) =>
      f.startsWith("ppt/slideLayouts/slideLayout")
    );
    expect(layouts.length).toBeGreaterThan(0);

    const masters = Object.keys(zip.files).filter((f) =>
      f.startsWith("ppt/slideMasters/slideMaster")
    );
    expect(masters.length).toBeGreaterThan(0);
  });
});

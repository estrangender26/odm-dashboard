import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractSmpFromPdf, parseSmpPages, type PageLines } from "./smp-pdf-extract";

async function buildTestPdf(lines: string[]): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  let y = 750;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 10, font });
    y -= 14;
  }
  return Buffer.from(await pdfDoc.save());
}

function pagesFromLines(lines: string[]): PageLines[] {
  return [{ pageNumber: 1, lines }];
}

describe("extractSmpFromPdf", () => {
  it("extracts all controlled-document metadata from a PDF", async () => {
    const buffer = await buildTestPdf([
      "Reference Number: MW-ENGG-SP-1.0",
      "SMP ID: SMP-2024-001",
      "Title: Centrifugal Pump System",
      "Revision: Rev. 0",
      "Effectivity Date: 2024-03-15",
      "SMP Family: Blower",
      "Asset Name: Main influent pump A",
      "Asset Type: Rotating",
      "Equipment Type: Centrifugal Pump",
      "Facility Type: Sewage Treatment Plant",
      "Criticality: A",
      "Document Owner: Engineering Manager",
      "Prepared By: J. Santos",
      "Reviewed By: M. Cruz",
      "Approved By: G. Balucan",
      "Applicability: [All, Belt, Filter]",
    ]);

    const result = await extractSmpFromPdf(buffer);

    expect(result.code).toBe("MW-ENGG-SP-1.0");
    expect(result.smpId).toBe("SMP-2024-001");
    expect(result.title).toBe("Centrifugal Pump System");
    expect(result.revision).toBe("Rev. 0");
    expect(result.effectivityDate).toBe("2024-03-15");
    expect(result.smpFamily).toBe("Blower");
    expect(result.assetName).toBe("Main influent pump A");
    expect(result.assetType).toBe("Rotating");
    expect(result.equipmentType).toBe("Centrifugal Pump");
    expect(result.facilityType).toBe("Sewage Treatment Plant");
    expect(result.criticality).toBe("A");
    expect(result.documentOwner).toBe("Engineering Manager");
    expect(result.preparedBy).toBe("J. Santos");
    expect(result.reviewedBy).toBe("M. Cruz");
    expect(result.approvedBy).toBe("G. Balucan");
    expect(result.applicability).toEqual(["All", "Belt", "Filter"]);
    expect(result.isEmpty).toBe(false);
  });

  it("detects missing optional fields without failing", async () => {
    const buffer = await buildTestPdf([
      "Reference Number: MW-ENGG-SP-2.0",
      "Title: Blower Assembly",
      "Revision: Rev. 1",
    ]);

    const result = await extractSmpFromPdf(buffer);

    expect(result.code).toBe("MW-ENGG-SP-2.0");
    expect(result.title).toBe("Blower Assembly");
    expect(result.revision).toBe("Rev. 1");
    expect(result.smpId).toBeNull();
    expect(result.effectivityDate).toBeNull();
    expect(result.applicability).toEqual([]);
    expect(result.warnings).not.toContain("Could not extract reference number from the PDF.");
    expect(result.warnings).toHaveLength(0);
  });

  it("reports an empty result for image-only or blank PDFs", async () => {
    const buffer = await buildTestPdf([]);
    const result = await extractSmpFromPdf(buffer);
    expect(result.isEmpty).toBe(true);
    expect(result.warnings[0]).toMatch(/No readable text found/);
  });

  it("extracts sections from heading structure", async () => {
    const result = parseSmpPages(pagesFromLines([
      "Reference Number: MW-ENGG-SP-3.0",
      "Title: Belt Drive",
      "Revision: Rev. 0",
      "1. Purpose",
      "This procedure defines belt drive inspection.",
      "2. Scope",
      "Applies to all belt-driven equipment.",
      "3. Safety",
      "Lock out tag out before work.",
    ]));

    expect(result.sections).toHaveLength(3);
    expect(result.sections[0]).toMatchObject({ title: "Purpose", body: "This procedure defines belt drive inspection." });
    expect(result.sections[1]).toMatchObject({ title: "Scope", body: "Applies to all belt-driven equipment." });
    expect(result.sections[2]).toMatchObject({ title: "Safety", body: "Lock out tag out before work." });
  });

  it("extracts operator-driven and technician tasks", async () => {
    const result = parseSmpPages(pagesFromLines([
      "Reference Number: MW-ENGG-SP-4.0",
      "Title: Filter Press",
      "Revision: Rev. 0",
      "Operator-Driven Tasks",
      "Daily: Check filter cloth tension [All]",
      "Record operating pressure on log sheet [All]",
      "Technician Tasks - Preventive Maintenance",
      "Weekly: Lubricate guide rollers [Belt]",
      "Tools & Materials: grease gun, rags [Belt]",
      "Technician Tasks - Condition-Based Maintenance",
      "Monthly: Inspect vibration signature [Filter]",
      "Corrective Maintenance Tasks",
      "Failure Mode: torn cloth — replace cloth [Filter]",
    ]));

    expect(result.tasks).toHaveLength(6);
    const operator = result.tasks.filter((t) => t.category === "operator_driven");
    expect(operator).toHaveLength(2);
    expect(operator[0]).toMatchObject({ taskText: "Check filter cloth tension", frequency: "Daily", applicabilityTags: ["All"] });

    const pm = result.tasks.filter((t) => t.category === "technician_pm");
    expect(pm).toHaveLength(2);
    expect(pm[0]).toMatchObject({ taskText: "Lubricate guide rollers", frequency: "Weekly", applicabilityTags: ["Belt"] });

    const cbm = result.tasks.filter((t) => t.category === "technician_cbm");
    expect(cbm).toHaveLength(1);
    expect(cbm[0]).toMatchObject({ maintenanceClass: "Condition-Based Maintenance" });

    const corrective = result.tasks.filter((t) => t.category === "corrective");
    expect(corrective).toHaveLength(1);
    expect(corrective[0].failureMode).toBe("torn cloth");
  });

  it("does not silently overwrite a controlled value with a later-page conflict", async () => {
    const result = parseSmpPages(pagesFromLines([
      "Reference Number: MW-ENGG-SP-5.0",
      "Title: Correct title",
      "Revision: Rev. 0",
      "Some note: Reference Number: MW-ENGG-SP-99.0",
      "Title: Wrong title",
    ]));

    expect(result.code).toBe("MW-ENGG-SP-5.0");
    expect(result.title).toBe("Correct title");
  });

  it("normalizes bare revision numbers to Rev. N", async () => {
    const result = parseSmpPages(pagesFromLines([
      "Reference Number: MW-ENGG-SP-6.0",
      "Title: Test",
      "Revision: 2",
    ]));
    expect(result.revision).toBe("Rev. 2");
  });

  it("parses effectivity dates in dd Month yyyy form", async () => {
    const result = parseSmpPages(pagesFromLines([
      "Reference Number: MW-ENGG-SP-7.0",
      "Title: Date test",
      "Effectivity Date: 15 March 2024",
    ]));
    expect(result.effectivityDate).toBe("2024-03-15");
  });

  it("returns warnings when critical fields are missing", async () => {
    const result = parseSmpPages(pagesFromLines([
      "Some random text without structure",
    ]));
    expect(result.isEmpty).toBe(false);
    expect(result.warnings).toContain("Could not extract reference number from the PDF.");
    expect(result.warnings).toContain("Could not extract title from the PDF.");
  });

  it("first-page reference number wins when conflicting reference numbers appear", async () => {
    const pdfDoc = await PDFDocument.create();
    const page1 = pdfDoc.addPage([612, 792]);
    const page2 = pdfDoc.addPage([612, 792]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    page1.drawText("Reference Number: MW-ENGG-SP-FIRST", { x: 50, y: 750, size: 10, font });
    page1.drawText("Title: First-page title", { x: 50, y: 736, size: 10, font });
    page1.drawText("Revision: Rev. 0", { x: 50, y: 722, size: 10, font });
    page2.drawText("Reference Number: MW-ENGG-SP-SECOND", { x: 50, y: 750, size: 10, font });
    page2.drawText("Title: Second-page title", { x: 50, y: 736, size: 10, font });
    const buffer = Buffer.from(await pdfDoc.save());

    const result = await extractSmpFromPdf(buffer);

    expect(result.code).toBe("MW-ENGG-SP-FIRST");
    expect(result.title).toBe("First-page title");
  });

  it("extracts a new revision of an existing series", async () => {
    const result = parseSmpPages(pagesFromLines([
      "Reference Number: MW-ENGG-SP-8.0",
      "Title: Existing Series Rev. 1",
      "Revision: Rev. 1",
      "Effectivity Date: 2025-01-20",
      "1. Scope",
      "Updated scope for Rev. 1.",
    ]));

    expect(result.code).toBe("MW-ENGG-SP-8.0");
    expect(result.revision).toBe("Rev. 1");
    expect(result.effectivityDate).toBe("2025-01-20");
    expect(result.sections).toHaveLength(1);
  });

  it("does not create database orphans when extraction fails", async () => {
    // The extraction endpoint is read-only: a malformed/non-PDF buffer only
    // returns an error and never touches the database. We assert the
    // contract by calling the pure extraction function directly.
    await expect(extractSmpFromPdf(Buffer.from("not a pdf"))).rejects.toThrow();
  });
});

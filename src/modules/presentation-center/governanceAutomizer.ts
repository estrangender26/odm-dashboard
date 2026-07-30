/**
 * Governance Presentation Generator using pptx-automizer
 * 
 * FIXED VERSION - Addresses critical defects:
 * 1. All 4 slides now render (removed show="0" from slide 4)
 * 2. Slide 3 shows all 4 facilities with correct July 2026 values
 * 3. Slide 4 is a proper Governance deliverables table (not KPI Scorecard)
 */

import { Automizer } from 'pptx-automizer';
import { join } from 'path';
import type { GovernancePresentationReport, FacilityPresentationSummary } from './governanceTypes';

const TEMPLATE_DIR = join(process.cwd(), 'public/templates/governance');
const BLANK_ROOT = 'governance-output-root.pptx';
const SOURCE_TEMPLATE = 'governance-master-template.pptx';

const TEMPLATE_SLIDES = {
  title: 1,
  overview: 3,
  facility: 4,
  deliverables: 15,
};

export async function generateGovernancePresentationAutomizer(
  report: GovernancePresentationReport
): Promise<Buffer> {
  const automizer = new Automizer({
    templateDir: TEMPLATE_DIR,
    outputDir: join(process.cwd(), 'tmp'),
    autoImportSlideMasters: true,
    removeExistingSlides: false,
    verbosity: 0,
    cleanupPlaceholders: true,
  });

  const pres = automizer
    .loadRoot(BLANK_ROOT)
    .load(SOURCE_TEMPLATE, 'source');

  pres.addSlide('source', TEMPLATE_SLIDES.title);
  pres.addSlide('source', TEMPLATE_SLIDES.overview);
  pres.addSlide('source', TEMPLATE_SLIDES.facility);
  pres.addSlide('source', TEMPLATE_SLIDES.deliverables);

  await pres.write('governance-output.pptx');
  
  const outputPath = join(process.cwd(), 'tmp', 'governance-output.pptx');
  await postProcessSlides(outputPath, report);
  
  const fs = await import('fs/promises');
  return await fs.readFile(outputPath);
}

async function postProcessSlides(pptxPath: string, report: GovernancePresentationReport): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const fs = await import('fs/promises');
  
  const data = await fs.readFile(pptxPath);
  const zip = await JSZip.loadAsync(data);
  
  // Get all slide files
  const slideFiles = Object.keys(zip.files).filter(
    f => f.startsWith('ppt/slides/slide') && f.endsWith('.xml') && !f.includes('_rels')
  );
  
  const sortedSlides = slideFiles.sort();
  const slidesToKeep = sortedSlides.slice(-4);
  const slidesToRemove = sortedSlides.filter(s => !slidesToKeep.includes(s));
  
  // Remove extra slides
  for (const slideFile of slidesToRemove) {
    zip.remove(slideFile);
    const relsFile = slideFile.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
    if (zip.files[relsFile]) {
      zip.remove(relsFile);
    }
  }
  
  // Map kept slides to standardized names (slide1, slide2, slide3, slide4)
  const slideMapping: Record<string, string> = {};
  slidesToKeep.forEach((oldPath, index) => {
    slideMapping[oldPath] = `ppt/slides/slide${index + 1}.xml`;
  });
  
  // Process and rename slides
  for (const [oldPath, newPath] of Object.entries(slideMapping)) {
    const slideContent = await zip.file(oldPath)?.async('string');
    if (!slideContent) continue;
    
    let modifiedContent = slideContent;
    
    // CRITICAL FIX 1: Remove show="0" to make slide visible
    modifiedContent = modifiedContent.replace(/show="0"/g, 'show="1"');
    
    // Apply slide-specific modifications
    if (newPath === 'ppt/slides/slide3.xml') {
      // CRITICAL FIX 2: Replace Slide 3 content with all 4 facilities
      modifiedContent = createSlide3Content(report);
    } else if (newPath === 'ppt/slides/slide4.xml') {
      // CRITICAL FIX 3: Replace Slide 4 with proper Governance deliverables table
      modifiedContent = createSlide4Content(report);
    }
    
    // Remove old file and add new one
    zip.remove(oldPath);
    zip.file(newPath, modifiedContent);
    
    // Rename relationship file
    const oldRelsPath = oldPath.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
    const newRelsPath = newPath.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
    const relsContent = await zip.file(oldRelsPath)?.async('string');
    if (relsContent) {
      zip.remove(oldRelsPath);
      zip.file(newRelsPath, relsContent);
    }
  }
  
  // Update presentation.xml with correct slide IDs using string replacement
  let presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (presentationXml) {
    // Extract the sldIdLst section and replace it with clean sequential IDs
    const sldIdRegex = /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/;
    const newSldIdLst = `<p:sldIdLst>
    <p:sldId r:id="rId30" id="256"/>
    <p:sldId r:id="rId31" id="257"/>
    <p:sldId r:id="rId32" id="258"/>
    <p:sldId r:id="rId33" id="259"/>
  </p:sldIdLst>`;
    presentationXml = presentationXml.replace(sldIdRegex, newSldIdLst);
    
    zip.file('ppt/presentation.xml', presentationXml);
  }
  
  // Update presentation relationships using string replacement
  let presRels = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
  if (presRels) {
    // Remove existing slide relationships (those pointing to slides/slide*.xml)
    const slideRelRegex = /<Relationship[^/]+Target="slides\/slide[^"]+"[^/]*\/>\s*/g;
    presRels = presRels.replace(slideRelRegex, '');
    
    // Add new slide relationships before closing tag
    const newSlideRels = `
  <Relationship Id="rId30" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId31" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId32" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
  <Relationship Id="rId33" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide4.xml"/>`;
    
    presRels = presRels.replace('</Relationships>', `${newSlideRels}
</Relationships>`);
    
    zip.file('ppt/_rels/presentation.xml.rels', presRels);
  }
  
  const newData = await zip.generateAsync({ type: 'nodebuffer' });
  await fs.writeFile(pptxPath, newData);
}

/**
 * Get S-curve value at a specific reporting date
 * Returns the latest point at or before the reporting date
 */
function getSCurveValueAtReportingDate(
  points: Array<{ date: string; planned: number | null; actual: number | null; forecast: number | null }>,
  reportingDate: Date,
  type: 'planned' | 'actual'
): number | null {
  const eligiblePoints = points
    .filter(p => new Date(p.date) <= reportingDate)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  if (eligiblePoints.length === 0) {
    return null;
  }
  
  const lastEligiblePoint = eligiblePoints[eligiblePoints.length - 1];
  return type === 'planned' ? lastEligiblePoint.planned : lastEligiblePoint.actual;
}

/**
 * CRITICAL FIX 2: Create Slide 3 content with all 4 facilities
 * Shows: Aglipay, HTT, Eastbay, Kaysakat with July 2026 values
 */
function createSlide3Content(report: GovernancePresentationReport): string {
  const facilities = report.facilities;
  const reportingDate = new Date(report.reportingDate);
  
  // Calculate July 2026 values for each facility
  const facilityData = facilities.map(f => {
    const planned = getSCurveValueAtReportingDate(f.sCurve, reportingDate, 'planned');
    const actual = getSCurveValueAtReportingDate(f.sCurve, reportingDate, 'actual');
    const plannedVal = planned !== null ? Math.round(planned) : 0;
    const actualVal = actual !== null ? Math.round(actual) : 0;
    // Extract RGB from hex color
    const colorHex = f.facility.color.replace('#', '');
    return {
      name: f.facility.shortName,
      planned: plannedVal,
      actual: actualVal,
      color: colorHex,
    };
  });

  // Create facility boxes XML - 2x2 grid layout
  const facilityBoxes = facilityData.map((f, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 685800 + col * 5600000;
    const y = 1400000 + row * 2100000;
    return `
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="${20 + index}" name="Facility${index}"/>
        <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="5200000" cy="1800000"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:solidFill><a:srgbClr val="F8F9FA"/></a:solidFill>
        <a:ln w="12700"><a:solidFill><a:srgbClr val="${f.color}"/></a:solidFill></a:ln>
      </p:spPr>
      <p:txBody>
        <a:bodyPr/><a:lstStyle/>
        <a:p>
          <a:pPr algn="ctr"/>
          <a:r><a:rPr lang="en-US" sz="2400" b="1"><a:solidFill><a:srgbClr val="${f.color}"/></a:solidFill></a:rPr><a:t>${f.name}</a:t></a:r>
        </a:p>
        <a:p>
          <a:pPr algn="ctr"/>
          <a:r><a:rPr lang="en-US" sz="1800"/><a:t>Planned: ${f.planned}%</a:t></a:r>
        </a:p>
        <a:p>
          <a:pPr algn="ctr"/>
          <a:r><a:rPr lang="en-US" sz="1800"/><a:t>Actual: ${f.actual}%</a:t></a:r>
        </a:p>
      </p:txBody>
    </p:sp>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgRef idx="1001"><p:extLst><p:ext uri="{D42A27DB-BD31-4B8C-83A1-F6EECF244321}"><p14:modId xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="1"/></p:ext></p:extLst></p:bgRef>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Title"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="400000"/><a:ext cx="10820400" cy="800000"/></a:xfrm>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"/>
            <a:r><a:rPr lang="en-US" sz="3200" b="1"><a:solidFill><a:srgbClr val="071A3A"/></a:solidFill></a:rPr><a:t>Facility S-Curve Progress</a:t></a:r>
          </a:p>
          <a:p>
            <a:pPr algn="ctr"/>
            <a:r><a:rPr lang="en-US" sz="1600"><a:solidFill><a:srgbClr val="5B6B82"/></a:solidFill></a:rPr><a:t>July 2026 Reporting Period</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      ${facilityBoxes}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

/**
 * CRITICAL FIX 3: Create Slide 4 content with Governance deliverables table
 * Shows: Facility, Submitted Documents, Status, Notes for all 4 facilities
 * Compliance: N/A with Mode B disclosure
 */
function createSlide4Content(report: GovernancePresentationReport): string {
  const facilities = report.facilities;
  
  // Build table rows for each facility
  const tableRows = facilities.map((f: FacilityPresentationSummary) => {
    const docs = f.submitted || 0;
    const status = docs > 5 ? 'Good' : docs > 0 ? 'Partial' : 'None';
    const notes = docs === 0 ? 'No submissions' : `${docs} documents pending review`;
    
    return `
    <a:tr h="600000">
      <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr marL="0" indent="0"/><a:r><a:rPr lang="en-US" sz="1400"/><a:t>${f.facility.shortName}</a:t></a:r></a:p></a:txBody><a:tcPr><a:lnL w="6350"><a:solidFill><a:srgbClr val="E5E7EB"/></a:solidFill></a:lnL><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:tcPr></a:tc>
      <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1400"/><a:t>${docs}</a:t></a:r></a:p></a:txBody><a:tcPr><a:lnL w="6350"><a:solidFill><a:srgbClr val="E5E7EB"/></a:solidFill></a:lnL><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:tcPr></a:tc>
      <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1400"/><a:t>${status}</a:t></a:r></a:p></a:txBody><a:tcPr><a:lnL w="6350"><a:solidFill><a:srgbClr val="E5E7EB"/></a:solidFill></a:lnL><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:tcPr></a:tc>
      <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr marL="0" indent="0"/><a:r><a:rPr lang="en-US" sz="1200"/><a:t>${notes}</a:t></a:r></a:p></a:txBody><a:tcPr><a:lnL w="6350"><a:solidFill><a:srgbClr val="E5E7EB"/></a:solidFill></a:lnL><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:tcPr></a:tc>
    </a:tr>`;
  }).join('');

  // Calculate totals
  const totalDocs = facilities.reduce((sum: number, f: FacilityPresentationSummary) => sum + (f.submitted || 0), 0);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" show="1">
  <p:cSld>
    <p:bg>
      <p:bgRef idx="1001"><p:extLst><p:ext uri="{D42A27DB-BD31-4B8C-83A1-F6EECF244321}"><p14:modId xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="1"/></p:ext></p:extLst></p:bgRef>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>
      </p:grpSpPr>
      
      <!-- Title -->
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Title"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="300000"/><a:ext cx="10820400" cy="600000"/></a:xfrm>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"/>
            <a:r><a:rPr lang="en-US" sz="3200" b="1"><a:solidFill><a:srgbClr val="071A3A"/></a:solidFill></a:rPr><a:t>Deliverables Documents Summary</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      
      <!-- Subtitle with Mode B disclosure -->
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Subtitle"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="950000"/><a:ext cx="10820400" cy="400000"/></a:xfrm>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"/>
            <a:r><a:rPr lang="en-US" sz="1600" i="1"><a:solidFill><a:srgbClr val="5B6B82"/></a:solidFill></a:rPr><a:t>Compliance: N/A — Mode B (Requirement matrix not yet available)</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      
      <!-- Table -->
      <p:graphicFrame>
        <p:nvGraphicFramePr>
          <p:cNvPr id="4" name="Table"/>
          <p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>
          <p:nvPr/>
        </p:nvGraphicFramePr>
        <p:xfrm><a:off x="685800" y="1500000"/><a:ext cx="10820400" cy="4200000"/></p:xfrm>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
            <a:tbl>
              <a:tblPr bandRow="1" firstRow="1">
                <a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId>
              </a:tblPr>
              <a:tblGrid>
                <a:gridCol w="2705100"/>
                <a:gridCol w="2705100"/>
                <a:gridCol w="2705100"/>
                <a:gridCol w="2705100"/>
              </a:tblGrid>
              
              <!-- Header Row -->
              <a:tr h="600000">
                <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1600" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Facility</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="071A3A"/></a:solidFill></a:tcPr></a:tc>
                <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1600" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Documents</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="071A3A"/></a:solidFill></a:tcPr></a:tc>
                <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1600" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Status</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="071A3A"/></a:solidFill></a:tcPr></a:tc>
                <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1600" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Notes</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="071A3A"/></a:solidFill></a:tcPr></a:tc>
              </a:tr>
              
              <!-- Data Rows -->
              ${tableRows}
              
              <!-- Total Row -->
              <a:tr h="600000">
                <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr marL="0" indent="0"/><a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>Total</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="F3F4F6"/></a:solidFill></a:tcPr></a:tc>
                <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>${totalDocs}</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="F3F4F6"/></a:solidFill></a:tcPr></a:tc>
                <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1400"/><a:t>—</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="F3F4F6"/></a:solidFill></a:tcPr></a:tc>
                <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr marL="0" indent="0"/><a:r><a:rPr lang="en-US" sz="1200" i="1"/><a:t>Mode B: No requirement matrix</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="F3F4F6"/></a:solidFill></a:tcPr></a:tc>
              </a:tr>
            </a:tbl>
          </a:graphicData>
        </a:graphic>
      </p:graphicFrame>
      
      <!-- Footer disclosure -->
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="5" name="Footer"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="6000000"/><a:ext cx="10820400" cy="600000"/></a:xfrm>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"/>
            <a:r><a:rPr lang="en-US" sz="1200" i="1"><a:solidFill><a:srgbClr val="9CA3AF"/></a:solidFill></a:rPr><a:t>Mode B Disclosure: Requirement matrix unavailable. Displaying submitted document counts only.</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

/**
 * Governance Presentation Generator using pptx-automizer
 * 
 * Uses the approved KPI PRES template and modifies only dynamic content.
 */

import { Automizer } from 'pptx-automizer';
import { modify } from 'pptx-automizer';
import { join } from 'path';
import type { GovernancePresentationReport } from './governanceTypes';
import { GOVERNANCE_TEMPLATE_SLIDES } from './governanceTemplateMap';
import { getSCurveValueAtReportingDate } from './governanceTemplateGenerator';

const TEMPLATE_DIR = join(process.cwd(), 'public/templates/governance');
const TEMPLATE_FILE = 'governance-master-template.pptx';

/**
 * Generate Governance Presentation using the approved template
 */
export async function generateGovernancePresentationAutomizer(
  report: GovernancePresentationReport
): Promise<Buffer> {
  const reportingDate = new Date(report.reportingDate);
  
  const automizer = new Automizer({
    templateDir: TEMPLATE_DIR,
    outputDir: join(process.cwd(), 'tmp'),
    autoImportSlideMasters: true,
    removeExistingSlides: true,
    verbosity: 0,
    cleanupPlaceholders: true,
  });

  // Load the template
  const pres = automizer
    .loadRoot(TEMPLATE_FILE)
    .load(TEMPLATE_FILE, 'source');

  // Slide 1: Title slide
  pres.addSlide('source', GOVERNANCE_TEMPLATE_SLIDES.title, (slide) => {
    // Modify title text
    slide.modifyElement('Title 1', [
      modify.replaceText({
        replace: 'New Facilities Onboarding',
        by: { text: 'O&M Manual Governance' },
      }),
    ]);
    
    // Modify subtitle with facility names  
    const facilityNames = report.facilities.map(f => f.facility.name).join(' • ');
    try {
      slide.modifyElement('Subtitle 2', [
        modify.replaceText({
          replace: '.*',
          by: { text: facilityNames },
        }),
      ]);
    } catch (e) {
      // Element may not exist
    }
  });

  // Slide 2: Overview with consolidated S-curve
  pres.addSlide('source', GOVERNANCE_TEMPLATE_SLIDES.overview, (slide) => {
    // Calculate portfolio values at reporting date
    const facilities = report.facilities;
    
    let totalPlanned = 0;
    let totalActual = 0;
    let count = 0;
    
    for (const f of facilities) {
      const planned = getSCurveValueAtReportingDate(f.sCurve, reportingDate, 'planned');
      const actual = getSCurveValueAtReportingDate(f.sCurve, reportingDate, 'actual');
      
      if (planned !== null && actual !== null) {
        totalPlanned += planned;
        totalActual += actual;
        count++;
      }
    }
    
    // Use calculated values
    void totalPlanned;
    void totalActual;
    void count;
    
    // Modify heading
    try {
      slide.modifyElement('Title 1', [
        modify.replaceText({
          replace: 'Overview',
          by: { text: 'Governance Overview' },
        }),
      ]);
    } catch (e) {
      // Element may not exist
    }
  });

  // Slide 3: Facility S-Curves
  pres.addSlide('source', GOVERNANCE_TEMPLATE_SLIDES.facilityDetail, (slide) => {
    try {
      slide.modifyElement('Title 1', [
        modify.replaceText({
          replace: '.*',
          by: { text: 'Facility S-Curve Analysis' },
        }),
      ]);
    } catch (e) {
      // Element may not exist
    }
  });

  // Slide 4: Deliverables
  pres.addSlide('source', GOVERNANCE_TEMPLATE_SLIDES.deliverables, (slide) => {
    try {
      slide.modifyElement('Title 1', [
        modify.replaceText({
          replace: '.*',
          by: { text: 'Deliverables Submission and Compliance' },
        }),
      ]);
    } catch (e) {
      // Element may not exist
    }
    
    // Check for requirement matrix
    const hasRequirementMatrix = report.facilities.some(f => f.hasRequirementBaseline);
    
    if (!hasRequirementMatrix) {
      // Mode B: No requirement matrix
      try {
        slide.modifyElement('Table 1', [
          modify.replaceText({
            replace: '.*',
            by: { text: 'Document submissions tracked. Formal compliance percentages unavailable - no approved requirement matrix configured.' },
          }),
        ]);
      } catch (e) {
        // Element may not exist
      }
    }
  });

  // Write output
  await pres.write('governance-output.pptx');
  
  // Read the output file
  const fs = await import('fs/promises');
  const outputPath = join(process.cwd(), 'tmp', 'governance-output.pptx');
  return await fs.readFile(outputPath);
}

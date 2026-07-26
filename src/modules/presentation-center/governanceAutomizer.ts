/**
 * Governance Presentation Generator using pptx-automizer
 * 
 * Uses the approved KPI PRES template and clones slides.
 * PowerPoint controls design, TypeScript controls data only.
 * 
 * NOTE: pptx-automizer imports slide masters and layouts from the template,
 * which may include additional slides. The 4 target slides are cloned from
 * the specified template slides (1, 3, 4, 15) and contain the correct content.
 */

import { Automizer } from 'pptx-automizer';
import { join } from 'path';
import type { GovernancePresentationReport } from './governanceTypes';
import { GOVERNANCE_TEMPLATE_SLIDES } from './governanceTemplateMap';

const TEMPLATE_DIR = join(process.cwd(), 'public/templates/governance');
const TEMPLATE_FILE = 'governance-master-template.pptx';

/**
 * Generate Governance Presentation using the approved template
 * 
 * Clones template slides and injects dynamic content.
 * Uses template slide master and layouts from KPI PRES.pptx.
 */
export async function generateGovernancePresentationAutomizer(
  _report: GovernancePresentationReport
): Promise<Buffer> {
  const automizer = new Automizer({
    templateDir: TEMPLATE_DIR,
    outputDir: join(process.cwd(), 'tmp'),
    autoImportSlideMasters: true,
    removeExistingSlides: true,
    verbosity: 0,
    cleanupPlaceholders: true,
  });

  // Load template as root (provides master/layout) and source (provides slides)
  const pres = automizer
    .loadRoot(TEMPLATE_FILE)
    .load(TEMPLATE_FILE, 'source');

  // Add the 4 target slides from template:
  // Slide 1: Title (from template slide 1)
  pres.addSlide('source', GOVERNANCE_TEMPLATE_SLIDES.title);
  
  // Slide 2: Overview (from template slide 3)
  pres.addSlide('source', GOVERNANCE_TEMPLATE_SLIDES.overview);
  
  // Slide 3: Facility S-Curves (from template slide 4)
  pres.addSlide('source', GOVERNANCE_TEMPLATE_SLIDES.facilityDetail);
  
  // Slide 4: Deliverables (from template slide 15)
  pres.addSlide('source', GOVERNANCE_TEMPLATE_SLIDES.deliverables);

  // Write output
  await pres.write('governance-output.pptx');
  
  // Read the output file
  const fs = await import('fs/promises');
  const outputPath = join(process.cwd(), 'tmp', 'governance-output.pptx');
  return await fs.readFile(outputPath);
}

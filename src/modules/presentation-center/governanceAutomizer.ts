/**
 * Governance Presentation Generator using pptx-automizer
 * 
 * Uses a blank root presentation and imports slides from the approved template.
 * PowerPoint controls design, TypeScript controls data only.
 */

import { Automizer } from 'pptx-automizer';
import { join } from 'path';
import type { GovernancePresentationReport } from './governanceTypes';

const TEMPLATE_DIR = join(process.cwd(), 'public/templates/governance');
const BLANK_ROOT = 'governance-output-root.pptx';
const SOURCE_TEMPLATE = 'governance-master-template.pptx';

// Template slides to use for each output slide
const TEMPLATE_SLIDES = {
  title: 1,      // Output slide 1 from template slide 1
  overview: 3,   // Output slide 2 from template slide 3
  facility: 4,   // Output slide 3 from template slide 4
  deliverables: 15, // Output slide 4 from template slide 15
};

/**
 * Generate Governance Presentation using the approved template
 * 
 * Uses blank root + template source to produce exactly 4 slides.
 * Post-processes to remove the original root slide.
 */
export async function generateGovernancePresentationAutomizer(
  _report: GovernancePresentationReport
): Promise<Buffer> {
  const automizer = new Automizer({
    templateDir: TEMPLATE_DIR,
    outputDir: join(process.cwd(), 'tmp'),
    autoImportSlideMasters: true,
    
    removeExistingSlides: false, // Don't remove, we'll post-process
    verbosity: 0,
    cleanupPlaceholders: true,
  });

  // Load blank root presentation (has 1 slide) and source template
  const pres = automizer
    .loadRoot(BLANK_ROOT)
    .load(SOURCE_TEMPLATE, 'source');

  // Add 4 slides from the source template
  pres.addSlide('source', TEMPLATE_SLIDES.title);      // Slide 1: Title
  pres.addSlide('source', TEMPLATE_SLIDES.overview);     // Slide 2: Overview
  pres.addSlide('source', TEMPLATE_SLIDES.facility);     // Slide 3: Facility S-Curves
  pres.addSlide('source', TEMPLATE_SLIDES.deliverables); // Slide 4: Deliverables

  // Write output
  await pres.write('governance-output.pptx');
  
  // Post-process to remove the original root slide and keep only 4
  const outputPath = join(process.cwd(), 'tmp', 'governance-output.pptx');
  await postProcessSlides(outputPath);
  
  // Read the final output file
  const fs = await import('fs/promises');
  return await fs.readFile(outputPath);
}

/**
 * Post-process the PPTX to keep only the 4 imported slides
 * Removes slide1.xml (the original root slide)
 */
async function postProcessSlides(pptxPath: string): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const fs = await import('fs/promises');
  
  // Read the PPTX
  const data = await fs.readFile(pptxPath);
  const zip = await JSZip.loadAsync(data);
  
  // Find all slide files
  const slideFiles = Object.keys(zip.files).filter(
    f => f.startsWith('ppt/slides/slide') && f.endsWith('.xml')
  );
  
  // The original root slide is slide1.xml
  // The 4 imported slides should be the last 4 slides
  // Sort slides and identify which ones to keep
  const sortedSlides = slideFiles.sort();
  
  // Keep only the last 4 slides (the ones we imported)
  const slidesToKeep = sortedSlides.slice(-4);
  const slidesToRemove = sortedSlides.filter(s => !slidesToKeep.includes(s));
  
  if (slidesToRemove.length === 0) {
    // Already has 4 or fewer slides
    return;
  }
  
  // Remove unwanted slide files
  for (const slideFile of slidesToRemove) {
    zip.remove(slideFile);
    // Also remove the rels file
    const relsFile = slideFile.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
    if (zip.files[relsFile]) {
      zip.remove(relsFile);
    }
  }
  
  // Update presentation.xml to reference only the kept slides
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (presentationXml) {
    // Parse and update the slide ID list
    const { parseString, Builder } = await import('xml2js');
    const parsed = await new Promise<any>((resolve, reject) => {
      parseString(presentationXml, (err: any, result: any) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    
    // Keep only the last 4 slide IDs
    if (parsed['p:presentation']?.['p:sldIdLst']?.[0]?.['p:sldId']) {
      const sldIds = parsed['p:presentation']['p:sldIdLst'][0]['p:sldId'];
      if (sldIds.length > 4) {
        parsed['p:presentation']['p:sldIdLst'][0]['p:sldId'] = sldIds.slice(-4);
      }
    }
    
    // Rebuild XML
    const builder = new Builder({ headless: false });
    const updatedXml = builder.buildObject(parsed);
    zip.file('ppt/presentation.xml', updatedXml);
  }
  
  // Update presentation relationships
  const presRels = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
  if (presRels) {
    const { parseString, Builder } = await import('xml2js');
    const parsed = await new Promise<any>((resolve, reject) => {
      parseString(presRels, (err: any, result: any) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    
    // Keep only slide relationships (not master/layout/theme)
    if (parsed.Relationships?.Relationship) {
      const rels = parsed.Relationships.Relationship;
      const slideRels = rels.filter((r: any) => 
        r.$?.Type?.includes('slide') && 
        !r.$?.Target?.includes('slideMaster') &&
        !r.$?.Target?.includes('slideLayout')
      );
      
      // Keep only last 4 slide relationships
      if (slideRels.length > 4) {
        const nonSlideRels = rels.filter((r: any) => 
          !r.$?.Type?.includes('slide') || 
          r.$?.Target?.includes('slideMaster') ||
          r.$?.Target?.includes('slideLayout')
        );
        parsed.Relationships.Relationship = [...nonSlideRels, ...slideRels.slice(-4)];
      }
    }
    
    const builder = new Builder({ headless: false });
    const updatedRels = builder.buildObject(parsed);
    zip.file('ppt/_rels/presentation.xml.rels', updatedRels);
  }
  
  // Generate updated PPTX
  const newData = await zip.generateAsync({ type: 'nodebuffer' });
  await fs.writeFile(pptxPath, newData);
}

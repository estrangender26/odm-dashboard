/**
 * Inspect the KPI PRES template to identify slides and shapes
 */

import { Automizer } from 'pptx-automizer';
import { join } from 'path';

const templateDir = join(process.cwd(), 'public/templates/governance');
const templateFile = 'governance-master-template.pptx';

async function main() {
  const automizer = new Automizer({
    templateDir,
    outputDir: join(process.cwd(), 'tmp'),
    autoImportSlideMasters: true,
    removeExistingSlides: true,
    verbosity: 0,
  });

  // Load as a regular template, not root
  const pres = automizer.load(templateFile, 'template');
  
  console.log('Loading template...');
  
  // Need to call presentation() first
  await pres.presentation();
  
  // Set creation IDs
  const creationIds = await pres.setCreationIds();
  console.log('\n=== Creation IDs ===');
  for (const tpl of creationIds) {
    console.log(`Template: ${tpl.name}`);
    for (const slide of tpl.slides) {
      console.log(`  Slide ${slide.number}: creationId=${slide.creationId || 'N/A'}`);
    }
  }
  
  const info = await pres.getInfo();
  
  console.log('\n=== Template Slides ===');
  
  const slides = info.slidesByTemplate('template');
  console.log(`Total Slides: ${slides.length}`);
  
  for (const slide of slides) {
    console.log(`\nSlide ${slide.number} (creationId: ${slide.creationId || 'N/A'}):`);
    
    // Get slide info
    const slideInfo = info.slideByNumber('template', slide.number);
    console.log(`  Layout: ${slideInfo.layoutName || 'N/A'}`);
    console.log(`  Master: ${slideInfo.masterName || 'N/A'}`);
  }
}

main().catch(console.error);

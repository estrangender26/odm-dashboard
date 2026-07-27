/**
 * Governance Presentation Generator using pptx-automizer
 */

import { Automizer } from 'pptx-automizer';
import { join } from 'path';
import type { GovernancePresentationReport } from './governanceTypes';
import { Builder } from 'xml2js';

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
  const { parseString } = await import('xml2js');
  
  const data = await fs.readFile(pptxPath);
  const zip = await JSZip.loadAsync(data);
  
  const slideFiles = Object.keys(zip.files).filter(
    f => f.startsWith('ppt/slides/slide') && f.endsWith('.xml')
  );
  
  const sortedSlides = slideFiles.sort();
  const slidesToKeep = sortedSlides.slice(-4);
  const slidesToRemove = sortedSlides.filter(s => !slidesToKeep.includes(s));
  
  for (const slideFile of slidesToRemove) {
    zip.remove(slideFile);
    const relsFile = slideFile.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
    if (zip.files[relsFile]) {
      zip.remove(relsFile);
    }
  }
  
  // Modify Slide 4 content
  const slide4Path = 'ppt/slides/slide21.xml';
  const slide4Content = await zip.file(slide4Path)?.async('string');
  
  if (slide4Content) {
    const modifiedContent = modifySlide4Content(slide4Content, report);
    zip.file(slide4Path, modifiedContent);
  }
  
  // Update presentation.xml
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (presentationXml) {
    const parsed = await new Promise<any>((resolve, reject) => {
      parseString(presentationXml, (err: any, result: any) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    
    if (parsed['p:presentation']?.['p:sldIdLst']?.[0]?.['p:sldId']) {
      const sldIds = parsed['p:presentation']['p:sldIdLst'][0]['p:sldId'];
      if (sldIds.length > 4) {
        parsed['p:presentation']['p:sldIdLst'][0]['p:sldId'] = sldIds.slice(-4);
      }
    }
    
    zip.file('ppt/presentation.xml', new Builder({ headless: false }).buildObject(parsed));
  }
  
  // Update presentation relationships
  const presRels = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
  if (presRels) {
    const parsed = await new Promise<any>((resolve, reject) => {
      parseString(presRels, (err: any, result: any) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    
    if (parsed.Relationships?.Relationship) {
      const rels = parsed.Relationships.Relationship;
      const slideRels = rels.filter((r: any) => 
        r.$?.Type?.includes('slide') && 
        !r.$?.Target?.includes('slideMaster') &&
        !r.$?.Target?.includes('slideLayout')
      );
      
      if (slideRels.length > 4) {
        const nonSlideRels = rels.filter((r: any) => 
          !r.$?.Type?.includes('slide') || 
          r.$?.Target?.includes('slideMaster') ||
          r.$?.Target?.includes('slideLayout')
        );
        parsed.Relationships.Relationship = [...nonSlideRels, ...slideRels.slice(-4)];
      }
    }
    
    zip.file('ppt/_rels/presentation.xml.rels', new Builder({ headless: false }).buildObject(parsed));
  }
  
  const newData = await zip.generateAsync({ type: 'nodebuffer' });
  await fs.writeFile(pptxPath, newData);
}

function modifySlide4Content(xmlContent: string, report: GovernancePresentationReport): string {
  let modified = xmlContent;
  
  // Replace KPI Scorecard title
  modified = modified.replace(
    /Reliability KPI Scorecard[^\u003c]*/g,
    'Deliverables Compliance Summary'
  );
  
  // Remove AMD/EZ references
  modified = modified.replace(/–\s*AMD\/EZ/g, '');
  modified = modified.replace(/AMD\/EZ/g, 'Governance');
  
  // Replace KPI headers
  modified = modified.replace(/Month/g, 'Facility');
  modified = modified.replace(/Compliance/g, 'Documents');
  modified = modified.replace(/Budget/g, 'Status');
  modified = modified.replace(/Spend/g, 'Notes');
  
  // Replace sample data
  modified = modified.replace(/\u003e100%\u003c/g, '>N/A\u003c');
  modified = modified.replace(/\u003eJan\u003c/g, '>–\u003c');
  
  // Add Mode B disclosure after title
  const modeBText = 'Compliance: N/A | Mode B – Requirement matrix not yet available';
  modified = modified.replace(
    /(Deliverables Compliance Summary)(\u003c\/a:t\u003e)/g,
    `$1$2\u003c/a:r\u003e\u003c/a:p\u003e\u003ca:p\u003e\u003ca:r\u003e\u003ca:t\u003e${modeBText}\u003c/a:t\u003e`
  );
  
  void report;
  return modified;
}

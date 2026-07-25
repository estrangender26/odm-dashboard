#!/bin/bash
# Script to render governance presentation slides to PNG
# Requires LibreOffice or unoconv

set -e

PPTX_FILE="OM-Governance-Onboarding-Progress-TEST.pptx"
OUTPUT_DIR="artifacts/governance-presentation-validation"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Check if LibreOffice is available
if command -v libreoffice &> /dev/null; then
    echo "Rendering slides using LibreOffice..."
    
    # Convert PPTX to PDF first
    libreoffice --headless --convert-to pdf --outdir "$OUTPUT_DIR" "$PPTX_FILE"
    
    PDF_FILE="$OUTPUT_DIR/${PPTX_FILE%.pptx}.pdf"
    
    # Convert PDF to PNG (requires ImageMagick)
    if command -v convert &> /dev/null; then
        convert -density 150 "$PDF_FILE" "$OUTPUT_DIR/slide-%d.png"
        
        # Rename slides to match expected naming
        mv "$OUTPUT_DIR/slide-0.png" "$OUTPUT_DIR/slide-1.png" 2>/dev/null || true
        mv "$OUTPUT_DIR/slide-1.png" "$OUTPUT_DIR/slide-2.png" 2>/dev/null || true
        mv "$OUTPUT_DIR/slide-2.png" "$OUTPUT_DIR/slide-3.png" 2>/dev/null || true
        
        echo "Slides rendered to $OUTPUT_DIR/"
        ls -la "$OUTPUT_DIR/"
    else
        echo "ImageMagick 'convert' not found. PDF saved at: $PDF_FILE"
    fi
else
    echo "LibreOffice not found. Cannot render slides."
    echo "Please install LibreOffice or manually open the PPTX file."
    exit 1
fi

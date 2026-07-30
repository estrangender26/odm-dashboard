/**
 * pptxgenjs Wrapper for Governance V3
 */
import pptxgenjs from "pptxgenjs";
const PptxGenConstructor = typeof pptxgenjs === "function" ? pptxgenjs : (pptxgenjs as unknown as { default: typeof pptxgenjs }).default;
export function hexColor(hex: string): string { return hex.startsWith("FF") ? hex.slice(2) : hex; }
export interface ExactPosition { x: number; y: number; w: number; h: number; }
export interface TextOptions extends ExactPosition { text: string; fontSize?: number; fontFace?: string; bold?: boolean; color?: string; align?: "left" | "center" | "right"; valign?: "top" | "middle" | "bottom"; }
export interface ShapeOptions extends ExactPosition { fillColor?: string; lineColor?: string; lineWidth?: number; }
export interface TableCell { text: string; options?: { bold?: boolean; color?: string; fill?: string; fontSize?: number; align?: "left" | "center" | "right"; valign?: "top" | "middle" | "bottom"; }; }
export interface TableOptions extends ExactPosition { rows: TableCell[][]; colWidths: number[]; fontSize?: number; fontFace?: string; borderColor?: string; headerFill?: string; }

/* eslint-disable @typescript-eslint/no-explicit-any */
export class GovernancePPTX {
  private pptx: any;
  private currentSlide: any = null;

  constructor() {
    this.pptx = new PptxGenConstructor();
    this.pptx.layout = "LAYOUT_WIDE";
    this.pptx.author = "ODM Dashboard";
    this.pptx.company = "Manila Water";
    this.pptx.subject = "O&M Governance Onboarding Progress";
    this.pptx.title = "Onboarding Status";
  }

  addSlide(): void {
    this.currentSlide = this.pptx.addSlide();
    this.currentSlide.background = { color: "F4F7F9" };
  }

  addText(options: TextOptions): void {
    if (!this.currentSlide) throw new Error("No slide added");
    this.currentSlide.addText(options.text, {
      x: options.x, y: options.y, w: options.w, h: options.h,
      fontSize: options.fontSize ?? 12,
      fontFace: options.fontFace ?? "Arial",
      bold: options.bold ?? false,
      color: options.color ? hexColor(options.color) : "17324F",
      align: options.align ?? "left",
      valign: options.valign ?? "top"
    });
  }

  addShape(options: ShapeOptions): void {
    if (!this.currentSlide) throw new Error("No slide added");
    const shapeType = this.pptx.ShapeType?.rect || "rect";
    this.currentSlide.addShape(shapeType, {
      x: options.x, y: options.y, w: options.w, h: options.h,
      fill: options.fillColor ? { color: hexColor(options.fillColor) } : undefined,
      line: options.lineColor ? { color: hexColor(options.lineColor), width: options.lineWidth ?? 1 } : undefined
    });
  }

  addTable(options: TableOptions): void {
    if (!this.currentSlide) throw new Error("No slide added");
    const tableRows = options.rows.map((row, rowIndex) =>
      row.map((cell) => ({
        text: cell.text,
        options: {
          bold: cell.options?.bold ?? (rowIndex === 0),
          color: cell.options?.color ? hexColor(cell.options.color) : "17324F",
          fill: cell.options?.fill ? { color: hexColor(cell.options.fill) } : rowIndex === 0 ? { color: hexColor(options.headerFill ?? "17324F") } : undefined,
          fontSize: cell.options?.fontSize ?? options.fontSize ?? 9,
          align: cell.options?.align ?? "center",
          valign: cell.options?.valign ?? "middle"
        }
      }))
    );
    this.currentSlide.addTable(tableRows, {
      x: options.x, y: options.y, w: options.w, h: options.h,
      colW: options.colWidths,
      fontFace: options.fontFace ?? "Arial",
      fontSize: options.fontSize ?? 9,
      color: "17324F",
      border: options.borderColor ? { type: "solid", color: hexColor(options.borderColor), pt: 0.5 } : undefined
    });
  }

  async generateBlob(): Promise<Blob> {
    const output = await this.pptx.write({ outputType: "arraybuffer", compression: true });
    return new Blob([output as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  }
}

/**
 * Core Presentation Types
 * 
 * Reusable abstractions for all ODM presentation generators.
 * This module defines the foundational interfaces that specific
 * presentation domains (Governance, KPI, SMP) will implement.
 */

/**
 * Base presentation model that all domain-specific models extend.
 */
export interface BasePresentationModel {
  /** Unique identifier for this presentation instance */
  presentationId: string;
  
  /** Domain-specific presentation type */
  presentationType: string;
  
  /** Human-readable title */
  reportTitle: string;
  
  /** Subtitle or secondary descriptor */
  reportSubtitle?: string;
  
  /** Reporting period description */
  reportingPeriod: string;
  
  /** ISO timestamp of generation */
  generatedAt: string;
  
  /** Version of the generator used */
  generatorVersion: string;
}

/**
 * Generic facility presentation data.
 * Domain-specific models will extend this with additional fields.
 */
export interface BaseFacilityPresentationData {
  /** Unique facility identifier */
  facilityId: string;
  
  /** Display name */
  facilityName: string;
  
  /** Short name for constrained spaces */
  facilityShortName: string;
  
  /** Hex color code for charts and indicators */
  color: string;
  
  /** Overall status for traffic-light reporting */
  status: FacilityStatus;
}

/**
 * Standard facility statuses for traffic-light reporting.
 */
export type FacilityStatus = 
  | "on-track" 
  | "attention" 
  | "delayed" 
  | "not-started"
  | "complete";

/**
 * Progress data point for S-curve or trend visualization.
 */
export interface ProgressPoint {
  /** Period identifier (e.g., "2026-01" or "Jan 2026") */
  period: string;
  
  /** ISO date for sorting */
  periodDate: string;
  
  /** Planned value (0-100) */
  planned: number | null;
  
  /** Actual value (0-100) */
  actual: number | null;
  
  /** Forecast value if available (0-100) */
  forecast?: number | null;
}

/**
 * Types of progress visualizations available.
 */
export type ProgressVisualizationType = 
  | "s-curve"      // Full historical S-curve with planned/actual/forecast
  | "snapshot"     // Current values only, no historical progression
  | "trend";       // Time-series bar/line chart

/**
 * Document/deliverable status for compliance reporting.
 */
export type DocumentStatus = 
  | "approved"           // Fully approved and accepted
  | "submitted-review"   // Submitted, under review
  | "outstanding"        // Required but not submitted
  | "not-applicable";    // Not required for this facility

/**
 * Compliance matrix cell value.
 */
export interface ComplianceCell {
  /** Count of documents in this status */
  count: number;
  
  /** Percentage of applicable documents */
  percentage: number | null;
  
  /** Visual status indicator */
  status: DocumentStatus | "mixed";
}

/**
 * Presentation disclosure or data quality notice.
 */
export interface PresentationDisclosure {
  /** Disclosure type for categorization */
  type: "data-quality" | "methodology" | "limitation" | "mode";
  
  /** Short label */
  label: string;
  
  /** Full disclosure text */
  text: string;
  
  /** Severity for display styling */
  severity?: "info" | "warning" | "critical";
}

/**
 * Slide layout configuration.
 */
export interface SlideLayout {
  /** Unique layout identifier */
  layoutId: string;
  
  /** Human-readable name */
  layoutName: string;
  
  /** Slide number in presentation sequence */
  slideNumber: number;
  
  /** Whether this slide is optional */
  optional: boolean;
}

/**
 * Validation result for a generated presentation.
 */
export interface PresentationValidationResult {
  /** Whether validation passed overall */
  valid: boolean;
  
  /** Individual check results */
  checks: ValidationCheck[];
  
  /** Errors that caused validation failure */
  errors: string[];
  
  /** Warnings that don't cause failure */
  warnings: string[];
}

/**
 * Individual validation check.
 */
export interface ValidationCheck {
  /** Check identifier */
  id: string;
  
  /** Human-readable description */
  description: string;
  
  /** Result status */
  status: "pass" | "fail" | "warn" | "skip";
  
  /** Detail message */
  message: string;
  
  /** Optional expected vs actual values */
  expected?: string;
  actual?: string;
}

/**
 * Theme configuration for consistent styling.
 */
export interface PresentationTheme {
  /** Theme identifier */
  themeId: string;
  
  /** Theme name */
  themeName: string;
  
  /** Path to template file */
  templatePath: string;
  
  /** Color palette */
  colors: {
    primary: string;
    secondary: string;
    success: string;
    warning: string;
    danger: string;
    neutral: string;
    [key: string]: string;
  };
  
  /** Typography settings */
  typography: {
    titleFont: string;
    bodyFont: string;
    titleSize: number;
    subtitleSize: number;
    bodySize: number;
  };
  
  /** Spacing in EMUs */
  spacing: {
    slideMargin: number;
    elementGap: number;
    sectionGap: number;
  };
}

/**
 * Programs Engineering module identity registry.
 *
 * One place that answers "what does this module look like?" so no route invents
 * its own accent. Every module is the same suite: it differentiates through
 * icon + title + subtitle, and only alternates between the two brand voices
 * (blue / teal) exactly as the reference banner alternates its four circular
 * icons. There is deliberately no per-module palette.
 */
import {
  Activity,
  BookOpenCheck,
  CalendarDays,
  ClipboardList,
  Factory,
  Library,
  Presentation,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { PeOrbTone } from "./PeIconOrb";

export interface ModuleIdentity {
  icon: LucideIcon;
  tone: PeOrbTone;
  title: string;
  subtitle: string;
  /** Canonical banner caption, matching the banner's icon-row labels. */
  caption: string;
}

export const MODULE_IDENTITY = {
  governance: {
    icon: ShieldCheck,
    tone: "blue",
    title: "O&M Manual Governance",
    subtitle: "4 facilities · 9 milestones · S-Curve progress and deliverables",
    caption: "Empower",
  },
  scorecard: {
    icon: Activity,
    tone: "teal",
    title: "Monthly KPI Scorecard",
    subtitle: "8 KPIs across 5 business units — performance, import and analytics",
    caption: "Deliver",
  },
  odm: {
    icon: Factory,
    tone: "blue",
    title: "Operator-Driven Maintenance",
    subtitle: "Corporate analytics, predictive insights and escalation monitoring",
    caption: "Engineer",
  },
  primavera: {
    icon: CalendarDays,
    tone: "teal",
    title: "Primavera Lite",
    subtitle: "Online project scheduling — WBS, activities, dependencies and Gantt",
    caption: "Innovate",
  },
  smp: {
    icon: BookOpenCheck,
    tone: "blue",
    title: "Standard Maintenance Procedures",
    subtitle: "Centralized repository for SOPs, SMPs and preventive maintenance documentation",
    caption: "Empower",
  },
  omLibrary: {
    icon: Library,
    tone: "teal",
    title: "O&M Manuals Library",
    subtitle: "Full O&M Manuals for each facility — search, view and download",
    caption: "Deliver",
  },
  projectsWithoutPpp: {
    icon: ClipboardList,
    tone: "blue",
    title: "Projects without PPP",
    subtitle: "Masterdata submittal monitoring for 50 projects",
    caption: "Engineer",
  },
  presentationCenter: {
    icon: Presentation,
    tone: "teal",
    title: "Presentation Center",
    subtitle: "Create, manage and generate PowerPoint decks from dashboard data",
    caption: "Innovate",
  },
} as const satisfies Record<string, ModuleIdentity>;

export type ModuleKey = keyof typeof MODULE_IDENTITY;

/** The banner's four identity verbs, used for restrained module captions. */
export const PE_VERBS = ["Innovate", "Engineer", "Deliver", "Empower"] as const;

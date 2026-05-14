import { pgTable, serial, varchar, text, integer, bigint, timestamp, index, unique } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  avatar: varchar("avatar", { length: 500 }),
  role: varchar("role", { length: 50 }).notNull().default("user"),
  unionId: varchar("union_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  lastSignInAt: timestamp("last_sign_in_at").defaultNow(),
});

export const equipment = pgTable("equipment", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  initials: varchar("initials", { length: 10 }).notNull(),
}, (table) => [index("equipment_name_idx").on(table.name)]);

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  equipmentId: bigint("equipment_id", { mode: "number" }).notNull(),
  taskList: text("task_list").notNull(),
  frequency: varchar("frequency", { length: 100 }).notNull(),
  responsiblePersonnel: varchar("responsible_personnel", { length: 100 }),
  operations: varchar("operations", { length: 100 }),
  amd: varchar("amd", { length: 100 }),
  ard: varchar("ard", { length: 100 }),
  procedureFamiliarity: varchar("procedure_familiarity", { length: 50 }),
  dataset: varchar("dataset", { length: 20 }).notNull(),
}, (table) => [
  index("tasks_equipment_idx").on(table.equipmentId),
  index("tasks_dataset_idx").on(table.dataset),
  index("tasks_familiarity_idx").on(table.procedureFamiliarity),
]);

export const governanceFacilities = pgTable("governance_facilities", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  shortName: varchar("short_name", { length: 100 }),
});

export const governanceMilestoneState = pgTable("governance_milestone_state", {
  id: serial("id").primaryKey(),
  facilitySlug: varchar("facility_slug", { length: 50 }).notNull(),
  milestoneId: varchar("milestone_id", { length: 10 }).notNull(),
  pppDate: varchar("ppp_date", { length: 20 }),
  compDate: varchar("comp_date", { length: 20 }),
  customPct: integer("custom_pct"),
  readyStatus: varchar("ready_status", { length: 20 }),
  remarks: text("remarks"),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: varchar("updated_by", { length: 255 }),
}, (table) => [
  unique("governance_ms_unique").on(table.facilitySlug, table.milestoneId),
]);

export const governanceUploads = pgTable("governance_uploads", {
  id: serial("id").primaryKey(),
  facilitySlug: varchar("facility_slug", { length: 50 }).notNull(),
  milestoneId: varchar("milestone_id", { length: 10 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(),
  tocItem: varchar("toc_item", { length: 20 }),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileUrl: text("file_url").notNull(),
  uploadedBy: varchar("uploaded_by", { length: 255 }),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

export const mwInspections = pgTable("mw_inspections", {
  id: serial("id").primaryKey(),
  submissionId: varchar("submission_id", { length: 100 }),
  facilityId: varchar("facility_id", { length: 50 }).notNull(),
  inspector: varchar("inspector", { length: 255 }).notNull(),
  inspectionDate: varchar("inspection_date", { length: 50 }),
  assetTag: varchar("asset_tag", { length: 100 }),
  assetName: varchar("asset_name", { length: 255 }),
  equipmentType: varchar("equipment_type", { length: 100 }),
  category: varchar("category", { length: 100 }).notNull(),
  task: text("task"),
  capture1Label: varchar("capture1_label", { length: 255 }),
  capture1Response: text("capture1_response"),
  escalationTrigger: varchar("escalation_trigger", { length: 100 }),
  entryNotes: text("entry_notes"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  score: integer("score"),
  findings: text("findings"),
  date: varchar("date", { length: 20 }),
  submittedAt: varchar("submitted_at", { length: 50 }),
  frequency: varchar("frequency", { length: 50 }),
  updatedBy: varchar("updated_by", { length: 255 }),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Prevent duplicate uploads: same asset + task + date + timestamp = same inspection
  // Different times = different shift inspections (keep both)
  unique("mw_inspections_dedup").on(table.assetTag, table.task, table.date, table.submittedAt),
]);

export const mwCompliance = pgTable("mw_compliance", {
  id: serial("id").primaryKey(),
  facilityId: varchar("facility_id", { length: 50 }).notNull(),
  standard: varchar("standard", { length: 255 }).notNull(),
  compliant: varchar("compliant", { length: 10 }).notNull().default("no"),
  notes: text("notes"),
  updatedBy: varchar("updated_by", { length: 255 }),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const mwEscalations = pgTable("mw_escalations", {
  id: serial("id").primaryKey(),
  facilityId: varchar("facility_id", { length: 50 }).notNull(),
  issue: varchar("issue", { length: 255 }).notNull(),
  severity: varchar("severity", { length: 20 }).notNull().default("low"),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  assignedTo: varchar("assigned_to", { length: 255 }),
  resolution: text("resolution"),
  updatedBy: varchar("updated_by", { length: 255 }),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const governanceFiles = pgTable("governance_files", {
  id: serial("id").primaryKey(),
  facilitySlug: varchar("facility_slug", { length: 50 }).notNull(),
  milestoneId: varchar("milestone_id", { length: 10 }).notNull(),
  tocItem: varchar("toc_item", { length: 20 }),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 100 }).notNull(),
  fileSize: integer("file_size"),
  fileData: text("file_data").notNull(),
  uploadedBy: varchar("uploaded_by", { length: 255 }),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

export const ganttTasks = pgTable("gantt_tasks", {
  id: serial("id").primaryKey(),
  text: varchar("text", { length: 500 }).notNull(),
  startDate: varchar("start_date", { length: 20 }),
  endDate: varchar("end_date", { length: 20 }),
  plannedStart: varchar("planned_start", { length: 20 }),
  plannedEnd: varchar("planned_end", { length: 20 }),
  duration: integer("duration"),
  progress: integer("progress").default(0),
  parent: integer("parent").default(0),
  type: varchar("type", { length: 20 }).default("task"),
  sortorder: integer("sortorder").default(0),
  owner: varchar("owner", { length: 255 }),
  open: integer("open").default(1),
  category: varchar("category", { length: 100 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Existing Facilities Maintenance Plans table
export const existingFacilitiesMaintenance = pgTable("existing_facilities_maintenance", {
  id: serial("id").primaryKey(),
  plant: varchar("plant", { length: 255 }).notNull(),
  equipmentType: varchar("equipment_type", { length: 255 }).notNull().default(""),
  task: text("task").notNull(),
  frequency: varchar("frequency", { length: 100 }).notNull(),
  implementor: varchar("implementor", { length: 255 }),
  status: varchar("status", { length: 50 }).notNull().default("Active"),
  lastCompleted: varchar("last_completed", { length: 20 }),
  nextDue: varchar("next_due", { length: 20 }),
  remarks: text("remarks"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("efm_plant_idx").on(table.plant),
  index("efm_equip_idx").on(table.equipmentType),
  index("efm_frequency_idx").on(table.frequency),
  index("efm_implementor_idx").on(table.implementor),
  index("efm_status_idx").on(table.status),
]);

// Document Management — Folder Tree System
export const docFolders = pgTable("doc_folders", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").references(() => docFolders.id),
  name: varchar("name", { length: 255 }).notNull(),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("doc_folders_parent_idx").on(table.parentId),
]);

export const docFiles = pgTable("doc_files", {
  id: serial("id").primaryKey(),
  folderId: integer("folder_id").notNull().references(() => docFolders.id),
  title: varchar("title", { length: 500 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 100 }),
  fileSize: integer("file_size"),
  fileData: text("file_data"),
  fileUrl: text("file_url"),
  description: text("description"),
  revision: varchar("revision", { length: 50 }),
  tags: text("tags"),
  uploadedBy: varchar("uploaded_by", { length: 255 }),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("doc_files_folder_idx").on(table.folderId),
]);

export const ganttLinks = pgTable("gantt_links", {
  id: serial("id").primaryKey(),
  source: integer("source").notNull(),
  target: integer("target").notNull(),
  type: varchar("type", { length: 20 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow(),
});
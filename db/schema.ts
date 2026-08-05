import { sql } from "drizzle-orm";
import { pgTable, serial, varchar, text, integer, bigint, timestamp, index, unique, uniqueIndex, check, doublePrecision, jsonb, uuid, date, boolean, numeric, type AnyPgColumn } from "drizzle-orm/pg-core";

const storageMetadataColumns = () => ({
  storageProvider: varchar("storage_provider", { length: 32 }),
  storageBucket: varchar("storage_bucket", { length: 100 }),
  storagePath: text("storage_path"),
  storageSize: bigint("storage_size", { mode: "number" }),
  storageMimeType: varchar("storage_mime_type", { length: 255 }),
  storageEtag: text("storage_etag"),
  storageUploadedAt: timestamp("storage_uploaded_at", { withTimezone: true }),
});

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

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

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
  procedureFamiliarity: text("procedure_familiarity"),
  dataset: varchar("dataset", { length: 20 }).notNull(),
}, (table) => [
  index("tasks_equipment_idx").on(table.equipmentId),
  index("tasks_dataset_idx").on(table.dataset),
  index("tasks_familiarity_idx").on(table.procedureFamiliarity),
]);

export const monthlyKpiRecords = pgTable("monthly_kpi_records", {
  id: serial("id").primaryKey(),
  businessUnit: varchar("business_unit", { length: 100 }).notNull(),
  reportingMonth: integer("reporting_month").notNull(),
  reportingYear: integer("reporting_year").notNull(),
  sourceFileName: varchar("source_file_name", { length: 255 }),
  importedAt: timestamp("imported_at").defaultNow(),
  pmCompliance: doublePrecision("pm_compliance"),
  pmPlanned: doublePrecision("pm_planned"),
  scheduleCompliance: doublePrecision("schedule_compliance"),
  budgetSpend: doublePrecision("budget_spend"),
  pmCmWorkOrderRatio: doublePrecision("pm_cm_work_order_ratio"),
  pmCmCostRatio: doublePrecision("pm_cm_cost_ratio"),
  mtbfDays: doublePrecision("mtbf_days"),
  mttrDays: doublePrecision("mttr_days"),
  facilityUptime: doublePrecision("facility_uptime"),
  actualSpend: doublePrecision("actual_spend"),
  budget: doublePrecision("budget"),
  pmOrdersCompletedOnTime: doublePrecision("pm_orders_completed_on_time"),
  totalPmOrders: doublePrecision("total_pm_orders"),
  pmWorkOrders: doublePrecision("pm_work_orders"),
  cmWorkOrders: doublePrecision("cm_work_orders"),
  pmCost: doublePrecision("pm_cost"),
  cmCost: doublePrecision("cm_cost"),
  totalDowntime: doublePrecision("total_downtime"),
  numberOfRepairs: doublePrecision("number_of_repairs"),
  totalOperatingTime: doublePrecision("total_operating_time"),
  sourceSheet: varchar("source_sheet", { length: 255 }),
  importBatchId: varchar("import_batch_id", { length: 100 }),
  notes: text("notes"),
  rawImportedValues: jsonb("raw_imported_values"),
}, (table) => [
  unique("monthly_kpi_records_bu_year_month_unique").on(table.businessUnit, table.reportingYear, table.reportingMonth),
  index("monthly_kpi_records_period_idx").on(table.reportingYear, table.reportingMonth),
  index("monthly_kpi_records_business_unit_idx").on(table.businessUnit),
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
  ...storageMetadataColumns(),
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


export const governanceDeliverableStatus = pgTable("governance_deliverable_status", {
  id: serial("id").primaryKey(),
  facilitySlug: varchar("facility_slug", { length: 50 }).notNull(),
  tocItem: varchar("toc_item", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("missing"),
  approvedAt: timestamp("approved_at"),
  approvedBy: varchar("approved_by", { length: 255 }),
  evidenceUploadId: integer("evidence_upload_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  unique("governance_deliverable_status_unique").on(table.facilitySlug, table.tocItem),
]);

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
  ...storageMetadataColumns(),
});

/* ─── Gantt Tasks (clean schema — matches UI fields exactly) ─── */
export const ganttTasks = pgTable("gantt_tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id"),
  frontendTaskUid: varchar("frontend_task_uid", { length: 64 }).unique(),
  taskName: varchar("task_name", { length: 500 }).notNull(),
  parentTaskId: integer("parent_task_id").default(0),
  predecessorTaskId: integer("predecessor_task_id"),
  dependencyType: varchar("dependency_type", { length: 10 }),
  lagDays: integer("lag_days").default(0),
  wbsLevel: integer("wbs_level").default(0),
  sortOrder: integer("sort_order").default(0),
  plannedStart: varchar("planned_start", { length: 20 }),
  plannedFinish: varchar("planned_finish", { length: 20 }),
  plannedDuration: integer("planned_duration"),
  actualStart: varchar("actual_start", { length: 20 }),
  actualFinish: varchar("actual_finish", { length: 20 }),
  actualDuration: integer("actual_duration"),
  progressPercent: integer("progress_percent").default(0),
  status: varchar("status", { length: 50 }),
  owner: varchar("owner", { length: 255 }),
  category: varchar("category", { length: 100 }),
  notes: text("notes"),
  remarks: text("remarks"),
  taskType: varchar("task_type", { length: 20 }).default("task"),
  isMilestone: integer("is_milestone").default(0),
  isParent: integer("is_parent").default(0),
  revision: integer("revision").notNull().default(1),
  updatedByName: varchar("updated_by_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("gantt_tasks_project_idx").on(table.projectId),
  index("gantt_tasks_parent_idx").on(table.parentTaskId),
  index("gantt_tasks_predecessor_idx").on(table.predecessorTaskId),
  index("gantt_tasks_uid_idx").on(table.frontendTaskUid),
  index("gantt_tasks_sort_idx").on(table.sortOrder),
]);



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
  parentId: integer("parent_id").references((): AnyPgColumn => docFolders.id),
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
  ...storageMetadataColumns(),
}, (table) => [
  index("doc_files_folder_idx").on(table.folderId),
]);

/* ── Gantt Task Dependencies ── */
export const ganttDependencies = pgTable("gantt_dependencies", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id"),
  predecessorTaskId: integer("predecessor_task_id").notNull(),
  successorTaskId: integer("successor_task_id").notNull(),
  dependencyType: varchar("dependency_type", { length: 10 }).notNull().default("FS"),
  lagDays: integer("lag_days").default(0),
  revision: integer("revision").notNull().default(1),
  updatedByName: varchar("updated_by_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("gantt_dep_project_idx").on(table.projectId),
  index("gantt_dep_pred_idx").on(table.predecessorTaskId),
  index("gantt_dep_succ_idx").on(table.successorTaskId),
]);

/* ── SMP Documents ── */
export const smpDocuments = pgTable("smp_documents", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  revision: varchar("revision", { length: 50 }).default("Rev. 1"),
  equipmentType: varchar("equipment_type", { length: 100 }),
  system: varchar("system", { length: 100 }),
  dateIssued: varchar("date_issued", { length: 20 }),
  nextReview: varchar("next_review", { length: 20 }),
  status: varchar("status", { length: 50 }).default("Active"),
  responsibleParty: varchar("responsible_party", { length: 255 }),
  fileData: text("file_data"),
  fileType: varchar("file_type", { length: 100 }),
  fileName: varchar("file_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  ...storageMetadataColumns(),
}, (table) => [
  index("smp_equip_idx").on(table.equipmentType),
  index("smp_system_idx").on(table.system),
  index("smp_status_idx").on(table.status),
]);

export const storageUploadIntents = pgTable("storage_upload_intents", {
  id: uuid("id").primaryKey(),
  module: varchar("module", { length: 32 }).notNull(),
  targetContext: jsonb("target_context").notNull(),
  expectedBucket: varchar("expected_bucket", { length: 100 }).notNull(),
  expectedPath: text("expected_path").notNull(),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  expectedSize: bigint("expected_size", { mode: "number" }).notNull(),
  expectedMimeType: varchar("expected_mime_type", { length: 255 }).notNull(),
  requestedBy: integer("requested_by"),
  capabilityJti: uuid("capability_jti"),
  capabilityTokenHash: varchar("capability_token_hash", { length: 64 }),
  capabilityExpiresAt: timestamp("capability_expires_at", { withTimezone: true }),
  capabilityConsumedAt: timestamp("capability_consumed_at", { withTimezone: true }),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  abandonedAt: timestamp("abandoned_at", { withTimezone: true }),
  cleanupAt: timestamp("cleanup_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  unique("storage_upload_intents_bucket_path_unique").on(table.expectedBucket, table.expectedPath),
  index("storage_upload_intents_status_expiry_idx").on(table.status, table.expiresAt),
  index("storage_upload_intents_user_idx").on(table.requestedBy),
]);

/* ── Gantt Chart Saved Projects ── */
export const ganttProjects = pgTable("gantt_projects", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  projectName: varchar("project_name", { length: 255 }),
  startDate: varchar("start_date", { length: 20 }),
  finishDate: varchar("finish_date", { length: 20 }),
  status: varchar("status", { length: 50 }),
  tasksData: text("tasks_data").notNull(),
  linksData: text("links_data"),
  description: text("description"),
  createdBy: varchar("created_by", { length: 255 }),
  updatedBy: varchar("updated_by", { length: 255 }),
  userId: integer("user_id"),
  ownerId: integer("owner_id"),
  tenantId: varchar("tenant_id", { length: 255 }),
  orgId: varchar("org_id", { length: 255 }),
  sessionId: varchar("session_id", { length: 255 }),
  publicId: uuid("public_id").unique(),
  slug: varchar("slug", { length: 255 }).unique(),
  editTokenHash: varchar("edit_token_hash", { length: 64 }),
  viewTokenHash: varchar("view_token_hash", { length: 64 }),
  revision: integer("revision").notNull().default(1),
  dataDate: varchar("data_date", { length: 20 }),
  defaultCalendarId: integer("default_calendar_id"),
  sharingEnabled: integer("sharing_enabled").notNull().default(0),
  adminTokenHash: varchar("admin_token_hash", { length: 64 }),
  lastScheduledAt: timestamp("last_scheduled_at"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("gantt_projects_name_idx").on(table.name),
  index("gantt_projects_session_idx").on(table.sessionId),
  index("gantt_projects_user_idx").on(table.userId),
  index("gantt_projects_public_id_idx").on(table.publicId),
  index("gantt_projects_slug_idx").on(table.slug),
  index("gantt_projects_edit_token_idx").on(table.editTokenHash),
  index("gantt_projects_view_token_idx").on(table.viewTokenHash),
  index("gantt_projects_admin_token_idx").on(table.adminTokenHash),
]);

/* ── Gantt Project Audit Events ── */
export const ganttProjectEvents = pgTable("gantt_project_events", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => ganttProjects.id, { onDelete: "cascade" }),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: integer("entity_id"),
  action: varchar("action", { length: 50 }).notNull(),
  actorName: varchar("actor_name", { length: 255 }),
  beforeData: jsonb("before_data"),
  afterData: jsonb("after_data"),
  projectRevision: integer("project_revision"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("gantt_project_events_project_idx").on(table.projectId, table.createdAt),
  index("gantt_project_events_entity_idx").on(table.projectId, table.entityType, table.entityId),
]);

/* ── Gantt Calendars ── */
export const ganttCalendars = pgTable("gantt_calendars", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => ganttProjects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  workingDays: integer("working_days").array().notNull().default([1, 2, 3, 4, 5]),
  hoursPerDay: numeric("hours_per_day", { precision: 4, scale: 2 }).notNull().default("8"),
  timezone: varchar("timezone", { length: 100 }).notNull().default("Asia/Manila"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("gantt_calendars_project_idx").on(table.projectId),
]);

/* ── Gantt Calendar Exceptions ── */
export const ganttCalendarExceptions = pgTable("gantt_calendar_exceptions", {
  id: serial("id").primaryKey(),
  calendarId: integer("calendar_id").notNull().references(() => ganttCalendars.id, { onDelete: "cascade" }),
  exceptionDate: date("exception_date").notNull(),
  isWorking: boolean("is_working").notNull().default(false),
  workingHours: numeric("working_hours", { precision: 4, scale: 2 }),
  description: varchar("description", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("gantt_calendar_exceptions_calendar_idx").on(table.calendarId, table.exceptionDate),
  unique("gantt_calendar_exceptions_date_unique").on(table.calendarId, table.exceptionDate),
]);

/* ── Primavera Lite WBS Nodes ── */
export const ganttWbsNodes = pgTable("gantt_wbs_nodes", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => ganttProjects.id, { onDelete: "restrict" }),
  parentNodeId: integer("parent_node_id").references((): AnyPgColumn => ganttWbsNodes.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 100 }).notNull(),
  name: varchar("name", { length: 500 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isLeaf: boolean("is_leaf").notNull().default(true),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("gantt_wbs_nodes_project_idx").on(table.projectId),
  index("gantt_wbs_nodes_parent_idx").on(table.projectId, table.parentNodeId),
  index("gantt_wbs_nodes_sort_idx").on(table.projectId, table.sortOrder),
  uniqueIndex("gantt_wbs_nodes_project_code_unique")
    .on(table.projectId, table.code)
    .where(sql`${table.archivedAt} IS NULL`),
]);

/* ── Primavera Lite Activities ── */
export const ganttActivities = pgTable("gantt_activities", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => ganttProjects.id, { onDelete: "restrict" }),
  wbsNodeId: integer("wbs_node_id").notNull().references(() => ganttWbsNodes.id, { onDelete: "restrict" }),
  frontendActivityUid: varchar("frontend_activity_uid", { length: 64 }).unique(),
  activityId: varchar("activity_id", { length: 100 }),
  activityName: varchar("activity_name", { length: 500 }).notNull(),
  activityType: varchar("activity_type", { length: 20 }).notNull().default("task"),
  sortOrder: integer("sort_order").notNull().default(0),
  calendarId: integer("calendar_id").references(() => ganttCalendars.id, { onDelete: "restrict" }),
  originalDurationDays: integer("original_duration_days").notNull().default(0),
  remainingDurationDays: integer("remaining_duration_days").notNull().default(0),
  plannedStart: date("planned_start"),
  plannedFinish: date("planned_finish"),
  earlyStart: date("early_start"),
  earlyFinish: date("early_finish"),
  lateStart: date("late_start"),
  lateFinish: date("late_finish"),
  totalFloatDays: integer("total_float_days").notNull().default(0),
  freeFloatDays: integer("free_float_days").notNull().default(0),
  actualStart: date("actual_start"),
  actualFinish: date("actual_finish"),
  percentComplete: integer("percent_complete").notNull().default(0),
  status: varchar("status", { length: 50 }),
  constraintType: varchar("constraint_type", { length: 20 }),
  constraintDate: date("constraint_date"),
  notes: text("notes"),
  revision: integer("revision").notNull().default(1),
  updatedByName: varchar("updated_by_name", { length: 255 }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("gantt_activities_project_idx").on(table.projectId),
  index("gantt_activities_wbs_idx").on(table.projectId, table.wbsNodeId),
  index("gantt_activities_order_idx").on(table.projectId, table.wbsNodeId, table.sortOrder),
  index("gantt_activities_uid_idx").on(table.frontendActivityUid),
]);

/* ── ODM Talk AI Collaboration Hub ── */

export const odmTalkThreads = pgTable("odm_talk_threads", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 500 }).notNull(),
  threadType: varchar("thread_type", { length: 100 }).notNull().default("General Discussion"),
  sourceModule: varchar("source_module", { length: 150 }).notNull(),
  sourcePage: varchar("source_page", { length: 255 }).notNull(),
  sourceRecordId: varchar("source_record_id", { length: 255 }).notNull(),
  sourceRecordLabel: varchar("source_record_label", { length: 500 }),
  sourceUrl: text("source_url").notNull(),
  assistantName: varchar("assistant_name", { length: 255 }).notNull(),
  userId: varchar("user_id", { length: 255 }),
  status: varchar("status", { length: 50 }).notNull().default("open"),
  requiresApproval: integer("requires_approval").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("odm_talk_threads_source_idx").on(table.sourceModule, table.sourceRecordId),
  index("odm_talk_threads_type_idx").on(table.threadType),
  index("odm_talk_threads_updated_idx").on(table.updatedAt),
]);

export const odmTalkMessages = pgTable("odm_talk_messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull().references(() => odmTalkThreads.id),
  role: varchar("role", { length: 50 }).notNull().default("assistant"),
  content: text("content").notNull(),
  shareType: varchar("share_type", { length: 100 }).notNull().default("AI summary"),
  isAiGenerated: integer("is_ai_generated").notNull().default(1),
  sourceModule: varchar("source_module", { length: 150 }).notNull(),
  sourcePage: varchar("source_page", { length: 255 }).notNull(),
  sourceRecordId: varchar("source_record_id", { length: 255 }).notNull(),
  sourceRecordLabel: varchar("source_record_label", { length: 500 }),
  sourceUrl: text("source_url").notNull(),
  assistantName: varchar("assistant_name", { length: 255 }).notNull(),
  userId: varchar("user_id", { length: 255 }),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("odm_talk_messages_thread_idx").on(table.threadId),
  index("odm_talk_messages_source_idx").on(table.sourceModule, table.sourceRecordId),
  index("odm_talk_messages_share_idx").on(table.shareType),
  index("odm_talk_messages_created_idx").on(table.createdAt),
]);

export const odmTalkNotifications = pgTable("odm_talk_notifications", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull().references(() => odmTalkThreads.id),
  messageId: integer("message_id").references(() => odmTalkMessages.id),
  notificationType: varchar("notification_type", { length: 100 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  body: text("body"),
  userId: varchar("user_id", { length: 255 }),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("odm_talk_notifications_thread_idx").on(table.threadId),
  index("odm_talk_notifications_user_idx").on(table.userId),
  index("odm_talk_notifications_created_idx").on(table.createdAt),
]);


/* ─── Presentation Center Files ─── */
export const presentationFiles = pgTable("presentation_files", {
  id: serial("id").primaryKey(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  title: varchar("title", { length: 255 }),
  version: varchar("version", { length: 50 }).default("1.0"),
  fileType: varchar("file_type", { length: 100 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull().default("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  fileBlob: text("file_blob").notNull(),
  sha256Hash: varchar("sha256_hash", { length: 64 }).notNull(),
  fileCategory: varchar("file_category", { length: 50 }).notNull(), // uploaded_deck | generated_deck
  generatorId: varchar("generator_id", { length: 100 }),
  generatorName: varchar("generator_name", { length: 255 }),
  template: varchar("template", { length: 100 }),
  scopeJson: text("scope_json"),
  originalFileUrl: text("original_file_url"),
  uploadedBy: varchar("uploaded_by", { length: 255 }).notNull().default("ODM User"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("presentation_files_category_idx").on(table.fileCategory),
  index("presentation_files_generator_idx").on(table.generatorId),
  index("presentation_files_hash_idx").on(table.sha256Hash),
  index("presentation_files_deleted_at_idx").on(table.deletedAt),
]);

export type PresentationFile = typeof presentationFiles.$inferSelect;
export type InsertPresentationFile = typeof presentationFiles.$inferInsert;


/* ─── Legacy Storage Migration Ledger ─── */
export const legacyStorageMigrationStateEnum = [
  "inventoried", "uploading", "uploaded", "object_verified",
  "metadata_committed", "app_verified", "rollback_required",
  "rolled_back", "conflict", "failed", "excluded"
] as const;

export type LegacyStorageMigrationState = (typeof legacyStorageMigrationStateEnum)[number];

export const VALID_STATE_TRANSITIONS: Record<LegacyStorageMigrationState, LegacyStorageMigrationState[]> = {
  inventoried: ["uploading", "excluded"],
  uploading: ["uploaded", "failed"],
  uploaded: ["object_verified", "failed"],
  object_verified: ["metadata_committed", "failed"],
  metadata_committed: ["app_verified", "rollback_required", "failed"],
  rollback_required: ["rolled_back", "failed"],
  rolled_back: ["uploading"],
  conflict: [],
  failed: ["uploading", "excluded"],
  app_verified: [],
  excluded: [],
};

export const legacyStorageMigrationLedger = pgTable("legacy_storage_migration_ledger", {
  id: serial("id").primaryKey(),
  source: varchar("source", { length: 50 }).notNull(),
  recordId: integer("record_id").notNull(),
  bucket: varchar("bucket", { length: 100 }).notNull(),
  storagePath: text("storage_path").notNull(),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  expectedSize: bigint("expected_size", { mode: "number" }).notNull(),
  legacySha256: varchar("legacy_sha256", { length: 64 }).notNull(),
  detectedMimeType: varchar("detected_mime_type", { length: 255 }).notNull(),
  state: varchar("state", { length: 32 }).notNull().default("inventoried"),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastError: text("last_error"),
  tusUploadUrl: text("tus_upload_url"),
  leaseOwner: varchar("lease_owner", { length: 36 }),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  leaseHeartbeatAt: timestamp("lease_heartbeat_at", { withTimezone: true }),
  objectVerifiedAt: timestamp("object_verified_at", { withTimezone: true }),
  metadataCommittedAt: timestamp("metadata_committed_at", { withTimezone: true }),
  appVerifiedAt: timestamp("app_verified_at", { withTimezone: true }),
  rollbackAt: timestamp("rollback_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  unique("legacy_migration_ledger_source_record").on(table.source, table.recordId),
  index("legacy_migration_state_idx").on(table.state),
  index("legacy_migration_lease_idx").on(table.leaseExpiresAt),
]);

export type LegacyStorageMigrationLedger = typeof legacyStorageMigrationLedger.$inferSelect;
export type InsertLegacyStorageMigrationLedger = typeof legacyStorageMigrationLedger.$inferInsert;


/* ─── Lihok Corporate Library ─── */
export const lihokCorporateDocumentClassificationValues = [
  "public", "internal", "confidential", "restricted"
] as const;

export const lihokCorporateDocumentStatusValues = [
  "draft", "for_review", "approved", "superseded", "archived"
] as const;

export const lihokCorporateDocumentCategories = pgTable("lihok_corporate_document_categories", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 10 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  unique("lihok_corporate_document_categories_code_unique").on(table.code),
  index("lihok_corporate_document_categories_sort_idx").on(table.sortOrder),
]);

export const lihokCorporateDocuments = pgTable("lihok_corporate_documents", {
  id: serial("id").primaryKey(),
  documentNumber: varchar("document_number", { length: 50 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  categoryId: integer("category_id").notNull().references(() => lihokCorporateDocumentCategories.id, { onDelete: "restrict" }),
  defaultClassification: varchar("default_classification", { length: 20 }).notNull().default("internal"),
  ownerName: varchar("owner_name", { length: 255 }),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  archivedAt: timestamp("archived_at"),
}, (table) => [
  unique("lihok_corporate_documents_document_number_unique").on(table.documentNumber),
  index("lihok_corporate_documents_category_idx").on(table.categoryId),
  index("lihok_corporate_documents_classification_idx").on(table.defaultClassification),
  index("lihok_corporate_documents_owner_idx").on(table.ownerName),
  index("lihok_corporate_documents_archived_at_idx").on(table.archivedAt),
  check("lihok_corporate_documents_classification_check", sql`${table.defaultClassification} IN ('public', 'internal', 'confidential', 'restricted')`),
]);

export const lihokCorporateDocumentVersions = pgTable("lihok_corporate_document_versions", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull().references(() => lihokCorporateDocuments.id, { onDelete: "restrict" }),
  versionNumber: varchar("version_number", { length: 20 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  classification: varchar("classification", { length: 20 }).notNull().default("internal"),
  ownerName: varchar("owner_name", { length: 255 }),
  effectiveDate: date("effective_date"),
  changeNotes: text("change_notes"),
  fileName: varchar("file_name", { length: 255 }),
  fileSize: bigint("file_size", { mode: "number" }),
  mimeType: varchar("mime_type", { length: 255 }),
  fileHash: varchar("file_hash", { length: 64 }),
  storageProvider: varchar("storage_provider", { length: 32 }),
  storageBucket: varchar("storage_bucket", { length: 100 }),
  storagePath: text("storage_path"),
  storageEtag: text("storage_etag"),
  storageUploadedAt: timestamp("storage_uploaded_at", { withTimezone: true }),
  uploadedBy: integer("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  reviewedBy: integer("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  approvedBy: integer("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  supersededByVersionId: integer("superseded_by_version_id").references((): AnyPgColumn => lihokCorporateDocumentVersions.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  unique("lihok_corporate_document_versions_unique").on(table.documentId, table.versionNumber),
  uniqueIndex("lihok_corporate_document_versions_approved_unique").on(table.documentId).where(sql`${table.status} = 'approved'`),
  uniqueIndex("lihok_corporate_document_versions_storage_unique").on(table.storageBucket, table.storagePath).where(sql`${table.storagePath} IS NOT NULL`),
  index("lihok_corporate_document_versions_document_idx").on(table.documentId),
  index("lihok_corporate_document_versions_status_idx").on(table.status),
  index("lihok_corporate_document_versions_classification_idx").on(table.classification),
  index("lihok_corporate_document_versions_owner_idx").on(table.ownerName),
  index("lihok_corporate_document_versions_superseded_idx").on(table.supersededByVersionId),
  index("lihok_corporate_document_versions_effective_date_idx").on(table.effectiveDate),
  check("lihok_corporate_document_versions_status_check", sql`${table.status} IN ('draft', 'for_review', 'approved', 'superseded', 'archived')`),
  check("lihok_corporate_document_versions_classification_check", sql`${table.classification} IN ('public', 'internal', 'confidential', 'restricted')`),
  check("lihok_corporate_document_versions_hash_check", sql`${table.fileHash} IS NULL OR ${table.fileHash} ~ '^[a-f0-9]{64}$'`),
  check("lihok_corporate_document_versions_no_self_supersede_check", sql`${table.supersededByVersionId} IS NULL OR ${table.supersededByVersionId} <> ${table.id}`),
]);

export const lihokCorporateDocumentAudit = pgTable("lihok_corporate_document_audit", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull().references(() => lihokCorporateDocuments.id, { onDelete: "restrict" }),
  versionId: integer("version_id").references(() => lihokCorporateDocumentVersions.id, { onDelete: "restrict" }),
  action: varchar("action", { length: 50 }).notNull(),
  actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorName: varchar("actor_name", { length: 255 }),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  requestId: varchar("request_id", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("lihok_corporate_document_audit_document_idx").on(table.documentId),
  index("lihok_corporate_document_audit_version_idx").on(table.versionId),
  index("lihok_corporate_document_audit_action_idx").on(table.action),
  index("lihok_corporate_document_audit_created_at_idx").on(table.createdAt),
]);

export type LihokCorporateDocumentCategory = typeof lihokCorporateDocumentCategories.$inferSelect;
export type InsertLihokCorporateDocumentCategory = typeof lihokCorporateDocumentCategories.$inferInsert;
export type LihokCorporateDocument = typeof lihokCorporateDocuments.$inferSelect;
export type InsertLihokCorporateDocument = typeof lihokCorporateDocuments.$inferInsert;
export type LihokCorporateDocumentVersion = typeof lihokCorporateDocumentVersions.$inferSelect;
export type InsertLihokCorporateDocumentVersion = typeof lihokCorporateDocumentVersions.$inferInsert;
export type LihokCorporateDocumentAuditEntry = typeof lihokCorporateDocumentAudit.$inferSelect;
export type InsertLihokCorporateDocumentAuditEntry = typeof lihokCorporateDocumentAudit.$inferInsert;

import { pgTable, serial, varchar, text, integer, bigint, timestamp, index, unique, doublePrecision, jsonb, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("gantt_projects_name_idx").on(table.name),
  index("gantt_projects_session_idx").on(table.sessionId),
  index("gantt_projects_user_idx").on(table.userId),
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
  "inventoried",
  "uploading",
  "uploaded",
  "object_verified",
  "metadata_committed",
  "app_verified",
  "rollback_required",
  "rolled_back",
  "conflict",
  "failed",
  "excluded",
] as const;

export type LegacyStorageMigrationState = (typeof legacyStorageMigrationStateEnum)[number];

// Valid state transitions for state machine
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
  // TUS upload URL for resumable uploads (never logged or exposed)
  tusUploadUrl: text("tus_upload_url"),
  // Worker lease for distributed locking
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  objectVerifiedAt: timestamp("object_verified_at", { withTimezone: true }),
  metadataCommittedAt: timestamp("metadata_committed_at", { withTimezone: true }),
  appVerifiedAt: timestamp("app_verified_at", { withTimezone: true }),
  rollbackAt: timestamp("rollback_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  unique("legacy_migration_ledger_source_record_unique").on(table.source, table.recordId),
  index("legacy_migration_ledger_state_idx").on(table.state),
  index("legacy_migration_ledger_source_idx").on(table.source),
  index("legacy_migration_ledger_updated_idx").on(table.updatedAt),
  index("legacy_migration_ledger_lease_idx").on(table.leaseExpiresAt),
]);

export type LegacyStorageMigrationLedger = typeof legacyStorageMigrationLedger.$inferSelect;
export type InsertLegacyStorageMigrationLedger = typeof legacyStorageMigrationLedger.$inferInsert;

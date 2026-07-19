/**
 * Dependency Adapter Interfaces for Legacy Storage Migrator
 *
 * These interfaces allow dependency injection for testability
 * while preserving production CLI behavior.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LegacyStorageMigrationState } from "../../db/schema";
import type { StorageFileSource } from "@contracts/storage";

// ============================================================================
// CORE ADAPTER INTERFACES
// ============================================================================

export interface DbAdapter {
  // Simplified - any for test flexibility
  select: any;
  insert: any;
  update: any;
  transaction: any;
  raw: any;
}

export interface StorageAdapter {
  // Simplified - any for test flexibility
  from: any;
}

export interface TusUpload {
  url: string | null;
  start: () => void;
  abort: () => void;
}

export interface TusAdapter {
  Upload: any;
}

export interface FsAdapter {
  mkdir: any;
  rm: any;
  open: any;
  createReadStream: any;
  createWriteStream: any;
}

export interface FetchAdapter {
  fetch: any;
}

export interface ClockAdapter {
  now: () => number;
  newDate: () => Date;
  randomUUID: () => string;
}

export interface LoggerAdapter {
  log: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  info?: (...args: any[]) => void;
}

// ============================================================================
// MIGRATION CONTEXT
// ============================================================================

export interface MigrationContext {
  db: DbAdapter;
  storage: StorageAdapter;
  tus: TusAdapter;
  fs: FsAdapter;
  fetchAdapter: FetchAdapter;
  clock: ClockAdapter;
  logger: LoggerAdapter;
  workerId: string;
  execute: boolean;
}

// ============================================================================
// WORKFLOW TYPES
// ============================================================================

export interface MigrationOptions {
  execute: boolean;
  confirmProduction: boolean;
  sources?: StorageFileSource[];
  recordIds?: number[];
  limit?: number;
  batchSize?: number;
}

export interface ProcessingResult {
  success: boolean;
  state?: string;
  error?: string;
  skipped?: boolean;
}

export interface SourceFingerprint {
  length: number;
  hash: string;
  mimeHint?: string;
}

export interface DecodedPayload {
  size: number;
  sha256: string;
  mimeType: string;
}

export interface LeaseResult {
  acquired: boolean;
  conflict?: string;
}

export interface CommitResult {
  success: boolean;
  error?: string;
}

export interface ObjectClassification {
  path: string;
  classification:
    | "referenced"
    | "active_upload_intent"
    | "finalized_upload_intent"
    | "migration_verified"
    | "migration_staged"
    | "possible_orphan"
    | "indeterminate";
}

// ============================================================================
// HELPER FUNCTION TYPES (for test injection)
// ============================================================================

export type AcquireLeaseFn = (
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  storagePath: string,
  expectedSize: number,
  legacySha256: string,
  mimeType: string,
  ctx: MigrationContext
) => Promise<LeaseResult>;

export type RenewLeaseFn = (
  source: StorageFileSource,
  recordId: number,
  ctx: MigrationContext
) => Promise<boolean>;

export type ReleaseLeaseFn = (
  source: StorageFileSource,
  recordId: number,
  ctx: MigrationContext
) => Promise<void>;

export type TransitionStateFn = (
  source: StorageFileSource,
  recordId: number,
  expectedState: string,
  newState: LegacyStorageMigrationState,
  ctx: MigrationContext
) => Promise<{ success: boolean }>;

export type TransactionalCommitFn = (
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  path: string,
  size: number,
  mimeType: string,
  fingerprint: SourceFingerprint,
  ctx: MigrationContext
) => Promise<CommitResult>;

export type TransactionalRollbackFn = (
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  path: string,
  ctx: MigrationContext
) => Promise<CommitResult>;

export type InspectObjectFn = (
  storage: StorageAdapter,
  bucket: string,
  path: string,
  expectedSize: number,
  expectedHash: string,
  expectedMime: string
) => Promise<
  | { status: "verified_match" }
  | { status: "verified_mismatch"; reason: string }
  | { status: "not_found" }
  | { status: "indeterminate"; reason: string }
>;

export type VerifyAppRouteFn = (
  baseUrl: string,
  source: StorageFileSource,
  recordId: number,
  size: number,
  hash: string,
  fetchFn: any
) => Promise<
  | { ok: true }
  | { ok: false; error: string }
>;

export type GetFingerprintFn = (
  source: StorageFileSource,
  recordId: number,
  db: DbAdapter
) => Promise<SourceFingerprint | null>;

export type DecodeWithHeartbeatFn = (
  source: StorageFileSource,
  recordId: number,
  record: { id: number; fileName: string | null; fileType: string | null; legacyDataLength: number },
  tempFilePath: string,
  ctx: MigrationContext,
  onProgress: (size: number) => void
) => Promise<DecodedPayload>;

export type UploadWithTusFn = (
  storage: StorageAdapter,
  bucket: string,
  path: string,
  tempFilePath: string,
  mimeType: string,
  fileSize: number,
  source: StorageFileSource,
  recordId: number,
  ctx: MigrationContext,
  onHeartbeat: () => Promise<void>
) => Promise<void>;

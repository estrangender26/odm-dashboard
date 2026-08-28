import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { sql, eq, and } from "drizzle-orm";
import { ensureDbReady, getDb } from "./queries/connection";
import { appRouter } from "./router";
import { presentationFilesRouter } from "./presentation-files-router";
import { documentsUploadRouter } from "./documents-router";
import { storageRouter } from "./storage-router";

import { createContext } from "./context";
import { env } from "./lib/env";
import { assertPreviewSecretConfigured } from "@/modules/gantt/primavera-lite/previewToken";
import { authenticateRequest } from "./auth/authenticate";
import {
  buildAuthorizeUrl,
  createOAuthCallbackHandler,
  isGoogleOAuthConfigured,
} from "./auth/google";
import { getOAuthRedirectUri } from "./lib/public-origin";
import { Paths } from "@contracts/constants";
import {
  MAX_UPLOAD_ERROR_MESSAGE,
  getDecodedBase64ByteLength,
  isUploadFileSizeAllowed,
} from "@contracts/upload-limits";
import fs from "fs";
import path from "path";
import { docFiles, governanceMilestoneState, governanceUploads } from "../db/schema";
import { isValidManualStatus } from "../src/modules/governance-v3/milestoneStatusManual";
import { aggregateMonthlyKpiRecords, computeMonthlyKpiValuesFromRaw, normalizeBusinessUnitLabel, normalizeKpiNumber } from "../src/modules/monthly-kpi/kpiAggregation";
import type { PersistedMonthlyKpiRecord } from "../src/modules/monthly-kpi/kpiAggregation";
import { installRequestBodyGuard } from "./request-body-guard";
import {
  buildOdmDashboardScorecard,
  mapInspectionToDashboardRow,
  type OdmDashboardFilters,
} from "../src/modules/operator-driven-maintenance/dashboardSummary";

const app = new Hono<{ Bindings: HttpBindings }>();


const DOC_FILE_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  zip: "application/zip",
  html: "text/html",
  htm: "text/html",
  xhtml: "application/xhtml+xml",
};

function sanitizeHeaderFilename(fileName: string): string {
  return (fileName || "document.pdf").replace(/[\r\n"]/g, "_");
}

function inferMimeType(fileName: string, storedMimeType?: string | null): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const typeFromExtension = ext ? DOC_FILE_MIME_TYPES[ext] : undefined;
  const typeFromStorage = storedMimeType?.trim();
  if (typeFromExtension === "application/pdf") return typeFromExtension;
  return typeFromStorage && typeFromStorage !== "application/octet-stream"
    ? typeFromStorage
    : typeFromExtension || "application/octet-stream";
}

function parseBase64FileData(fileData: string | null, fileName: string, storedMimeType?: string | null) {
  const rawData = fileData?.trim();
  if (!rawData) return null;

  let mimeType = inferMimeType(fileName, storedMimeType);
  let base64Data = rawData;

  if (rawData.startsWith("data:")) {
    const match = rawData.match(/^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s);
    if (!match) return null;
    if (match[1]) mimeType = match[1];
    base64Data = match[2];
  }

  return {
    mimeType,
    buffer: Buffer.from(base64Data, "base64"),
  };
}

type ParsedDocumentFile = {
  mimeType: string;
  buffer: Buffer;
};

type DocumentFileCacheEntry = ParsedDocumentFile & {
  id: number;
  fileName: string;
  updatedAt: string;
  cachedAt: number;
};

const DOCUMENT_FILE_CACHE_TTL_MS = 5 * 60_000;
const DOCUMENT_FILE_CACHE_MAX_ENTRIES = 20;
const documentFileCache = new Map<number, DocumentFileCacheEntry>();

function normalizeUpdatedAt(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : "";
}

function rememberDocumentFile(entry: DocumentFileCacheEntry): DocumentFileCacheEntry {
  documentFileCache.delete(entry.id);
  documentFileCache.set(entry.id, entry);
  while (documentFileCache.size > DOCUMENT_FILE_CACHE_MAX_ENTRIES) {
    const oldestKey = documentFileCache.keys().next().value;
    if (oldestKey === undefined) break;
    documentFileCache.delete(oldestKey);
  }
  return entry;
}

async function getParsedDocumentFile(id: number) {
  const metadataRows = await getDb().select({
    id: docFiles.id,
    title: docFiles.title,
    fileName: docFiles.fileName,
    fileType: docFiles.fileType,
    fileSize: docFiles.fileSize,
    updatedAt: docFiles.updatedAt,
  }).from(docFiles).where(eq(docFiles.id, id)).limit(1);
  const metadata = metadataRows[0];
  if (!metadata) return null;

  const fileName = sanitizeHeaderFilename(metadata.fileName || metadata.title || "document.pdf");
  const updatedAt = normalizeUpdatedAt(metadata.updatedAt);
  const cached = documentFileCache.get(id);
  if (cached && cached.fileName === fileName && cached.updatedAt === updatedAt && Date.now() - cached.cachedAt < DOCUMENT_FILE_CACHE_TTL_MS) {
    documentFileCache.delete(id);
    documentFileCache.set(id, { ...cached, cachedAt: Date.now() });
    return { fileName, parsed: cached };
  }

  const dataRows = await getDb().select({
    fileData: docFiles.fileData,
    fileType: docFiles.fileType,
  }).from(docFiles).where(eq(docFiles.id, id)).limit(1);
  const parsed = parseBase64FileData(dataRows[0]?.fileData ?? null, fileName, dataRows[0]?.fileType ?? metadata.fileType);
  if (!parsed || parsed.buffer.length === 0) return { fileName, parsed: null };

  return {
    fileName,
    parsed: rememberDocumentFile({
      id,
      fileName,
      updatedAt,
      cachedAt: Date.now(),
      mimeType: parsed.mimeType,
      buffer: parsed.buffer,
    }),
  };
}

function parseRangeHeader(range: string | undefined, size: number) {
  if (!range) return null;
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return "invalid" as const;

  const [, startText, endText] = match;
  if (!startText && !endText) return "invalid" as const;

  if (!startText) {
    const suffixLength = Number.parseInt(endText, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return "invalid" as const;
    const start = Math.max(size - suffixLength, 0);
    return { start, end: size - 1 };
  }

  const start = Number.parseInt(startText, 10);
  const end = endText ? Number.parseInt(endText, 10) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return "invalid" as const;
  return { start, end: Math.min(end, size - 1) };
}


let bootStageCounter = 0;
function logBootStage(message: string, details?: Record<string, unknown>): void {
  bootStageCounter += 1;
  const stage = `BOOT_STAGE_${bootStageCounter}`;
  if (details) {
    console.log(`[${stage}] ${message}`, details);
  } else {
    console.log(`[${stage}] ${message}`);
  }
}

function logBootError(stage: string, error: unknown): void {
  const e = error as { message?: string; stack?: string };
  console.error(`[${stage}] error`, {
    message: e?.message ?? String(error),
    stack: e?.stack,
  });
}

const BOOT_MIGRATION_TIMEOUT_MS = Number.parseInt(
  process.env.BOOT_MIGRATION_TIMEOUT_MS || "60000",
  10
);

function withTimeoutDiagnostics<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  return new Promise<T>((resolve, reject) => {
    timeout = setTimeout(() => {
      console.error(`[BOOT] ${label} still pending after ${timeoutMs}ms`, {
        timeoutMs,
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
      });
    }, timeoutMs);

    promise.then(resolve, reject).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
  });
}

logBootStage("boot.ts module loaded", {
  nodeEnv: process.env.NODE_ENV ?? "unset",
  isProduction: env.isProduction,
});

/**
 * Find the dist/public directory that contains index.html.
 * Tries multiple strategies to work in both bundled (production) and
 * dynamic-import (dev) contexts.
 */
function findDistPublic(): string | null {
  const candidates: string[] = [];

  // Strategy 1: process.cwd() — works when server is started from project root
  candidates.push(path.resolve(process.cwd(), "dist/public"));

  // Strategy 2: import.meta.dirname + ../dist/public — when bundled to dist/boot.js
  candidates.push(path.resolve(import.meta.dirname, "../dist/public"));

  // Strategy 3: import.meta.dirname + ../../dist/public — when loaded dynamically from api/lib/
  candidates.push(path.resolve(import.meta.dirname, "../../dist/public"));

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  // None found — return the most likely one for error reporting
  return candidates[0];
}

// Resolve dist path once at module load
const distPath = findDistPublic();
logBootStage("dist/public path resolved", { distPath });

logBootStage("registering streaming request body guard");
installRequestBodyGuard(app);

logBootStage("registering document upload routes");
app.route("/api/documents", documentsUploadRouter);
app.route("/api/storage", storageRouter);

logBootStage("registering API request logger middleware");
app.use("*", async (c, next) => {
  const start = Date.now();
  const path = c.req.path;
  if (path.startsWith("/api/") || path.startsWith("/api/trpc")) {
    console.log(`[API] --> ${c.req.method} ${path}`);
  }
  try {
    await next();
    if (path.startsWith("/api/") || path.startsWith("/api/trpc")) {
      console.log(`[API] <-- ${c.req.method} ${path} ${c.res.status} (${Date.now() - start}ms)`);
    }
  } catch (error: any) {
    if (path.startsWith("/api/") || path.startsWith("/api/trpc")) {
      console.error(`[API] xx ${c.req.method} ${path} (${Date.now() - start}ms): ${error?.message ?? String(error)}`);
    }
    throw error;
  }
});


logBootStage("registering OAuth routes");
app.get(Paths.oauthCallback, createOAuthCallbackHandler());

// OAuth authorize — redirects to Google. OWNER/admin login entry only;
// the public Projects without PPP workflow never touches this route.
app.get("/api/oauth/authorize", async (c) => {
  if (!isGoogleOAuthConfigured()) {
    return c.json({ error: "Google OAuth is not configured" }, 503);
  }
  // Canonical public redirect URI (https behind Render's proxy) used for the
  // Google redirect_uri AND the signed state binding.
  const redirectUri = getOAuthRedirectUri(c.req.raw);
  const authorizeUrl = await buildAuthorizeUrl(redirectUri);
  return c.redirect(authorizeUrl, 302);
});

logBootStage("registering static HTML dashboard routes");

// Serve O&M Governance Dashboard at /governance
app.get("/governance", async (c) => {
  const dp = distPath || findDistPublic();
  if (!dp) return c.json({ error: "dist/public not found" }, 500);
  const governancePath = path.join(dp, "governance.html");
  if (fs.existsSync(governancePath)) {
    const content = fs.readFileSync(governancePath, "utf-8");
    // Aggressive cache-busting: unique ETag based on file mtime + content length
    const stat = fs.statSync(governancePath);
    const etag = `"gov-${stat.mtime.getTime()}-${content.length}"`;
    c.header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
    c.header("Vary", "*");
    c.header("ETag", etag);
    // If client sends matching If-None-Match, still return 200 to force refresh
    return c.html(content);
  }
  return c.json({ error: "Governance dashboard not found", path: governancePath }, 404);
});

// Serve Manila Water Operator-Driven Maintenance Dashboard at /mw-dashboard
app.get("/mw-dashboard", async (c) => {
  const dp = distPath || findDistPublic();
  if (!dp) return c.json({ error: "dist/public not found" }, 500);
  const mwPath = path.join(dp, "mw-dashboard.html");
  if (fs.existsSync(mwPath)) {
    const content = fs.readFileSync(mwPath, "utf-8");
    c.header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
    return c.html(content);
  }
  return c.json({ error: "MW dashboard not found", path: mwPath }, 404);
});

app.get("/operator-maintenance", (c) => c.redirect("/mw-dashboard", 302));
app.get("/operator-driven-maintenance", (c) => c.redirect("/mw-dashboard", 302));



const monthlyKpiCanonicalBusinessUnitSql = sql`
  CASE lower(trim(business_unit))
    WHEN 'ez' THEN 'AMD-EZ'
    WHEN 'amd-ez' THEN 'AMD-EZ'
    WHEN 'laguna' THEN 'Laguna Water'
    WHEN 'laguna water' THEN 'Laguna Water'
    WHEN 'clark' THEN 'Clark Water'
    WHEN 'clark water' THEN 'Clark Water'
    WHEN 'tagum' THEN 'Tagum Water'
    WHEN 'tagum water' THEN 'Tagum Water'
    WHEN 'estate' THEN 'Estate Water'
    WHEN 'estate water' THEN 'Estate Water'
    WHEN 'wawajvc' THEN 'WAWA/JVC'
    WHEN 'wawa/jvc' THEN 'WAWA/JVC'
    ELSE trim(business_unit)
  END
`;

const monthlyKpiAliasPrioritySql = sql`
  CASE
    WHEN trim(business_unit) IN ('AMD-EZ', 'Laguna Water', 'Clark Water', 'Tagum Water', 'Estate Water', 'WAWA/JVC') THEN 0
    ELSE 1
  END
`;

function normalizeMonthlyKpiBusinessUnitFilter(value: string | null | undefined) {
  const normalized = normalizeBusinessUnitLabel(String(value || "").trim());
  return normalized || null;
}

function asNullableKpiNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function asNullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function asRequiredInteger(value: unknown, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${fieldName} must be an integer`);
  return parsed;
}

function normalizeMonthlyKpiRecord(input: any, fallbackSourceFileName?: string | null, fallbackBusinessUnit?: string | null) {
  const businessUnit = String(input?.business_unit ?? input?.businessUnit ?? fallbackBusinessUnit ?? "").trim();
  if (!businessUnit) throw new Error("business_unit is required");
  const reportingMonth = asRequiredInteger(input?.reporting_month ?? input?.reportingMonth, "reporting_month");
  const reportingYear = asRequiredInteger(input?.reporting_year ?? input?.reportingYear, "reporting_year");
  if (reportingMonth < 1 || reportingMonth > 12) throw new Error("reporting_month must be between 1 and 12");
  if (reportingYear < 1900 || reportingYear > 3000) throw new Error("reporting_year must be a valid year");

  const sourceFileName = String(input?.source_file_name ?? input?.sourceFileName ?? fallbackSourceFileName ?? "").trim() || null;

  // Raw input fields.
  const rawFields = {
    actualSpend: asNullableKpiNumber(input?.actual_spend ?? input?.actualSpend),
    budget: asNullableKpiNumber(input?.budget),
    pmOrdersCompletedOnTime: asNullableKpiNumber(input?.pm_orders_completed_on_time ?? input?.pmOrdersCompletedOnTime),
    totalPmOrders: asNullableKpiNumber(input?.total_pm_orders ?? input?.totalPmOrders),
    pmWorkOrders: asNullableKpiNumber(input?.pm_work_orders ?? input?.pmWorkOrders),
    cmWorkOrders: asNullableKpiNumber(input?.cm_work_orders ?? input?.cmWorkOrders),
    pmCost: asNullableKpiNumber(input?.pm_cost ?? input?.pmCost),
    cmCost: asNullableKpiNumber(input?.cm_cost ?? input?.cmCost),
    totalDowntime: asNullableKpiNumber(input?.total_downtime ?? input?.totalDowntime),
    numberOfRepairs: asNullableKpiNumber(input?.number_of_repairs ?? input?.numberOfRepairs),
    totalOperatingTime: asNullableKpiNumber(input?.total_operating_time ?? input?.totalOperatingTime),
    sourceSheet: asNullableText(input?.source_sheet ?? input?.sourceSheet),
    importBatchId: asNullableText(input?.import_batch_id ?? input?.importBatchId),
  };

  // Compute monthly KPI values from raw inputs when the computed column is missing.
  const rawInputRecord: PersistedMonthlyKpiRecord = {
    business_unit: businessUnit,
    reporting_month: reportingMonth,
    reporting_year: reportingYear,
    source_file_name: sourceFileName,
    pm_compliance: asNullableKpiNumber(input?.pm_compliance ?? input?.pmCompliance),
    pm_planned: asNullableKpiNumber(input?.pm_planned ?? input?.pmPlanned),
    schedule_compliance: asNullableKpiNumber(input?.schedule_compliance ?? input?.scheduleCompliance),
    budget_spend: asNullableKpiNumber(input?.budget_spend ?? input?.budgetSpend),
    pm_cm_work_order_ratio: asNullableKpiNumber(input?.pm_cm_work_order_ratio ?? input?.pmCmWorkOrderRatio ?? input?.pmcmWORatio),
    pm_cm_cost_ratio: asNullableKpiNumber(input?.pm_cm_cost_ratio ?? input?.pmCmCostRatio ?? input?.pmcmCostRatio),
    mtbf_days: asNullableKpiNumber(input?.mtbf_days ?? input?.mtbfDays ?? input?.mtbf),
    mttr_days: asNullableKpiNumber(input?.mttr_days ?? input?.mttrDays ?? input?.mttr),
    facility_uptime: asNullableKpiNumber(input?.facility_uptime ?? input?.facilityUptime),
    notes: asNullableText(input?.notes ?? input?.Notes),
    raw_imported_values: input?.raw_imported_values ?? input?.rawImportedValues ?? null,
    ...rawFields,
  };
  const computedFromRaw = computeMonthlyKpiValuesFromRaw(rawInputRecord);

  function pickComputed(key: keyof typeof computedFromRaw, stored: number | null): number | null {
    return stored !== null ? stored : (computedFromRaw[key] ?? null);
  }

  return {
    businessUnit,
    reportingMonth,
    reportingYear,
    sourceFileName,
    pmCompliance: pickComputed("pmCompliance", normalizeKpiNumber(rawInputRecord.pm_compliance)),
    pmPlanned: asNullableKpiNumber(input?.pm_planned ?? input?.pmPlanned),
    scheduleCompliance: asNullableKpiNumber(input?.schedule_compliance ?? input?.scheduleCompliance),
    budgetSpend: pickComputed("budgetSpend", normalizeKpiNumber(rawInputRecord.budget_spend)),
    pmCmWorkOrderRatio: pickComputed("pmCmWorkOrderRatio", normalizeKpiNumber(rawInputRecord.pm_cm_work_order_ratio)),
    pmCmCostRatio: pickComputed("pmCmCostRatio", normalizeKpiNumber(rawInputRecord.pm_cm_cost_ratio)),
    mtbfDays: asNullableKpiNumber(input?.mtbf_days ?? input?.mtbfDays ?? input?.mtbf),
    mttrDays: pickComputed("mttrDays", normalizeKpiNumber(rawInputRecord.mttr_days)),
    facilityUptime: pickComputed("facilityUptime", normalizeKpiNumber(rawInputRecord.facility_uptime)),
    notes: asNullableText(input?.notes ?? input?.Notes),
    rawImportedValues: input?.raw_imported_values ?? input?.rawImportedValues ?? null,
    ...rawFields,
  };
}

logBootStage("registering monthly KPI scorecard routes");

function preventMonthlyKpiResponseCaching(c: Context) {
  c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  c.header("Pragma", "no-cache");
  c.header("Expires", "0");
}

function rowsFromDb<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  return Array.isArray(result) ? (result as T[]) : [];
}

async function fetchMonthlyKpiRecordsForResponse(filters: { businessUnit?: string | null; reportingYear?: number | null; reportingMonth?: number | null } = {}) {
  const businessUnitParam = normalizeMonthlyKpiBusinessUnitFilter(filters.businessUnit);
  const reportingYear = Number.isInteger(filters.reportingYear) ? filters.reportingYear : null;
  const reportingMonth = Number.isInteger(filters.reportingMonth) ? filters.reportingMonth : null;
  const rows = await getDb().execute(sql`
    SELECT
      id,
      canonical_business_unit AS business_unit,
      reporting_month,
      reporting_year,
      source_file_name,
      imported_at,
      pm_compliance,
      pm_planned,
      schedule_compliance,
      budget_spend,
      pm_cm_work_order_ratio,
      pm_cm_cost_ratio,
      mttr_days,
      facility_uptime,
      actual_spend,
      budget,
      pm_orders_completed_on_time,
      total_pm_orders,
      pm_work_orders,
      cm_work_orders,
      pm_cost,
      cm_cost,
      total_downtime,
      number_of_repairs,
      total_operating_time,
      source_sheet,
      import_batch_id,
      notes,
      raw_imported_values
    FROM (
      SELECT
        monthly_kpi_records.*,
        ${monthlyKpiCanonicalBusinessUnitSql} AS canonical_business_unit,
        ROW_NUMBER() OVER (
          PARTITION BY ${monthlyKpiCanonicalBusinessUnitSql}, reporting_year, reporting_month
          ORDER BY ${monthlyKpiAliasPrioritySql} ASC, imported_at DESC NULLS LAST, id DESC
        ) AS alias_rank
      FROM monthly_kpi_records
    ) ranked_monthly_kpi_records
    WHERE alias_rank = 1
      AND (${businessUnitParam}::text IS NULL OR canonical_business_unit = ${businessUnitParam})
      AND (${reportingYear}::int IS NULL OR reporting_year = ${reportingYear})
      AND (${reportingMonth}::int IS NULL OR reporting_month = ${reportingMonth})
    ORDER BY reporting_year DESC, reporting_month DESC, canonical_business_unit ASC
  `);
  return rowsFromDb<Record<string, unknown>>(rows);
}

async function fetchMonthlyKpiAggregateForResponse(reportingYear: number, reportingMonth?: number) {
  const rows = await getDb().execute(sql`
    SELECT
      business_unit,
      reporting_month,
      reporting_year,
      pm_compliance,
      schedule_compliance,
      budget_spend,
      pm_cm_work_order_ratio,
      pm_cm_cost_ratio,
      mttr_days,
      facility_uptime,
      actual_spend,
      budget,
      pm_orders_completed_on_time,
      total_pm_orders,
      pm_work_orders,
      cm_work_orders,
      pm_cost,
      cm_cost,
      total_downtime,
      number_of_repairs,
      total_operating_time,
      mttr_downtime,
      repair_count,
      facility_operating_time,
      facility_downtime,
      source_sheet,
      import_batch_id,
      notes,
      raw_imported_values
    FROM monthly_kpi_records
    WHERE reporting_year = ${reportingYear}
    ORDER BY business_unit ASC, reporting_month ASC
  `);
  return aggregateMonthlyKpiRecords(rowsFromDb<PersistedMonthlyKpiRecord>(rows), reportingYear, reportingMonth);
}

app.get("/api/monthly-kpi/records", async (c) => {
  try {
    preventMonthlyKpiResponseCaching(c);
    await ensureDbReady();
    const records = await fetchMonthlyKpiRecordsForResponse({
      businessUnit: c.req.query("business_unit")?.trim() || null,
      reportingYear: c.req.query("reporting_year") ? Number(c.req.query("reporting_year")) : null,
      reportingMonth: c.req.query("reporting_month") ? Number(c.req.query("reporting_month")) : null,
    });
    return c.json({ records });
  } catch (e: any) {
    console.error("[monthly-kpi] GET records failed", e);
    return c.json({ error: e?.message ?? "Unable to fetch Monthly KPI records" }, 500);
  }
});

app.get("/api/monthly-kpi/aggregates", async (c) => {
  try {
    preventMonthlyKpiResponseCaching(c);
    await ensureDbReady();
    const reportingYear = Number(c.req.query("reporting_year"));
    if (!Number.isInteger(reportingYear)) {
      return c.json({ error: "reporting_year query parameter is required" }, 400);
    }
    const reportingMonthParam = c.req.query("reporting_month");
    let reportingMonth: number | undefined;
    if (reportingMonthParam) {
      reportingMonth = Number(reportingMonthParam);
      if (!Number.isInteger(reportingMonth) || reportingMonth < 1 || reportingMonth > 12) {
        return c.json({ error: "reporting_month query parameter must be between 1 and 12" }, 400);
      }
    }
    return c.json(await fetchMonthlyKpiAggregateForResponse(reportingYear, reportingMonth));
  } catch (e: any) {
    console.error("[monthly-kpi] GET aggregates failed", e);
    return c.json({ error: e?.message ?? "Unable to aggregate Monthly KPI records" }, 500);
  }
});

app.post("/api/monthly-kpi/import", async (c) => {
  try {
    await ensureDbReady();
    const body = await c.req.json();
    const sourceFileName = body?.source_file_name ?? body?.sourceFileName ?? null;
    const fallbackBusinessUnit = body?.business_unit ?? body?.businessUnit ?? null;
    const payloadRecords = Array.isArray(body?.records) ? body.records : [];
    if (payloadRecords.length === 0) return c.json({ error: "records array is required" }, 400);
    const db = getDb();
    const saved: any[] = [];
    for (const payloadRecord of payloadRecords) {
      const record = normalizeMonthlyKpiRecord(payloadRecord, sourceFileName, fallbackBusinessUnit);
      const result = await db.execute(sql`
        INSERT INTO monthly_kpi_records (
          business_unit,
          reporting_month,
          reporting_year,
          source_file_name,
          imported_at,
          pm_compliance,
          pm_planned,
          schedule_compliance,
          budget_spend,
          pm_cm_work_order_ratio,
          pm_cm_cost_ratio,
          mtbf_days,
          mttr_days,
          facility_uptime,
          actual_spend,
          budget,
          pm_orders_completed_on_time,
          total_pm_orders,
          pm_work_orders,
          cm_work_orders,
          pm_cost,
          cm_cost,
          total_downtime,
          number_of_repairs,
          total_operating_time,
          source_sheet,
          import_batch_id,
          notes,
          raw_imported_values
        ) VALUES (
          ${record.businessUnit},
          ${record.reportingMonth},
          ${record.reportingYear},
          ${record.sourceFileName},
          now(),
          ${record.pmCompliance},
          ${record.pmPlanned},
          ${record.scheduleCompliance},
          ${record.budgetSpend},
          ${record.pmCmWorkOrderRatio},
          ${record.pmCmCostRatio},
          ${record.mtbfDays},
          ${record.mttrDays},
          ${record.facilityUptime},
          ${record.actualSpend},
          ${record.budget},
          ${record.pmOrdersCompletedOnTime},
          ${record.totalPmOrders},
          ${record.pmWorkOrders},
          ${record.cmWorkOrders},
          ${record.pmCost},
          ${record.cmCost},
          ${record.totalDowntime},
          ${record.numberOfRepairs},
          ${record.totalOperatingTime},
          ${record.sourceSheet},
          ${record.importBatchId},
          ${record.notes},
          ${record.rawImportedValues ? JSON.stringify(record.rawImportedValues) : null}::jsonb
        )
        ON CONFLICT (business_unit, reporting_year, reporting_month)
        DO UPDATE SET
          source_file_name = EXCLUDED.source_file_name,
          imported_at = now(),
          pm_compliance = EXCLUDED.pm_compliance,
          pm_planned = EXCLUDED.pm_planned,
          schedule_compliance = EXCLUDED.schedule_compliance,
          budget_spend = EXCLUDED.budget_spend,
          pm_cm_work_order_ratio = EXCLUDED.pm_cm_work_order_ratio,
          pm_cm_cost_ratio = EXCLUDED.pm_cm_cost_ratio,
          mtbf_days = EXCLUDED.mtbf_days,
          mttr_days = EXCLUDED.mttr_days,
          facility_uptime = EXCLUDED.facility_uptime,
          actual_spend = EXCLUDED.actual_spend,
          budget = EXCLUDED.budget,
          pm_orders_completed_on_time = EXCLUDED.pm_orders_completed_on_time,
          total_pm_orders = EXCLUDED.total_pm_orders,
          pm_work_orders = EXCLUDED.pm_work_orders,
          cm_work_orders = EXCLUDED.cm_work_orders,
          pm_cost = EXCLUDED.pm_cost,
          cm_cost = EXCLUDED.cm_cost,
          total_downtime = EXCLUDED.total_downtime,
          number_of_repairs = EXCLUDED.number_of_repairs,
          total_operating_time = EXCLUDED.total_operating_time,
          source_sheet = EXCLUDED.source_sheet,
          import_batch_id = EXCLUDED.import_batch_id,
          notes = EXCLUDED.notes,
          raw_imported_values = EXCLUDED.raw_imported_values
        RETURNING
          id,
          business_unit,
          reporting_month,
          reporting_year,
          source_file_name,
          imported_at,
          pm_compliance,
          pm_planned,
          schedule_compliance,
          budget_spend,
          pm_cm_work_order_ratio,
          pm_cm_cost_ratio,
          mtbf_days,
          mttr_days,
          facility_uptime,
          actual_spend,
          budget,
          pm_orders_completed_on_time,
          total_pm_orders,
          pm_work_orders,
          cm_work_orders,
          pm_cost,
          cm_cost,
          total_downtime,
          number_of_repairs,
          total_operating_time,
          source_sheet,
          import_batch_id,
          notes,
          raw_imported_values
      `);
      const row = ((result as any).rows ?? result)[0];
      if (row) saved.push(row);
    }
    return c.json({ success: true, records: saved, count: saved.length });
  } catch (e: any) {
    console.error("[monthly-kpi] import failed", e);
    return c.json({ error: e?.message ?? "Unable to save Monthly KPI records" }, 500);
  }
});


app.delete("/api/monthly-kpi/records", async (c) => {
  try {
    preventMonthlyKpiResponseCaching(c);
    await ensureDbReady();
    const rawBusinessUnit = c.req.query("business_unit");
    const businessUnit = rawBusinessUnit ? rawBusinessUnit.trim() : null;
    const reportingYear = Number(c.req.query("reporting_year"));
    const rawReportingMonth = c.req.query("reporting_month");
    const reportingMonth = rawReportingMonth ? Number(rawReportingMonth) : null;
    if (!Number.isInteger(reportingYear)) {
      return c.json({ error: "reporting_year query parameter is required" }, 400);
    }
    const result = await getDb().execute(sql`
      DELETE FROM monthly_kpi_records
      WHERE reporting_year = ${reportingYear}
        ${businessUnit ? sql`AND ${monthlyKpiCanonicalBusinessUnitSql} = ${normalizeMonthlyKpiBusinessUnitFilter(businessUnit)}` : sql``}
        ${Number.isInteger(reportingMonth) ? sql`AND reporting_month = ${reportingMonth}` : sql``}
      RETURNING id
    `);
    const rows = rowsFromDb<{ id: number }>(result);
    const records = await fetchMonthlyKpiRecordsForResponse({ reportingYear });
    const aggregates = Number.isInteger(reportingYear)
      ? await fetchMonthlyKpiAggregateForResponse(reportingYear)
      : null;
    return c.json({
      success: true,
      business_unit: businessUnit,
      reporting_year: reportingYear,
      reporting_month: reportingMonth,
      deletedCount: rows.length,
      records,
      aggregates,
    });
  } catch (e: any) {
    console.error("[monthly-kpi] delete failed", e);
    return c.json({ error: e?.message ?? "Unable to delete Monthly KPI records" }, 500);
  }
});

app.patch("/api/monthly-kpi/records/:id", async (c) => {
  try {
    await ensureDbReady();
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid record id" }, 400);
    const body = await c.req.json();
    const existingRows = await getDb().execute(sql`SELECT * FROM monthly_kpi_records WHERE id = ${id} LIMIT 1`);
    const existing = ((existingRows as any).rows ?? existingRows)[0];
    if (!existing) return c.json({ error: "Monthly KPI record not found" }, 404);
    const record = normalizeMonthlyKpiRecord({ ...existing, ...body }, existing.source_file_name);
    const result = await getDb().execute(sql`
      UPDATE monthly_kpi_records SET
        business_unit = ${record.businessUnit},
        reporting_month = ${record.reportingMonth},
        reporting_year = ${record.reportingYear},
        source_file_name = ${record.sourceFileName},
        imported_at = now(),
        pm_compliance = ${record.pmCompliance},
        pm_planned = ${record.pmPlanned},
        schedule_compliance = ${record.scheduleCompliance},
        budget_spend = ${record.budgetSpend},
        pm_cm_work_order_ratio = ${record.pmCmWorkOrderRatio},
        pm_cm_cost_ratio = ${record.pmCmCostRatio},
        mtbf_days = ${record.mtbfDays},
        mttr_days = ${record.mttrDays},
        facility_uptime = ${record.facilityUptime},
        actual_spend = ${record.actualSpend},
        budget = ${record.budget},
        pm_orders_completed_on_time = ${record.pmOrdersCompletedOnTime},
        total_pm_orders = ${record.totalPmOrders},
        pm_work_orders = ${record.pmWorkOrders},
        cm_work_orders = ${record.cmWorkOrders},
        pm_cost = ${record.pmCost},
        cm_cost = ${record.cmCost},
        total_downtime = ${record.totalDowntime},
        number_of_repairs = ${record.numberOfRepairs},
        total_operating_time = ${record.totalOperatingTime},
        source_sheet = ${record.sourceSheet},
        import_batch_id = ${record.importBatchId},
        notes = ${record.notes},
        raw_imported_values = ${record.rawImportedValues ? JSON.stringify(record.rawImportedValues) : null}::jsonb
      WHERE id = ${id}
      RETURNING *
    `);
    return c.json({ success: true, record: (((result as any).rows ?? result)[0]) });
  } catch (e: any) {
    console.error("[monthly-kpi] update failed", e);
    return c.json({ error: e?.message ?? "Unable to update Monthly KPI record" }, 500);
  }
});

logBootStage("registering operator-driven maintenance scorecard routes");

function preventOdmResponseCaching(c: Context) {
  c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  c.header("Pragma", "no-cache");
  c.header("Expires", "0");
}

function asOdmNullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function parseOdmInspectionDateParts(record: Record<string, unknown>) {
  const raw =
    asOdmNullableText(record.date) ??
    asOdmNullableText(record.inspection_date) ??
    asOdmNullableText(record.inspectionDate) ??
    asOdmNullableText(record.submitted_at) ??
    asOdmNullableText(record.submittedAt);
  if (!raw) return null;
  const text = raw.trim();
  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    if (Number.isInteger(year) && month >= 1 && month <= 12) return { year, month };
  }
  const usMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    const month = Number(usMatch[1]);
    const year = Number(usMatch[3]);
    if (Number.isInteger(year) && month >= 1 && month <= 12) return { year, month };
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return { year: parsed.getFullYear(), month: parsed.getMonth() + 1 };
}

async function fetchOdmInspectionsForResponse(filters: {
  facilityId?: string | null;
  reportingYear?: number | null;
  reportingMonth?: number | null;
} = {}) {
  const facilityId = asOdmNullableText(filters.facilityId);
  const reportingYear = Number.isInteger(filters.reportingYear) ? filters.reportingYear : null;
  const reportingMonth = Number.isInteger(filters.reportingMonth) ? filters.reportingMonth : null;
  const rows = await getDb().execute(sql`
    SELECT
      id,
      submission_id,
      facility_id,
      inspector,
      inspection_date,
      asset_tag,
      asset_name,
      equipment_type,
      category,
      task,
      capture1_label,
      capture1_response,
      escalation_trigger,
      entry_notes,
      status,
      score,
      findings,
      date,
      submitted_at,
      frequency,
      updated_by,
      updated_at
    FROM mw_inspections
    WHERE (${facilityId}::text IS NULL OR facility_id = ${facilityId})
    ORDER BY date DESC NULLS LAST, submitted_at DESC NULLS LAST, id DESC
  `);
  return rowsFromDb<Record<string, unknown>>(rows).filter(record => {
    if (reportingYear === null && reportingMonth === null) return true;
    const parts = parseOdmInspectionDateParts(record);
    if (!parts) return false;
    if (reportingYear !== null && parts.year !== reportingYear) return false;
    if (reportingMonth !== null && parts.month !== reportingMonth) return false;
    return true;
  });
}

function isOdmDateParam(value: string | null | undefined) {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function fetchOdmDashboardSummaryForResponse(filters: OdmDashboardFilters = {}) {
  const rows = await getDb().execute(sql`
    SELECT
      id,
      submission_id,
      facility_id,
      inspector,
      inspection_date,
      asset_tag,
      asset_name,
      equipment_type,
      category,
      task,
      capture1_label,
      capture1_response,
      escalation_trigger,
      entry_notes,
      status,
      score,
      findings,
      date,
      submitted_at,
      frequency,
      updated_by,
      updated_at
    FROM mw_inspections
    ORDER BY date DESC NULLS LAST, submitted_at DESC NULLS LAST, id DESC
  `);
  const dashboardRows = rowsFromDb<Record<string, unknown>>(rows).map(
    mapInspectionToDashboardRow
  );
  return buildOdmDashboardScorecard(dashboardRows, filters);
}

app.get("/api/operator-driven-maintenance/inspections", async (c) => {
  try {
    preventOdmResponseCaching(c);
    await ensureDbReady();
    const reportingYearParam = c.req.query("reporting_year");
    const reportingMonthParam = c.req.query("reporting_month");
    const reportingYear = reportingYearParam ? Number(reportingYearParam) : null;
    const reportingMonth = reportingMonthParam ? Number(reportingMonthParam) : null;
    if (reportingYearParam && !Number.isInteger(reportingYear)) {
      return c.json({ error: "reporting_year query parameter must be an integer" }, 400);
    }
    if (reportingMonthParam) {
      if (
        reportingMonth === null ||
        !Number.isInteger(reportingMonth) ||
        reportingMonth < 1 ||
        reportingMonth > 12
      ) {
        return c.json({ error: "reporting_month query parameter must be between 1 and 12" }, 400);
      }
    }
    const records = await fetchOdmInspectionsForResponse({
      facilityId: c.req.query("facility_id")?.trim() || null,
      reportingYear,
      reportingMonth,
    });
    return c.json({ records });
  } catch (e: any) {
    console.error("[operator-driven-maintenance] GET inspections failed", e);
    return c.json({ error: e?.message ?? "Unable to fetch Operator-Driven Maintenance inspections" }, 500);
  }
});

app.get("/api/operator-driven-maintenance/summary", async (c) => {
  try {
    preventOdmResponseCaching(c);
    await ensureDbReady();
    const dateFrom = c.req.query("date_from")?.trim() || null;
    const dateTo = c.req.query("date_to")?.trim() || null;
    if (!isOdmDateParam(dateFrom)) {
      return c.json({ error: "date_from query parameter must be YYYY-MM-DD" }, 400);
    }
    if (!isOdmDateParam(dateTo)) {
      return c.json({ error: "date_to query parameter must be YYYY-MM-DD" }, 400);
    }
    const scorecard = await fetchOdmDashboardSummaryForResponse({
      dateFrom,
      dateTo,
      plant:
        c.req.query("facility_id")?.trim() ||
        c.req.query("plant")?.trim() ||
        null,
      equipmentType: c.req.query("equipment_type")?.trim() || null,
      category: c.req.query("category")?.trim() || null,
      inspector: c.req.query("inspector")?.trim() || null,
    });
    return c.json({ ...scorecard, records: scorecard.rows });
  } catch (e: any) {
    console.error("[operator-driven-maintenance] GET summary failed", e);
    return c.json({ error: e?.message ?? "Unable to fetch Operator-Driven Maintenance dashboard summary" }, 500);
  }
});

logBootStage("registering health check routes");

// Health check — tests database connectivity and shows deployment info
app.get("/_health", async (c) => {
  try {
    // Test actual database query
    const db = getDb();
    const result = await db.select({ count: sql`count(*)` }).from(sql`mw_inspections`);
    const dbRecords = result[0]?.count || 0;
    
    return c.json({ 
      status: "ok",
      service: "odm-dashboard",
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        records: dbRecords
      }
    });
  } catch (e: any) {
    return c.json({ 
      status: "degraded",
      service: "odm-dashboard",
      timestamp: new Date().toISOString(),
      database: {
        connected: false,
        error: e.message
      }
    }, 500);
  }
});

app.get("/api/health/db", async (c) => {
  try {
    const db = getDb();
    const rows = await db.execute(sql`SELECT current_database() AS current_database, current_schema() AS current_schema, 1 AS ping`);
    const row = (rows as any).rows?.[0] ?? (Array.isArray(rows) ? rows[0] : rows);
    return c.json({ ok: true, ...row });
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500);
  }
});

function isDuplicateCleanupDbUnavailable(error: unknown): boolean {
  const e = error as { code?: string; message?: string; name?: string } | undefined;
  const message = e?.message?.toLowerCase() ?? "";
  const code = e?.code?.toLowerCase() ?? "";

  return [
    "database_url not set",
    "database",
    "connection",
    "connect",
    "dns",
    "enotfound",
    "econnrefused",
    "econnreset",
    "timeout",
    "terminating connection",
  ].some(term => message.includes(term) || code.includes(term));
}

logBootStage("registering duplicate cleanup dry-run endpoint");
app.post("/api/admin/tasks/duplicate-cleanup/dry-run", async (c) => {
  try {
    const user = await authenticateRequest(c.req.raw.headers);
    if (user.role !== "admin") {
      return c.json({ error: "Admin role required" }, 403);
    }

    const body = await c.req.json().catch(() => ({}));
    const dataset = body?.dataset as "htt" | "aglipay" | undefined;
    if (dataset !== undefined && !["htt", "aglipay"].includes(dataset)) {
      return c.json({ error: "Invalid dataset. Use htt or aglipay." }, 400);
    }

    console.info("[tasks/duplicateCleanup/dry-run] started", {
      requestedBy: user.id,
      dataset: dataset ?? "all",
    });

    const { getDb } = await import("./queries/connection");
    const {
      exportDuplicateCleanupDryRun,
      runMaintenanceDuplicateCleanup,
    } = await import("./tasks-duplicate-cleanup");
    const db = getDb();
    const result = await runMaintenanceDuplicateCleanup(db, {
      dataset,
      dryRun: true,
      apply: false,
    });
    const payload = await exportDuplicateCleanupDryRun(result, {
      dataset,
      csvPath: "reports/task-duplicate-dry-run.csv",
    });

    console.info("[tasks/duplicateCleanup/dry-run] completed", {
      requestedBy: user.id,
      dataset: dataset ?? "all",
      duplicateGroupCount: payload.duplicateGroupCount,
      duplicateRowCount: payload.duplicateRowCount,
      rowsProposedForDeletion: payload.rowsProposedForDeletion.length,
      rowsProposedForRetention: payload.rowsProposedForRetention.length,
      conflictGroups: payload.conflictGroups,
      csvPath: payload.exported.csvPath,
    });

    return c.json(payload);
  } catch (error) {
    const e = error as {
      tag?: string;
      status?: number;
      message?: string;
      stack?: string;
    };
    if (e?.tag === "app_error" && e.status === 403) {
      return c.json({ error: "Authentication required" }, 401);
    }
    if (e?.message === "Missing session" || e?.message === "Invalid session") {
      return c.json({ error: "Authentication required" }, 401);
    }
    if (isDuplicateCleanupDbUnavailable(error)) {
      console.error("[tasks/duplicateCleanup/dry-run] DB error isolated", {
        message: e?.message ?? String(error),
        stack: e?.stack,
      });
      return c.json(
        { error: "Database unavailable. Duplicate cleanup dry-run was not run." },
        503
      );
    }

    console.error("[tasks/duplicateCleanup/dry-run] failed", {
      message: e?.message ?? String(error),
      stack: e?.stack,
    });
    return c.json({ error: e?.message ?? "Duplicate cleanup dry-run failed" }, 500);
  }
});
console.info("[tasks/duplicateCleanup] dry-run endpoint registered");
logBootStage("duplicate cleanup dry-run endpoint registration complete");

logBootStage("registering governance file and debug routes");

async function requireFileRequestUser(c: Context): Promise<Response | null> {
  try {
    await authenticateRequest(c.req.raw.headers);
    return null;
  } catch {
    return c.json({ error: "Authentication required" }, 401);
  }
}


// Debug: list latest uploads
app.get("/api/debug/uploads", async (c) => {
  try {
    const unauthorized = await requireFileRequestUser(c);
    if (unauthorized) return unauthorized;
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT id, facility_slug, milestone_id, file_name, storage_provider, storage_bucket,
             storage_path, storage_size, storage_mime_type, uploaded_at
      FROM governance_uploads
      ORDER BY id DESC
      LIMIT 20
    `);
    return c.json({ count: rows.length, uploads: rows });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ═══ Governance File CRUD (for standalone HTML multi-user sync) ═══

// GET /api/governance/files/:facilitySlug - list files for a facility
app.get("/api/governance/files/:facilitySlug", async (c) => {
  try {
    const unauthorized = await requireFileRequestUser(c);
    if (unauthorized) return unauthorized;
    const facilitySlug = c.req.param("facilitySlug").toLowerCase();
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT id, facility_slug, milestone_id, category, toc_item, file_name,
             storage_provider, storage_bucket, storage_path, storage_size, storage_mime_type,
             uploaded_by, uploaded_at
      FROM governance_uploads
      WHERE facility_slug = ${facilitySlug}
      ORDER BY id DESC
    `);
    return c.json({ files: (rows as unknown as { rows: any[] }).rows || rows });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/governance/files - create a file record
app.post("/api/governance/files", async (c) => {
  try {
    const unauthorized = await requireFileRequestUser(c);
    if (unauthorized) return unauthorized;
    const body = await c.req.json();
    const { facilitySlug, milestoneId, tocItem, filename, fileUrl, fileSize, uploadedAt } = body;
    console.log("[API] POST /api/governance/files body:", JSON.stringify({ facilitySlug, milestoneId, tocItem, filename, fileSize, hasUrl: !!fileUrl }));
    if (!facilitySlug || !filename) {
      console.log("[API] POST files missing fields:", { facilitySlug, milestoneId, filename });
      return c.json({ error: "facilitySlug, filename required" }, 400);
    }
    const decodedFileSize = typeof fileUrl === "string"
      ? getDecodedBase64ByteLength(fileUrl)
      : 0;
    const suppliedFileSize = typeof fileSize === "number" ? fileSize : decodedFileSize;
    if (
      (decodedFileSize !== null && !isUploadFileSizeAllowed(decodedFileSize))
      || (suppliedFileSize !== null && !isUploadFileSizeAllowed(suppliedFileSize))
    ) {
      return c.json({ error: MAX_UPLOAD_ERROR_MESSAGE }, 413);
    }
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const slug = facilitySlug.toLowerCase();
    const mid = milestoneId || "__ref";
    // Single INSERT with RETURNING — replaces 3 round-trips (check + insert + select)
    console.log("[API] POST files inserting:", slug, mid, filename);
    const result = await db.execute(sql`
      INSERT INTO governance_uploads
        (facility_slug, milestone_id, category, toc_item, file_name, file_url, uploaded_at)
      VALUES
        (${slug}, ${mid}, ${tocItem || null}, ${tocItem || null}, ${filename}, ${fileUrl || filename}, ${uploadedAt ? new Date(uploadedAt).toISOString() : new Date().toISOString()})
      RETURNING id, facility_slug, milestone_id, category, toc_item, file_name, file_url, uploaded_at
    `);
    const rows = (result as any).rows || (result as any) || [];
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    console.log("[API] POST files row:", row ? JSON.stringify(row).substring(0,100) : "none");
    if (!row || !row.id) {
      return c.json({ error: "insert returned no row" }, 500);
    }
    return c.json({ id: row.id, file: row, success: true });
  } catch (e: any) {
    console.error("[API] POST files ERROR:", e.message);
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/governance/references - list reference documents (milestone_id = '__ref')
app.get("/api/governance/references", async (c) => {
  try {
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const result = await db.execute(sql`
      SELECT id, facility_slug, milestone_id, category, toc_item, file_name, uploaded_by, uploaded_at,
             storage_path, 'governance_uploads'::text AS source
      FROM governance_uploads
      WHERE milestone_id = '__ref' OR category = 'references'
      ORDER BY uploaded_at DESC
    `);
    const rows = (result as any).rows || (result as any) || [];
    return c.json({ files: rows });
  } catch (e: any) {
    console.error("[API] /references error:", e.message);
    return c.json({ error: e.message, files: [] }, 500);
  }
});

// DELETE /api/governance/files/:id - delete a file from either table
app.delete("/api/governance/files/:id", async (c) => {
  try {
    const unauthorized = await requireFileRequestUser(c);
    if (unauthorized) return unauthorized;
    const id = parseInt(c.req.param("id"));
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const source = c.req.query("source") || "governance_uploads";
    if (source !== "governance_uploads" && source !== "governance_files") {
      return c.json({ error: "Invalid file source" }, 400);
    }
    if (source === "governance_files") {
      const storageCheck = await db.execute(sql`SELECT storage_path FROM governance_files WHERE id = ${id} LIMIT 1`);
      const storageRows = (storageCheck as any).rows || storageCheck;
      if (storageRows[0]?.storage_path) return c.json({ error: "Storage-backed files require verified deletion." }, 409);
      await db.execute(sql`DELETE FROM governance_files WHERE id = ${id}`);
    } else {
      const storageCheck = await db.execute(sql`SELECT storage_path FROM governance_uploads WHERE id = ${id} LIMIT 1`);
      const storageRows = (storageCheck as any).rows || storageCheck;
      if (storageRows[0]?.storage_path) return c.json({ error: "Storage-backed files require verified deletion." }, 409);
      await db.execute(sql`DELETE FROM governance_uploads WHERE id = ${id}`);
    }
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});


// Document view and download routes (public access)
import { createDefaultDocumentsViewRouter } from "./documents-view-router";
const documentsViewRouter = createDefaultDocumentsViewRouter(getDb, getParsedDocumentFile);
app.route("/api/documents/files", documentsViewRouter);

// GET /api/governance/files/:id/view - stream file inline
// Helper: fetch file from either governance_uploads or governance_files table
type GovernanceFileSource = "governance_uploads" | "governance_files";

async function getFileFromEitherTable(db: any, id: number, requestedSource?: GovernanceFileSource) {
  // Try governance_uploads first (REST uploads)
  let rows = requestedSource === "governance_files" ? { rows: [] } : await db.execute(sql`
    SELECT id, file_name, file_url, storage_bucket, storage_path
    FROM governance_uploads WHERE id = ${id} LIMIT 1
  `);
  let fileRows = rows.rows || rows;
  if (fileRows.length > 0) return { ...fileRows[0], source: "governance_uploads" };
  if (requestedSource === "governance_uploads") return null;
  // Fallback to governance_files (tRPC uploads)
  rows = await db.execute(sql`
    SELECT id, file_name, file_data AS file_url, storage_bucket, storage_path
    FROM governance_files WHERE id = ${id} LIMIT 1
  `);
  fileRows = rows.rows || rows;
  return fileRows.length > 0 ? { ...fileRows[0], source: "governance_files" } : null;
}

app.get("/api/governance/files/:id/view", async (c) => {
  try {
    const unauthorized = await requireFileRequestUser(c);
    if (unauthorized) return unauthorized;
    const id = parseInt(c.req.param("id"));
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const requestedSource = c.req.query("source");
    if (requestedSource && requestedSource !== "governance_uploads" && requestedSource !== "governance_files") {
      return c.json({ error: "Invalid file source" }, 400);
    }
    const file = await getFileFromEitherTable(db, id, requestedSource as GovernanceFileSource | undefined);
    if (!file) return c.json({ error: "File not found" }, 404);
    if (file.storage_path) return c.redirect(`/api/storage/files/${file.source}/${id}/view`, 302);
    const fileName = file.file_name || "file";
    const fileUrl = file.file_url || "";
    console.log("[VIEW] id=", id, "name=", fileName, "urlLen=", fileUrl.length, "urlPrefix=", fileUrl.substring(0, 50));
    // Parse data URI: data:<mime>;base64,<data>
    let mimeType = "application/octet-stream";
    let base64Data = "";
    if (fileUrl.startsWith("data:")) {
      const commaIdx = fileUrl.indexOf(",");
      if (commaIdx > -1) {
        const header = fileUrl.slice(0, commaIdx);
        base64Data = fileUrl.slice(commaIdx + 1);
        const semiIdx = header.indexOf(";");
        mimeType = semiIdx > -1 ? header.slice(5, semiIdx) : header.slice(5);
        console.log("[VIEW] data URI header=", header, "mime=", mimeType, "b64len=", base64Data.length);
      } else {
        console.log("[VIEW] data URI has no comma!");
      }
    } else {
      base64Data = fileUrl;
      console.log("[VIEW] not a data URI, raw length=", fileUrl.length);
    }
    // Fallback mime type from file extension
    if (mimeType === "application/octet-stream") {
      const ext = fileName.split(".").pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", txt: "text/plain",
        csv: "text/csv", json: "application/json", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        xls: "application/vnd.ms-excel", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        doc: "application/msword", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ppt: "application/vnd.ms-powerpoint", zip: "application/zip", mp4: "video/mp4", mp3: "audio/mpeg",
      };
      if (ext && mimeMap[ext]) mimeType = mimeMap[ext];
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64Data, "base64");
      console.log("[VIEW] decoded buffer size=", buffer.length);
    } catch (decErr: any) {
      console.error("[VIEW] Base64 decode failed:", decErr.message);
      return c.json({ error: "Invalid file data encoding" }, 500);
    }
    if (buffer.length === 0) {
      console.error("[VIEW] Empty buffer!");
      return c.json({ error: "Empty file data" }, 500);
    }
    // For non-viewable types (docx, xlsx), force download instead
    const isViewable = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/svg+xml", "image/webp", "text/plain", "text/csv"].includes(mimeType);
    const disposition = isViewable ? "inline" : "attachment";
    c.header("Content-Type", mimeType);
    c.header("Content-Disposition", `${disposition}; filename="${fileName}"`);
    c.header("Content-Length", String(buffer.length));
    c.header("Cache-Control", "public, max-age=3600");
    console.log("[VIEW] serving", disposition, "type=", mimeType, "size=", buffer.length);
    return c.body(buffer as any);
  } catch (e: any) {
    console.error("[VIEW] Error:", e.message, e.stack);
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/governance/files/:id/download - stream file as attachment
app.get("/api/governance/files/:id/download", async (c) => {
  try {
    const unauthorized = await requireFileRequestUser(c);
    if (unauthorized) return unauthorized;
    const id = parseInt(c.req.param("id"));
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const requestedSource = c.req.query("source");
    if (requestedSource && requestedSource !== "governance_uploads" && requestedSource !== "governance_files") {
      return c.json({ error: "Invalid file source" }, 400);
    }
    const file = await getFileFromEitherTable(db, id, requestedSource as GovernanceFileSource | undefined);
    if (!file) return c.json({ error: "File not found" }, 404);
    if (file.storage_path) return c.redirect(`/api/storage/files/${file.source}/${id}/download`, 302);
    const fileName = file.file_name || "file";
    const fileUrl = file.file_url || "";
    console.log("[DL] id=", id, "name=", fileName, "urlLen=", fileUrl.length);
    let mimeType = "application/octet-stream";
    let base64Data = "";
    if (fileUrl.startsWith("data:")) {
      const commaIdx = fileUrl.indexOf(",");
      if (commaIdx > -1) {
        const header = fileUrl.slice(0, commaIdx);
        base64Data = fileUrl.slice(commaIdx + 1);
        const semiIdx = header.indexOf(";");
        mimeType = semiIdx > -1 ? header.slice(5, semiIdx) : header.slice(5);
      }
    } else {
      base64Data = fileUrl;
    }
    if (mimeType === "application/octet-stream") {
      const ext = fileName.split(".").pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", txt: "text/plain",
        csv: "text/csv", json: "application/json", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        xls: "application/vnd.ms-excel", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        doc: "application/msword", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ppt: "application/vnd.ms-powerpoint", zip: "application/zip", mp4: "video/mp4", mp3: "audio/mpeg",
      };
      if (ext && mimeMap[ext]) mimeType = mimeMap[ext];
    }
    const buffer = Buffer.from(base64Data, "base64");
    console.log("[DL] mime=", mimeType, "bufSize=", buffer.length);
    c.header("Content-Type", mimeType);
    c.header("Content-Disposition", `attachment; filename="${fileName}"`);
    c.header("Content-Length", String(buffer.length));
    return c.body(buffer as any);
  } catch (e: any) {
    console.error("[DL] Error:", e.message, e.stack);
    return c.json({ error: e.message }, 500);
  }
});

// ═══ Governance Milestone State CRUD (DB-only, no localStorage) ═══

// POST /api/governance/repair-ppp — fix corrupted ppp_date values
app.post("/api/governance/repair-ppp", async (c) => {
  try {
    const body = await c.req.json();
    const { facilitySlug, milestoneId, pppDate } = body;
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    // First clear the corrupted value
    await db.execute(sql`
      UPDATE governance_milestone_state
      SET ppp_date = NULL
      WHERE facility_slug = ${facilitySlug.toLowerCase()} AND milestone_id = ${milestoneId}
    `);
    // Then set the correct value
    if (pppDate) {
      await db.execute(sql`
        UPDATE governance_milestone_state
        SET ppp_date = ${pppDate}
        WHERE facility_slug = ${facilitySlug.toLowerCase()} AND milestone_id = ${milestoneId}
      `);
    }
    // Verify
    const rows = await db.execute(sql`
      SELECT ppp_date FROM governance_milestone_state
      WHERE facility_slug = ${facilitySlug.toLowerCase()} AND milestone_id = ${milestoneId}
    `);
    const r = (rows as any).rows || rows;
    return c.json({ success: true, facility: facilitySlug, milestone: milestoneId, pppDate: Array.isArray(r) && r.length > 0 ? r[0].ppp_date : null });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/governance/ppp-diag/:facilitySlug/:milestoneId — diagnostic: raw DB row
app.get("/api/governance/ppp-diag/:facilitySlug/:milestoneId", async (c) => {
  try {
    const facilitySlug = c.req.param("facilitySlug").toLowerCase();
    const milestoneId = c.req.param("milestoneId");
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT * FROM governance_milestone_state
      WHERE facility_slug = ${facilitySlug} AND milestone_id = ${milestoneId}
    `);
    const r = (rows as any).rows || rows;
    return c.json({ facility: facilitySlug, milestone: milestoneId, count: Array.isArray(r) ? r.length : 0, row: Array.isArray(r) && r.length > 0 ? r[0] : null });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/governance/state/:facilitySlug — returns all milestone states
app.get("/api/governance/state/:facilitySlug", async (c) => {
  try {
    const facilitySlug = c.req.param("facilitySlug").toLowerCase();
    console.log("[LOAD-BE] GET facility=" + facilitySlug);
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    // Raw SQL matching actual migration columns (avoid schema drift)
    const states = await db.execute(sql`
      SELECT id, facility_slug, milestone_id, ppp_date, comp_date, custom_pct, ready_status, remarks, updated_at, updated_by
      FROM governance_milestone_state
      WHERE facility_slug = ${facilitySlug}
    `);
    const stateRows = (states as any).rows || states;
    console.log("[LOAD-BE] Found", Array.isArray(stateRows) ? stateRows.length : 'N/A', "states");
    if (Array.isArray(stateRows) && stateRows.length > 0) {
      stateRows.forEach((r: any, i: number) => {
        console.log(`[LOAD-BE] Row ${i}: mid=${r.milestone_id} ppp_date=${JSON.stringify(r.ppp_date)} comp_date=${JSON.stringify(r.comp_date)}`);
      });
    }
    // Query uploads table — exclude file_url (base64) to keep response small
    const files1 = await db.execute(sql`
      SELECT id, facility_slug, milestone_id, category, toc_item, file_name, uploaded_by, uploaded_at,
             storage_path, 'governance_uploads'::text AS source
      FROM governance_uploads
      WHERE facility_slug = ${facilitySlug} OR facility_slug = 'all'
      ORDER BY id DESC
    `);
    console.log("[API] uploads query raw type:", typeof files1, "isArray:", Array.isArray(files1), "keys:", Object.keys(files1));
    // Handle multiple possible response formats from postgres-js
    let upRows: any[] = [];
    if (Array.isArray(files1)) {
      upRows = files1;
    } else if (files1 && Array.isArray((files1 as any).rows)) {
      upRows = (files1 as any).rows;
    } else if (files1 && typeof files1 === 'object') {
      const f = files1 as any;
      if (f.rows) upRows = f.rows;
      else if (f.length) upRows = f;
    }
    console.log("[API] governance_uploads rows:", upRows.length);
    // ALSO query governance_files — exclude file_data (base64) to keep response small
    const files2 = await db.execute(sql`
      SELECT id, facility_slug, milestone_id, toc_item, file_name, uploaded_by, uploaded_at,
             storage_path, 'governance_files'::text AS source
      FROM governance_files
      WHERE facility_slug = ${facilitySlug}
      ORDER BY id DESC
    `);
    let gfRows: any[] = [];
    if (Array.isArray(files2)) {
      gfRows = files2;
    } else if (files2 && Array.isArray((files2 as any).rows)) {
      gfRows = (files2 as any).rows;
    } else if (files2 && typeof files2 === 'object') {
      const f2 = files2 as any;
      if (f2.rows) gfRows = f2.rows;
      else if (f2.length) gfRows = f2;
    }
    console.log("[API] governance_files rows:", gfRows.length);
    // Merge both sources
    const allFiles = [...upRows, ...gfRows];
    // Separate reference documents (milestone_id = '__ref')
    const refFiles = allFiles.filter((f: any) => f.milestone_id === '__ref' || f.category === 'references');
    const msFiles = allFiles.filter((f: any) => f.milestone_id !== '__ref' && f.category !== 'references');
    console.log("[API] files=" + allFiles.length + " refs=" + refFiles.length + " ms=" + msFiles.length);
    return c.json({
      states: stateRows,
      files: msFiles,
      referenceFiles: refFiles
    });
  } catch (e: any) {
    console.error("[API] GET state ERROR:", e.message, e.stack);
    return c.json({ error: e.message, stack: e.stack }, 500);
  }
});

// Validate YYYY-MM-DD format
function isValidDate(str: unknown): boolean {
  if (!str || typeof str !== 'string') return false;
  if (str === 'undefined' || str === 'null' || str === 'NaN' || str === '' || str === 'undefined-NaN-NaN') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// ═══ DB Cleanup: remove corrupted date values ═══
app.post("/api/governance/cleanup-dates", async (c) => {
  try {
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    // Clear corrupted ppp_date values (MySQL/TiDB compatible regex)
    const ppResult = await db.execute(sql.raw(`
      UPDATE governance_milestone_state
      SET ppp_date = NULL
      WHERE ppp_date IS NOT NULL
        AND ppp_date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    `));
    // Clear corrupted comp_date values
    const cdResult = await db.execute(sql.raw(`
      UPDATE governance_milestone_state
      SET comp_date = NULL
      WHERE comp_date IS NOT NULL
        AND comp_date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    `));
    return c.json({
      success: true,
      pppCleared: (ppResult as any).rowCount || 0,
      compCleared: (cdResult as any).rowCount || 0
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/governance/state/:facilitySlug — save a milestone state
app.post("/api/governance/state/:facilitySlug", async (c) => {
  try {
    const facilitySlug = c.req.param("facilitySlug").toLowerCase();
    const body = await c.req.json();
    console.log('[SAVE-BE] facility='+facilitySlug+' body:',JSON.stringify(body));
    const { milestoneId, compDate, customPct, pppDate, readyStatus, remarks } = body;
    if (!milestoneId) return c.json({ error: "milestoneId required" }, 400);
    // Manual status override whitelist: only approved values or null (Auto).
    // Arbitrary strings are rejected server-side.
    if (readyStatus !== undefined && readyStatus !== null && !isValidManualStatus(readyStatus)) {
      console.warn('[SAVE-BE] REJECTED invalid readyStatus:', JSON.stringify(readyStatus));
      return c.json({ error: "Invalid readyStatus. Allowed: achieved, in_progress, planned_open, upcoming, null." }, 400);
    }
    // Sanitize date inputs — reject garbage strings like "undefined"
    const sanitizedPP = pppDate !== undefined
      ? (isValidDate(pppDate) ? pppDate : (pppDate === null ? null : undefined))
      : undefined;
    const sanitizedCD = compDate !== undefined
      ? (isValidDate(compDate) ? compDate : (compDate === null ? null : undefined))
      : undefined;
    console.log('[SAVE-BE] sanitizedPP:',sanitizedPP,'sanitizedCD:',sanitizedCD);
    if (pppDate !== undefined && sanitizedPP === undefined && pppDate !== null) {
      console.warn('[SAVE-BE] REJECTED invalid pppDate:', JSON.stringify(pppDate));
    }
    if (compDate !== undefined && sanitizedCD === undefined && compDate !== null) {
      console.warn('[SAVE-BE] REJECTED invalid compDate:', JSON.stringify(compDate));
    }
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const now = new Date().toISOString();
    // Check for existing
    const existing = await db.execute(sql`
      SELECT id, ppp_date, comp_date FROM governance_milestone_state
      WHERE facility_slug = ${facilitySlug} AND milestone_id = ${milestoneId}
      LIMIT 1
    `);
    const existingRows = (existing as unknown as { rows: any[] }).rows || existing;
    console.log('[SAVE-BE] existing rows:',existingRows.length);
    if (existingRows.length > 0) {
      console.log('[SAVE-BE] existing row before:',JSON.stringify(existingRows[0]));
      // Update — only touch fields that were explicitly sent
      const setParts: string[] = [`updated_at = '${now}'`];
      if (sanitizedCD !== undefined) setParts.push("comp_date = " + (sanitizedCD === null ? 'NULL' : "'" + sanitizedCD + "'"));
      if (sanitizedPP !== undefined) setParts.push("ppp_date = " + (sanitizedPP === null ? 'NULL' : "'" + sanitizedPP + "'"));
      if (customPct !== undefined) setParts.push("custom_pct = " + customPct);
      if (readyStatus !== undefined) setParts.push("ready_status = " + (readyStatus === null ? 'NULL' : "'" + readyStatus + "'"));
      if (remarks !== undefined) setParts.push("remarks = " + (remarks === null ? 'NULL' : "'" + remarks + "'"));
      const updateSQL = `UPDATE governance_milestone_state SET ${setParts.join(', ')} WHERE facility_slug = '${facilitySlug}' AND milestone_id = '${milestoneId}'`;
      console.log('[SAVE-BE] UPDATE SQL:',updateSQL);
      await db.execute(sql.raw(updateSQL));
      // Verify
      const verify = await db.execute(sql`
        SELECT ppp_date, comp_date FROM governance_milestone_state
        WHERE facility_slug = ${facilitySlug} AND milestone_id = ${milestoneId}
      `);
      const vRows = (verify as unknown as { rows: any[] }).rows || verify;
      console.log('[SAVE-BE] row after UPDATE:',JSON.stringify(vRows[0]));
    } else {
      // Insert — use provided values or NULL
      console.log('[SAVE-BE] INSERT: pp='+sanitizedPP+' cd='+sanitizedCD);
      await db.execute(sql`
        INSERT INTO governance_milestone_state
          (facility_slug, milestone_id, comp_date, custom_pct, ppp_date, ready_status, updated_at)
        VALUES
          (${facilitySlug}, ${milestoneId}, ${sanitizedCD !== undefined ? sanitizedCD : null}, ${customPct !== undefined ? customPct : null}, ${sanitizedPP !== undefined ? sanitizedPP : null}, ${readyStatus !== undefined ? readyStatus : null}, ${now})
      `);
      // Verify
      const verify = await db.execute(sql`
        SELECT ppp_date, comp_date FROM governance_milestone_state
        WHERE facility_slug = ${facilitySlug} AND milestone_id = ${milestoneId}
      `);
      const vRows = (verify as unknown as { rows: any[] }).rows || verify;
      console.log('[SAVE-BE] row after INSERT:',JSON.stringify(vRows[0]));
    }
    return c.json({ success: true, milestoneId, savedPP: sanitizedPP, savedCD: sanitizedCD });
  } catch (e: any) {
    console.error('[SAVE-BE] ERROR:', e.message);
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/governance/presentation-data - fetch data for presentation generator
app.get("/api/governance/presentation-data", async (c) => {
  try {
    const reportingDateParam = c.req.query("reporting_date");
    const reportingDateStr = reportingDateParam || new Date().toISOString().split("T")[0];
    const reportingDate = new Date(`${reportingDateStr}T00:00:00Z`);
    
    console.log("[GOV-PRESENTATION] Fetching data for", reportingDateStr);
    
    const { fetchGovernanceDataForPresentation } = await import("../src/modules/presentation-center/governanceData.server");
    const { facilities, summary } = await fetchGovernanceDataForPresentation(reportingDate);
    
    console.log(`[GOV-PRESENTATION] Found ${facilities.length} facilities`);
    
    return c.json({
      reportingDate: reportingDateStr,
      facilities,
      summary,
    });
  } catch (e: any) {
    console.error("[GOV-PRESENTATION] ERROR:", e.message);
    return c.json({ error: e.message }, 500);
  }
});



// GET /api/governance/presentation-v3-data - fetch V3 presentation model data (JSON)
app.get("/api/governance/presentation-v3", async (c) => {
  try {
    const reportingDateParam = c.req.query("reporting_date");
    const reportingDateStr = reportingDateParam || new Date().toISOString().split("T")[0];
    const reportingDate = new Date(`${reportingDateStr}T00:00:00Z`);
    
    console.log("[GOV-PRESENTATION-V3] Fetching data for", reportingDateStr);
    
    const { fetchGovernanceV3Data } = await import("../src/modules/governance-v3/adapter.server");
    const data = await fetchGovernanceV3Data(reportingDate);
    
    console.log(`[GOV-PRESENTATION-V3] Generated presentation with ${data.facilities.length} facilities`);
    
    return c.json(data);
  } catch (e: any) {
    console.error("[GOV-PRESENTATION-V3] ERROR:", e.message);
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/governance/presentation-v3/generate - generate and return the V3 PPTX
app.get("/api/governance/presentation-v3/generate", async (c) => {
  try {
    const reportingDateParam = c.req.query("reporting_date");
    const reportingDateStr = reportingDateParam || new Date().toISOString().split("T")[0];
    const reportingDate = new Date(`${reportingDateStr}T00:00:00Z`);

    console.log("[GOV-PRESENTATION-V3-GENERATE] Generating deck for", reportingDateStr);

    const { fetchGovernanceV3Data } = await import("../src/modules/governance-v3/adapter.server");
    const { generateGovernanceV3Presentation } = await import("../src/modules/governance-v3/templateGenerator");

    const data = await fetchGovernanceV3Data(reportingDate);
    const blob = await generateGovernanceV3Presentation(data);
    const arrayBuffer = await blob.arrayBuffer();

    const filename = `O&M Governance Onboarding Progress - ${data.reportingDate}.pptx`;

    console.log(`[GOV-PRESENTATION-V3-GENERATE] Rendered ${blob.size} byte PPTX`);

    return c.body(arrayBuffer, 200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
    });
  } catch (e: any) {
    console.error("[GOV-PRESENTATION-V3-GENERATE] ERROR:", e.message);
    return c.json({ error: e.message }, 500);
  }
});


// GET /api/monthly-kpi/presentation/generate - generate and return the Monthly KPI scorecard PPTX
app.get("/api/monthly-kpi/presentation/generate", async (c) => {
  try {
    const reportingYearParam = c.req.query("reporting_year");
    const reportingMonthParam = c.req.query("reporting_month");
    const businessUnitParam = c.req.query("business_unit");

    const reportingYear = reportingYearParam ? Number(reportingYearParam) : new Date().getFullYear();
    const reportingMonth = reportingMonthParam ? Number(reportingMonthParam) : new Date().getMonth() + 1;

    if (!Number.isInteger(reportingYear) || !Number.isInteger(reportingMonth) || reportingMonth < 1 || reportingMonth > 12) {
      return c.json({ error: "reporting_year and a valid reporting_month (1-12) are required" }, 400);
    }

    console.log("[MONTHLY-KPI-PRESENTATION-GENERATE] Generating deck for", reportingYear, reportingMonth);

    const { fetchMonthlyKpiPresentationData } = await import("../src/modules/monthly-kpi/adapter.server");
    const { generateMonthlyKpiPresentation } = await import("../src/modules/monthly-kpi/templateGenerator");

    const data = await fetchMonthlyKpiPresentationData(reportingYear, reportingMonth, businessUnitParam);
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();

    const filename = `Monthly KPI Executive Scorecard - ${data.reportingMonthLabel}.pptx`;

    console.log(`[MONTHLY-KPI-PRESENTATION-GENERATE] Rendered ${blob.size} byte PPTX`);

    return c.body(arrayBuffer, 200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
    });
  } catch (e: any) {
    console.error("[MONTHLY-KPI-PRESENTATION-GENERATE] ERROR:", e.message);
    return c.json({ error: e.message }, 500);
  }
});
logBootStage("registering presentation files routes");
app.route("/api/presentation-files", presentationFilesRouter);

logBootStage("registering tRPC and API fallback routes");

/* CORS for tRPC — production origin and local dev */
app.use("/api/trpc/*", cors({
  origin: ["https://dashboard.onrender.com", "http://localhost:3000", "http://localhost:5173"],
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "x-trpc-source"],
  credentials: true,
}));

app.use("/api/trpc/*", async (c) => {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });

  if (c.req.path.includes("tasks.import")) {
    const rawBody = await response.clone().text();
    console.info("[tasks/import] backend raw response body", {
      path: c.req.path,
      status: response.status,
      rawBody,
    });
  }

  return response;
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  logBootStage("production startup branch entered");

  // Import production startup helper
  const { executeProductionStartup } = await import("./production-startup");
  logBootStage("importing @hono/node-server");
  const { serve } = await import("@hono/node-server");

  // Startup verification — log dist path before serving
  logBootStage("static asset verification start");
  const dp = distPath || findDistPublic();
  console.log("[BOOT] import.meta.dirname:", import.meta.dirname);
  console.log("[BOOT] process.cwd():", process.cwd());
  console.log("[BOOT] Resolved distPath:", dp);
  console.log("[BOOT] index.html exists:", dp ? fs.existsSync(path.join(dp, "index.html")) : false);
  if (dp && fs.existsSync(path.join(dp, "assets"))) {
    console.log("[BOOT] asset files:", fs.readdirSync(path.join(dp, "assets")).join(", "));
  }
  logBootStage("static asset verification finish");

  // Debug endpoint - MUST be before serveStaticFiles
  app.get("/_debug/static", (c) => {
    return c.json({
      distPath: dp,
      cwd: process.cwd(),
      dirname: import.meta.dirname,
      indexExists: dp ? fs.existsSync(path.join(dp, "index.html")) : false,
      assetsExists: dp ? fs.existsSync(path.join(dp, "assets")) : false,
      assetsFiles: dp && fs.existsSync(path.join(dp, "assets"))
        ? fs.readdirSync(path.join(dp, "assets")).slice(0, 10)
        : [],
    });
  });

// ═══ AI INSIGHTS: Analyze governance data for a facility ═══
app.post("/api/governance/ai-insights", async (c) => {
  try {
    const { facilitySlug, allStates } = await c.req.json();
    if (!facilitySlug || !allStates) {
      return c.json({ error: "facilitySlug and allStates required" }, 400);
    }
    const { analyzeGovernance } = await import("./governance-ai");
    const state = allStates[facilitySlug] || { pp: "", ms: {}, up: {} };
    const insights = analyzeGovernance(facilitySlug, state, allStates);
    return c.json({ success: true, insights });
  } catch (e: any) {
    console.error("[AI-INSIGHTS] Error:", e.message);
    return c.json({ error: e.message }, 500);
  }
});

// ═══ AI CHAT: Answer governance questions ═══
app.post("/api/governance/ai-chat", async (c) => {
  try {
    const { question, facilitySlug, allStates } = await c.req.json();
    if (!question) return c.json({ error: "question required" }, 400);

    const { analyzeGovernance, chatWithAI } = await import("./governance-ai");
    const slug = facilitySlug || Object.keys(allStates || {})[0] || "default";
    const state = allStates?.[slug] || { pp: "", ms: {}, up: {} };
    const insights = analyzeGovernance(slug, state, allStates || {});
    const response = chatWithAI(question, insights);
    return c.json({ success: true, response });
  } catch (e: any) {
    console.error("[AI-CHAT] Error:", e.message);
    return c.json({ error: e.message }, 500);
  }
});

// ═══ AI SUMMARY: Quick cross-facility overview ═══
app.post("/api/governance/ai-summary", async (c) => {
  try {
    const { allStates } = await c.req.json();
    if (!allStates) return c.json({ error: "allStates required" }, 400);

    const { analyzeGovernance } = await import("./governance-ai");
    const facilities = Object.keys(allStates);
    const results = facilities.map((slug) => {
      const insights = analyzeGovernance(slug, allStates[slug], allStates);
      return {
        slug,
        readiness: insights.overallReadiness,
        risk: insights.riskLevel,
        completed: insights.milestoneAnalysis.filter((m: any) => m.completed).length,
        total: insights.milestoneAnalysis.length,
        hasPPP: insights.hasPPP,
      };
    });

    const avgReadiness = results.length > 0
      ? Math.round(results.reduce((s, r) => s + r.readiness, 0) / results.length)
      : 0;
    const criticalCount = results.filter((r) => r.risk === "CRITICAL").length;
    const readyCount = results.filter((r) => r.readiness >= 80).length;

    return c.json({
      success: true,
      summary: {
        totalFacilities: facilities.length,
        avgReadiness,
        criticalCount,
        readyCount,
        facilities: results,
      },
    });
  } catch (e: any) {
    console.error("[AI-SUMMARY] Error:", e.message);
    return c.json({ error: e.message }, 500);
  }
});

  logBootStage("importing static file server");
  const { serveStaticFiles } = await import("./lib/vite");
  logBootStage("registering static file server");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000", 10);
  const host = process.env.HOST || "0.0.0.0";


  // Fail fast if the preview-token signing secret is not configured in production.
  try {
    assertPreviewSecretConfigured();
  } catch (err) {
    logBootError("preview-token secret preflight failed", err);
    process.exit(1);
  }

  const startupDeps = {
    ensureDatabaseReady: async () => {
      await withTimeoutDiagnostics(
        "database migration/startup verification",
        ensureDbReady(),
        BOOT_MIGRATION_TIMEOUT_MS
      );
    },
    verifyDatabase: async () => {
      await getDb().execute(sql`SELECT 1 FROM gantt_projects LIMIT 1`);
    },
    startListener: async () => {
      serve({ fetch: app.fetch, port, hostname: host }, () => {
        logBootStage("listen callback executed", { port, host });
        console.log(`Server listening on: ${host}:${port}`);
        console.log(`Server running on http://${host}:${port}/`);
        console.log(`[BOOT] Static files served from: ${dp}`);
        console.log(`[BOOT] Health check: http://${host}:${port}/_health`);
      });
    },
  };

  // Execute production startup: migration, verification, then listen
  try {
    await executeProductionStartup(startupDeps);
  } catch (error) {
    logBootError("migration/startup verification failed", error);
    // Exit without starting the server; Render will mark deployment as failed
    process.exit(1);
  }
}

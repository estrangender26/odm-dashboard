import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

// Set the DB connection BEFORE the router module graph is imported.
const TEST_DB_NAME = "pwp_test";
const TEST_DB_URL = `postgresql://postgres:postgres@localhost:5433/${TEST_DB_NAME}?sslmode=disable`;
vi.hoisted(() => {
  process.env.DATABASE_URL_TEST =
    "postgresql://postgres:postgres@localhost:5433/pwp_test?sslmode=disable";
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  process.env.DATABASE_SSL_MODE = "disable";
  process.env.APP_ID = "pwp-test-app";
  process.env.APP_SECRET = "pwp-test-secret-at-least-32-characters-long!!";
});

const { appRouter } = await import("./router");
const { runProjectsWithoutPPPBootstrap } = await import("./projects-without-ppp-bootstrap");
const { db } = await import("./queries/connection");
const { projectsWithoutPPP, projectWithoutPPPFiles } = await import("@db/schema");
const { PROJECTS_WITHOUT_PPP_FIXTURE } = await import("@db/fixtures/projects-without-ppp");
const { storageRouter } = await import("./storage-router");
const { eq } = await import("drizzle-orm");

// Mirror the end state of migration 0031 (CREATE + ADD COLUMN, all idempotent).
const FINAL_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS public.projects_without_ppp (
  id serial PRIMARY KEY,
  tracking_id varchar(50) NOT NULL UNIQUE,
  ps_code varchar(50) NOT NULL,
  coding_mask varchar(50),
  project_phase varchar(50) NOT NULL,
  latest_milestone varchar(50),
  sub_phase varchar(50),
  pm_headline varchar(255),
  project_name varchar(255),
  work_package varchar(500),
  contract_package varchar(500),
  contractor varchar(255),
  major_project_tag varchar(100),
  construction_manager varchar(255),
  project_manager varchar(255),
  with_ls_ps boolean NOT NULL DEFAULT false,
  amd_grid_head varchar(255),
  submitted_by varchar(255),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pwp_tracking_id_idx ON public.projects_without_ppp (tracking_id);
CREATE INDEX IF NOT EXISTS pwp_ps_code_idx ON public.projects_without_ppp (ps_code);
CREATE INDEX IF NOT EXISTS pwp_phase_idx ON public.projects_without_ppp (project_phase);
CREATE INDEX IF NOT EXISTS pwp_tag_idx ON public.projects_without_ppp (major_project_tag);
CREATE TABLE IF NOT EXISTS public.project_without_ppp_files (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES public.projects_without_ppp(id) ON DELETE CASCADE,
  file_name varchar(255) NOT NULL,
  file_type varchar(100),
  file_size integer,
  file_data text,
  uploaded_by varchar(255),
  uploaded_at timestamp DEFAULT now(),
  submitted_at timestamp DEFAULT now(),
  superseded_at timestamp,
  storage_provider varchar(32),
  storage_bucket varchar(100),
  storage_path text,
  storage_size bigint,
  storage_mime_type varchar(255),
  storage_etag text,
  storage_uploaded_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS pwp_files_project_idx ON public.project_without_ppp_files (project_id);
CREATE INDEX IF NOT EXISTS pwp_files_current_idx ON public.project_without_ppp_files (project_id, superseded_at);
`;

async function probeLocalPostgres(): Promise<boolean> {
  try {
    const admin = postgres(
      "postgresql://postgres:postgres@localhost:5433/postgres?sslmode=disable",
      { ssl: false, prepare: false, max: 1, connect_timeout: 2 },
    );
    await admin`SELECT 1`;
    await admin.unsafe(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}"`);
    await admin.unsafe(`CREATE DATABASE "${TEST_DB_NAME}"`);
    await admin.end();
    return true;
  } catch {
    return false;
  }
}

const localDbAvailable = await probeLocalPostgres();

function makeCaller(user?: { id: number; name: string; role: string }) {
  return appRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  } as never);
}

const userCaller = makeCaller({ id: 1, name: "Test User", role: "user" });
const adminCaller = makeCaller({ id: 1, name: "Test Admin", role: "admin" });
const anonymousCaller = makeCaller(undefined);

async function resetDatabase() {
  const client = postgres(TEST_DB_URL, { ssl: false, prepare: false, max: 1 });
  try {
    await client.unsafe(`
      DROP TABLE IF EXISTS public.project_without_ppp_files CASCADE;
      DROP TABLE IF EXISTS public.projects_without_ppp CASCADE;
    `);
    await client.unsafe(FINAL_SCHEMA_DDL);
  } finally {
    await client.end();
  }
}

const t = describe.skipIf(!localDbAvailable);

t("projectsWithoutPPP router + bootstrap (integration)", () => {
  beforeAll(async () => {
    if (!localDbAvailable) return;
    await resetDatabase();
  });

  afterAll(async () => {
    // Leave the disposable database clean for other test files.
    await resetDatabase();
  });

  it("bootstrap dry-run on an empty database reports 50 expected inserts", async () => {
    const report = await runProjectsWithoutPPPBootstrap(db, { dryRun: true });
    expect(report.mode).toBe("dry-run");
    expect(report.expectedSourceRecords).toBe(50);
    expect(report.valid).toBe(50);
    expect(report.invalid).toBe(0);
    expect(report.duplicateTrackingIds).toEqual([]);
    expect(report.inserts).toBe(50);
    expect(report.updates).toBe(0);
    expect(report.unchanged).toBe(0);

    const count = await db.select({ n: projectsWithoutPPP.id }).from(projectsWithoutPPP);
    expect(count.length).toBe(0); // dry-run must not write
  });

  it("bootstrap defaults to dry-run — bare invocation must not mutate", async () => {
    const report = await runProjectsWithoutPPPBootstrap(db); // no options
    expect(report.mode).toBe("dry-run");
    expect(report.inserts).toBe(50);
    const count = await db.select({ id: projectsWithoutPPP.id }).from(projectsWithoutPPP);
    expect(count.length).toBe(0); // nothing written without explicit apply
  });

  it("bootstrap apply is transactional — a mid-apply failure rolls back everything", async () => {
    // Force the LAST fixture record's insert to fail so the transaction must
    // roll back all 50 inserts, leaving no partial population.
    const client = postgres(TEST_DB_URL, { ssl: false, prepare: false, max: 1 });
    try {
      await client.unsafe(`
        CREATE OR REPLACE FUNCTION pwp_reject_last() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'simulated mid-apply failure';
        END $$ LANGUAGE plpgsql;
        CREATE TRIGGER pwp_reject_last_trigger
        BEFORE INSERT ON public.projects_without_ppp
        FOR EACH ROW
        WHEN (NEW.tracking_id = 'RR18-0870-01-01')
        EXECUTE FUNCTION pwp_reject_last();
      `);
    } finally {
      await client.end();
    }

    try {
      // postgres-js wraps the SQL error; the trigger message lives on the cause.
      await runProjectsWithoutPPPBootstrap(db, { dryRun: false }).then(
        () => {
          throw new Error("expected the simulated mid-apply failure to abort the apply");
        },
        (error: unknown) => {
          const e = error as { message?: string; cause?: { message?: string } };
          const messages = [e?.message, e?.cause?.message, String(error)].join(" ");
          expect(messages).toMatch(/simulated mid-apply failure/);
        },
      );
    } finally {
      const client2 = postgres(TEST_DB_URL, { ssl: false, prepare: false, max: 1 });
      try {
        await client2.unsafe(`
          DROP TRIGGER IF EXISTS pwp_reject_last_trigger ON public.projects_without_ppp;
          DROP FUNCTION IF EXISTS pwp_reject_last();
        `);
      } finally {
        await client2.end();
      }
    }

    const count = await db.select({ id: projectsWithoutPPP.id }).from(projectsWithoutPPP);
    expect(count.length).toBe(0); // no partial population after rollback

    // Restore the empty baseline so the following apply test starts fresh.
    await resetDatabase();
  });

  it("bootstrap apply populates exactly 50 projects", async () => {
    const report = await runProjectsWithoutPPPBootstrap(db, { dryRun: false });
    expect(report.mode).toBe("apply");
    expect(report.inserts).toBe(50);
    const count = await db.select({ id: projectsWithoutPPP.id }).from(projectsWithoutPPP);
    expect(count.length).toBe(50);
  });

  it("repeated bootstrap is idempotent", async () => {
    const again = await runProjectsWithoutPPPBootstrap(db, { dryRun: false });
    expect(again.inserts).toBe(0);
    expect(again.updates).toBe(0);
    expect(again.unchanged).toBe(50);
    const count = await db.select({ id: projectsWithoutPPP.id }).from(projectsWithoutPPP);
    expect(count.length).toBe(50);
  });

  it("initial dashboard: 50 projects | 0 submitted | 50 not submitted | 0%", async () => {
    const dashboard = await userCaller.projectsWithoutPPP.dashboard();
    expect(dashboard.kpis).toMatchObject({
      totalProjects: 50,
      submitted: 0,
      notSubmitted: 50,
      submissionRate: 0,
      totalFiles: 0,
    });
    expect(dashboard.items).toHaveLength(50);
    expect(dashboard.items.every((r) => r.status === "not_submitted")).toBe(true);
  });

  it("CRITICAL ACCEPTANCE: upload Excel to RR18-0616-01-01 -> 50 | 1 | 49 | 2%", async () => {
    const project = await dashboardRow("RR18-0616-01-01");
    const fileData = Buffer.from("fake xlsx content").toString("base64");
    const attached = await userCaller.projectsWithoutPPP.attachMasterdataFile({
      projectId: project.id,
      fileName: "masterdata.xlsx",
      fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileSize: Buffer.from("fake xlsx content").length,
      fileData,
    });
    expect(attached.fileId).toBeGreaterThan(0);

    const dashboard = await userCaller.projectsWithoutPPP.dashboard();
    expect(dashboard.kpis).toMatchObject({
      totalProjects: 50,
      submitted: 1,
      notSubmitted: 49,
      submissionRate: 2,
      totalFiles: 1,
    });

    const row = dashboard.items.find((r) => r.trackingId === "RR18-0616-01-01");
    expect(row?.status).toBe("submitted");
    expect(row?.fileCount).toBe(1);
    expect(row?.latestSubmission?.fileName).toBe("masterdata.xlsx");
    expect(row?.latestSubmission?.submittedBy).toBe("Test User");
  });

  it("selected project detail shows Submitted and the file is downloadable", async () => {
    const project = await dashboardRow("RR18-0616-01-01");
    const detail = await userCaller.projectsWithoutPPP.detail({ id: project.id });
    expect(detail?.status).toBe("submitted");
    expect(detail?.files).toHaveLength(1);
    expect(detail?.files[0].fileName).toBe("masterdata.xlsx");
    expect(detail?.files[0].current).toBe(true);

    // The fallback file (base64 file_data) must be downloadable through the
    // storage file endpoint (legacy content path — no Supabase needed).
    const fileId = detail!.files[0].id;
    const response = await storageRouter.request(
      `/files/project_without_ppp_files/${fileId}/download`,
      { headers: { host: "localhost" } },
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe("fake xlsx content");
  });

  it("uploading a second file to the SAME project keeps 1 Submitted but file count = 2", async () => {
    const project = await dashboardRow("RR18-0616-01-01");
    await userCaller.projectsWithoutPPP.attachMasterdataFile({
      projectId: project.id,
      fileName: "supplement.pdf",
      fileType: "application/pdf",
      fileSize: 6,
      fileData: Buffer.from("pdfdoc").toString("base64"),
    });

    const dashboard = await userCaller.projectsWithoutPPP.dashboard();
    expect(dashboard.kpis.submitted).toBe(1); // KPI counts projects, not files
    expect(dashboard.kpis.notSubmitted).toBe(49);
    expect(dashboard.kpis.submissionRate).toBe(2);
    const row = dashboard.items.find((r) => r.trackingId === "RR18-0616-01-01");
    expect(row?.fileCount).toBe(2);
  });

  it("dashboard KPIs count projects, not uploaded files (still 1 submitted of 50)", async () => {
    const dashboard = await userCaller.projectsWithoutPPP.dashboard();
    expect(dashboard.kpis).toMatchObject({
      totalProjects: 50,
      submitted: 1,
      notSubmitted: 49,
      submissionRate: 2,
      totalFiles: 2,
    });
  });

  it("safe superseding derives status back to Not Submitted", async () => {
    const project = await dashboardRow("RR18-0616-01-01");
    const files = (await userCaller.projectsWithoutPPP.detail({ id: project.id }))!.files;

    // Supersede the PDF: project must remain Submitted (one current file left).
    const pdfFile = files.find((f) => f.fileName === "supplement.pdf")!;
    const afterFirst = await adminCaller.projectsWithoutPPP.supersedeMasterdataFile({ fileId: pdfFile.id });
    expect(afterFirst.status).toBe("submitted");

    // Supersede the Excel: no current file remains -> Not Submitted.
    const xlsxFile = files.find((f) => f.fileName === "masterdata.xlsx")!;
    const afterSecond = await adminCaller.projectsWithoutPPP.supersedeMasterdataFile({ fileId: xlsxFile.id });
    expect(afterSecond.status).toBe("not_submitted");

    const dashboard = await userCaller.projectsWithoutPPP.dashboard();
    expect(dashboard.kpis).toMatchObject({ submitted: 0, notSubmitted: 50, submissionRate: 0 });

    // History is preserved: files still listed but no longer current.
    const detail = await userCaller.projectsWithoutPPP.detail({ id: project.id });
    expect(detail?.files).toHaveLength(2);
    expect(detail?.files.every((f) => !f.current)).toBe(true);
  });

  it("reference-data update through bootstrap does not delete submission history", async () => {
    // Give the fixture a changed reference value and re-run the bootstrap.
    const project = await dashboardRow("RR18-0616-01-01");
    const original = PROJECTS_WITHOUT_PPP_FIXTURE.find((r) => r.trackingId === "RR18-0616-01-01")!;

    const client = postgres(TEST_DB_URL, { ssl: false, prepare: false, max: 1 });
    try {
      await client.unsafe(
        `UPDATE public.projects_without_ppp SET ps_code = 'CHANGED' WHERE tracking_id = 'RR18-0616-01-01'`,
      );
    } finally {
      await client.end();
    }
    void original;

    const report = await runProjectsWithoutPPPBootstrap(db, { dryRun: false });
    expect(report.updates).toBe(1);
    expect(report.inserts).toBe(0);

    const files = await db
      .select({ id: projectWithoutPPPFiles.id })
      .from(projectWithoutPPPFiles)
      .where(eq(projectWithoutPPPFiles.projectId, project.id));
    expect(files.length).toBe(2); // submission history untouched

    // Restore the fixture value so later assertions are unaffected.
    const client2 = postgres(TEST_DB_URL, { ssl: false, prepare: false, max: 1 });
    try {
      await client2.unsafe(
        `UPDATE public.projects_without_ppp SET ps_code = '${original.psCode}' WHERE tracking_id = 'RR18-0616-01-01'`,
      );
    } finally {
      await client2.end();
    }
  });

  it("uploads require authentication", async () => {
    await expect(
      anonymousCaller.projectsWithoutPPP.attachMasterdataFile({
        projectId: 1,
        fileName: "x.xlsx",
        fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileSize: 1,
        fileData: Buffer.from("x").toString("base64"),
      }),
    ).rejects.toThrow(/Authentication required/i);
  });

  it("rejects unrelated file types and oversized files", async () => {
    const project = await dashboardRow("RR23-0047-03-04");

    await expect(
      userCaller.projectsWithoutPPP.attachMasterdataFile({
        projectId: project.id,
        fileName: "evil.exe",
        fileType: "application/octet-stream",
        fileSize: 1024,
        fileData: Buffer.from("MZ").toString("base64"),
      }),
    ).rejects.toThrow(/extension is not allowed/);

    await expect(
      userCaller.projectsWithoutPPP.attachMasterdataFile({
        projectId: project.id,
        fileName: "big.pdf",
        fileType: "application/pdf",
        fileSize: 157_286_401,
        fileData: Buffer.alloc(1).toString("base64"),
      }),
    ).rejects.toThrow(/150 MB/);
  });

  it("rejects malformed base64 fallback content (strict decode)", async () => {
    const project = await dashboardRow("RR23-0047-03-04");
    await expect(
      userCaller.projectsWithoutPPP.attachMasterdataFile({
        projectId: project.id,
        fileName: "masterdata.pdf",
        fileType: "application/pdf",
        fileSize: 8,
        fileData: "!!!not-base64-at-all!!!",
      }),
    ).rejects.toThrow(/not valid base64/i);
  });

  it("rejects valid base64 whose decoded size does not match the declared size", async () => {
    const project = await dashboardRow("RR23-0047-03-04");
    const payload = Buffer.from("0123456789").toString("base64"); // 10 bytes
    await expect(
      userCaller.projectsWithoutPPP.attachMasterdataFile({
        projectId: project.id,
        fileName: "masterdata.xlsx",
        fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileSize: 999, // wrong declared size
        fileData: payload,
      }),
    ).rejects.toThrow(/size does not match/i);
  });

  it("accepts valid base64 with a matching declared size", async () => {
    const project = await dashboardRow("RR23-0047-03-04");
    const payload = Buffer.from("masterdata-content-123").toString("base64");
    const attached = await userCaller.projectsWithoutPPP.attachMasterdataFile({
      projectId: project.id,
      fileName: "supplement.pdf",
      fileType: "application/pdf",
      fileSize: Buffer.from("masterdata-content-123").length,
      fileData: payload,
    });
    expect(attached.fileId).toBeGreaterThan(0);
    // Cleanup: remove the just-attached evidence so later assertions are stable.
    await db
      .delete(projectWithoutPPPFiles)
      .where(eq(projectWithoutPPPFiles.id, attached.fileId));
  });

  it("supersede is admin-only (normal users forbidden)", async () => {
    const project = await dashboardRow("RR18-0616-01-01");
    const detail = await userCaller.projectsWithoutPPP.detail({ id: project.id });
    const file = detail!.files[0];
    await expect(
      userCaller.projectsWithoutPPP.supersedeMasterdataFile({ fileId: file.id }),
    ).rejects.toThrow(/Insufficient permissions/i);
  });

  it("anonymous supersede remains rejected (public upload does not grant supersede)", async () => {
    const project = await dashboardRow("RR18-0616-01-01");
    const detail = await userCaller.projectsWithoutPPP.detail({ id: project.id });
    const file = detail!.files[0];
    await expect(
      anonymousCaller.projectsWithoutPPP.supersedeMasterdataFile({ fileId: file.id }),
    ).rejects.toThrow(/Authentication required/i);
  });
});

async function dashboardRow(trackingId: string) {
  const dashboard = await userCaller.projectsWithoutPPP.dashboard();
  const row = dashboard.items.find((r) => r.trackingId === trackingId);
  if (!row) throw new Error(`project ${trackingId} not found in dashboard`);
  return row;
}

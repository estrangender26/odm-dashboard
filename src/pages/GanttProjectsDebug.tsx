import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";

type Column = { key: string; label: string };
type TableRow = Record<string, unknown>;

type ProjectDebugRow = {
  id: number;
  name: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  userId?: number | null;
  sessionId?: string | null;
  tasksCount?: number | null;
  tasksDataFormat?: string | null;
};

type GanttDebugData = {
  rowCount?: number;
  databaseFingerprint?: string;
  databaseContext?: TableRow;
  ownershipSummary?: TableRow;
  latest?: ProjectDebugRow[];
  userIdValues?: TableRow[];
  sessionIdValues?: TableRow[];
  currentSessionId?: string;
  sql?: string;
};

function valueText(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function DataTable({
  rows,
  columns,
}: {
  rows: TableRow[] | undefined;
  columns: Column[];
}) {
  if (!rows || rows.length === 0) {
    return <p style={{ color: "#64748b" }}>No rows returned.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
      >
        <thead>
          <tr>
            {columns.map(column => (
              <th
                key={column.key}
                style={{
                  background: "#F1F5F9",
                  borderBottom: "1px solid #CBD5E1",
                  color: "#334155",
                  padding: 8,
                  textAlign: "left",
                }}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.id ?? `${row.userId ?? row.sessionId ?? "row"}-${index}`}
            >
              {columns.map(column => (
                <td
                  key={column.key}
                  style={{
                    borderBottom: "1px solid #E2E8F0",
                    padding: 8,
                    verticalAlign: "top",
                    whiteSpace:
                      column.key === "sessionId" ? "normal" : "nowrap",
                    wordBreak:
                      column.key === "sessionId" ? "break-all" : "normal",
                  }}
                >
                  {valueText(row[column.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectAdoptionTable({
  rows,
  selectedIds,
  setSelectedIds,
}: {
  rows: ProjectDebugRow[];
  selectedIds: Set<number>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
}) {
  if (rows.length === 0) {
    return <p style={{ color: "#64748b" }}>No projects returned.</p>;
  }

  const allSelected = rows.every(row => selectedIds.has(row.id));
  const toggleAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) rows.forEach(row => next.delete(row.id));
      else rows.forEach(row => next.add(row.id));
      return next;
    });
  };
  const toggleOne = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
      >
        <thead>
          <tr>
            <th style={thStyle}>
              <input
                aria-label="Select all projects"
                checked={allSelected}
                onChange={toggleAll}
                type="checkbox"
              />
            </th>
            <th style={thStyle}>id</th>
            <th style={thStyle}>Project name</th>
            <th style={thStyle}>createdAt</th>
            <th style={thStyle}>updatedAt</th>
            <th style={thStyle}>userId</th>
            <th style={thStyle}>sessionId</th>
            <th style={thStyle}>task count</th>
            <th style={thStyle}>tasks format</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const selected = selectedIds.has(row.id);
            return (
              <tr
                key={row.id}
                style={{ background: selected ? "#ECFDF5" : "#FFFFFF" }}
              >
                <td style={tdStyle}>
                  <input
                    aria-label={`Select project ${row.name}`}
                    checked={selected}
                    onChange={() => toggleOne(row.id)}
                    type="checkbox"
                  />
                </td>
                <td style={tdStyle}>{row.id}</td>
                <td style={tdStyle}>{valueText(row.name)}</td>
                <td style={tdStyle}>{valueText(row.createdAt)}</td>
                <td style={tdStyle}>{valueText(row.updatedAt)}</td>
                <td style={tdStyle}>{valueText(row.userId)}</td>
                <td
                  style={{
                    ...tdStyle,
                    whiteSpace: "normal",
                    wordBreak: "break-all",
                  }}
                >
                  {valueText(row.sessionId)}
                </td>
                <td style={tdStyle}>{valueText(row.tasksCount)}</td>
                <td style={tdStyle}>{valueText(row.tasksDataFormat)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  background: "#F1F5F9",
  borderBottom: "1px solid #CBD5E1",
  color: "#334155",
  padding: 8,
  textAlign: "left",
};

const tdStyle: React.CSSProperties = {
  borderBottom: "1px solid #E2E8F0",
  padding: 8,
  verticalAlign: "top",
  whiteSpace: "nowrap",
};

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E8F0",
        borderRadius: 10,
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)",
        margin: "16px 0",
        padding: 16,
      }}
    >
      <h2 style={{ fontSize: 18, margin: "0 0 12px" }}>{title}</h2>
      {children}
    </section>
  );
}

export default function GanttProjectsDebug() {
  const utils = trpc.useUtils();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const diagnostics = trpc.ganttProjects.debug.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const adoptMutation = trpc.ganttProjects.adoptToCurrentSession.useMutation({
    onSuccess: async () => {
      setSelectedIds(new Set());
      await Promise.all([
        diagnostics.refetch(),
        utils.ganttProjects.list.invalidate(),
      ]);
    },
  });
  const data = diagnostics.data as GanttDebugData | undefined;
  const projects = useMemo<ProjectDebugRow[]>(
    () => data?.latest ?? [],
    [data?.latest]
  );
  const selectedProjects = projects.filter(project =>
    selectedIds.has(project.id)
  );
  const currentSessionId = data?.currentSessionId;

  const adoptSelected = () => {
    if (selectedProjects.length === 0 || adoptMutation.isPending) return;
    const projectNames = selectedProjects
      .map(project => `• ${project.name}`)
      .join("\n");
    const confirmed = window.confirm(
      `Adopt ${selectedProjects.length} selected project(s) to the current session?\n\n` +
        `Current session_id:\n${currentSessionId || "—"}\n\n` +
        `Projects:\n${projectNames}\n\n` +
        "This updates only session_id and updated_at. It will not delete, duplicate, rename, or overwrite tasks_data."
    );
    if (!confirmed) return;
    adoptMutation.mutate({ ids: selectedProjects.map(project => project.id) });
  };

  return (
    <main
      style={{
        background: "#F8FAFC",
        color: "#0F172A",
        fontFamily:
          "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>
        Gantt Projects Production Debug
      </h1>
      <p style={{ color: "#475569", marginTop: 0 }}>
        Admin/debug-only inspection and recovery for{" "}
        <code>public.gantt_projects</code>. Adoption is guarded by{" "}
        <code>ENABLE_GANTT_DEBUG=true</code> and updates only selected rows to
        the current anonymous <code>session_id</code>.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          disabled={diagnostics.isFetching}
          onClick={() => diagnostics.refetch()}
          style={{
            background: diagnostics.isFetching ? "#94A3B8" : "#0F766E",
            border: 0,
            borderRadius: 6,
            color: "#FFFFFF",
            cursor: diagnostics.isFetching ? "wait" : "pointer",
            fontWeight: 700,
            padding: "10px 14px",
          }}
        >
          {diagnostics.isFetching ? "Loading…" : "Refresh production records"}
        </button>
        <button
          disabled={
            selectedProjects.length === 0 ||
            adoptMutation.isPending ||
            !currentSessionId
          }
          onClick={adoptSelected}
          style={{
            background:
              selectedProjects.length === 0 ||
              adoptMutation.isPending ||
              !currentSessionId
                ? "#94A3B8"
                : "#005BAC",
            border: 0,
            borderRadius: 6,
            color: "#FFFFFF",
            cursor:
              selectedProjects.length === 0 ||
              adoptMutation.isPending ||
              !currentSessionId
                ? "not-allowed"
                : "pointer",
            fontWeight: 700,
            padding: "10px 14px",
          }}
        >
          {adoptMutation.isPending
            ? "Adopting…"
            : `Adopt selected projects to current session (${selectedProjects.length})`}
        </button>
      </div>

      {diagnostics.error ? (
        <Card title="Debug route error">
          <p style={{ color: "#B91C1C", fontWeight: 700 }}>
            {diagnostics.error.message}
          </p>
          <p style={{ color: "#475569" }}>
            Confirm <code>ENABLE_GANTT_DEBUG=true</code> is set in the running
            production environment.
          </p>
        </Card>
      ) : null}

      {adoptMutation.error ? (
        <Card title="Adoption error">
          <p style={{ color: "#B91C1C", fontWeight: 700 }}>
            {adoptMutation.error.message}
          </p>
        </Card>
      ) : null}

      {adoptMutation.data ? (
        <Card title="Last adoption result">
          <p>
            Adopted <strong>{adoptMutation.data.adoptedCount}</strong> of{" "}
            <strong>{adoptMutation.data.requestedCount}</strong> selected
            project(s) to session{" "}
            <code>{adoptMutation.data.currentSessionId}</code>.
          </p>
          <p style={{ color: "#475569" }}>
            The diagnostics table was refreshed, and the normal Open Saved
            Project list cache was invalidated.
          </p>
        </Card>
      ) : null}

      <Card title="Summary">
        <p>
          <strong>Total rows:</strong> {valueText(data?.rowCount)}
        </p>
        <p>
          <strong>Current session_id:</strong>{" "}
          <code>{valueText(currentSessionId)}</code>
        </p>
        <p>
          <strong>Database fingerprint:</strong>{" "}
          {valueText(data?.databaseFingerprint)}
        </p>
        <p>
          <strong>Database context:</strong>{" "}
          <code>
            {data?.databaseContext ? JSON.stringify(data.databaseContext) : "—"}
          </code>
        </p>
        <p>
          <strong>Ownership summary:</strong>{" "}
          <code>
            {data?.ownershipSummary
              ? JSON.stringify(data.ownershipSummary)
              : "—"}
          </code>
        </p>
      </Card>

      <Card title="All projects">
        <p style={{ color: "#475569", marginTop: 0 }}>
          Select only the legacy anonymous projects you want to make visible in
          the current browser session. Adoption never deletes, duplicates,
          renames, or overwrites <code>tasks_data</code>.
        </p>
        <ProjectAdoptionTable
          rows={projects}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
        />
      </Card>

      <Card title="user_id values">
        <DataTable
          rows={data?.userIdValues}
          columns={[
            { key: "userId", label: "userId" },
            { key: "rows", label: "rows" },
          ]}
        />
      </Card>

      <Card title="session_id values">
        <DataTable
          rows={data?.sessionIdValues}
          columns={[
            { key: "sessionId", label: "sessionId" },
            { key: "rows", label: "rows" },
            { key: "firstCreatedAt", label: "firstCreatedAt" },
            { key: "lastUpdatedAt", label: "lastUpdatedAt" },
          ]}
        />
      </Card>

      <Card title="SQL used">
        <pre
          style={{
            background: "#0F172A",
            borderRadius: 8,
            color: "#E2E8F0",
            overflowX: "auto",
            padding: 12,
          }}
        >
          {data?.sql ?? "—"}
        </pre>
      </Card>
    </main>
  );
}

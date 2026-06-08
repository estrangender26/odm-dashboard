import { trpc } from "@/providers/trpc";

type Column = { key: string; label: string };

function valueText(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function DataTable({
  rows,
  columns,
}: {
  rows: any[] | undefined;
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
  const diagnostics = trpc.ganttProjects.debug.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const data = diagnostics.data as any;

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
        Read-only inspection of <code>public.gantt_projects</code>. This page
        does not save, delete, migrate, adopt, overwrite, or reset data.
      </p>
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

      <Card title="Summary">
        <p>
          <strong>Total rows:</strong> {valueText(data?.rowCount)}
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

      <Card title="Latest 50 projects">
        <DataTable
          rows={data?.latest}
          columns={[
            { key: "id", label: "id" },
            { key: "name", label: "Project name" },
            { key: "createdAt", label: "createdAt" },
            { key: "updatedAt", label: "updatedAt" },
            { key: "userId", label: "userId" },
            { key: "sessionId", label: "sessionId" },
            { key: "tasksCount", label: "task count" },
          ]}
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

import { trpc } from "@/providers/trpc";

type TableRow = Record<string, unknown>;

function valueText(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function DataTable({ rows }: { rows: TableRow[] }) {
  if (rows.length === 0) return <p style={{ color: "#64748b" }}>No rows returned.</p>;
  const columns = Object.keys(rows[0]);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>{columns.map(column => <th key={column} style={thStyle}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id ?? index)}>
              {columns.map(column => <td key={column} style={tdStyle}>{valueText(row[column])}</td>)}
            </tr>
          ))}
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
  whiteSpace: "normal",
  wordBreak: "break-word",
};

export default function GanttProjectsDebug() {
  const diagnostics = trpc.ganttProjects.debug.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const data = diagnostics.data as Record<string, unknown> | undefined;
  const latest = Array.isArray(data?.latest) ? data.latest as TableRow[] : [];

  return (
    <main style={{ background: "#F8FAFC", color: "#0F172A", minHeight: "100vh", padding: 24 }}>
      <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Gantt Projects Diagnostics</h1>
      <p style={{ color: "#475569", marginTop: 0 }}>
        Read-only diagnostics. This endpoint requires an authenticated admin and <code>ENABLE_GANTT_DEBUG=true</code>.
      </p>
      <button
        disabled={diagnostics.isFetching}
        onClick={() => diagnostics.refetch()}
        style={{ background: "#0F766E", border: 0, borderRadius: 6, color: "#FFFFFF", padding: "10px 14px" }}
      >
        {diagnostics.isFetching ? "Loading…" : "Refresh"}
      </button>
      {diagnostics.error ? <p style={{ color: "#B91C1C" }}>{diagnostics.error.message}</p> : null}
      {data ? (
        <>
          <h2>Summary</h2>
          <pre style={{ background: "#E2E8F0", borderRadius: 8, overflowX: "auto", padding: 12 }}>
            {JSON.stringify({ ...data, latest: undefined, sql: undefined }, null, 2)}
          </pre>
          <h2>Latest projects</h2>
          <DataTable rows={latest} />
        </>
      ) : null}
    </main>
  );
}

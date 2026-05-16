import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";

interface AgentMessage {
  role: "user" | "agent";
  content: string;
  timestamp: string;
}

const SUGGESTED_PROMPTS = [
  "Build a dashboard for equipment tracking",
  "Create a form with validation and submit",
  "Design a responsive landing page",
  "Generate a data table with sorting and filtering",
  "Build an authentication flow with login/register",
  "Create a chart dashboard with KPI cards",
];

export default function WebsiteAgent() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = useCallback(
    (text?: string) => {
      const msg = (text || input).trim();
      if (!msg || loading) return;
      setInput("");
      const userMsg: AgentMessage = {
        role: "user",
        content: msg,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      // Simulate agent processing
      setTimeout(() => {
        const response = generateAgentResponse(msg);
        setMessages((prev) => [
          ...prev,
          {
            role: "agent",
            content: response,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
        setLoading(false);
      }, 1200);
    },
    [input, loading]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const copyResponse = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  const clearChat = () => setMessages([]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#F8FAFC", fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <header style={{ background: "#16324F", padding: "10px 20px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 100 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <ProgramsEngineeringLogo size={36} borderRadius={8} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>Kimi Website Agent</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.5px" }}>AI-Powered Web Development</div>
          </div>
        </Link>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
          >
            {sidebarOpen ? "Hide" : "Show"} Sidebar
          </button>
          <Link to="/" style={{ color: "rgba(255,255,255,0.7)", textDecoration: "none", fontSize: 12, fontWeight: 500, padding: "6px 12px", borderRadius: 6 }}>
            Back to Dashboard
          </Link>
        </div>
      </header>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Sidebar — Session History */}
        {sidebarOpen && (
          <aside style={{ width: 240, minWidth: 240, background: "#fff", borderRight: "1px solid #E2E8F0", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Sessions</span>
              <button onClick={clearChat} style={{ fontSize: 10, color: "#94A3B8", background: "none", border: "none", cursor: "pointer" }}>
                New Session
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
              <div style={{ padding: "8px 10px", background: "#DBEAFE", borderRadius: 6, marginBottom: 4, cursor: "pointer" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#1E40AF" }}>Current Session</div>
                <div style={{ fontSize: 9, color: "#64748B" }}>{messages.length} messages</div>
              </div>
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid #E2E8F0", fontSize: 10, color: "#94A3B8" }}>
              Kimi Website Agent v1.0
            </div>
          </aside>
        )}

        {/* Chat Area */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Messages */}
          <div
            ref={scrollRef}
            style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}
          >
            {messages.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#94A3B8" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                </div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "#475569", margin: "0 0 8px" }}>Kimi Website Agent</h2>
                <p style={{ fontSize: 13, margin: "0 0 24px", maxWidth: 420, marginInline: "auto" }}>
                  Describe what you want to build. I'll generate code, design layouts, and help you deploy web applications.
                </p>

                {/* Suggested Prompts */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 480, margin: "0 auto" }}>
                  {SUGGESTED_PROMPTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => sendMessage(p)}
                      style={{
                        padding: "8px 14px",
                        fontSize: 11,
                        border: "1px solid #D6DFE8",
                        borderRadius: 20,
                        background: "#fff",
                        color: "#475569",
                        cursor: "pointer",
                        transition: "all .15s",
                        fontFamily: "Inter, sans-serif",
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "80%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: m.role === "user" ? "#005BAC" : "#1F9D55",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      color: "#fff",
                      fontWeight: 700,
                    }}
                  >
                    {m.role === "user" ? "You" : "KA"}
                  </span>
                  <span style={{ fontSize: 9, color: "#94A3B8" }}>{m.timestamp}</span>
                </div>
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                    background: m.role === "user" ? "#005BAC" : "#fff",
                    color: m.role === "user" ? "#fff" : "#2D3748",
                    fontSize: 12,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    border: m.role === "user" ? "none" : "1px solid #E2E8F0",
                    boxShadow: m.role === "user" ? "none" : "0 1px 3px rgba(0,0,0,.04)",
                  }}
                >
                  {m.content}
                </div>
                {m.role === "agent" && (
                  <div style={{ display: "flex", gap: 8, paddingLeft: 4 }}>
                    <button
                      onClick={() => copyResponse(m.content)}
                      style={{ fontSize: 9, color: "#94A3B8", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    >
                      Copy
                    </button>
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "#1F9D55",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9,
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  KA
                </span>
                <span style={{ display: "inline-flex", gap: 4 }}>
                  <span style={{ width: 6, height: 6, background: "#94A3B8", borderRadius: "50%", animation: "agentPulse 1.4s ease-in-out infinite" }} />
                  <span style={{ width: 6, height: 6, background: "#94A3B8", borderRadius: "50%", animation: "agentPulse 1.4s ease-in-out infinite .2s" }} />
                  <span style={{ width: 6, height: 6, background: "#94A3B8", borderRadius: "50%", animation: "agentPulse 1.4s ease-in-out infinite .4s" }} />
                </span>
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{ padding: "12px 24px 16px", borderTop: "1px solid #E2E8F0", background: "#fff" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", maxWidth: 800, margin: "0 auto" }}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe what you want to build..."
                rows={1}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  fontSize: 13,
                  border: "1px solid #D6DFE8",
                  borderRadius: 12,
                  fontFamily: "Inter, sans-serif",
                  resize: "none",
                  outline: "none",
                  maxHeight: 120,
                  lineHeight: 1.5,
                }}
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading}
                style={{
                  padding: "10px 20px",
                  fontSize: 13,
                  fontWeight: 600,
                  background: input.trim() && !loading ? "#005BAC" : "#CBD5E1",
                  color: "#fff",
                  border: "none",
                  borderRadius: 12,
                  cursor: input.trim() && !loading ? "pointer" : "not-allowed",
                  transition: "all .15s",
                  fontFamily: "Inter, sans-serif",
                  flexShrink: 0,
                }}
              >
                {loading ? "Building..." : "Send"}
              </button>
            </div>
            <div style={{ textAlign: "center", marginTop: 6, fontSize: 9, color: "#CBD5E1" }}>
              Kimi Website Agent can generate code, design layouts, and suggest implementations. Results are simulated for demo.
            </div>
          </div>
        </main>
      </div>

      <style>{`
        @keyframes agentPulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

/* Simple response generator for demo */
function generateAgentResponse(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes("dashboard")) {
    return `I'll build a dashboard for you. Here's the structure:

\`\`\`tsx
// DashboardLayout.tsx
export default function Dashboard() {
  return (
    <div className="grid grid-cols-12 gap-4">
      <KpiCard title="Total Equipment" value="248" trend="+12%" />
      <KpiCard title="Open Work Orders" value="37" trend="-5%" />
      <KpiCard title="PM Compliance" value="94%" trend="+3%" />
      <KpiCard title="Critical Findings" value="3" alert />
      <DataTable columns={cols} data={equipmentData} />
      <ChartWidget type="line" data={trendData} />
    </div>
  );
}
\`\`\`

This creates a responsive 12-column grid with KPI cards, a data table, and a trend chart. The components use Tailwind CSS for styling and are mobile-responsive by default.`;
  }
  if (lower.includes("form")) {
    return `Here's a form with validation:

\`\`\`tsx
// EquipmentForm.tsx
const schema = z.object({
  name: z.string().min(2, "Name required"),
  type: z.enum(["pump", "motor", "valve"]),
  location: z.string().min(1),
  installDate: z.date(),
});

export default function EquipmentForm() {
  const form = useForm({ resolver: zodResolver(schema) });
  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Input label="Equipment Name" {...form.register("name")} />
      <Select label="Type" options={equipmentTypes} {...form.register("type")} />
      <Input label="Location" {...form.register("location")} />
      <DatePicker label="Install Date" {...form.register("installDate")} />
      <Button type="submit">Save Equipment</Button>
    </form>
  );
}
\`\`\`

Includes Zod validation, react-hook-form integration, and shadcn/ui components.`;
  }
  if (lower.includes("table")) {
    return `Here's a data table with sorting and filtering:

\`\`\`tsx
// EquipmentTable.tsx
export default function EquipmentTable({ data }) {
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [filter, setFilter] = useState("");

  const sorted = useMemo(() => {
    return data
      .filter(d => d.name.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => sort.dir === "asc" 
        ? a[sort.key].localeCompare(b[sort.key])
        : b[sort.key].localeCompare(a[sort.key]));
  }, [data, sort, filter]);

  return (
    <div>
      <Input placeholder="Search..." onChange={e => setFilter(e.target.value)} />
      <Table>
        <SortableHeader columns={cols} sort={sort} onSort={setSort} />
        <tbody>{sorted.map(row => <TableRow key={row.id} data={row} />)}</tbody>
      </Table>
      <Pagination total={sorted.length} pageSize={10} />
    </div>
  );
}
\`\`\`

Features client-side sorting, text filtering, and pagination.`;
  }
  if (lower.includes("login") || lower.includes("auth")) {
    return `Here's an authentication flow:

\`\`\`tsx
// AuthFlow.tsx
function LoginPage() {
  const login = trpc.auth.login.useMutation();
  return (
    <div className="flex h-screen items-center justify-center">
      <Card className="w-96">
        <h2>Sign In</h2>
        <Input label="Email" type="email" />
        <Input label="Password" type="password" />
        <Button onClick={() => login.mutate({ email, password })}>
          Sign In
        </Button>
        <p>Don't have an account? <Link to="/register">Register</Link></p>
      </Card>
    </div>
  );
}
\`\`\`

Includes tRPC backend integration, form validation, and route guards.`;
  }
  if (lower.includes("landing") || lower.includes("page")) {
    return `Here's a responsive landing page:

\`\`\`tsx
// LandingPage.tsx
export default function Landing() {
  return (
    <div>
      <HeroSection 
        title="Water Facility Management"
        subtitle="Streamline operations..."
        cta="Get Started"
      />
      <FeatureGrid features={[
        { icon: "📊", title: "Dashboards", desc: "Real-time KPIs" },
        { icon: "🔧", title: "Maintenance", desc: "PM/CM tracking" },
        { icon: "📋", title: "Inspections", desc: "Finding management" },
      ]} />
      <StatsBar stats={[{ label: "Facilities", value: "12" }, ...]} />
      <Footer />
    </div>
  );
}
\`\`\`

Hero section, feature grid, stats bar, and footer — all responsive.`;
  }
  if (lower.includes("chart") || lower.includes("kpi")) {
    return `Here's a chart dashboard with KPI cards:

\`\`\`tsx
// ChartDashboard.tsx
export default function ChartDashboard() {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="MTBF" value="2,400h" icon="⏱" />
        <KpiCard label="Availability" value="98.2%" icon="📈" />
        <KpiCard label="Backlog" value="14 days" icon="📋" />
        <KpiCard label="Cost" value="$42K" icon="💰" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Chart type="bar" data={monthlyCosts} title="Monthly Maintenance Cost" />
        <Chart type="line" data={availabilityTrend} title="Availability Trend" />
        <Chart type="pie" data={workTypeBreakdown} title="Work Type Distribution" />
        <Chart type="area" data={backlogHistory} title="Backlog Trend" />
      </div>
    </div>
  );
}
\`\`\`

4 KPI cards + 4 chart types in a responsive 2-column grid.`;
  }
  return `I'll help you build that. Let me generate the code structure:

\`\`\`tsx
// GeneratedComponent.tsx
import { useState, useEffect } from "react";

export default function GeneratedComponent() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <SkeletonLoader />;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">{title}</h1>
      <div className="grid gap-4">
        {data.map(item => (
          <Card key={item.id} data={item} />
        ))}
      </div>
    </div>
  );
}
\`\`\`

This gives you a solid foundation. Would you like me to add specific features like sorting, filtering, or API integration?`;
}

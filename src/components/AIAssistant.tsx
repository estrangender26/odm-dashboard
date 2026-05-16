import { useState, useRef, useEffect } from "react";
import { trpc } from "@/providers/trpc";

export type DashboardContext =
  | "maintenance"
  | "gantt"
  | "inspection"
  | "smp"
  | "manuals"
  | "scorecard"
  | "help";

interface AIAssistantProps {
  contextType: DashboardContext;
  data?: any[];
}

const CONTEXT_PROMPTS: Record<DashboardContext, string[]> = {
  maintenance: [
    "Analyze PM compliance trends",
    "Identify high-risk equipment",
    "Suggest maintenance optimization",
    "Review overdue work orders",
  ],
  gantt: [
    "Analyze schedule delays",
    "Suggest task sequencing improvements",
    "Review critical path",
    "Identify resource conflicts",
  ],
  inspection: [
    "Analyze inspection findings",
    "Classify risk levels",
    "Suggest corrective actions",
    "Review compliance status",
  ],
  smp: [
    "Review SMP effectiveness",
    "Suggest program improvements",
    "Analyze maintenance strategy",
    "Compare with best practices",
  ],
  manuals: [
    "Find relevant O&M procedures",
    "Check documentation gaps",
    "Suggest procedure updates",
    "Cross-reference equipment docs",
  ],
  scorecard: [
    "Analyze KPI performance",
    "Identify trends and patterns",
    "Suggest improvement actions",
    "Compare with targets",
  ],
  help: [
    "Explain dashboard features",
    "Guide on data import",
    "Troubleshoot issues",
    "Suggest best practices",
  ],
};

export default function AIAssistant({ contextType, data }: AIAssistantProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chatMut = trpc.ai.maintenanceChat.useMutation({
    onSuccess: (res) => {
      setLoading(false);
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
    },
    onError: (e) => {
      setLoading(false);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ Error: ${e.message}\n\nThe AI service may not be configured. Please set GROQ_API_KEY in your Render environment variables.\n\nGet a free key at: https://console.groq.com`,
        },
      ]);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const send = (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setLoading(true);

    const history = messages.slice(-6).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    chatMut.mutate({ message: msg, history });
  };

  const prompts = CONTEXT_PROMPTS[contextType] || CONTEXT_PROMPTS.help;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: "fixed",
          bottom: 20,
          left: 20,
          zIndex: 200,
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #7C3AED, #6D28D9)",
          color: "#fff",
          border: "none",
          boxShadow: "0 4px 16px rgba(124,58,237,.35)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          transition: "all .2s",
        }}
        title="AI Analysis"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
      </button>

      {/* Panel */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 80,
            left: 20,
            zIndex: 200,
            width: "min(380px, calc(100vw - 40px))",
            height: "min(480px, calc(100vh - 120px))",
            background: "#fff",
            borderRadius: 16,
            boxShadow: "0 20px 60px rgba(0,0,0,.25)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            fontFamily: "Inter, sans-serif",
            border: "1px solid #D6DFE8",
          }}
        >
          {/* Header */}
          <div style={{ padding: "12px 16px", background: "linear-gradient(135deg, #7C3AED, #6D28D9)", color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
            <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>AI Analysis</span>
            <button onClick={() => setMessages([])} style={{ background: "none", border: "none", color: "#fff", fontSize: 10, cursor: "pointer", opacity: .8 }}>Clear</button>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#fff", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>&times;</button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {messages.length === 0 && (
              <div style={{ textAlign: "center", padding: "16px 8px", color: "#94A3B8", fontSize: 11 }}>
                <p style={{ margin: "0 0 12px" }}>Ask AI to analyze this dashboard's data.</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
                  {prompts.map((p) => (
                    <button key={p} onClick={() => send(p)} style={{ padding: "4px 10px", fontSize: 10, border: "1px solid #D6DFE8", borderRadius: 12, background: "#fff", color: "#475569", cursor: "pointer", fontFamily: "Inter, sans-serif" }}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%", padding: "6px 10px", borderRadius: m.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px", background: m.role === "user" ? "#7C3AED" : "#F1F5F9", color: m.role === "user" ? "#fff" : "#2D3748", fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {m.content}
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf: "flex-start", padding: "8px 12px", background: "#F1F5F9", borderRadius: "10px 10px 10px 2px" }}>
                <span style={{ display: "inline-flex", gap: 3 }}>
                  <span style={{ width: 5, height: 5, background: "#94A3B8", borderRadius: "50%", animation: "dotPulse 1.4s ease-in-out infinite" }} />
                  <span style={{ width: 5, height: 5, background: "#94A3B8", borderRadius: "50%", animation: "dotPulse 1.4s ease-in-out infinite .2s" }} />
                  <span style={{ width: 5, height: 5, background: "#94A3B8", borderRadius: "50%", animation: "dotPulse 1.4s ease-in-out infinite .4s" }} />
                </span>
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{ padding: "8px 12px", borderTop: "1px solid #E2E8F0", display: "flex", gap: 6, alignItems: "flex-end" }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }}}
              placeholder="Ask AI..."
              rows={1}
              style={{ flex: 1, padding: "6px 10px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 8, fontFamily: "Inter, sans-serif", resize: "none", outline: "none", maxHeight: 60 }}
            />
            <button onClick={() => send()} disabled={!input.trim() || loading} style={{ padding: "6px 14px", fontSize: 11, fontWeight: 600, background: input.trim() && !loading ? "#7C3AED" : "#CBD5E1", color: "#fff", border: "none", borderRadius: 8, cursor: input.trim() && !loading ? "pointer" : "not-allowed" }}>
              Send
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes dotPulse { 0%,80%,100%{opacity:.3;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }`}</style>
    </>
  );
}

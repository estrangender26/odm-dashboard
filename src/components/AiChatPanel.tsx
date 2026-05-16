import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/providers/trpc";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
}

const QUICK_PROMPTS = [
  "Analyze this inspection finding",
  "Suggest PM tasks for this equipment",
  "Create a corrective maintenance scope",
  "Explain this KPI issue",
  "Draft a vendor scope of work",
  "Map this to SAP PM fields",
];

export default function AiChatPanel() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const chatMut = trpc.ai.maintenanceChat.useMutation({
    onSuccess: (data) => {
      setTyping(false);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply, error: !!data.error },
      ]);
    },
    onError: (e) => {
      setTyping(false);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Request failed: " + e.message, error: true },
      ]);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  const sendMessage = useCallback(
    (text?: string) => {
      const msg = (text || input).trim();
      if (!msg || typing || chatMut.isPending) return;
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: msg }]);
      setTyping(true);

      const history = messages
        .filter((m) => !m.error)
        .slice(-10)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      chatMut.mutate({ message: msg, history });
    },
    [input, typing, chatMut, messages]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const copyLast = () => {
    const last = [...messages].reverse().find((m) => m.role === "assistant" && !m.error);
    if (last) {
      navigator.clipboard.writeText(last.content).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const clearChat = () => {
    setMessages([]);
    setTyping(false);
  };

  return (
    <>
      {/* ── Floating Button ── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 200,
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #005BAC, #004D99)",
            color: "#fff",
            border: "none",
            boxShadow: "0 4px 16px rgba(0,91,172,.35)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all .2s",
            fontSize: 22,
          }}
          title="Ask Maintenance AI"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </button>
      )}

      {/* ── Chat Panel ── */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 200,
            width: "min(420px, calc(100vw - 32px))",
            height: "min(560px, calc(100vh - 40px))",
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
          <div
            style={{
              padding: "14px 16px",
              background: "linear-gradient(135deg, #005BAC, #004D99)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexShrink: 0,
            }}
          >
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,255,255,.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>Maintenance AI Expert</div>
              <div style={{ fontSize: 10, opacity: .7 }}>Senior Reliability Advisor</div>
            </div>
            <button onClick={copyLast} title="Copy last response" style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 12, opacity: .8, padding: 4 }}>
              {copied ? "Copied!" : "Copy"}
            </button>
            <button onClick={clearChat} title="Clear chat" style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 14, opacity: .8, padding: 4 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#fff", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 4 }}>
              &times;
            </button>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}
          >
            {messages.length === 0 && (
              <div style={{ textAlign: "center", padding: "20px 8px", color: "#94A3B8", fontSize: 12 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </div>
                <p style={{ margin: "0 0 16px", fontWeight: 600, color: "#64748B" }}>Ask Maintenance AI</p>
                <p style={{ margin: 0 }}>Get expert advice on PM, CM, inspections, KPIs, and more.</p>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  padding: "8px 12px",
                  borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                  background: m.error ? "#FEE2E2" : m.role === "user" ? "#005BAC" : "#F1F5F9",
                  color: m.role === "user" ? "#fff" : m.error ? "#991B1B" : "#2D3748",
                  fontSize: 12,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {m.content}
              </div>
            ))}

            {typing && (
              <div style={{ alignSelf: "flex-start", padding: "10px 14px", background: "#F1F5F9", borderRadius: "12px 12px 12px 2px" }}>
                <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
                  <span style={{ width: 6, height: 6, background: "#94A3B8", borderRadius: "50%", animation: "dotPulse 1.4s ease-in-out infinite", animationDelay: "0s" }} />
                  <span style={{ width: 6, height: 6, background: "#94A3B8", borderRadius: "50%", animation: "dotPulse 1.4s ease-in-out infinite", animationDelay: ".2s" }} />
                  <span style={{ width: 6, height: 6, background: "#94A3B8", borderRadius: "50%", animation: "dotPulse 1.4s ease-in-out infinite", animationDelay: ".4s" }} />
                </span>
              </div>
            )}
          </div>

          {/* Quick Prompts */}
          {messages.length === 0 && (
            <div style={{ padding: "0 12px 8px", display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => sendMessage(p)}
                  style={{
                    padding: "5px 10px",
                    fontSize: 10,
                    border: "1px solid #D6DFE8",
                    borderRadius: 14,
                    background: "#fff",
                    color: "#475569",
                    cursor: "pointer",
                    transition: "all .15s",
                    fontFamily: "Inter, sans-serif",
                    fontWeight: 500,
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{ padding: "8px 12px 12px", borderTop: "1px solid #E2E8F0", display: "flex", gap: 8, flexShrink: 0, alignItems: "flex-end" }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about maintenance, PM, KPIs..."
              rows={1}
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: 12,
                border: "1px solid #D6DFE8",
                borderRadius: 10,
                fontFamily: "Inter, sans-serif",
                resize: "none",
                outline: "none",
                maxHeight: 80,
              }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || typing || chatMut.isPending}
              style={{
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 600,
                background: input.trim() && !typing ? "#005BAC" : "#CBD5E1",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                cursor: input.trim() && !typing ? "pointer" : "not-allowed",
                transition: "all .15s",
                fontFamily: "Inter, sans-serif",
                flexShrink: 0,
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </>
  );
}

import { useState, useRef, useCallback, useEffect } from "react";
import { type DashboardContext, analyze, ask, getSuggestedPrompts, type AIResponse, type AIInsight } from "../../api/universal-ai";

interface AIAssistantProps {
  contextType: DashboardContext;
  data: any;
  filters?: Record<string, string>;
  metadata?: Record<string, any>;
  title?: string;
  position?: "right" | "left";
}

export default function AIAssistant({ contextType, data, filters, metadata, title = "AI Assistant", position = "right" }: AIAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<AIResponse | null>(null);
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const suggestedPrompts = getSuggestedPrompts(contextType);

  // Compute insights when data changes
  useEffect(() => {
    if (!data || (Array.isArray(data) && data.length === 0)) {
      setInsights([]);
      return;
    }
    try {
      const result = analyze({ type: contextType, data, filters, metadata });
      setInsights(result.insights);
    } catch {
      setInsights([]);
    }
  }, [data, contextType, filters, metadata]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) setIsOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen]);

  const handleAsk = useCallback(
    (q?: string) => {
      const qText = (q || question).trim();
      if (!qText || isLoading) return;

      // Check if data exists
      const hasData = data && (Array.isArray(data) ? data.length > 0 : true);
      if (!hasData) {
        setResponse({ answer: "No data loaded. Please load or import data first.", insights: [], confidence: "LOW", source: "client" });
        return;
      }

      setIsLoading(true);
      setResponse(null);

      // Small delay for UX feel
      setTimeout(() => {
        try {
          const result = ask({ type: contextType, data, filters, metadata }, qText);
          setResponse(result);
          setHistory((prev) => [...prev.slice(-9), { q: qText, a: result.answer }]);
          if (!q) setQuestion("");
        } catch (err: any) {
          setResponse({ answer: `Error: ${err.message || "Failed to analyze data"}`, insights: [], confidence: "LOW", source: "error" });
        } finally {
          setIsLoading(false);
        }
      }, 300);
    },
    [question, isLoading, data, contextType, filters, metadata]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  const severityDot = (s: string) => {
    const colors: Record<string, string> = {
      critical: "#DC2626",
      warning: "#F59E0B",
      info: "#005BAC",
      success: "#1F9D55",
    };
    return colors[s] || "#8BA3B8";
  };

  const formatAnswer = (text: string) => {
    return text
      .replace(/\*\*(.+?)\*\*/g, "<strong style=\"color:#16324F\">$1</strong>")
      .replace(/\n/g, "<br>");
  };

  return (
    <>
      {/* Floating AI Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: "fixed",
          bottom: 24,
          [position]: 24,
          zIndex: 9999,
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: isOpen ? "#DC2626" : "linear-gradient(135deg, #005BAC 0%, #0077CC 100%)",
          color: "#fff",
          border: "none",
          boxShadow: "0 4px 16px rgba(0,91,172,0.35)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          transition: "all 0.25s cubic-bezier(0.4,0,0.2,1)",
          transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
        }}
        title={isOpen ? "Close AI" : "Ask AI"}
      >
        {isOpen ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>
        )}
      </button>

      {/* Overlay */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(11,29,68,0.3)",
            zIndex: 9998,
            backdropFilter: "blur(2px)",
            animation: "fadeIn 0.2s ease-out",
          }}
        />
      )}

      {/* AI Panel */}
      {isOpen && (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top: 0,
            [position]: 0,
            width: "min(420px, 90vw)",
            height: "100vh",
            background: "#fff",
            zIndex: 9999,
            boxShadow: position === "right" ? "-8px 0 40px rgba(0,0,0,0.15)" : "8px 0 40px rgba(0,0,0,0.15)",
            display: "flex",
            flexDirection: "column",
            fontFamily: "Inter, sans-serif",
            animation: `slidePanel${position === "right" ? "Right" : "Left"} 0.3s cubic-bezier(0.4, 0, 0.2, 1)`,
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid #E2E8F0",
              background: "linear-gradient(135deg, #005BAC 0%, #0077CC 100%)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
              <div style={{ fontSize: 10, opacity: 0.8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {contextType.charAt(0).toUpperCase() + contextType.slice(1)} Analysis
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 4, borderRadius: 4, display: "flex" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          {/* Scrollable content */}
          <div style={{ flex: 1, overflow: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Insights Section */}
            {insights.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#8BA3B8", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
                  AI Insights
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {insights.map((insight, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "10px 12px",
                        background: `${severityDot(insight.severity)}08`,
                        borderRadius: 8,
                        borderLeft: `3px solid ${severityDot(insight.severity)}`,
                      }}
                    >
                      <div style={{ fontWeight: 700, color: "#16324F", fontSize: 12, marginBottom: 2 }}>{insight.title}</div>
                      <div style={{ fontSize: 11, color: "#5A6B7D", marginBottom: insight.recommendation ? 4 : 0 }}>{insight.description}</div>
                      {insight.metric !== undefined && (
                        <div style={{ fontSize: 11, fontWeight: 700, color: severityDot(insight.severity) }}>{insight.metric}</div>
                      )}
                      {insight.recommendation && (
                        <div style={{ fontSize: 10, color: "#005BAC", fontWeight: 600, marginTop: 4, padding: "4px 8px", background: "#EFF6FF", borderRadius: 4 }}>
                          → {insight.recommendation}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Question Chips */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#8BA3B8", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
                Quick Questions
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {suggestedPrompts.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => handleAsk(p)}
                    style={{
                      padding: "6px 12px",
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: "Inter, sans-serif",
                      background: "#F1F5F9",
                      color: "#475569",
                      border: "1px solid #E2E8F0",
                      borderRadius: 16,
                      cursor: "pointer",
                      transition: "all 0.15s",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#E2E8F0"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "#F1F5F9"; }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Response Area */}
            {isLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 12px", color: "#5A6B7D", fontSize: 13 }}>
                <div
                  style={{
                    width: 16,
                    height: 16,
                    border: "2px solid #E2E8F0",
                    borderTopColor: "#005BAC",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
                Analyzing {contextType} data...
              </div>
            )}

            {response && !isLoading && (
              <div style={{ animation: "fadeIn 0.25s ease-out" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#8BA3B8", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
                  {response.source} · {response.confidence} confidence
                </div>
                <div
                  style={{
                    padding: "12px 14px",
                    background: "#FAFBFC",
                    borderRadius: 10,
                    border: "1px solid #E2E8F0",
                    fontSize: 12,
                    color: "#2D3748",
                    lineHeight: 1.6,
                  }}
                  dangerouslySetInnerHTML={{ __html: formatAnswer(response.answer) }}
                />
                {response.suggestedQuestions && response.suggestedQuestions.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                    {response.suggestedQuestions.map((sq, i) => (
                      <button
                        key={i}
                        onClick={() => handleAsk(sq)}
                        style={{
                          padding: "4px 10px",
                          fontSize: 10,
                          fontWeight: 600,
                          fontFamily: "Inter, sans-serif",
                          background: "#EFF6FF",
                          color: "#005BAC",
                          border: "none",
                          borderRadius: 12,
                          cursor: "pointer",
                        }}
                      >
                        {sq}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Conversation History */}
            {history.length > 0 && (
              <div style={{ marginTop: "auto", borderTop: "1px solid #E2E8F0", paddingTop: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#8BA3B8", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
                  Conversation
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {history.slice(-3).map((h, i) => (
                    <div key={i} style={{ fontSize: 11 }}>
                      <div style={{ fontWeight: 600, color: "#005BAC", marginBottom: 2 }}>Q: {h.q}</div>
                      <div style={{ color: "#5A6B7D", paddingLeft: 8, borderLeft: "2px solid #E2E8F0" }}>{h.a}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Input Area */}
          <div style={{ padding: "12px 16px", borderTop: "1px solid #E2E8F0", background: "#FAFBFC", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ask about ${contextType} data...`}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  fontSize: 12,
                  fontFamily: "Inter, sans-serif",
                  border: "1px solid #D6DFE8",
                  borderRadius: 8,
                  outline: "none",
                  background: "#fff",
                }}
              />
              <button
                onClick={() => handleAsk()}
                disabled={isLoading || !question.trim()}
                style={{
                  padding: "10px 14px",
                  background: isLoading || !question.trim() ? "#E2E8F0" : "#005BAC",
                  color: isLoading || !question.trim() ? "#94A3B8" : "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: isLoading || !question.trim() ? "not-allowed" : "pointer",
                  fontWeight: 700,
                  fontSize: 12,
                  fontFamily: "Inter, sans-serif",
                  transition: "all 0.15s",
                  whiteSpace: "nowrap",
                }}
              >
                {isLoading ? "..." : "Ask"}
              </button>
            </div>
            <div style={{ fontSize: 9, color: "#8BA3B8", marginTop: 6, textAlign: "center" }}>
              Press Enter to send · ESC to close · AI analyzes real dashboard data
            </div>
          </div>
        </div>
      )}

      {/* Keyframes */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slidePanelRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slidePanelLeft { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        @keyframes slideInRight { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes slideInLeft { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }
      `}</style>
    </>
  );
}

export { AIAssistant };

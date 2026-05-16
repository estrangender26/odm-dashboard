import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";

interface ChatMessage {
  role: "user" | "agent";
  content: string;
  timestamp: string;
}

interface GitHubItem {
  name: string;
  path: string;
  type: string;
  size: number;
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<"chat" | "github">("chat");
  const [githubPath, setGithubPath] = useState("");
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [filePath, setFilePath] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const { data: githubStatus } = trpc.github.status.useQuery();
  const { data: githubContents } = trpc.github.listContents.useQuery(
    { path: githubPath },
    { enabled: githubStatus?.configured === true && activeTab === "github" }
  );
  const { data: githubCommits } = trpc.github.listCommits.useQuery(
    { path: githubPath },
    { enabled: githubStatus?.configured === true && activeTab === "github" }
  );
  const getFileMut = trpc.github.getFile.useMutation({
    onSuccess: (data) => {
      if (data.content) setFileContent(data.content);
    },
  });
  const saveFileMut = trpc.github.saveFile.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setSaveMessage("Saved to GitHub!");
        setTimeout(() => setSaveMessage(""), 3000);
      }
    },
  });

  const chatMut = trpc.ai.maintenanceChat.useMutation({
    onSuccess: (data) => {
      setLoading(false);
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: data.reply, error: !!data.error },
      ]);
    },
    onError: (e) => {
      setLoading(false);
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: "Request failed: " + e.message, error: true },
      ]);
    },
  });

  const sendMessage = useCallback(
    (text?: string) => {
      const msg = (text || input).trim();
      if (!msg || loading || chatMut.isPending) return;
      setInput("");
      const userMsg: ChatMessage = {
        role: "user",
        content: msg,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      const history = messages
        .filter((m) => !(m as any).error)
        .slice(-10)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      chatMut.mutate({ message: msg, history });
    },
    [input, loading, chatMut, messages]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (activeTab === "chat") sendMessage();
    }
  };

  const copyResponse = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  const clearChat = () => setMessages([]);

  const openFile = (item: GitHubItem) => {
    if (item.type === "dir") {
      setGithubPath(item.path);
      setFileContent(null);
      setFilePath("");
    } else {
      getFileMut.mutate({ path: item.path });
      setFilePath(item.path);
    }
  };

  const saveFile = () => {
    if (!fileContent || !filePath) return;
    saveFileMut.mutate({
      path: filePath,
      content: fileContent,
      message: `Update ${filePath} via Website Agent`,
    });
  };

  const goUp = () => {
    const parts = githubPath.split("/").filter(Boolean);
    parts.pop();
    setGithubPath(parts.join("/"));
    setFileContent(null);
    setFilePath("");
  };

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
            onClick={() => setActiveTab("chat")}
            style={{ background: activeTab === "chat" ? "rgba(255,255,255,0.2)" : "transparent", border: "none", color: "#fff", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
          >
            Chat
          </button>
          <button
            onClick={() => setActiveTab("github")}
            style={{ background: activeTab === "github" ? "rgba(255,255,255,0.2)" : "transparent", border: "none", color: "#fff", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
          >
            GitHub
          </button>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
          >
            {sidebarOpen ? "Hide" : "Show"}
          </button>
          <Link to="/" style={{ color: "rgba(255,255,255,0.7)", textDecoration: "none", fontSize: 12, fontWeight: 500, padding: "6px 12px", borderRadius: 6 }}>
            Back
          </Link>
        </div>
      </header>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Sidebar */}
        {sidebarOpen && (
          <aside style={{ width: 260, minWidth: 260, background: "#fff", borderRight: "1px solid #E2E8F0", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #E2E8F0" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {activeTab === "chat" ? "Sessions" : "Repository"}
              </span>
            </div>

            {activeTab === "chat" ? (
              <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
                <div style={{ padding: "8px 10px", background: "#DBEAFE", borderRadius: 6, marginBottom: 4, cursor: "pointer" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#1E40AF" }}>Current Session</div>
                  <div style={{ fontSize: 9, color: "#64748B" }}>{messages.length} messages</div>
                </div>
                <button onClick={clearChat} style={{ marginTop: 8, width: "100%", padding: "6px", fontSize: 10, border: "1px solid #D6DFE8", borderRadius: 6, background: "#fff", color: "#64748B", cursor: "pointer" }}>
                  New Session
                </button>
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
                {/* GitHub Status */}
                <div style={{ padding: "8px 10px", background: githubStatus?.configured ? "#DCFCE7" : "#FEE2E2", borderRadius: 6, marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: githubStatus?.configured ? "#15803D" : "#DC2626" }}>
                    {githubStatus?.configured ? "Connected" : "Not Connected"}
                  </div>
                  {githubStatus?.configured && (
                    <div style={{ fontSize: 9, color: "#64748B" }}>
                      {githubStatus.owner}/{githubStatus.repo}
                    </div>
                  )}
                </div>

                {/* Breadcrumb */}
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
                  <button onClick={() => { setGithubPath(""); setFileContent(null); }} style={{ fontSize: 10, background: "none", border: "none", color: "#005BAC", cursor: "pointer", padding: 0 }}>root</button>
                  {githubPath && (
                    <>
                      <span style={{ fontSize: 10, color: "#94A3B8" }}>/</span>
                      <span style={{ fontSize: 10, color: "#475569" }}>{githubPath}</span>
                    </>
                  )}
                </div>
                {githubPath && (
                  <button onClick={goUp} style={{ fontSize: 10, marginBottom: 8, background: "none", border: "none", color: "#005BAC", cursor: "pointer", padding: 0 }}>
                    &uarr; Parent
                  </button>
                )}

                {/* File List */}
                {githubContents?.items?.map((item: GitHubItem) => (
                  <div
                    key={item.path}
                    onClick={() => openFile(item)}
                    style={{
                      padding: "6px 8px",
                      borderRadius: 4,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: filePath === item.path ? "#DBEAFE" : "transparent",
                      fontSize: 11,
                    }}
                  >
                    <span style={{ fontSize: 12 }}>{item.type === "dir" ? "📁" : "📄"}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
                  </div>
                ))}

                {/* Commits */}
                {githubCommits?.commits && githubCommits.commits.length > 0 && (
                  <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid #E2E8F0" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 6 }}>Recent Commits</div>
                    {githubCommits.commits.map((c: any) => (
                      <div key={c.sha} style={{ fontSize: 9, color: "#64748B", padding: "3px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ color: "#005BAC", fontFamily: "monospace" }}>{c.sha}</span> {c.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </aside>
        )}

        {/* Main Content */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {activeTab === "chat" ? (
            <>
              {/* Messages */}
              <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
                {messages.length === 0 && (
                  <div style={{ textAlign: "center", padding: "40px 20px", color: "#94A3B8" }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                    </div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, color: "#475569", margin: "0 0 8px" }}>Kimi Website Agent</h2>
                    <p style={{ fontSize: 13, margin: "0 0 24px", maxWidth: 420, marginInline: "auto" }}>
                      Describe what you want to build. I'll generate code, design layouts, and help you deploy web applications.
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 480, margin: "0 auto" }}>
                      {SUGGESTED_PROMPTS.map((p) => (
                        <button key={p} onClick={() => sendMessage(p)} style={{ padding: "8px 14px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 20, background: "#fff", color: "#475569", cursor: "pointer", fontFamily: "Inter, sans-serif" }}>
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "80%", display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{ width: 20, height: 20, borderRadius: "50%", background: m.role === "user" ? "#005BAC" : "#1F9D55", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 700 }}>
                        {m.role === "user" ? "You" : "KA"}
                      </span>
                      <span style={{ fontSize: 9, color: "#94A3B8" }}>{m.timestamp}</span>
                    </div>
                    <div style={{ padding: "10px 14px", borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px", background: m.role === "user" ? "#005BAC" : "#fff", color: m.role === "user" ? "#fff" : "#2D3748", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", border: m.role === "user" ? "none" : "1px solid #E2E8F0" }}>
                      {m.content}
                    </div>
                    {m.role === "agent" && (
                      <div style={{ display: "flex", gap: 8, paddingLeft: 4 }}>
                        <button onClick={() => copyResponse(m.content)} style={{ fontSize: 9, color: "#94A3B8", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Copy</button>
                      </div>
                    )}
                  </div>
                ))}
                {loading && (
                  <div style={{ alignSelf: "flex-start", padding: "10px 14px", background: "#F1F5F9", borderRadius: "12px 12px 12px 2px" }}>
                    <span style={{ display: "inline-flex", gap: 3 }}>
                      <span style={{ width: 6, height: 6, background: "#94A3B8", borderRadius: "50%", animation: "dotPulse 1.4s ease-in-out infinite" }} />
                      <span style={{ width: 6, height: 6, background: "#94A3B8", borderRadius: "50%", animation: "dotPulse 1.4s ease-in-out infinite .2s" }} />
                      <span style={{ width: 6, height: 6, background: "#94A3B8", borderRadius: "50%", animation: "dotPulse 1.4s ease-in-out infinite .4s" }} />
                    </span>
                  </div>
                )}
              </div>
              {/* Input */}
              <div style={{ padding: "12px 24px 16px", borderTop: "1px solid #E2E8F0", background: "#fff" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end", maxWidth: 800, margin: "0 auto" }}>
                  <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Describe what you want to build..." rows={1} style={{ flex: 1, padding: "10px 14px", fontSize: 13, border: "1px solid #D6DFE8", borderRadius: 12, fontFamily: "Inter, sans-serif", resize: "none", outline: "none", maxHeight: 120 }} />
                  <button onClick={() => sendMessage()} disabled={!input.trim() || loading} style={{ padding: "10px 20px", fontSize: 13, fontWeight: 600, background: input.trim() && !loading ? "#005BAC" : "#CBD5E1", color: "#fff", border: "none", borderRadius: 12, cursor: input.trim() && !loading ? "pointer" : "not-allowed", fontFamily: "Inter, sans-serif", flexShrink: 0 }}>
                    {loading ? "Building..." : "Send"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* GitHub File Editor */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {githubStatus?.configured === false && (
                <div style={{ padding: "40px 20px", textAlign: "center", color: "#94A3B8" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  </div>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: "#DC2626", margin: "0 0 8px" }}>GitHub Not Connected</h3>
                  <p style={{ fontSize: 12, margin: "0 0 16px" }}>Set these environment variables:</p>
                  <div style={{ textAlign: "left", maxWidth: 400, margin: "0 auto", background: "#F1F5F9", padding: "12px 16px", borderRadius: 8, fontSize: 11, fontFamily: "monospace" }}>
                    <div style={{ marginBottom: 4 }}>GITHUB_TOKEN=&lt;your_token&gt;</div>
                    <div style={{ marginBottom: 4 }}>GITHUB_OWNER=&lt;owner&gt;</div>
                    <div>GITHUB_REPO=&lt;repo&gt;</div>
                  </div>
                </div>
              )}
              {githubStatus?.configured && !fileContent && (
                <div style={{ padding: "40px 20px", textAlign: "center", color: "#94A3B8" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
                  </div>
                  <p style={{ fontSize: 13 }}>Select a file from the sidebar to view and edit</p>
                  <p style={{ fontSize: 11, color: "#64748B" }}>{githubStatus.owner}/{githubStatus.repo}</p>
                </div>
              )}
              {fileContent && (
                <>
                  <div style={{ padding: "8px 16px", borderBottom: "1px solid #E2E8F0", background: "#fff", display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>{filePath}</span>
                    <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                      {saveMessage && <span style={{ fontSize: 11, color: "#1F9D55", fontWeight: 600 }}>{saveMessage}</span>}
                      <button onClick={saveFile} disabled={saveFileMut.isPending} style={{ padding: "4px 12px", fontSize: 11, background: "#1F9D55", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
                        {saveFileMut.isPending ? "Saving..." : "Save to GitHub"}
                      </button>
                    </span>
                  </div>
                  <textarea
                    value={fileContent}
                    onChange={(e) => setFileContent(e.target.value)}
                    style={{ flex: 1, padding: 16, fontSize: 12, fontFamily: "monospace", border: "none", outline: "none", resize: "none", lineHeight: 1.6, background: "#FAFBFC" }}
                  />
                </>
              )}
            </div>
          )}
        </main>
      </div>

      <style>{`@keyframes dotPulse { 0%,80%,100%{opacity:.3;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  );
}

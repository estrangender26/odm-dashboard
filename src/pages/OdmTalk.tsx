import { useMemo, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";

export default function OdmTalk() {
  const [query, setQuery] = useState("");
  const threads = trpc.odmTalk.listThreads.useQuery({ limit: 50 });
  const notifications = trpc.odmTalk.notifications.useQuery({ limit: 10 });
  const search = trpc.odmTalk.search.useQuery({ query }, { enabled: query.trim().length > 0 });

  const searchResults = useMemo(() => search.data || [], [search.data]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "Inter, sans-serif" }}>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <Link to="/" className="text-xs font-semibold text-blue-700 no-underline">← Dashboard Suite</Link>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">ODM Talk</h1>
            <p className="text-sm text-slate-500">Central discussion and decision hub for module AI assistants. Module databases remain the source of truth.</p>
          </div>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-800">
            AI posts include labels, source metadata, backlinks, thread IDs, timestamps, and user IDs when available.
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[1fr_320px]">
        <section className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">Search discussions, AI recommendations, action items, decisions, and linked records</label>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search ODM Talk..."
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {query.trim() && (
            <div className="rounded-2xl border border-blue-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-bold text-blue-900">Search Results</h2>
              {search.isLoading ? <p className="text-sm text-slate-500">Searching...</p> : null}
              {!search.isLoading && searchResults.length === 0 ? <p className="text-sm text-slate-500">No results found.</p> : null}
              <div className="space-y-3">
                {searchResults.map(({ thread, message }) => (
                  <article key={`${thread.id}-${message.id}`} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="rounded-full bg-purple-100 px-2 py-0.5 font-bold text-purple-800">AI Generated</span>
                      <span>#{thread.id}</span>
                      <span>{thread.threadType}</span>
                      <span>{message.shareType}</span>
                    </div>
                    <h3 className="mt-2 text-sm font-bold">{thread.title}</h3>
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-slate-700">{message.content}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-slate-600">{message.assistantName}</span>
                      <span>·</span>
                      <span>{message.sourceModule}</span>
                      <span>·</span>
                      <a href={message.sourceUrl} className="font-semibold text-blue-700">Open Source Record</a>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-slate-900">Recent Threads</h2>
            {threads.isLoading ? <p className="text-sm text-slate-500">Loading threads...</p> : null}
            {!threads.isLoading && (threads.data || []).length === 0 ? <p className="text-sm text-slate-500">No ODM Talk threads yet. Use any module assistant's ODM Talk Bridge actions to create one.</p> : null}
            <div className="space-y-3">
              {(threads.data || []).map((thread) => (
                <article key={thread.id} className="rounded-xl border border-slate-200 p-4 transition hover:border-blue-300 hover:shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-700">#{thread.id}</span>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 font-bold text-blue-800">{thread.threadType}</span>
                      {thread.requiresApproval ? <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800">Approval Required</span> : null}
                    </div>
                    <a href={thread.sourceUrl} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white no-underline">Open Source Record</a>
                  </div>
                  <h3 className="mt-3 text-base font-bold">{thread.title}</h3>
                  <dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                    <div><dt className="font-bold text-slate-500">Source Module</dt><dd>{thread.sourceModule}</dd></div>
                    <div><dt className="font-bold text-slate-500">Source Record</dt><dd>{thread.sourceRecordLabel || thread.sourceRecordId}</dd></div>
                    <div><dt className="font-bold text-slate-500">Assistant Name</dt><dd>{thread.assistantName}</dd></div>
                    <div><dt className="font-bold text-slate-500">Status</dt><dd>{thread.status}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          </div>
        </section>

        <aside className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-slate-900">Thread Types</h2>
            <ul className="space-y-1 text-xs text-slate-600">
              {[
                "General Discussion",
                "Maintenance Recommendation",
                "KPI Insight",
                "Risk Review",
                "Action Tracking",
                "Ownership Review",
                "Post-PPP Decision",
                "Gantt Coordination",
                "Manual Governance Review",
              ].map((type) => <li key={type} className="rounded-lg bg-slate-50 px-3 py-2 font-semibold">{type}</li>)}
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-slate-900">Notifications</h2>
            <div className="space-y-2">
              {(notifications.data || []).map((notification) => (
                <div key={notification.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="text-xs font-bold text-slate-800">{notification.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{notification.body}</div>
                </div>
              ))}
              {!notifications.isLoading && (notifications.data || []).length === 0 ? <p className="text-xs text-slate-500">No notifications yet.</p> : null}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

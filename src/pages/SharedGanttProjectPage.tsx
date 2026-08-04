import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";

const DISPLAY_NAME_KEY = "gantt_display_name";
const POLL_INTERVAL_MS = 4000;

export default function SharedGanttProjectPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const access = searchParams.get("access") ?? "";

  const [displayName, setDisplayName] = useState(() =>
    localStorage.getItem(DISPLAY_NAME_KEY) ?? ""
  );
  const [nameEntered, setNameEntered] = useState(() => {
    const saved = localStorage.getItem(DISPLAY_NAME_KEY);
    return !!saved;
  });

  // Capture the token once, then remove it from the visible URL to reduce shoulder-surfing
  // and accidental sharing via copy/paste of the address bar.
  useEffect(() => {
    if (slug && access) {
      const params = new URLSearchParams(searchParams);
      params.delete("access");
      const cleanUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  }, [slug]); // only run once on mount when slug is available

  const loadQuery = trpc.sharedGantt.load.useQuery(
    { slug: slug ?? "", access, sinceRevision: undefined },
    { enabled: !!slug && !!access && nameEntered }
  );

  const [projectRevision, setProjectRevision] = useState(
    loadQuery.data?.project.revision ?? 0
  );

  useEffect(() => {
    if (loadQuery.data?.project.revision !== undefined) {
      setProjectRevision(loadQuery.data.project.revision);
    }
  }, [loadQuery.data?.project.revision]);

  // Lightweight polling: fetch events that happened after the revision we last saw.
  const pollQuery = trpc.sharedGantt.pollEvents.useQuery(
    { slug: slug ?? "", access, afterRevision: projectRevision },
    {
      enabled: !!slug && !!access && nameEntered && projectRevision > 0,
      refetchInterval: POLL_INTERVAL_MS,
    }
  );

  useEffect(() => {
    if (!pollQuery.data) return;
    const data = pollQuery.data;
    if (data.projectRevision > projectRevision) {
      setProjectRevision(data.projectRevision);
      if (data.events.length > 0) {
        void loadQuery.refetch();
      }
    }
  }, [pollQuery.data, projectRevision, loadQuery]);

  const handleNameSubmit = () => {
    const trimmed = displayName.trim();
    if (!trimmed) return;
    localStorage.setItem(DISPLAY_NAME_KEY, trimmed);
    setNameEntered(true);
  };

  const project = loadQuery.data?.project;
  const role = loadQuery.data?.role;

  const title = useMemo(() => {
    if (!project) return "Shared Gantt Project";
    return project.projectName || project.name || "Untitled Project";
  }, [project]);

  // Expose the full share link for intentional copy/share use.
  const fullShareUrl = useMemo(() => {
    if (!slug || !access) return "";
    return `${window.location.origin}/gantt/p/${slug}?access=${access}`;
  }, [slug, access]);

  const copyLink = async () => {
    if (!fullShareUrl) return;
    await navigator.clipboard.writeText(fullShareUrl);
  };

  if (!slug || !access) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertTitle>Missing project link</AlertTitle>
          <AlertDescription>
            This page needs a project slug and an access token in the URL.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!nameEntered) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-md pt-20">
          <Card>
            <CardHeader className="text-center">
              <ProgramsEngineeringLogo className="mx-auto mb-4 h-12" />
              <CardTitle>Join this project</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter the name you want others to see (e.g., Gerald, AMD, Operations).
                No account or password is required.
              </p>
              <Input
                placeholder="Your name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNameSubmit();
                }}
                maxLength={100}
              />
              <Button onClick={handleNameSubmit} disabled={!displayName.trim()} className="w-full">
                Continue
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (loadQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (loadQuery.error) {
    const msg = loadQuery.error.message;
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertTitle>Could not open project</AlertTitle>
          <AlertDescription>{msg}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8">
        <Alert>
          <AlertTitle>Project not found</AlertTitle>
          <AlertDescription>The shared project could not be loaded.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <meta name="referrer" content="no-referrer" />
      <header className="border-b bg-white px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <ProgramsEngineeringLogo className="h-8" />
            <div>
              <h1 className="text-lg font-semibold">{title}</h1>
              <p className="text-xs text-muted-foreground">
                Shared project · {role === "editor" ? "Editor access" : "View-only access"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {fullShareUrl && (
              <Button variant="outline" size="sm" onClick={copyLink}>
                Copy link
              </Button>
            )}
            <span className="text-sm text-muted-foreground">
              Joined as <strong>{displayName}</strong>
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>ODM Primavera Lite Online — Collaboration Foundation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This is the new shared project view for ODM Primavera Lite. The backend
              now supports editor and view-only links, revision-based updates, and an
              append-only audit trail. The full scheduling UI will be wired here in PR 2.
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">Activities</div>
                <div className="text-2xl font-semibold">{loadQuery.data?.tasks.length ?? 0}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">Dependencies</div>
                <div className="text-2xl font-semibold">{loadQuery.data?.dependencies.length ?? 0}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">Project revision</div>
                <div className="text-2xl font-semibold">{projectRevision}</div>
              </div>
            </div>

            {role === "editor" && (
              <div className="rounded bg-yellow-50 p-3 text-sm text-yellow-900">
                You have editor access. Mutations are implemented on the backend and will
                be connected to the scheduling UI in the next PR.
              </div>
            )}

            {role === "viewer" && (
              <div className="rounded bg-blue-50 p-3 text-sm text-blue-900">
                You have view-only access. You can see the latest schedule, but changes
                are disabled.
              </div>
            )}

            <div className="rounded bg-slate-100 p-3 text-xs text-slate-700">
              <strong>Security note:</strong> The access token has been removed from the address bar
              for safety, but you can still copy the full share link above to invite others. The token is
              stored only in memory while this page is open; reload or re-open the original link to return.
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

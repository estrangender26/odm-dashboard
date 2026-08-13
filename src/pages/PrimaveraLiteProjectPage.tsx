import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  computeRolePermissions,
  isProjectUnavailable,
  persistAccessToken,
  resolveAccessToken,
  stripTokenPath,
} from "@/modules/gantt/primavera-lite/pageState";
import WbsTree from "@/modules/gantt/primavera-lite/WbsTree";
import ActivityGrid from "@/modules/gantt/primavera-lite/ActivityGrid";
import Timeline from "@/modules/gantt/primavera-lite/Timeline";
import DependencyPanel from "@/modules/gantt/primavera-lite/DependencyPanel";
import { formatDate } from "@/modules/gantt/primavera-lite/activityGridModel";

export default function PrimaveraLiteProjectPage() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(() => window.location.pathname.split("/gantt/p/")[1] || "", []);
  const urlAccess = searchParams.get("access") || "";

  // Resolve the effective access token: the current URL first, then
  // sessionStorage, otherwise empty. This keeps a full reload (where the URL
  // token has already been stripped) able to recover the credential.
  const [access, setAccess] = useState<string>(() =>
    resolveAccessToken(urlAccess, sessionStorage, slug)
  );

  // A token in the URL always takes precedence over any older stored token,
  // and is persisted to sessionStorage so it survives the visible URL strip.
  useEffect(() => {
    if (urlAccess) {
      setAccess(urlAccess);
      persistAccessToken(sessionStorage, slug, urlAccess);
    }
  }, [urlAccess, slug]);

  const [expectedRevision, setExpectedRevision] = useState(0);
  const [isEditingActivity, setIsEditingActivity] = useState(false);
  const [highlightedActivityId, setHighlightedActivityId] = useState<number | null>(null);
  const [scheduleScrollTop, setScheduleScrollTop] = useState(0);
  const [dataDateDraft, setDataDateDraft] = useState("");

  useEffect(() => {
    if (access) {
      // Strip token from visible URL after capture, keeping it in memory and sessionStorage
      window.history.replaceState({}, "", stripTokenPath(window.location.pathname, slug));
    }
  }, [slug, access]);

  const { data, isLoading, error, refetch } = trpc.primaveraLite.load.useQuery(
    { slug, access },
    { enabled: !!slug && !!access, refetchInterval: isEditingActivity ? false : 5000 }
  );

  useEffect(() => {
    if (data) setExpectedRevision(data.revision);
  }, [data?.revision]);

  const archiveProjectDryRun = trpc.primaveraLite.archiveProjectDryRun.useMutation();
  const archiveProject = trpc.primaveraLite.archiveProject.useMutation({
    onSuccess: () => refetch(),
  });
  const runSchedule = trpc.primaveraLite.runSchedule.useMutation({
    onSuccess: (res) => {
      setExpectedRevision(res.revision);
      refetch();
    },
  });
  const updateProjectMeta = trpc.primaveraLite.updateProjectMeta.useMutation({
    onSuccess: (res) => {
      setExpectedRevision(res.revision);
      refetch();
      setDataDateDraft(formatDate(res.project.dataDate));
    },
  });

  useEffect(() => {
    if (data?.project?.dataDate !== undefined) setDataDateDraft(formatDate(data.project.dataDate));
  }, [data?.project?.dataDate]);

  const handleDataDateSave = () => {
    const value = dataDateDraft === "" ? null : dataDateDraft;
    updateProjectMeta.mutate({ slug, access, expectedRevision, changes: { dataDate: value } });
  };

  const { isAdmin, canEdit } = computeRolePermissions(data?.role);

  const handleArchiveProject = async () => {
    const dryRun = await archiveProjectDryRun.mutateAsync({ slug, access, expectedRevision });
    await archiveProject.mutateAsync({
      slug,
      access,
      expectedRevision,
      previewToken: dryRun.previewToken,
      confirmed: true,
    });
  };

  const handleRunSchedule = async () => {
    await runSchedule.mutateAsync({ slug, access, expectedRevision });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!data || isProjectUnavailable(data.project, error)) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Project Unavailable</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {error?.message || "This project has been archived or the link is invalid."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <meta name="referrer" content="no-referrer" />
      <div className="mx-auto max-w-4xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{data.project?.name || slug}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-muted-foreground">
                Role: {data.role} | Revision: {data.revision} | Last Scheduled:{" "}
                {data.project?.lastScheduledAt
                  ? new Date(data.project.lastScheduledAt).toLocaleString()
                  : "Never"}
                {data.project?.scheduleOutOfDate && (
                  <span role="status" className="ml-2 font-semibold text-amber-700">Schedule Out of Date</span>
                )}
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium" htmlFor="project-data-date">
                    Data Date
                  </label>
                  <input
                    id="project-data-date"
                    type="date"
                    value={dataDateDraft}
                    onChange={(e) => setDataDateDraft(e.target.value)}
                    className="h-9 rounded border px-2 text-sm"
                    aria-label="Project Data Date"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleDataDateSave}
                    disabled={updateProjectMeta.isPending}
                  >
                    {updateProjectMeta.isPending ? "Saving…" : "Set Data Date"}
                  </Button>
                  {updateProjectMeta.error && (
                    <span className="text-xs text-red-600">
                      {updateProjectMeta.error.message}
                    </span>
                  )}
                </div>
              )}
              {canEdit && (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={handleRunSchedule}
                    disabled={runSchedule.isPending}
                  >
                    {runSchedule.isPending ? "Scheduling…" : "Run Schedule"}
                  </Button>
                  {runSchedule.error && (
                    <span className="text-xs text-red-600">
                      {runSchedule.error.message}
                    </span>
                  )}
                </div>
              )}
            </div>

            <WbsTree
              slug={slug}
              access={access}
              role={data.role}
              expectedRevision={expectedRevision}
              nodes={data.wbsNodes}
              onRevisionChange={setExpectedRevision}
              onRefresh={() => refetch()}
            />

            {isAdmin && (
              <Button
                variant="destructive"
                onClick={handleArchiveProject}
                disabled={archiveProjectDryRun.isPending || archiveProject.isPending}
              >
                {archiveProject.isPending ? "Archiving…" : "Archive Project"}
              </Button>
            )}

            <ActivityGrid slug={slug} access={access} role={data.role} expectedRevision={expectedRevision}
              activities={data.activities} wbsNodes={data.wbsNodes} calendars={data.calendars}
              onRevisionChange={setExpectedRevision} onRefresh={() => refetch()}
              onEditingChange={setIsEditingActivity} highlightedActivityId={highlightedActivityId}
              onActivityHighlight={setHighlightedActivityId} verticalScrollTop={scheduleScrollTop}
              onVerticalScroll={setScheduleScrollTop} />

            <Timeline activities={data.activities} dataDate={data.project.dataDate}
              dependencies={data.dependencies}
              highlightedActivityId={highlightedActivityId} onActivityHighlight={setHighlightedActivityId}
              verticalScrollTop={scheduleScrollTop} onVerticalScroll={setScheduleScrollTop} />

            <DependencyPanel slug={slug} access={access} role={data.role} expectedRevision={expectedRevision}
              activities={data.activities} dependencies={data.dependencies}
              onRevisionChange={setExpectedRevision} onRefresh={() => refetch()} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

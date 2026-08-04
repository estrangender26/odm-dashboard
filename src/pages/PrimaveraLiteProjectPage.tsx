import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  computeRolePermissions,
  isProjectUnavailable,
  stripTokenPath,
} from "@/modules/gantt/primavera-lite/pageState";

export default function PrimaveraLiteProjectPage() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(() => window.location.pathname.split("/gantt/p/")[1] || "", []);
  const access = searchParams.get("access") || "";

  const [activityName, setActivityName] = useState("");
  const [expectedRevision, setExpectedRevision] = useState(0);

  useEffect(() => {
    if (access) {
      // Strip token from visible URL after capture, keeping it only in memory
      window.history.replaceState({}, "", stripTokenPath(window.location.pathname, slug));
    }
  }, [slug, access]);

  const { data, isLoading, error, refetch } = trpc.primaveraLite.load.useQuery(
    { slug, access },
    { enabled: !!slug && !!access, refetchInterval: 5000 }
  );

  useEffect(() => {
    if (data) setExpectedRevision(data.revision);
  }, [data?.revision]);

  const createActivity = trpc.primaveraLite.createActivity.useMutation({
    onSuccess: (res) => {
      setExpectedRevision(res.revision);
      setActivityName("");
      refetch();
    },
  });

  const archiveActivity = trpc.primaveraLite.archiveActivity.useMutation({
    onSuccess: (res) => {
      setExpectedRevision(res.revision);
      refetch();
    },
  });

  const archiveProject = trpc.primaveraLite.archiveProject.useMutation({
    onSuccess: () => refetch(),
  });

  const { canEdit, isAdmin } = computeRolePermissions(data?.role);

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
            <div className="text-sm text-muted-foreground">
              Role: {data.role} | Revision: {data.revision}
            </div>

            {isAdmin && (
              <Button
                variant="destructive"
                onClick={() =>
                  archiveProject.mutate({
                    slug,
                    access,
                    expectedRevision,
                    confirmed: true,
                  })
                }
                disabled={archiveProject.isPending}
              >
                {archiveProject.isPending ? "Archiving…" : "Archive Project"}
              </Button>
            )}

            {canEdit && (
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label htmlFor="activityName">New activity</Label>
                  <Input
                    id="activityName"
                    value={activityName}
                    onChange={(e) => setActivityName(e.target.value)}
                    placeholder="Activity name"
                  />
                </div>
                <Button
                  className="self-end"
                  onClick={() =>
                    createActivity.mutate({
                      slug,
                      access,
                      expectedRevision,
                      activity: { activityName },
                    })
                  }
                  disabled={!activityName.trim() || createActivity.isPending}
                >
                  Add
                </Button>
              </div>
            )}

            <div>
              <h3 className="mb-2 text-sm font-semibold">Activities</h3>
              {data.activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activities yet.</p>
              ) : (
                <ul className="space-y-2">
                  {data.activities.map((activity) => (
                    <li
                      key={activity.id}
                      className="flex items-center justify-between rounded border bg-white p-3"
                    >
                      <span className="text-sm">{activity.activityName}</span>
                      {canEdit && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            archiveActivity.mutate({
                              slug,
                              access,
                              expectedRevision,
                              activityId: activity.id,
                              confirmed: true,
                            })
                          }
                          disabled={archiveActivity.isPending}
                        >
                          Archive
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

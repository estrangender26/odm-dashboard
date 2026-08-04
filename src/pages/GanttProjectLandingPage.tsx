import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";

const DISPLAY_NAME_KEY = "gantt_display_name";

export default function GanttProjectLandingPage() {
  const navigate = useNavigate();
  const [projectName, setProjectName] = useState("");
  const [displayName, setDisplayName] = useState(() =>
    localStorage.getItem(DISPLAY_NAME_KEY) ?? ""
  );

  const createMutation = trpc.sharedGantt.createShared.useMutation({
    onSuccess: (data) => {
      if (displayName.trim()) {
        localStorage.setItem(DISPLAY_NAME_KEY, displayName.trim());
      }
      navigate(data.editorUrl);
    },
  });

  const handleCreate = () => {
    const name = projectName.trim();
    if (!name || createMutation.isPending) return;
    createMutation.mutate({
      name,
      projectName: name,
      actorName: displayName.trim() || undefined,
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-md pt-20">
        <Card>
          <CardHeader className="text-center">
            <ProgramsEngineeringLogo className="mx-auto mb-4 h-12" />
            <CardTitle>ODM Primavera Lite Online</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Create a collaborative, link-based Gantt project. Anyone with the
              editor link can update the schedule; anyone with the view-only link
              can open and inspect it. No account required.
            </p>

            <div className="space-y-2">
              <Label htmlFor="projectName">Project name</Label>
              <Input
                id="projectName"
                placeholder="e.g., Calawis Handover"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
                maxLength={255}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName">Your display name</Label>
              <Input
                id="displayName"
                placeholder="e.g., Gerald, AMD, Operations"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={100}
              />
            </div>

            <Button
              onClick={handleCreate}
              disabled={!projectName.trim() || createMutation.isPending}
              className="w-full"
            >
              {createMutation.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner className="h-4 w-4" /> Creating...
                </span>
              ) : (
                "Create shared project"
              )}
            </Button>

            {createMutation.error && (
              <p className="text-sm text-red-600">{createMutation.error.message}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

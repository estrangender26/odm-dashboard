import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import {
  addRememberedLink,
  extractTokenFromUrl,
  stripTokenPath,
} from "@/modules/gantt/primavera-lite/pageState";

const DISPLAY_NAME_KEY = "primavera-lite-display-name";

export default function GanttNewProjectPage() {
  const navigate = useNavigate();
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [displayName, setDisplayName] = useState(() => localStorage.getItem(DISPLAY_NAME_KEY) ?? "");
  const [created, setCreated] = useState<{
    name: string;
    slug: string;
    adminLink: string;
    editorLink: string;
    viewerLink: string;
  } | null>(null);

  const createMutation = trpc.primaveraLite.createProject.useMutation({
    onSuccess: (data) => {
      if (displayName.trim()) {
        localStorage.setItem(DISPLAY_NAME_KEY, displayName.trim());
      }
      setCreated({
        name: data.project.name,
        slug: data.project.slug,
        adminLink: data.adminLink,
        editorLink: data.editorLink,
        viewerLink: data.viewerLink,
      });

      addRememberedLink(localStorage, {
        slug: data.project.slug,
        name: data.project.name,
        adminUrl: data.adminLink,
        createdAt: new Date().toISOString(),
      });

      if (window.location.search) {
        window.history.replaceState({}, "", window.location.pathname);
      }
    },
  });

  const handleCreate = () => {
    const name = projectName.trim();
    if (!name || createMutation.isPending) return;
    createMutation.mutate({
      name,
      description: description.trim() || undefined,
      actorName: displayName.trim() || undefined,
    });
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => alert("Copied to clipboard"));
  };

  const adminToken = created ? extractTokenFromUrl(created.adminLink) ?? "" : "";
  const projectPath = created ? stripTokenPath(`/gantt/p/${created.slug}`, created.slug) : "";

  return (
    <div className="min-h-screen bg-slate-50">
      <header
        className="text-white"
        style={{ background: "linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)" }}
      >
        <div className="mx-auto flex max-w-4xl items-center px-4 py-3">
          <Link
            to="/"
            aria-label="Dashboard Home"
            title="Dashboard Home"
            className="flex items-center gap-3 text-white no-underline"
          >
            <ProgramsEngineeringLogo size={56} borderRadius={8} />
            <div>
              <h1 className="text-base font-bold leading-tight sm:text-lg">Create Primavera Lite Project</h1>
              <p className="text-[0.65rem] uppercase tracking-[0.22em] opacity-70">Link-based project scheduling</p>
            </div>
          </Link>
        </div>
      </header>

      <main className="p-6">
        <div className="mx-auto max-w-md pt-6">
          <meta name="referrer" content="no-referrer" />
          <Card>
            <CardHeader className="text-center">
              <CardTitle>Create Primavera Lite Project</CardTitle>
            </CardHeader>
          <CardContent className="space-y-4">
            {!created ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="projectName">Project name</Label>
                  <Input
                    id="projectName"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="e.g., Calawis Handover"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Input
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Short project description"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="displayName">Your display name (optional)</Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g., Gerald"
                  />
                </div>

                <Button onClick={handleCreate} disabled={createMutation.isPending} className="w-full">
                  {createMutation.isPending ? <Spinner className="h-4 w-4" /> : "Create Project"}
                </Button>
              </>
            ) : (
              <div className="space-y-4">
                <p className="text-sm font-medium">{created.name}</p>

                <div className="rounded bg-amber-50 p-3 text-xs text-amber-800">
                  Save the admin link now. It will not be shown again and cannot be recovered from the server.
                </div>

                <div className="space-y-2">
                  <Label>Admin link (full control)</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={created.adminLink} className="text-xs" />
                    <Button variant="outline" onClick={() => copy(created.adminLink)}>Copy</Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Editor link</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={created.editorLink} className="text-xs" />
                    <Button variant="outline" onClick={() => copy(created.editorLink)}>Copy</Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Viewer link</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={created.viewerLink} className="text-xs" />
                    <Button variant="outline" onClick={() => copy(created.viewerLink)}>Copy</Button>
                  </div>
                </div>

                <Button className="w-full" onClick={() => navigate(`${projectPath}?access=${adminToken}`)}>
                  Open Project
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </main>
    </div>
  );
}

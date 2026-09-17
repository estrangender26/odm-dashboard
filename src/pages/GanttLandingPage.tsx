import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import { readRememberedLinks } from "@/modules/gantt/primavera-lite/pageState";

type RememberedLink = {
  slug: string;
  name: string;
  adminUrl: string;
  createdAt: string;
};

export default function GanttLandingPage() {
  const [links, setLinks] = useState<RememberedLink[]>([]);
  const [validating, setValidating] = useState(true);

  useEffect(() => {
    setLinks(readRememberedLinks(localStorage));
    setValidating(false);
  }, []);

  return (
    <div className="odm-canvas min-h-screen">
      <header
        className=""
        style={{ background: "var(--pe-white)" }}
      >
        <div className="odm-workspace-shell flex items-center py-3">
          <Link
            to="/"
            aria-label="Dashboard Home"
            title="Dashboard Home"
            className="flex items-center gap-3 text-pe-text-strong no-underline"
          >
            <ProgramsEngineeringLogo size={56} borderRadius={8} tight />
            <div>
              <h1 className="pe-header-title">ODM Primavera Lite Online</h1>
              <p className="pe-header-sub">Link-based project scheduling</p>
            </div>
          </Link>
        </div>
      </header>

      <main className="py-6">
        <div className="odm-workspace-shell pt-6">
          <meta name="referrer" content="no-referrer" />
          <Card>
            <CardHeader className="text-center">
              <CardTitle>ODM Primavera Lite Online</CardTitle>
            </CardHeader>
          <CardContent className="space-y-6">
            {/* Explanatory copy keeps a readable measure while the project
                list below uses the full workspace width. */}
            <p className="max-w-3xl text-sm text-muted-foreground">
              Link-based project scheduling. No account required. Keep your admin link safe — it is the only way to manage a project.
            </p>

            <div className="flex justify-center">
              <Link to="/gantt/new">
                <Button>Create New Project</Button>
              </Link>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">My Projects</h3>
              {validating ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="h-4 w-4" /> Loading remembered projects…
                </div>
              ) : links.length === 0 ? (
                <p className="max-w-3xl text-sm text-muted-foreground">
                  No remembered projects. Create one above, or paste an admin link into the address bar.
                </p>
              ) : (
                <ul className="space-y-2">
                  {links.map((link) => (
                    <li key={link.slug}>
                      <a
                        href={link.adminUrl}
                        className="block rounded border bg-white p-3 text-sm hover:bg-slate-100"
                      >
                        <div className="break-words font-medium">{link.name || link.slug}</div>
                        <div className="break-words text-xs text-muted-foreground">{link.slug}</div>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="max-w-3xl rounded bg-amber-50 p-3 text-xs text-amber-800">
              Warning: Remembered projects are stored in this browser. If browser storage is cleared and you have not saved the admin link elsewhere, you may lose access.
            </div>
          </CardContent>
        </Card>
      </div>
      </main>
    </div>
  );
}

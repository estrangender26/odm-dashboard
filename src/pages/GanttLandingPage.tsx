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
              <h1 className="text-base font-bold leading-tight sm:text-lg">ODM Primavera Lite Online</h1>
              <p className="text-[0.65rem] uppercase tracking-[0.22em] opacity-70">Link-based project scheduling</p>
            </div>
          </Link>
        </div>
      </header>

      <main className="p-6">
        <div className="mx-auto max-w-2xl pt-6">
          <meta name="referrer" content="no-referrer" />
          <Card>
            <CardHeader className="text-center">
              <CardTitle>ODM Primavera Lite Online</CardTitle>
            </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm text-muted-foreground">
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
                <p className="text-sm text-muted-foreground">
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
                        <div className="font-medium">{link.name || link.slug}</div>
                        <div className="text-xs text-muted-foreground">{link.slug}</div>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded bg-amber-50 p-3 text-xs text-amber-800">
              Warning: Remembered projects are stored in this browser. If browser storage is cleared and you have not saved the admin link elsewhere, you may lose access.
            </div>
          </CardContent>
        </Card>
      </div>
      </main>
    </div>
  );
}

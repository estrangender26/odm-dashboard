import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { MODULE_IDENTITY, ModuleMasthead, SuiteMasthead } from "@/components/programs";
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
      {/*
        Programs Engineering suite identity sits ABOVE module identity; both
        rows are white-dominant and replace the previous dark navy header.
        The identity link keeps its "Dashboard Home" contract via
        linkAriaLabel/linkTitle, and its aria-label gives the page its
        accessible home affordance.
      */}
      <SuiteMasthead linkAriaLabel="Dashboard Home" linkTitle="Dashboard Home" />

      <ModuleMasthead
        showIdentityRow={false}
        icon={MODULE_IDENTITY.primavera.icon}
        tone={MODULE_IDENTITY.primavera.tone}
        title="ODM Primavera Lite Online"
        subtitle="Link-based project scheduling — no account required"
      />

      <main className="p-6">
        <div className="mx-auto max-w-2xl pt-6">
          <meta name="referrer" content="no-referrer" />
          <Card>
            <CardHeader className="text-center">
              <CardTitle>ODM Primavera Lite Online</CardTitle>
            </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm text-pe-muted">
              Link-based project scheduling. No account required. Keep your admin link safe — it is the only way to manage a project.
            </p>

            <div className="flex justify-center">
              <Link to="/gantt/new" className="pe-btn pe-btn--primary no-underline">
                Create New Project
              </Link>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-pe-text-strong">My Projects</h3>
              {validating ? (
                <div className="flex items-center gap-2 text-sm text-pe-muted">
                  <Spinner className="h-4 w-4" /> Loading remembered projects…
                </div>
              ) : links.length === 0 ? (
                <p className="text-sm text-pe-muted">
                  No remembered projects. Create one above, or paste an admin link into the address bar.
                </p>
              ) : (
                <ul className="space-y-2">
                  {links.map((link) => (
                    <li key={link.slug}>
                      <a
                        href={link.adminUrl}
                        className="pe-focusable block rounded-md border border-pe-border bg-white p-3 text-sm text-pe-text no-underline hover:border-pe-blue-border hover:bg-pe-row-hover"
                      >
                        <div className="font-medium">{link.name || link.slug}</div>
                        <div className="text-xs text-pe-faint">{link.slug}</div>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-md border border-odm-warning-border bg-odm-warning-bg p-3 text-xs text-odm-warning">
              Warning: Remembered projects are stored in this browser. If browser storage is cleared and you have not saved the admin link elsewhere, you may lose access.
            </div>
          </CardContent>
        </Card>
      </div>
      </main>
    </div>
  );
}

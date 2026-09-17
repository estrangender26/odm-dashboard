/**
 * NotFound — Programs Engineering empty state for unknown routes.
 *
 * Supporting surface, so it carries the compact suite identity (masthead) rather
 * than the landing hero: a white card on the soft PE canvas, a teal orb, and one
 * primary action back to the suite. Calm and corporate — no illustration, no
 * dark background. The route target ("/") is unchanged.
 */
import { Link } from "react-router";
import { FileQuestion } from "lucide-react";
import { PeIconOrb, SuiteMasthead } from "@/components/programs";

export default function NotFound() {
  return (
    <div
      className="odm-canvas min-h-screen flex flex-col"
      style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}
    >
      <SuiteMasthead suiteTitle="Program Oversight Center" />

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <section
          className="pe-card w-full"
          style={{ maxWidth: 440, padding: "30px 26px 28px", textAlign: "center" }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            <PeIconOrb icon={FileQuestion} tone="teal" size="lg" />

            <h1
              style={{
                margin: 0,
                fontSize: 34,
                fontWeight: 800,
                letterSpacing: "-0.6px",
                color: "var(--pe-text-strong)",
              }}
            >
              404
            </h1>

            <span className="pe-gradient-rule" style={{ display: "block", width: 72 }} />

            <p
              style={{
                margin: 0,
                fontSize: 14.5,
                fontWeight: 600,
                color: "var(--pe-text)",
              }}
            >
              Page not found
            </p>

            <p
              style={{
                margin: 0,
                maxWidth: 340,
                fontSize: 13,
                lineHeight: 1.55,
                color: "var(--pe-text-muted)",
              }}
            >
              The page you requested is not part of the Programs Engineering suite.
              Use the link below to return to the suite home.
            </p>

            <Link
              to="/"
              className="pe-btn pe-btn--primary pe-focusable"
              style={{
                marginTop: 6,
                padding: "9px 18px",
                fontSize: 13.5,
                textDecoration: "none",
              }}
            >
              Back to Home
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

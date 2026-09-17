/**
 * Login — OWNER / administrator entry point.
 *
 * Deliberately quiet: white card on the soft PE canvas, compact suite identity
 * in the masthead, charcoal-on-white type, and the banner's blue → teal sweep on
 * the single primary action. Authentication behaviour is untouched — the button
 * still redirects to /api/oauth/authorize exactly as before.
 */
import { ShieldCheck } from "lucide-react";
import { PeIconOrb, SuiteMasthead } from "@/components/programs";

export default function Login() {
  return (
    <div
      className="odm-canvas min-h-screen flex flex-col"
      style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}
    >
      <SuiteMasthead suiteTitle="Program Oversight Center" />

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <section className="pe-card w-full" style={{ maxWidth: 400 }}>
          <div
            className="pe-card__header"
            style={{ padding: "22px 20px 18px", textAlign: "center" }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
              }}
            >
              <PeIconOrb icon={ShieldCheck} tone="blue" size="lg" />

              <h1
                style={{
                  margin: 0,
                  fontSize: 19,
                  fontWeight: 700,
                  letterSpacing: "-0.2px",
                  color: "var(--pe-text-strong)",
                }}
              >
                ODM Dashboard
              </h1>

              <p
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  color: "var(--pe-text-muted)",
                }}
              >
                OWNER / Administrator Access
              </p>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: "18px 20px 20px",
            }}
          >
            <button
              type="button"
              className="pe-btn pe-btn--primary pe-focusable"
              style={{ width: "100%", padding: "10px 16px", fontSize: 13.5 }}
              onClick={() => {
                window.location.href = "/api/oauth/authorize";
              }}
            >
              Sign in with Google
            </button>

            <p
              style={{
                margin: 0,
                textAlign: "center",
                fontSize: 11.5,
                color: "var(--pe-text-faint)",
              }}
            >
              Administrator access only.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

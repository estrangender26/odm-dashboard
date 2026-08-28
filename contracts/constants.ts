export const Session = {
  // Provider-neutral session cookie. Renamed from "kimi_sid" when Kimi auth
  // was retired; existing Kimi sessions are intentionally invalidated.
  cookieName: "odm_sid",
  maxAgeMs: 365 * 24 * 60 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "Authentication required",
  insufficientRole: "Insufficient permissions",
} as const;

export const Paths = {
  login: "/login",
  oauthCallback: "/api/oauth/callback",
} as const;

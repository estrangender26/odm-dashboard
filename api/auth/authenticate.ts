import * as cookie from "cookie";
import { Session } from "@contracts/constants";
import { Errors } from "@contracts/errors";
import { verifySessionToken } from "./session";
import { findUserByAuthSubject } from "../queries/users";

/**
 * Authenticates a request from its provider-neutral ODM session cookie.
 * Returns the DB user row or throws forbidden. Replaces the Kimi-era
 * authenticateRequest; the session cookie is now `odm_sid` and the user is
 * resolved by (auth_provider, auth_subject) instead of union_id.
 */
export async function authenticateRequest(headers: Headers) {
  const cookies = cookie.parse(headers.get("cookie") || "");
  const token = cookies[Session.cookieName];
  if (!token) {
    console.warn("[auth] No session cookie found in request.");
    throw Errors.forbidden("Invalid authentication token.");
  }
  const claim = await verifySessionToken(token);
  if (!claim) {
    throw Errors.forbidden("Invalid authentication token.");
  }
  const user = await findUserByAuthSubject(claim.provider, claim.sub);
  if (!user) {
    throw Errors.forbidden("User not found. Please re-login.");
  }
  return user;
}

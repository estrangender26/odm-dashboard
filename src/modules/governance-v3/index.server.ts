/**
 * Governance V3 Presentation Module (Server-Only)
 * Exports that require database access
 * 
 * @server-only
 */

export * from "./index";
export { fetchGovernanceV3Data } from "./adapter.server";

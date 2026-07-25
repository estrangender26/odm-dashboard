import type { FacilityGovernanceData } from "./governanceTypes";

const API_URL = import.meta.env.VITE_API_URL || "/api/trpc";

/**
 * Fetch governance presentation data from the tRPC endpoint.
 * This is a direct HTTP fetch (not a React hook) suitable for use in async functions.
 */
export async function fetchGovernancePresentationData(
  reportingDate?: string
): Promise<{ facilities: FacilityGovernanceData[]; reportingDate: string }> {
  const date = reportingDate || new Date().toISOString().split("T")[0];
  
  const response = await fetch(`${API_URL}/governance.presentationData`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      json: { reportingDate: date },
    }),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error?.message || `Failed to fetch governance data: ${response.status}`
    );
  }
  
  const result = await response.json();
  
  // tRPC batch response format: [{ result: { data: ... } }]
  const data = Array.isArray(result) ? result[0]?.result?.data : result;
  
  if (!data || !Array.isArray(data.facilities)) {
    throw new Error("Invalid response format from governance endpoint");
  }
  
  return {
    facilities: data.facilities,
    reportingDate: data.reportingDate || date,
  };
}

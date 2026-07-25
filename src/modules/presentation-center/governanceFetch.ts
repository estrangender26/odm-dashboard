import type { FacilityGovernanceData } from "./governanceTypes";

/**
 * Fetch governance presentation data from the REST API endpoint.
 * This is a direct HTTP GET fetch (not a React hook) suitable for use in async functions.
 */
export async function fetchGovernancePresentationData(
  reportingDate?: string
): Promise<{ facilities: FacilityGovernanceData[]; reportingDate: string }> {
  const date = reportingDate || new Date().toISOString().split("T")[0];
  
  const url = `/api/governance/presentation-data?reporting_date=${encodeURIComponent(date)}`;
  
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error || `Failed to fetch governance data: ${response.status}`
    );
  }
  
  const data = await response.json();
  
  if (!data || !Array.isArray(data.facilities)) {
    throw new Error("Invalid response format from governance endpoint");
  }
  
  return {
    facilities: data.facilities,
    reportingDate: data.reportingDate || date,
  };
}

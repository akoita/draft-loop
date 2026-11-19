import type { ApiClient, ApiSchemas } from "./api-client.js";

type Application = ApiSchemas["Application"];

/**
 * The address's identity for "is this the same job page": the parsed URL without its fragment or
 * a trailing slash, so `https://Jobs.example/1/` and `https://jobs.example/1#apply` match. An
 * address that does not parse is compared as typed.
 */
export function jobPageKey(address: string): string {
  try {
    const url = new URL(address.trim());
    url.hash = "";
    const key = url.toString();
    return key.endsWith("/") ? key.slice(0, -1) : key;
  } catch {
    return address.trim();
  }
}

/**
 * The application already kept for this job page, so retrying New application with the same
 * address opens it instead of creating a second one (#2942). Only applications on the main list
 * whose job source is an approved page are read; archived ones stay archived. A failed read
 * answers undefined, and the caller creates the application as asked.
 */
export async function existingJobPageApplication(
  client: ApiClient,
  workspaceId: string,
  address: string,
): Promise<Application | undefined> {
  const key = jobPageKey(address);
  try {
    const { applications } = await client.call("GET /v1/workspaces/{workspaceId}/applications", {
      path: { workspaceId },
    });
    const candidates = applications.filter(
      (application) =>
        application.jobSourceKind === "approved-url" && application.archivedAt === null,
    );
    for (const application of candidates) {
      const job = await client.call(
        "GET /v1/workspaces/{workspaceId}/applications/{applicationId}/job",
        { path: { workspaceId, applicationId: application.id } },
      );
      if (job.url !== null && job.url !== undefined && jobPageKey(job.url) === key) {
        return application;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

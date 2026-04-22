/**
 * Dokploy tRPC client helpers.
 */

export type JsonMap = Record<string, unknown>;

function getDokployUrl(): string {
  return process.env.DOKPLOY_URL || "";
}

function getDokployToken(): string {
  return process.env.DOKPLOY_TOKEN || "";
}

function requireDokployConfig() {
  const url = getDokployUrl();
  const token = getDokployToken();
  if (!url) throw new Error("DOKPLOY_URL not configured");
  if (!token) throw new Error("DOKPLOY_TOKEN not configured");
  return { url, token };
}

export async function dokployQuery(procedure: string, input: JsonMap = {}): Promise<any> {
  const { url: dokployUrl, token } = requireDokployConfig();
  const wrapped = Object.keys(input).length > 0 ? { json: input } : input;
  const url = `${dokployUrl}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(wrapped))}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-api-key": token,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dokploy ${procedure} failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const data = json?.result?.data;
  return data?.json ?? data ?? json;
}

export async function dokployMutate(procedure: string, input: JsonMap = {}): Promise<any> {
  const { url: dokployUrl, token } = requireDokployConfig();
  const url = `${dokployUrl}/api/trpc/${procedure}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-api-key": token,
    },
    body: JSON.stringify({ json: input }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dokploy ${procedure} failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const data = json?.result?.data;
  return data?.json ?? data ?? json;
}

export const getProjects = () => dokployQuery("project.all", {});
export const getApplication = (applicationId: string) =>
  dokployQuery("application.one", { applicationId });
export const getApplicationDeployments = (applicationId: string) =>
  dokployQuery("deployment.all", { applicationId });
export const getServers = () => dokployQuery("server.all", {});
export const getApplicationDomains = (applicationId: string) =>
  dokployQuery("domain.byApplicationId", { applicationId });

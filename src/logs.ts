import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getApplication, getApplicationDeployments } from "./dokploy.js";

const execFileAsync = promisify(execFile);

type AnyRecord = Record<string, unknown>;

type RuntimeContainer = {
  id: string;
  name: string;
  image?: string;
  status?: string;
};

function asRecord(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null ? (value as AnyRecord) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function pickStrings(record: AnyRecord, keys: string[]): string[] {
  return keys
    .map((key) => record[key])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseTail(rawTail: string | undefined, fallback = 100): number {
  const parsed = Number.parseInt(rawTail || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 10000);
}

async function readTextFileIfPresent(path: string | undefined): Promise<string | null> {
  if (!path) return null;
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function listDockerContainers(): Promise<RuntimeContainer[]> {
  try {
    const { stdout } = await execFileAsync("docker", ["ps", "-a", "--format", "{{json .}}"]);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, string>)
      .map((row) => ({
        id: row.ID || "",
        name: row.Names || "",
        image: row.Image || undefined,
        status: row.Status || undefined,
      }))
      .filter((container) => container.id && container.name);
  } catch {
    return [];
  }
}

function extractContainerCandidates(application: AnyRecord, deployment: AnyRecord | undefined): string[] {
  const applicationCandidates = pickStrings(application, [
    "containerId",
    "containerName",
    "serviceName",
    "appName",
    "name",
    "slug",
  ]);

  const deploymentCandidates = deployment
    ? pickStrings(deployment, ["containerId", "containerName", "serviceName", "appName", "name"])
    : [];

  return uniqueStrings([...applicationCandidates, ...deploymentCandidates]);
}

function findMatchingContainer(containers: RuntimeContainer[], candidates: string[]): RuntimeContainer | null {
  for (const candidate of candidates) {
    const direct = containers.find(
      (container) =>
        container.id === candidate ||
        container.id.startsWith(candidate) ||
        container.name === candidate,
    );
    if (direct) return direct;
  }

  for (const candidate of candidates) {
    const fuzzy = containers.find((container) => container.name.includes(candidate));
    if (fuzzy) return fuzzy;
  }

  return null;
}

export async function getDeployLogs(applicationId: string) {
  const deployments = asArray(await getApplicationDeployments(applicationId));
  if (!deployments.length) {
    return {
      applicationId,
      deploymentId: null,
      status: "unknown",
      createdAt: null,
      logPath: null,
      logs: "No deployments found",
      source: "none",
    };
  }

  const latest = asRecord(deployments[0]);
  const logPath = typeof latest.logPath === "string" ? latest.logPath : null;
  const logContent = await readTextFileIfPresent(logPath || undefined);

  return {
    applicationId,
    deploymentId: latest.deploymentId ?? null,
    status: latest.status ?? null,
    createdAt: latest.createdAt ?? null,
    logPath,
    logs: logContent || (logPath ? `Could not read log file: ${logPath}` : "No log content available"),
    source: logContent ? "filesystem" : "none",
  };
}

export async function getRuntimeLogs(applicationId: string, rawTail?: string) {
  const tail = parseTail(rawTail, 100);
  const application = asRecord(await getApplication(applicationId));
  const deployments = asArray(await getApplicationDeployments(applicationId));
  const latestDeployment = deployments.length ? asRecord(deployments[0]) : undefined;
  const candidates = extractContainerCandidates(application, latestDeployment);
  const containers = await listDockerContainers();
  const matchedContainer = findMatchingContainer(containers, candidates);

  if (!matchedContainer) {
    return {
      applicationId,
      tail,
      source: containers.length ? "docker-cli-no-match" : "docker-cli-unavailable",
      logs:
        "Runtime logs unavailable. No matching local Docker container was found for this application. Mount the Docker socket and ensure the service can resolve the target container.",
      candidates,
      container: null,
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync("docker", ["logs", "--tail", String(tail), matchedContainer.id]);
    return {
      applicationId,
      tail,
      source: "docker-cli",
      logs: stdout || stderr || "No runtime log output available",
      candidates,
      container: matchedContainer,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      applicationId,
      tail,
      source: "docker-cli-error",
      logs: `Runtime logs unavailable: ${detail}`,
      candidates,
      container: matchedContainer,
    };
  }
}

export async function listRuntimeContainers(serverId?: string) {
  const containers = await listDockerContainers();
  return {
    source: containers.length ? "docker-cli" : "docker-cli-unavailable",
    serverId: serverId || null,
    containers,
  };
}

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

type DockerInspection = {
  available: boolean;
  reason?: string;
  containers: RuntimeContainer[];
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

async function inspectDockerContainers(): Promise<DockerInspection> {
  try {
    const { stdout } = await execFileAsync("docker", ["ps", "-a", "--format", "{{json .}}"]);
    const containers = stdout
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
    return {
      available: true,
      containers,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const reason = detail.includes("ENOENT")
      ? "docker-cli-missing"
      : detail.includes("permission denied")
        ? "docker-cli-permission-denied"
        : detail.includes("Cannot connect to the Docker daemon")
          ? "docker-daemon-unreachable"
          : "docker-cli-unavailable";
    return {
      available: false,
      reason,
      containers: [],
    };
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
  const docker = await inspectDockerContainers();
  const matchedContainer = findMatchingContainer(docker.containers, candidates);

  if (!matchedContainer) {
    const unavailableMessage = docker.available
      ? "Runtime logs unavailable. No matching local Docker container was found for this application."
      : docker.reason === "docker-cli-missing"
        ? "Runtime logs unavailable because the Docker CLI is not installed in the dokploy-manager container."
        : docker.reason === "docker-daemon-unreachable"
          ? "Runtime logs unavailable because the Docker daemon is not reachable from the dokploy-manager container."
          : docker.reason === "docker-cli-permission-denied"
            ? "Runtime logs unavailable because the dokploy-manager container does not have permission to talk to Docker."
            : "Runtime logs unavailable because Docker inspection is not available in the dokploy-manager container.";
    return {
      applicationId,
      tail,
      source: docker.available ? "docker-cli-no-match" : (docker.reason || "docker-cli-unavailable"),
      logs: unavailableMessage,
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
  const docker = await inspectDockerContainers();
  return {
    source: docker.available ? "docker-cli" : (docker.reason || "docker-cli-unavailable"),
    serverId: serverId || null,
    containers: docker.containers,
  };
}

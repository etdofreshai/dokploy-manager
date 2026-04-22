import { Hono } from "hono";
import {
  dokployMutate,
  dokployQuery,
  getApplication,
  getApplicationDeployments,
  getApplicationDomains,
  getProjects,
  getServers,
} from "./dokploy.js";
import { getDeployLogs, getRuntimeLogs, listRuntimeContainers } from "./logs.js";
import { html } from "./ui.js";

type AnyRecord = Record<string, any>;

type DokployDependencies = {
  dokployQuery: typeof dokployQuery;
  dokployMutate: typeof dokployMutate;
  getApplication: typeof getApplication;
  getApplicationDeployments: typeof getApplicationDeployments;
  getApplicationDomains: typeof getApplicationDomains;
  getProjects: typeof getProjects;
  getServers: typeof getServers;
  getDeployLogs: typeof getDeployLogs;
  getRuntimeLogs: typeof getRuntimeLogs;
  listRuntimeContainers: typeof listRuntimeContainers;
};

type CreateAppOptions = {
  dokploy?: Partial<DokployDependencies>;
};

function getManagerToken(): string {
  return (
    process.env.DOKPLOY_MANAGER_TOKEN ||
    process.env.DOKPLOY_EDITOR_TOKEN ||
    process.env.DOKPLOY_VIEWER_TOKEN ||
    ""
  );
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function flattenServices(projects: unknown): AnyRecord[] {
  const services: AnyRecord[] = [];

  for (const project of asArray<AnyRecord>(projects)) {
    for (const application of asArray<AnyRecord>(project.applications)) {
      services.push({
        ...application,
        _type: "application",
        _project: project.name,
        _env: null,
      });
    }

    for (const compose of asArray<AnyRecord>(project.compose)) {
      services.push({
        ...compose,
        _type: "compose",
        _project: project.name,
        _env: null,
      });
    }

    for (const environment of asArray<AnyRecord>(project.environments)) {
      for (const application of asArray<AnyRecord>(environment.applications)) {
        services.push({
          ...application,
          _type: "application",
          _project: project.name,
          _env: environment.name,
        });
      }
      for (const compose of asArray<AnyRecord>(environment.compose)) {
        services.push({
          ...compose,
          _type: "compose",
          _project: project.name,
          _env: environment.name,
        });
      }
    }
  }

  return services;
}

function flattenApplications(projects: unknown): AnyRecord[] {
  return flattenServices(projects).filter((service) => service._type === "application");
}

async function aggregateDomains(applications: AnyRecord[], deps: DokployDependencies) {
  const domainGroups = await Promise.all(
    applications.map(async (application) => {
      try {
        const domains = asArray(await deps.getApplicationDomains(application.applicationId));
        return domains.map((domain) => ({
          ...(typeof domain === "object" && domain !== null ? (domain as AnyRecord) : {}),
          applicationId: application.applicationId,
          applicationName: application.name || application.appName || application.applicationId,
        }));
      } catch {
        return [];
      }
    }),
  );

  return domainGroups.flat();
}

async function aggregateDeployments(applications: AnyRecord[], deps: DokployDependencies) {
  const deploymentGroups = await Promise.all(
    applications.map(async (application) => {
      try {
        const deployments = asArray(await deps.getApplicationDeployments(application.applicationId));
        return deployments.map((deployment) => ({
          ...(typeof deployment === "object" && deployment !== null ? (deployment as AnyRecord) : {}),
          applicationId: application.applicationId,
          applicationName: application.name || application.appName || application.applicationId,
        }));
      } catch {
        return [];
      }
    }),
  );

  return deploymentGroups.flat();
}

function getMetadata() {
  return {
    name: "dokploy-manager",
    version: "1.0.0",
    description: "Unified Dokploy manager — read, write, logs, monitoring, UI",
    endpoints: {
      "GET /": "Lightweight Dokploy Manager web UI",
      "GET /api": "Service metadata and endpoint index",
      "GET /api/health": "Health check",
      "GET /api/projects": "List all projects",
      "POST /api/projects": "Create project",
      "GET /api/services": "List all services",
      "GET /api/applications": "List all applications",
      "GET /api/overview": "Overview snapshot with counts and embedded data",
      "GET /api/deployments": "Aggregate deployment history across applications",
      "GET /api/domains": "Aggregate domains across applications",
      "GET /api/servers": "List Dokploy servers",
      "GET /api/containers?serverId=": "Best-effort local Docker container listing",
      "GET /api/applications/:id": "Get application details",
      "GET /api/applications/:id/deployments": "List deployments for one application",
      "GET /api/applications/:id/env": "Get env vars",
      "POST /api/applications/:id/env": "Set env vars",
      "GET /api/applications/:id/domains": "List domains for one application",
      "POST /api/applications/:id/domains": "Add domain",
      "GET /api/applications/:id/logs/deploy": "Read latest deploy log",
      "GET /api/applications/:id/logs/runtime?tail=100": "Read runtime logs via local Docker when available",
      "GET /api/applications/:id/webhook": "Return webhook-related fields from the application payload",
      "POST /api/applications": "Create application",
      "PATCH /api/applications/:id": "Update application settings",
      "POST /api/applications/:id/deploy": "Trigger deploy",
      "POST /api/applications/:id/redeploy": "Trigger redeploy",
      "POST /api/applications/:id/start": "Start application",
      "POST /api/applications/:id/stop": "Stop application",
      "GET /api/raw/:procedure?input={}": "Raw tRPC query",
      "POST /api/raw/:procedure": "Raw tRPC mutation",
    },
  };
}

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono();
  const deps: DokployDependencies = {
    dokployQuery,
    dokployMutate,
    getApplication,
    getApplicationDeployments,
    getApplicationDomains,
    getProjects,
    getServers,
    getDeployLogs,
    getRuntimeLogs,
    listRuntimeContainers,
    ...options.dokploy,
  };

  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api" || c.req.path === "/api/health") return next();
    const managerToken = getManagerToken();
    if (!managerToken) {
      return c.json({ error: "Manager auth not configured" }, 503);
    }
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${managerToken}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });

  app.get("/", (c) => c.html(html()));
  app.get("/api", (c) => c.json(getMetadata()));

  app.get("/api/health", async (c) => {
    let dokployOk = false;
    try {
      await deps.getProjects();
      dokployOk = true;
    } catch {}

    return c.json({
      status: "ok",
      dokploy: dokployOk ? "reachable" : "unreachable",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/projects", async (c) => c.json(await deps.getProjects()));

  app.get("/api/services", async (c) => {
    const projects = await deps.getProjects();
    return c.json(flattenServices(projects));
  });

  app.get("/api/applications", async (c) => {
    const projects = await deps.getProjects();
    return c.json(flattenApplications(projects));
  });

  app.get("/api/overview", async (c) => {
    const projects = await deps.getProjects();
    const services = flattenServices(projects);
    const applications = services.filter((service) => service._type === "application");
    const [servers, deployments, domains] = await Promise.all([
      deps.getServers().catch(() => []),
      aggregateDeployments(applications, deps),
      aggregateDomains(applications, deps),
    ]);

    return c.json({
      counts: {
        projects: asArray(projects).length,
        services: services.length,
        applications: applications.length,
        deployments: deployments.length,
        domains: domains.length,
        servers: asArray(servers).length,
      },
      projects,
      services,
      applications,
      deployments,
      domains,
      servers,
    });
  });

  app.get("/api/deployments", async (c) => {
    try {
      const data = await deps.dokployQuery("deployment.all", {});
      return c.json(data);
    } catch {
      const projects = await deps.getProjects();
      return c.json(await aggregateDeployments(flattenApplications(projects), deps));
    }
  });

  app.get("/api/domains", async (c) => {
    const projects = await deps.getProjects();
    const applications = flattenApplications(projects);
    return c.json(await aggregateDomains(applications, deps));
  });

  app.get("/api/servers", async (c) => c.json(await deps.getServers()));

  app.get("/api/containers", async (c) => {
    const serverId = c.req.query("serverId");
    return c.json(await deps.listRuntimeContainers(serverId));
  });

  app.get("/api/applications/:id", async (c) => {
    const applicationId = c.req.param("id");
    return c.json(await deps.getApplication(applicationId));
  });

  app.get("/api/applications/:id/deployments", async (c) => {
    const applicationId = c.req.param("id");
    return c.json(await deps.getApplicationDeployments(applicationId));
  });

  app.get("/api/applications/:id/env", async (c) => {
    const applicationId = c.req.param("id");
    const data = await deps.getApplication(applicationId);
    return c.json({ env: data?.env || null });
  });

  app.get("/api/applications/:id/domains", async (c) => {
    const applicationId = c.req.param("id");
    return c.json(await deps.getApplicationDomains(applicationId));
  });

  app.get("/api/applications/:id/webhook", async (c) => {
    const applicationId = c.req.param("id");
    const data = await deps.getApplication(applicationId);
    return c.json({
      applicationId,
      webhook: data?.webhook ?? null,
      webhookUrl: data?.webhookUrl ?? null,
      deployHook: data?.deployHook ?? null,
    });
  });

  app.get("/api/applications/:id/logs/deploy", async (c) => {
    const applicationId = c.req.param("id");
    return c.json(await deps.getDeployLogs(applicationId));
  });

  app.get("/api/applications/:id/logs/runtime", async (c) => {
    const applicationId = c.req.param("id");
    const tail = c.req.query("tail");
    return c.json(await deps.getRuntimeLogs(applicationId, tail));
  });

  app.post("/api/applications/:id/deploy", async (c) => {
    const applicationId = c.req.param("id");
    try {
      const result = await deps.dokployMutate("application.deploy", { applicationId });
      return c.json({ success: true, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/applications/:id/redeploy", async (c) => {
    const applicationId = c.req.param("id");
    try {
      const result = await deps.dokployMutate("application.redeploy", { applicationId });
      return c.json({ success: true, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/applications/:id/stop", async (c) => {
    const applicationId = c.req.param("id");
    try {
      const result = await deps.dokployMutate("application.stop", { applicationId });
      return c.json({ success: true, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/applications/:id/start", async (c) => {
    const applicationId = c.req.param("id");
    try {
      const result = await deps.dokployMutate("application.start", { applicationId });
      return c.json({ success: true, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/applications/:id/env", async (c) => {
    const applicationId = c.req.param("id");
    const body = await c.req.json();
    const env = body.env;
    if (typeof env !== "string") {
      return c.json({ error: "env must be a string (KEY=VALUE format, newline-separated)" }, 400);
    }

    try {
      const result = await deps.dokployMutate("application.saveEnvironment", { applicationId, env });
      return c.json({ success: true, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/applications/:id/domains", async (c) => {
    const applicationId = c.req.param("id");
    const body = await c.req.json();
    try {
      const result = await deps.dokployMutate("domain.create", {
        applicationId,
        host: body.host,
        path: body.path || "/",
        port: body.port || 3000,
        https: body.https !== false,
        certificateType: body.certificateType || "letsencrypt",
        ...body,
      });
      return c.json({ success: true, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/applications", async (c) => {
    const body = await c.req.json();
    if (!body.name || !body.projectId) {
      return c.json({ error: "name and projectId are required" }, 400);
    }

    try {
      const result = await deps.dokployMutate("application.create", {
        name: body.name,
        projectId: body.projectId,
        description: body.description || "",
      });
      return c.json({ success: true, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.patch("/api/applications/:id", async (c) => {
    const applicationId = c.req.param("id");
    const body = await c.req.json();
    try {
      const result = await deps.dokployMutate("application.update", { applicationId, ...body });
      return c.json({ success: true, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/projects", async (c) => {
    const body = await c.req.json();
    if (!body.name) {
      return c.json({ error: "name is required" }, 400);
    }
    try {
      const result = await deps.dokployMutate("project.create", {
        name: body.name,
        description: body.description || "",
      });
      return c.json({ success: true, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.get("/api/raw/:procedure", async (c) => {
    const procedure = c.req.param("procedure");
    const inputStr = c.req.query("input");
    let input: Record<string, unknown> = {};
    if (inputStr) {
      try {
        const parsed = JSON.parse(inputStr);
        input = (parsed?.json ?? parsed) as Record<string, unknown>;
      } catch {
        return c.json({ error: "Invalid JSON in input query param" }, 400);
      }
    }

    if (process.env.DOKPLOY_ENABLE_RAW_PASSTHROUGH !== "true") {
      return c.json({ error: "Raw passthrough disabled" }, 403);
    }

    try {
      return c.json(await deps.dokployQuery(procedure, input));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/raw/:procedure", async (c) => {
    const procedure = c.req.param("procedure");
    let input: Record<string, unknown> = {};
    try {
      const body = await c.req.json();
      input = (body?.json ?? body) as Record<string, unknown>;
    } catch {}

    if (process.env.DOKPLOY_ENABLE_RAW_PASSTHROUGH !== "true") {
      return c.json({ error: "Raw passthrough disabled" }, 403);
    }

    try {
      return c.json(await deps.dokployMutate(procedure, input));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  return app;
}

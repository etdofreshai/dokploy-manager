# dokploy-manager

Unified Dokploy manager service.

## What it does

- Read Dokploy projects, services, applications, deployments, domains, servers
- Trigger write actions like deploy, redeploy, start, stop, env updates, and domain creation
- Provide lightweight monitoring and log endpoints
- Serve a simple web UI for inspection
- Expose raw tRPC passthrough for uncovered Dokploy procedures

## Environment

- `DOKPLOY_MANAGER_TOKEN` - preferred bearer token for this service
- `DOKPLOY_EDITOR_TOKEN` - legacy fallback token
- `DOKPLOY_VIEWER_TOKEN` - legacy fallback token
- `DOKPLOY_URL` - Dokploy base URL
- `DOKPLOY_TOKEN` - Dokploy API token
- `PORT` - port to listen on (default: `3000`)

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

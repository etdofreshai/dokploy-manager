import test from 'node:test';
import assert from 'node:assert/strict';

const { createApp } = await import('../dist/app.js');

function getResponseText(response) {
  return response.text();
}

test('GET / serves the Dokploy Manager UI', async () => {
  const app = createApp();
  const response = await app.request('http://localhost/');

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  const body = await getResponseText(response);
  assert.match(body, /Dokploy Manager/);
});

test('GET /api returns dokploy-manager metadata', async () => {
  const app = createApp();
  const response = await app.request('http://localhost/api');

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.name, 'dokploy-manager');
  assert.equal(body.version, '1.0.0');
  assert.ok(body.endpoints['GET /api/overview']);
  assert.ok(body.endpoints['GET /api/applications/:id/logs/runtime?tail=100']);
});

test('protected API endpoints are unavailable until manager auth is configured', async () => {
  delete process.env.DOKPLOY_MANAGER_TOKEN;
  delete process.env.DOKPLOY_EDITOR_TOKEN;
  delete process.env.DOKPLOY_VIEWER_TOKEN;

  const app = createApp();
  const response = await app.request('http://localhost/api/projects');

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, 'Manager auth not configured');
});

test('GET /api/projects requires auth when manager token is configured', async () => {
  process.env.DOKPLOY_MANAGER_TOKEN = 'secret-token';
  const app = createApp();
  const response = await app.request('http://localhost/api/projects');

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, 'Unauthorized');

  delete process.env.DOKPLOY_MANAGER_TOKEN;
});

test('GET /api/health stays public even when auth is enabled', async () => {
  process.env.DOKPLOY_MANAGER_TOKEN = 'secret-token';
  const app = createApp();
  const response = await app.request('http://localhost/api/health');

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');

  delete process.env.DOKPLOY_MANAGER_TOKEN;
});

test('GET /api/services includes top-level project applications in aggregated services', async () => {
  process.env.DOKPLOY_MANAGER_TOKEN = 'secret-token';
  const app = createApp({
    dokploy: {
      getProjects: async () => [
        {
          name: 'Top Level Project',
          applications: [
            { applicationId: 'top-app', name: 'Top App' }
          ],
          environments: []
        }
      ]
    }
  });

  const response = await app.request('http://localhost/api/services', {
    headers: { Authorization: 'Bearer secret-token' }
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].applicationId, 'top-app');
  assert.equal(body[0]._project, 'Top Level Project');
  assert.equal(body[0]._type, 'application');

  delete process.env.DOKPLOY_MANAGER_TOKEN;
});

test('manager token takes precedence over legacy editor/viewer token fallbacks', async () => {
  process.env.DOKPLOY_MANAGER_TOKEN = 'manager-token';
  process.env.DOKPLOY_EDITOR_TOKEN = 'editor-token';
  process.env.DOKPLOY_VIEWER_TOKEN = 'viewer-token';
  const app = createApp({
    dokploy: {
      getProjects: async () => []
    }
  });

  const editorResponse = await app.request('http://localhost/api/projects', {
    headers: { Authorization: 'Bearer editor-token' }
  });
  assert.equal(editorResponse.status, 401);

  const managerResponse = await app.request('http://localhost/api/projects', {
    headers: { Authorization: 'Bearer manager-token' }
  });
  assert.equal(managerResponse.status, 200);

  delete process.env.DOKPLOY_MANAGER_TOKEN;
  delete process.env.DOKPLOY_EDITOR_TOKEN;
  delete process.env.DOKPLOY_VIEWER_TOKEN;
});

test('raw passthrough is disabled by default even when authenticated', async () => {
  process.env.DOKPLOY_MANAGER_TOKEN = 'secret-token';
  delete process.env.DOKPLOY_ENABLE_RAW_PASSTHROUGH;
  const app = createApp();

  const response = await app.request('http://localhost/api/raw/project.all', {
    headers: { Authorization: 'Bearer secret-token' }
  });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, 'Raw passthrough disabled');

  delete process.env.DOKPLOY_MANAGER_TOKEN;
});

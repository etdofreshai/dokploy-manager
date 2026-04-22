export function html(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dokploy Manager</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; }
  header { padding: 20px 24px; border-bottom: 1px solid #1e293b; background: #111827; position: sticky; top: 0; }
  h1 { margin: 0 0 8px; color: #38bdf8; font-size: 28px; }
  p { margin: 0; color: #94a3b8; }
  main { padding: 24px; display: grid; grid-template-columns: 360px 1fr; gap: 20px; }
  .panel { background: #111827; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; }
  .controls { display: flex; gap: 8px; margin-top: 16px; }
  input, button { border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; padding: 10px 12px; }
  input { width: 100%; }
  button { cursor: pointer; background: #2563eb; border-color: #2563eb; }
  button:hover { background: #1d4ed8; }
  .project { padding: 12px; border: 1px solid #1e293b; border-radius: 10px; margin-top: 12px; }
  .project-title { font-weight: 700; color: #7dd3fc; margin-bottom: 10px; }
  .app { padding: 10px; border-radius: 8px; background: #1e293b; margin-top: 8px; cursor: pointer; }
  .app:hover { background: #334155; }
  .app small { display: block; color: #94a3b8; margin-top: 4px; }
  .tabs { display: flex; gap: 8px; margin: 14px 0; flex-wrap: wrap; }
  .tab { padding: 8px 12px; background: #1e293b; border-radius: 999px; cursor: pointer; }
  .tab.active { background: #2563eb; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; background: #020617; padding: 14px; border-radius: 10px; border: 1px solid #1e293b; max-height: 70vh; overflow: auto; }
  .muted { color: #94a3b8; }
  .error { color: #f87171; }
  .pill { display: inline-block; padding: 3px 8px; border-radius: 999px; background: #1e293b; color: #cbd5e1; font-size: 12px; margin-left: 8px; }
  @media (max-width: 1000px) { main { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>🛠️ Dokploy Manager</h1>
  <p>Unified Dokploy operations, monitoring, logs, and lightweight UI.</p>
</header>
<main>
  <section class="panel">
    <label for="token">Bearer token</label>
    <div class="controls">
      <input id="token" type="password" placeholder="Optional token" />
      <button onclick="loadProjects()">Connect</button>
    </div>
    <div id="projects" class="muted" style="margin-top: 16px;">Enter a token if needed, then click Connect.</div>
  </section>
  <section class="panel">
    <div id="details" class="muted">Select an application to inspect deployments, logs, and env.</div>
  </section>
</main>
<script>
const API = window.location.origin;
let currentAppId = '';

function headers() {
  const token = document.getElementById('token').value.trim();
  const out = { 'Content-Type': 'application/json' };
  if (token) out.Authorization = 'Bearer ' + token;
  return out;
}

async function api(path) {
  const response = await fetch(API + path, { headers: headers() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || (response.status + ' ' + response.statusText));
  }
  return data;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderProjects(projects) {
  if (!Array.isArray(projects) || !projects.length) {
    return '<p class="muted">No projects found.</p>';
  }

  return projects.map(function(project) {
    const apps = [];
    (project.environments || []).forEach(function(environment) {
      (environment.applications || []).forEach(function(app) {
        apps.push(Object.assign({}, app, { _env: environment.name || '' }));
      });
    });
    (project.applications || []).forEach(function(app) {
      apps.push(app);
    });

    const appHtml = apps.length
      ? apps.map(function(app) {
          return '<div class="app" onclick="showApp(\'' + esc(app.applicationId) + '\')">'
            + '<strong>' + esc(app.name || app.appName || app.applicationId) + '</strong>'
            + '<small>' + esc(app.applicationStatus || 'unknown') + (app._env ? ' · ' + esc(app._env) : '') + '</small>'
            + '</div>';
        }).join('')
      : '<p class="muted">No applications.</p>';

    return '<div class="project">'
      + '<div class="project-title">' + esc(project.name || 'Unnamed Project') + '</div>'
      + appHtml
      + '</div>';
  }).join('');
}

async function loadProjects() {
  const container = document.getElementById('projects');
  container.innerHTML = '<p class="muted">Loading projects…</p>';
  try {
    const projects = await api('/api/projects');
    container.innerHTML = renderProjects(projects);
  } catch (error) {
    container.innerHTML = '<p class="error">' + esc(error.message) + '</p>';
  }
}

function activateTab(name) {
  document.querySelectorAll('.tab').forEach(function(tab) {
    tab.classList.toggle('active', tab.dataset.tab === name);
  });
  document.querySelectorAll('.tab-content').forEach(function(panel) {
    panel.classList.toggle('active', panel.dataset.tab === name);
  });
}

async function loadTab(path, target, formatter) {
  const element = document.getElementById(target);
  if (!element) return;
  element.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const data = await api(path);
    element.innerHTML = formatter(data);
  } catch (error) {
    element.innerHTML = '<p class="error">' + esc(error.message) + '</p>';
  }
}

function showApp(appId) {
  currentAppId = appId;
  const details = document.getElementById('details');
  details.innerHTML = '<div>'
    + '<strong>Application</strong><span class="pill">' + esc(appId) + '</span>'
    + '<div class="tabs">'
    + '<div class="tab active" data-tab="info" onclick="selectTab(\'info\')">Info</div>'
    + '<div class="tab" data-tab="deployments" onclick="selectTab(\'deployments\')">Deployments</div>'
    + '<div class="tab" data-tab="deploy-log" onclick="selectTab(\'deploy-log\')">Deploy Log</div>'
    + '<div class="tab" data-tab="runtime-log" onclick="selectTab(\'runtime-log\')">Runtime Log</div>'
    + '<div class="tab" data-tab="env" onclick="selectTab(\'env\')">Env</div>'
    + '</div>'
    + '<div id="tab-info" class="tab-content active" data-tab="info"></div>'
    + '<div id="tab-deployments" class="tab-content" data-tab="deployments"></div>'
    + '<div id="tab-deploy-log" class="tab-content" data-tab="deploy-log"></div>'
    + '<div id="tab-runtime-log" class="tab-content" data-tab="runtime-log"></div>'
    + '<div id="tab-env" class="tab-content" data-tab="env"></div>'
    + '</div>';
  selectTab('info');
}

function selectTab(name) {
  activateTab(name);
  if (!currentAppId) return;

  if (name === 'info') {
    loadTab('/api/applications/' + currentAppId, 'tab-info', function(data) {
      return '<pre>' + esc(JSON.stringify(data, null, 2)) + '</pre>';
    });
  }
  if (name === 'deployments') {
    loadTab('/api/applications/' + currentAppId + '/deployments', 'tab-deployments', function(data) {
      return '<pre>' + esc(JSON.stringify(data, null, 2)) + '</pre>';
    });
  }
  if (name === 'deploy-log') {
    loadTab('/api/applications/' + currentAppId + '/logs/deploy', 'tab-deploy-log', function(data) {
      return '<pre>' + esc(data.logs || JSON.stringify(data, null, 2)) + '</pre>';
    });
  }
  if (name === 'runtime-log') {
    loadTab('/api/applications/' + currentAppId + '/logs/runtime?tail=200', 'tab-runtime-log', function(data) {
      return '<pre>' + esc(data.logs || JSON.stringify(data, null, 2)) + '</pre>';
    });
  }
  if (name === 'env') {
    loadTab('/api/applications/' + currentAppId + '/env', 'tab-env', function(data) {
      return '<pre>' + esc(data.env || 'No environment variables found') + '</pre>';
    });
  }
}
</script>
</body>
</html>`;
}

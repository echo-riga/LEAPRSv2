/* Task-specific Google OAuth/Drive contract simulation. No real credentials. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Postman loads mock handlers as CommonJS.
const http = require('http');
const initial = () => ({ mode: 'new', folders: [], creates: 0, patches: 0, refreshes: [] });
// This local-only simulation uses process state; it is never deployed or shared.
let fixture = initial();
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let body = req.body;
  if (body === undefined) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    body = raw ? (req.headers['content-type']?.includes('application/json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw))) : {};
  }
  if (typeof body === 'string') body = Object.fromEntries(new URLSearchParams(body));
  const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (url.pathname === '/__reset' && req.method === 'POST') {
    fixture = { ...initial(), ...body };
    return send(200, { ok: true });
  }
  if (url.pathname === '/__state') return send(200, fixture);
  if (url.pathname === '/token' && req.method === 'POST') {
    if (body.refresh_token) fixture.refreshes.push(body.refresh_token);
    if (body.code === 'expired' || body.refresh_token === 'revoked') return send(400, { error: 'invalid_grant' });
    return send(200, { access_token: 'sim-access', refresh_token: 'sim-refresh', token_type: 'Bearer', expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/forms.body https://www.googleapis.com/auth/forms.responses.readonly' });
  }
  if (req.headers.authorization !== 'Bearer sim-access') return send(401, { error: { code: 401 } });
  if (url.pathname === '/about') return send(200, { user: { permissionId: 'sim-account', emailAddress: 'storage@example.test' } });
  if (fixture.mode === 'error') return send(503, { error: { code: 503 } });
  if (url.pathname === '/files' && req.method === 'GET') {
    const query = url.searchParams.get('q') || '';
    const folders = fixture.folders.filter(folder => query.includes("name = 'LEAPRS'") ? folder.name === 'LEAPRS'
      : folder.appProperties?.leaprsClient && query.includes(folder.appProperties.leaprsClient));
    return send(200, { files: folders });
  }
  if (url.pathname === '/files' && req.method === 'POST') {
    if (body.mimeType !== 'application/vnd.google-apps.folder' || body.parents?.[0] !== 'root') return send(400, { error: { code: 400 } });
    fixture.creates++;
    const folder = { ...body, id: 'sim-folder-' + fixture.creates, ownedByMe: true, trashed: false, capabilities: { canAddChildren: true } };
    fixture.folders.push(folder);
    return send(200, { id: folder.id });
  }
  if (url.pathname.startsWith('/files/')) {
    const folder = fixture.folders.find(folder => folder.id === decodeURIComponent(url.pathname.slice(7)));
    if (!folder) return send(404, { error: { code: 404 } });
    if (req.method === 'GET') return send(200, folder);
    if (req.method === 'PATCH') { Object.assign(folder, body); fixture.patches++; return send(200, folder); }
  }
  return send(501, { error: 'Endpoint not modeled by this integration contract.' });
}).listen(process.env.PORT || 4500, function () { if (process.send) process.send({ port: this.address().port }); });

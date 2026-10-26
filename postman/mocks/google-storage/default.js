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
    if (fixture.migration) return send(200, { access_token: body.refresh_token === 'target-refresh' ? 'sim-target' : 'sim-source' });
    return send(200, { access_token: 'sim-access', refresh_token: 'sim-refresh', token_type: 'Bearer', expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/forms.body https://www.googleapis.com/auth/forms.responses.readonly' });
  }
  if (fixture.migration) {
    const account = req.headers.authorization === 'Bearer sim-target' ? 'target-account' : req.headers.authorization === 'Bearer sim-source' ? 'source-account' : null;
    if (!account) return send(401, {});
    if (url.pathname === '/about') return send(200, { user: { permissionId: account, emailAddress: account + '@example.test' } });
    const files = fixture.files || [];
    const visible = file => file.owners?.some(owner => owner.permissionId === account) || file.readable !== false;
    if (url.pathname === '/files' && req.method === 'GET') {
      const query = url.searchParams.get('q') || '';
      const parent = /'([\w-]+)' in parents/.exec(query)?.[1];
      const taggedRoot = /key='leaprsStorageRoot' and value='([\w-]+)'/.exec(query)?.[1];
      const cutoff = /createdTime < '([^']+)'/.exec(query)?.[1];
      const matches = files.filter(file => !file.trashed && visible(file) && (taggedRoot
        ? file.appProperties?.leaprsStorageRoot === taggedRoot && (!cutoff || new Date(file.createdTime || 0) < new Date(cutoff))
        : file.parents?.includes(parent)));
      const offset = Number(url.searchParams.get('pageToken') || 0);
      const page = matches.slice(offset, offset + 2);
      return send(200, { files: page, ...(matches.length > offset + 2 ? { nextPageToken: String(offset + 2) } : {}) });
    }
    const match = /^\/files\/([^/]+)(?:\/permissions(?:\/([^/]+))?)?$/.exec(url.pathname);
    if (match) {
      const file = files.find(file => file.id === decodeURIComponent(match[1]));
      if (!file || !visible(file)) return send(404, {});
      if (url.pathname.includes('/permissions')) {
        fixture.permissionCalls = (fixture.permissionCalls || 0) + 1;
        if (fixture.blocked) return send(403, { error: { code: 403, errors: [{ reason: fixture.blockedReason || 'ownershipChangeAcrossDomainsNotPermitted' }] } });
        if (req.method === 'GET') return send(200, { permissions: file.permissions || [] });
        if (req.method === 'POST' && body.role === 'writer') {
          // Observed Drive behavior: creation can ignore pendingOwner. Require the
          // caller to explicitly PATCH it before the target can accept ownership.
          fixture.shares = (fixture.shares || 0) + 1;
          file.permissions = [{ id: 'target-account', emailAddress: 'target-account@example.test', role: 'writer' }];
          return send(200, { id: 'target-account', role: 'writer', pendingOwner: false });
        }
        if (body.pendingOwner) {
          fixture.pendingUpdates = (fixture.pendingUpdates || 0) + 1;
          if (fixture.pendingFailureReason) return send(403, { error: { errors: [{ reason: fixture.pendingFailureReason }] } });
          if (fixture.workspace) return send(403, { error: { code: 403, errors: [{ reason: 'userCannotAddPendingOwnerToFile' }] } });
          file.pendingOwner = 'target-account';
          return send(200, { id: 'target-account', pendingOwner: true });
        }
        if (body.role === 'owner') {
          if (url.searchParams.get('transferOwnership') !== 'true' || (account === 'target-account' && !file.pendingOwner)) return send(400, {});
          file.owners = [{ permissionId: 'target-account' }];
          delete file.pendingOwner;
          fixture.transfers = (fixture.transfers || 0) + 1;
          if (fixture.lostResponse) { fixture.lostResponse = false; return send(503, {}); }
          return send(200, { id: 'target-account' });
        }
        return send(501, {});
      }
      if (req.method === 'GET') return send(200, { ...file, ownedByMe: file.owners?.some(owner => owner.permissionId === account) });
      if (req.method === 'PATCH') {
        if (url.searchParams.has('addParents')) file.parents = [url.searchParams.get('addParents')];
        Object.assign(file, body);
        return send(200, file);
      }
      if (req.method === 'DELETE') {
        if (!file.owners?.some(owner => owner.permissionId === account)) return send(403, { error: 'Only the owner can delete this My Drive file' });
        if (fixture.deleteFailures > 0) { fixture.deleteFailures--; return send(503, { error: 'Temporary provider failure' }); }
        if (files.some(child => child.parents?.includes(file.id) && !child.trashed)) return send(400, { error: 'Folder is not empty' });
        fixture.files = files.filter(item => item.id !== file.id);
        fixture.deleted = [...(fixture.deleted || []), file.id];
        if (fixture.deleteLostResponse) { fixture.deleteLostResponse = false; return send(503, { error: 'Lost deletion response' }); }
        res.writeHead(204); return res.end();
      }
    }
    return send(501, { error: 'Migration endpoint not modeled.' });
  }
  if (req.headers.authorization !== 'Bearer sim-access') return send(401, { error: { code: 401 } });
  if (url.pathname === '/about') return send(200, { user: { permissionId: 'sim-account', emailAddress: 'storage@example.test', displayName: 'Storage Owner' } });
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

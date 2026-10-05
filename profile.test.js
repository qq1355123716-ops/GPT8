const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createApp } = require('./server');
test('profile updates persist, keep login username, validate avatars and isolate accounts', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gpt8-profile-'));
  const databasePath = path.join(directory, 'accounts.sqlite');
  let server, base;
  async function start() { server = createApp({ databasePath }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  async function api(route, body, cookie = '', origin = 'http://localhost:3000') {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-App-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  try {
    await start();
    const owner = await api('/api/register', { username: 'profile-owner', password: 'test-password-123' });
    const other = await api('/api/register', { username: 'profile-other', password: 'test-password-123' });
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    assert.equal((await api('/api/profile', { displayName: '新名字' })).status, 401);
    assert.equal((await api('/api/profile', { displayName: '新名字' }, owner.cookie, 'https://evil.example')).status, 403);
    assert.equal((await api('/api/profile', { displayName: '' }, owner.cookie)).status, 400);
    assert.equal((await api('/api/profile', { displayName: '名'.repeat(25) }, owner.cookie)).status, 400);
    assert.equal((await api('/api/profile', { displayName: '新名字', avatar: 'data:image/svg+xml;base64,PHN2Zz4=' }, owner.cookie)).status, 400);
    assert.equal((await api('/api/profile', { displayName: '新名字', avatar: 'data:image/png;base64,aGVsbG8=' }, owner.cookie)).status, 400);
    const saved = await api('/api/profile', { displayName: '新名字 ✨', avatar: image, userId: 2 }, owner.cookie);
    assert.equal(saved.status, 200);
    assert.equal(saved.data.user.username, 'profile-owner');
    assert.equal(saved.data.user.displayName, '新名字 ✨');
    const avatarResponse = await fetch(base + saved.data.user.avatarUrl);
    assert.equal(avatarResponse.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await avatarResponse.arrayBuffer()), Buffer.from(image.split(',')[1], 'base64'));
    assert.equal((await api('/api/me', undefined, other.cookie)).data.user.displayName, 'profile-other');
    await api('/api/activities', { content: '资料测试' }, owner.cookie);
    assert.equal((await api('/api/activities')).data.activities[0].username, '新名字 ✨');
    await api('/api/profile', { displayName: '再次改名' }, owner.cookie);
    assert.equal((await api('/api/me', undefined, owner.cookie)).data.user.avatarUrl !== null, true);
    await stop(); await start();
    const login = await api('/api/login', { username: 'profile-owner', password: 'test-password-123' });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.displayName, '再次改名');
    assert.ok(login.data.user.avatarUrl);
    assert.equal((await api('/api/profile', { displayName: '再次改名', avatar: null }, login.cookie)).data.user.avatarUrl, null);
    await api('/api/logout', {}, login.cookie);
    assert.equal((await api('/api/profile', { displayName: '不应保存' }, login.cookie)).status, 401);
  } finally { if (server?.listening) await stop(); rmSync(directory, { recursive: true, force: true }); }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('./server');

test('accounts persist; passwords are hashed; sessions support login, expiry and logout', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gpt8-auth-'));
  const databasePath = path.join(directory, 'test.sqlite');
  const origin = 'http://localhost:3000';
  let server;
  let base;
  async function start() {
    server = createApp({ databasePath, origin });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  async function api(route, body, cookie = '', requestOrigin = origin) {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Request': '1', Origin: requestOrigin, Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { code: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
  }
  try {
    await start();
    assert.equal((await api('/api/me')).data.user, null);
    assert.equal((await api('/api/register', { username: '测试用户', password: 'short' })).code, 400);
    assert.equal((await api('/api/register', { username: '测试用户', password: 'test-password-123' }, '', 'https://evil.example')).code, 403);
    const registered = await api('/api/register', { username: '测试用户', password: 'test-password-123' });
    assert.equal(registered.code, 201);
    assert.equal(registered.data.user.username, '测试用户');
    assert.match(registered.cookie, /HttpOnly; SameSite=Strict/);
    const cookie = registered.cookie.split(';')[0];
    assert.equal((await api('/api/me', undefined, cookie)).data.user.username, '测试用户');
    assert.equal((await api('/api/register', { username: '测试用户', password: 'test-password-123' })).code, 409);
    assert.equal((await api('/api/login', { username: '测试用户', password: 'wrong-password' })).code, 401);
    await stop();
    const db = new DatabaseSync(databasePath);
    const saved = db.prepare('SELECT * FROM users').get();
    assert.notEqual(saved.password_hash, 'test-password-123');
    assert.equal(saved.password_hash.length, 128);
    assert.equal(saved.salt.length, 32);
    db.close();
    await start();
    assert.equal((await api('/api/me', undefined, cookie)).data.user.username, '测试用户');
    const loggedIn = await api('/api/login', { username: '测试用户', password: 'test-password-123' }, cookie);
    assert.equal(loggedIn.code, 200);
    assert.equal((await api('/api/me', undefined, cookie)).data.user, null);
    const newCookie = loggedIn.cookie.split(';')[0];
    assert.equal((await api('/api/logout', {}, newCookie)).code, 200);
    assert.equal((await api('/api/me', undefined, newCookie)).data.user, null);
    const session = await api('/api/login', { username: '测试用户', password: 'test-password-123' });
    const expireDb = new DatabaseSync(databasePath);
    expireDb.exec('UPDATE sessions SET expires = 0');
    expireDb.close();
    assert.equal((await api('/api/me', undefined, session.cookie.split(';')[0])).data.user, null);
    assert.equal((await fetch(base + '/data/accounts.sqlite')).status, 404);
    assert.equal((await fetch(base + '/server.js')).status, 404);
  } finally {
    if (server?.listening) await stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects malformed input, oversized bodies and repeated attempts', async () => {
  const server = createApp({ databasePath: ':memory:' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', 'X-App-Request': '1' };
  try {
    assert.equal((await fetch(base + '/api/login', { method: 'POST', headers, body: 'null' })).status, 400);
    assert.equal((await fetch(base + '/api/login', { method: 'POST', headers, body: '{' })).status, 400);
    assert.equal((await fetch(base + '/api/login', { method: 'POST', headers, body: JSON.stringify({ username: 'test', password: 'x'.repeat(5000) }) })).status, 413);
    assert.equal((await fetch(base + '/api/logout', { method: 'POST' })).status, 403);
    let code;
    for (let i = 0; i < 20; i++) code = (await fetch(base + '/api/login', { method: 'POST', headers, body: '{}' })).status;
    assert.equal(code, 429);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

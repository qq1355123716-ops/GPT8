const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createApp } = require('./server');
test('author profiles are public; favorites persist per account; copied edits preserve original HTML', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gpt8-social-'));
  const originalHTML = '<!DOCTYPE html><html><head></head><body>原作</body></html>';
  const copyHTML = '<!DOCTYPE html><html><head></head><body>修改后的副本</body></html>';
  let calls = 0, server, base;
  const aiOptions = { apiKey: 'test-only', fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ reply: '测试游戏', title: calls++ ? '副本' : '原作', html: calls === 1 ? originalHTML : copyHTML }) }] }] })) };
  async function start() { server = createApp({ databasePath: path.join(directory, 'accounts.sqlite'), aiOptions }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  async function api(route, body, cookie = '', origin = 'http://localhost:3000') {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-App-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: response.headers.get('content-type').includes('application/json') ? await response.json() : await response.text(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  try {
    await start();
    const owner = await api('/api/register', { username: 'original-author', password: 'test-password-123' });
    const other = await api('/api/register', { username: 'copy-author', password: 'test-password-123' });
    await api('/api/profile', { displayName: '原作作者' }, owner.cookie);
    const original = (await api('/api/chat', { text: '制作游戏', images: [] }, owner.cookie)).data.game;
    const work = (await api('/api/works')).data.games[0];
    assert.equal(work.author, '原作作者');
    const profile = await api(`/api/authors/${work.authorId}`);
    assert.equal(profile.data.author.displayName, '原作作者');
    assert.equal(profile.data.author.username, undefined);
    assert.equal(profile.data.author.password_hash, undefined);
    assert.equal(profile.data.total, 1);
    assert.equal(profile.data.games[0].id, original.id);
    assert.equal((await api('/api/authors/999999')).status, 404);
    assert.equal((await api('/api/favorites')).status, 401);
    assert.equal((await api('/api/favorites', { gameId: original.id, favorite: true })).status, 401);
    assert.equal((await api('/api/favorites', { gameId: original.id, favorite: true }, other.cookie, 'https://evil.example')).status, 403);
    assert.equal((await api('/api/favorites', { gameId: original.id, favorite: 'yes' }, other.cookie)).status, 400);
    const favorite = await api('/api/favorites', { gameId: original.id, favorite: true, userId: work.authorId }, other.cookie);
    assert.equal(favorite.data.favoriteCount, 1);
    assert.equal((await api('/api/favorites', { gameId: original.id, favorite: true }, other.cookie)).data.favoriteCount, 1);
    assert.equal((await api('/api/favorites', undefined, other.cookie)).data.total, 1);
    assert.equal((await api('/api/favorites', undefined, owner.cookie)).data.total, 0);
    assert.equal((await api('/api/works')).data.games[0].isFavorite, false);
    assert.equal((await api('/api/works', undefined, other.cookie)).data.games[0].isFavorite, true);
    const copy = (await api('/api/chat', { text: '复制作品并修改', images: [], baseGameId: original.id }, other.cookie)).data.game;
    assert.notEqual(copy.id, original.id);
    assert.equal(readFileSync(path.join(directory, 'games', original.filename), 'utf8'), originalHTML);
    assert.equal(readFileSync(path.join(directory, 'games', copy.filename), 'utf8'), copyHTML);
    assert.equal((await api(copy.sourceUrl, undefined, owner.cookie)).status, 404);
    assert.equal((await api('/api/games', undefined, other.cookie)).data.games[0].id, copy.id);
    await stop(); await start();
    assert.equal((await api('/api/favorites', undefined, other.cookie)).data.games[0].id, original.id);
    assert.equal((await api('/api/favorites', { gameId: original.id, favorite: false }, other.cookie)).data.favoriteCount, 0);
    assert.equal((await api('/api/favorites', undefined, other.cookie)).data.total, 0);
  } finally { if (server?.listening) await stop(); rmSync(directory, { recursive: true, force: true }); }
});

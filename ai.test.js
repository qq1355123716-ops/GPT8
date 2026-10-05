const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./server');
const { createAI } = require('./ai');
const { mkdtempSync, rmSync, readFileSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=';
function mockReply(reply = '可以做成星球探索游戏。', html = '', title = '星球探索') {
  const text = JSON.stringify({ reply, html, title });
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }), { status: 200 });
}
async function withServer(aiOptions, run) {
  const directory = mkdtempSync(path.join(tmpdir(), 'gpt8-games-'));
  const server = createApp({ databasePath: ':memory:', gamesDirectory: directory, aiOptions });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function api(route, body, cookie = '', origin = 'http://localhost:3000') {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Request': '1', Cookie: cookie, Origin: origin },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text(), headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  try { await run(api, directory); }
  finally { await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); }
}
test('AI endpoint enforces login, forwards images and isolates conversation context', async () => {
  const calls = [];
  await withServer({ apiKey: 'test-only-secret', model: 'test-model', fetchImpl: async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return mockReply();
  } }, async api => {
    assert.deepEqual((await api('/api/ai/status')).data, { configured: true });
    assert.equal((await api('/api/chat', { text: '你好', images: [] })).status, 401);
    const first = await api('/api/register', { username: 'user1', password: 'password123' });
    const second = await api('/api/register', { username: 'user2', password: 'password123' });
    assert.equal((await api('/api/chat', { text: '星球游戏', images: [image] }, first.cookie)).status, 200);
    assert.equal(calls[0].url, 'https://api.deepseek.com/responses');
    assert.deepEqual(calls[0].body.reasoning, { effort: 'none' });
    assert.equal(calls[0].body.model, 'test-model');
    assert.equal(calls[0].body.input[0].content[1].image_url, image);
    const next = await api('/api/chat', { text: '继续完善', images: [] }, first.cookie);
    assert.equal(next.data.reply, '可以做成星球探索游戏。');
    assert.equal(calls[1].body.input.length, 3);
    assert.equal(calls[1].body.input[0].content, '星球游戏');
    await api('/api/chat', { text: '另一个用户', images: [] }, second.cookie);
    assert.equal(calls[2].body.input.length, 1);
    assert.equal((await api('/api/chat', { text: '', images: [] }, first.cookie)).status, 400);
    assert.equal((await api('/api/chat', { text: 'test', images: ['https://evil.example/x'] }, first.cookie)).status, 400);
    assert.equal((await api('/api/chat', { text: 'test', images: ['data:image/png;base64,YWJj'] }, first.cookie)).status, 400);
    assert.equal((await api('/api/chat', { text: 'test', images: [] }, first.cookie, 'https://evil.example')).status, 403);
    await api('/api/logout', {}, first.cookie);
    assert.equal((await api('/api/chat', { text: '继续', images: [] }, first.cookie)).status, 401);
    assert.equal((await api('/.env')).status, 404);
    assert.equal((await api('/ai.js')).status, 404);
  });
});
test('missing key disables service and never returns simulated AI output', async () => {
  await withServer({ apiKey: '' }, async api => {
    assert.deepEqual((await api('/api/ai/status')).data, { configured: false });
    const user = await api('/api/register', { username: 'user1', password: 'password123' });
    const result = await api('/api/chat', { text: '你好', images: [] }, user.cookie);
    assert.equal(result.status, 503);
    assert.equal(result.data.reply, undefined);
  });
});
test('upstream errors never expose provider response or API secrets', async () => {
  const ai = createAI({ apiKey: 'test-only-secret', fetchImpl: async () => new Response('test-only-secret: internal provider details', { status: 401 }) });
  await assert.rejects(ai.reply('session', { text: '你好', images: [] }), error => error.status === 502 && !error.message.includes('test-only-secret'));
  const incomplete = createAI({ apiKey: 'test-only-secret', fetchImpl: async () => new Response(JSON.stringify({ status: 'incomplete', output: [] })) });
  await assert.rejects(incomplete.reply('session', { text: '你好', images: [] }), error => error.status === 502);
  const quota = createAI({ apiKey: 'test-only-secret', fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Insufficient Balance' } }), { status: 402 }) });
  await assert.rejects(quota.reply('session', { text: '你好', images: [] }), error => error.status === 502 && error.message.includes('余额或额度不足'));
});
test('concurrent requests are blocked; logout removes context; requests are limited', async () => {
  let release;
  const calls = [];
  const ai = createAI({ apiKey: 'test-only-secret', fetchImpl: async (url, options) => {
    calls.push(JSON.parse(options.body));
    if (calls.length === 1) await new Promise(resolve => { release = resolve; });
    return mockReply('回复');
  } });
  const first = ai.reply('session', { text: '第一条', images: [] });
  await assert.rejects(ai.reply('session', { text: '并发', images: [] }), error => error.status === 409);
  release();
  await first;
  ai.clear('session');
  await ai.reply('session', { text: '新会话', images: [] });
  assert.equal(calls[1].input.length, 1);
  for (let i = 0; i < 29; i++) await ai.reply('session', { text: '你好', images: [] });
  await assert.rejects(ai.reply('session', { text: '超限', images: [] }), error => error.status === 429);
});

test('generated HTML is saved as a new file, isolated in preview, downloadable and owner-only', async () => {
  const html = '<!DOCTYPE html><html><head><title>测试游戏</title></head><body><button id="play">开始</button><script>document.getElementById("play").onclick=()=>{document.body.dataset.played="yes"}</script></body></html>';
  const calls = [];
  await withServer({ apiKey: 'test-only', fetchImpl: async (url, options) => { calls.push(JSON.parse(options.body)); return mockReply('点击开始即可游玩。', html, '<测试游戏>'); } }, async (api, directory) => {
    const owner = await api('/api/register', { username: 'owner', password: 'password123' });
    const other = await api('/api/register', { username: 'other', password: 'password123' });
    const result = await api('/api/chat', { text: '制作游戏', images: [] }, owner.cookie);
    assert.equal(result.status, 200);
    assert.match(result.data.game.filename, /^[0-9a-f-]{36}\.html$/);
    assert.equal(readFileSync(path.join(directory, result.data.game.filename), 'utf8'), html);
    assert.equal((await api(result.data.game.url)).status, 401);
    assert.equal((await api(result.data.game.url, undefined, other.cookie)).status, 404);
    const preview = await api(result.data.game.url, undefined, owner.cookie);
    assert.match(preview.data, /sandbox="allow-scripts"/);
    assert.match(preview.data, /&lt;测试游戏&gt;/);
    const game = await api(`/games/${result.data.game.filename}`, undefined, owner.cookie);
    assert.equal(game.data, html);
    assert.match(game.headers.get('content-security-policy'), /sandbox allow-scripts/);
    assert.match(game.headers.get('content-security-policy'), /connect-src 'none'/);
    const download = await api(result.data.game.downloadUrl, undefined, owner.cookie);
    assert.match(download.headers.get('content-disposition'), /attachment;/);
    const updated = await api('/api/chat', { text: '改成紫色', images: [] }, owner.cookie);
    assert.notEqual(updated.data.game.id, result.data.game.id);
    assert.equal(readdirSync(directory).length, 2);
    assert.equal(JSON.parse(calls[1].input[1].content).html, html);
  });
});

test('incomplete or malformed generation is rejected without creating files', async () => {
  for (const html of ['<html><body>不完整', '<!DOCTYPE html><html><head></head></html>']) {
    await withServer({ apiKey: 'test-only', fetchImpl: async () => mockReply('生成好了', html) }, async (api, directory) => {
      const owner = await api('/api/register', { username: 'owner', password: 'password123' });
      assert.equal((await api('/api/chat', { text: '制作游戏', images: [] }, owner.cookie)).status, 502);
      assert.equal(readdirSync(directory).length, 0);
    });
  }
});

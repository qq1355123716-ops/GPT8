const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./server');
const { createAI } = require('./ai');
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=';
function mockReply(text = '可以做成星球探索游戏。') {
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }), { status: 200 });
}
async function withServer(aiOptions, run) {
  const server = createApp({ databasePath: ':memory:', aiOptions });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function api(route, body, cookie = '', origin = 'http://localhost:3000') {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Request': '1', Cookie: cookie, Origin: origin },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  try { await run(api); }
  finally { await new Promise(resolve => server.close(resolve)); }
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
    assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
    assert.equal(calls[0].body.store, false);
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
  const quota = createAI({ apiKey: 'test-only-secret', fetchImpl: async () => new Response(JSON.stringify({ error: { type: 'insufficient_quota', code: 'credit_balance_exhausted' } }), { status: 429 }) });
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

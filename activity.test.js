const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('./server');

test('activities require login to publish, validate content, persist and paginate publicly', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gpt8-activity-'));
  const databasePath = path.join(directory, 'accounts.sqlite');
  let server;
  let base;
  async function start() {
    server = createApp({ databasePath });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  const headers = { 'Content-Type': 'application/json', 'X-App-Request': '1' };
  async function publish(content, cookie = '', extra = {}, images) {
    return fetch(base + '/api/activities', { method: 'POST', headers: { ...headers, Cookie: cookie, ...extra }, body: JSON.stringify({ content, images }) });
  }
  try {
    await start();
    assert.deepEqual(await (await fetch(base + '/api/activities')).json(), { activities: [], next: null });
    assert.equal((await publish('第一条动态')).status, 401);
    const registered = await fetch(base + '/api/register', { method: 'POST', headers, body: JSON.stringify({ username: '动态测试', password: 'test-password-123' }) });
    const cookie = registered.headers.get('set-cookie').split(';')[0];
    assert.equal((await publish(' ', cookie)).status, 400);
    assert.equal((await publish('长'.repeat(2001), cookie)).status, 400);
    assert.equal((await publish('测试', cookie, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await publish('长'.repeat(6000), cookie)).status, 400);
    assert.equal((await fetch(base + '/api/activities', { method: 'POST', headers: { ...headers, Cookie: cookie }, body: 'null' })).status, 400);
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    assert.equal((await publish('错误格式', cookie, {}, ['data:image/svg+xml;base64,PHN2Zz4='])).status, 400);
    assert.equal((await publish('远程图片', cookie, {}, ['https://example.com/image.png'])).status, 400);
    assert.equal((await publish('伪造图片', cookie, {}, ['data:image/png;base64,aGVsbG8='])).status, 400);
    assert.equal((await publish('太多图片', cookie, {}, Array(7).fill(image))).status, 400);
    assert.equal((await publish('超大图片', cookie, {}, ['data:image/png;base64,' + Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')])).status, 400);
    const posted = await publish('  第一条动态\n<script>alert(1)</script>  ', cookie, {}, [image, image]);
    assert.equal(posted.status, 201);
    const activity = (await posted.json()).activity;
    assert.equal(activity.username, '动态测试');
    assert.equal(activity.content, '第一条动态\n<script>alert(1)</script>');
    assert.equal(activity.images.length, 2);
    assert.notEqual(activity.images[0], activity.images[1]);
    const registered2 = await fetch(base + '/api/register', { method: 'POST', headers, body: JSON.stringify({ username: '纯图片', password: 'test-password-123' }) });
    const cookie2 = registered2.headers.get('set-cookie').split(';')[0];
    const imageOnly = await publish('', cookie2, {}, [image]);
    assert.equal(imageOnly.status, 201);
    assert.equal((await imageOnly.json()).activity.content, '');
    assert.equal((await publish('重复', cookie)).status, 429);
    await stop();
    const db = new DatabaseSync(databasePath);
    const user = db.prepare('SELECT id FROM users').get();
    for (let i = 0; i < 22; i++) db.prepare('INSERT INTO activities (user_id, content, created) VALUES (?, ?, ?)').run(user.id, `动态 ${i}`, Date.now());
    db.close();
    await start();
    const first = await (await fetch(base + '/api/activities')).json();
    assert.equal(first.activities.length, 20);
    assert.ok(first.next);
    const second = await (await fetch(base + `/api/activities?before=${first.next}`)).json();
    assert.equal(second.activities.length, 4);
    assert.equal(second.next, null);
    assert.deepEqual(second.activities.at(-1), activity);
    const savedImage = await fetch(base + activity.images[0]);
    assert.equal(savedImage.status, 200);
    assert.equal(savedImage.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await savedImage.arrayBuffer()), Buffer.from(image.split(',')[1], 'base64'));
    assert.equal((await fetch(base + '/activity-images/00000000-0000-0000-0000-000000000000')).status, 404);
    assert.equal((await fetch(base + '/api/activities?before=bad')).status, 400);
    await fetch(base + '/api/logout', { method: 'POST', headers: { ...headers, Cookie: cookie }, body: '{}' });
    assert.equal((await publish('退出后', cookie)).status, 401);
    const html = await (await fetch(base + '/')).text();
    assert.match(html, /id="publish-activity"[^>]*aria-label="发布动态"/);
    assert.doesNotMatch(html, /id="publish-activity"[^>]*disabled/);
    assert.equal((await fetch(base + '/activity.js')).status, 200);
  } finally {
    if (server?.listening) await stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

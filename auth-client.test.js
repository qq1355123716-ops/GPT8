const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
function browser(fetchImpl) {
  const elements = new Map();
  const timers = new Map();
  let timerId = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: false, handlers: {}, attrs: {},
      addEventListener(name, callback) { this.handlers[name] = callback; },
      setAttribute(name, value) { this.attrs[name] = value; },
      contains() { return false; }, focus() {}, reset() {}, close() { this.handlers.close?.(); }
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element, addEventListener() {} },
    window: { dispatchEvent() {} }, CustomEvent: class {},
    AbortController, AbortSignal: {}, fetch: fetchImpl,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(readFileSync('auth.js', 'utf8'), context);
  return { context, element, timers };
}
test('mobile login works without AbortSignal.timeout and clears request timers', async () => {
  const calls = [];
  const client = browser(async (route, options) => {
    calls.push({ route, options });
    return { ok: true, json: async () => ({ user: route === '/api/login' ? { username: 'mobile' } : null }) };
  });
  await vm.runInContext("request('/api/me')", client.context);
  client.element('username').value = 'mobile';
  client.element('password').value = 'test-only-password';
  await client.element('auth-form').handlers.submit({ preventDefault() {} });
  assert.equal(client.element('open-auth').hidden, true);
  assert.equal(client.element('account-dropdown').hidden, false);
  assert.equal(client.element('status').hidden, true);
  assert.equal(client.element('submit-auth').disabled, false);
  assert.equal(client.timers.size, 0);
  assert.equal(calls.at(-1).route, '/api/login');
});
test('stalled mobile requests time out and release the timer', async () => {
  const client = browser(async route => ({ ok: true, json: async () => ({ user: null }) }));
  await vm.runInContext("request('/api/me')", client.context);
  client.context.fetch = (route, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const pending = vm.runInContext("request('/api/login', {})", client.context);
  for (const timeout of client.timers.values()) timeout();
  await assert.rejects(pending, /登录请求超时/);
  assert.equal(client.timers.size, 0);
});

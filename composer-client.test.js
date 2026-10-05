const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
for (const popup of ['blocked', 'throws']) {
  test(`mobile generation works without new AbortSignal APIs when popup ${popup}`, async () => {
    const nodes = new Map();
    function node() { return {
      value: '', hidden: true, children: [], handlers: {}, style: {},
      addEventListener(event, callback) { this.handlers[event] = callback; },
      setAttribute() {}, before() {}, prepend() {}, focus() {},
      closest() { return element('composer'); }, querySelectorAll() { return []; },
      append(...items) { this.children.push(...items); }, replaceChildren() { this.children = []; }
    }; }
    function element(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }
    const events = {};
    const timers = new Map();
    let timerId = 0;
    let opened;
    let request;
    const id = '12345678-1234-1234-1234-123456789abc';
    const context = vm.createContext({
      document: { getElementById: element, createElement: node },
      window: {
        location: { search: '', assign(url) { opened = url; } },
        history: { replaceState() {} },
        addEventListener(event, callback) { events[event] = callback; }, dispatchEvent() {},
        open() { if (popup === 'throws') throw new Error('popup unavailable'); return null; }
      }, URL, URLSearchParams, CustomEvent: class {}, AbortController, AbortSignal: {},
      setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
      fetch: async (route, options) => {
        if (route === '/api/ai/status') return { ok: true, json: async () => ({ configured: true }) };
        assert.equal(route, '/api/chat');
        request = JSON.parse(options.body);
        return { ok: true, json: async () => ({ reply: '游戏已制作。', game: { title: '测试游戏', filename: `${id}.html`, url: `/play/${id}`, downloadUrl: `/games/${id}.html?download=1` } }) };
      }
    });
    vm.runInContext(readFileSync('composer.js', 'utf8'), context);
    await new Promise(resolve => setImmediate(resolve));
    events.authchange({ detail: { user: { username: 'mobile-test' } } });
    element('game-prompt').value = '做一个跑酷游戏';
    await element('send-message').handlers.click();
    assert.equal(request.text, '做一个跑酷游戏');
    assert.equal(opened, `/play/${id}`);
    assert.equal(element('chat-history').children.length, 2);
    assert.match(element('composer-status').textContent, /已自动打开/);
    assert.equal(timers.size, 0);
  });
}

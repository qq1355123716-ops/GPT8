const { randomUUID } = require('node:crypto');
const { mkdirSync, writeFileSync, readFileSync, unlinkSync } = require('node:fs');
const path = require('node:path');
const escapeHTML = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function createGames(db, directory) {
  db.exec('CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL, created INTEGER NOT NULL)');
  return {
    save(userId, title, html) {
      const id = randomUUID();
      mkdirSync(directory, { recursive: true });
      const file = path.join(directory, `${id}.html`);
      writeFileSync(file, html, { encoding: 'utf8', flag: 'wx' });
      try { db.prepare('INSERT INTO games VALUES (?, ?, ?, ?)').run(id, userId, title, Date.now()); }
      catch (error) { unlinkSync(file); throw error; }
      return { id, title, filename: `${id}.html`, url: `/play/${id}`, sourceUrl: `/source/${id}`, downloadUrl: `/games/${id}.html?download=1` };
    },
    get(id, userId) {
      return db.prepare('SELECT id, title FROM games WHERE id = ? AND user_id = ?').get(id, userId);
    },
    list(userId, page = 1) {
      const pageSize = 24;
      const total = db.prepare('SELECT COUNT(*) AS total FROM games WHERE user_id = ?').get(userId).total;
      const rows = db.prepare('SELECT id, title, created FROM games WHERE user_id = ? ORDER BY created DESC, id DESC LIMIT ? OFFSET ?').all(userId, pageSize, (page - 1) * pageSize);
      return { games: rows.map(game => ({ ...game, filename: `${game.id}.html`, url: `/play/${game.id}`, sourceUrl: `/source/${game.id}`, downloadUrl: `/games/${game.id}.html?download=1` })), total, page, pageSize };
    },
    html(id) { return readFileSync(path.join(directory, `${id}.html`)); },
    source(game) {
      const title = escapeHTML(game.title);
      const code = escapeHTML(this.html(game.id).toString('utf8'));
      return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · 源文件</title><style>body{margin:0;background:#1b1e30;color:#f2f4f6;font-family:system-ui,sans-serif}header{padding:20px;display:flex;gap:24px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #ffffff20}h1{font-size:18px;margin:0}a{color:#c8f27b}pre{margin:0;padding:24px;line-height:1.7;overflow:auto;tab-size:2}code{font-family:monospace}</style></head><body><header><h1>${title} · HTML 源文件</h1><a href="/#library">返回库</a><a href="/games/${game.id}.html?download=1">下载源文件</a></header><pre><code>${code}</code></pre></body></html>`;
    },
    preview(game) {
      const title = escapeHTML(game.title);
      return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · 一句一游戏</title><style>*{box-sizing:border-box}body{margin:0;background:#1b1e30;color:#f2f4f6;font-family:system-ui,"Microsoft YaHei",sans-serif}header{height:56px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 20px;border-bottom:1px solid #ffffff20}h1{font-size:16px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}nav{display:flex;gap:16px;white-space:nowrap}a{color:#c8f27b;font-size:13px;text-decoration:none}iframe{display:block;border:0;width:100%;height:calc(100dvh - 56px);background:#101426}</style></head><body><header><h1>${title}</h1><nav><a href="/#works">返回作品</a><a href="/#home">返回首页</a></nav></header><iframe src="/games/${game.id}.html" sandbox="allow-scripts" title="${title}"></iframe></body></html>`;
    }
  };
}
module.exports = { createGames };

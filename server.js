const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, createHash, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { mkdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const derive = promisify(scrypt);
const hashToken = token => createHash('sha256').update(token).digest('hex');
const lifetime = 7 * 24 * 60 * 60;
const { createAI } = require('./ai');
const { createGames } = require('./games');
const { createActivities } = require('./activities');

function createApp({ databasePath = path.join(__dirname, 'data', 'accounts.sqlite'), origin = 'http://localhost:3000', secure = false, aiOptions = {}, gamesDirectory = path.join(databasePath === ':memory:' ? path.join(__dirname, 'data') : path.dirname(databasePath), 'games') } = {}) {
  const ai = createAI(aiOptions);
  if (databasePath !== ':memory:') mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);`);
  const games = createGames(db, gamesDirectory);
  db.exec('CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, content TEXT NOT NULL, created INTEGER NOT NULL)');
  const activities = createActivities(db);
  const files = {
    '/': [readFileSync(path.join(__dirname, 'index.html')), 'text/html; charset=utf-8'],
    '/index.html': [readFileSync(path.join(__dirname, 'index.html')), 'text/html; charset=utf-8'],
    '/auth.js': [readFileSync(path.join(__dirname, 'auth.js')), 'text/javascript; charset=utf-8'],
    '/composer.js': [readFileSync(path.join(__dirname, 'composer.js')), 'text/javascript; charset=utf-8'],
    '/navigation.js': [readFileSync(path.join(__dirname, 'navigation.js')), 'text/javascript; charset=utf-8'],
    '/library.js': [readFileSync(path.join(__dirname, 'library.js')), 'text/javascript; charset=utf-8'],
    '/activity.js': [readFileSync(path.join(__dirname, 'activity.js')), 'text/javascript; charset=utf-8']
  };
  const attempts = new Map();
  const cookie = (token, age) => `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const tokenFrom = req => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('session='))?.slice(8) || '';
  const removeSession = req => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(tokenFrom(req)));
  const send = (res, code, body, headers = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      const route = new URL(req.url, origin).pathname;
      const activityImage = route.match(/^\/activity-images\/([0-9a-f-]{36})$/);
      if (req.method === 'GET' && activityImage) {
        const image = activities.image(activityImage[1]);
        if (!image) return send(res, 404, { message: '图片不存在。' });
        res.writeHead(200, { 'Content-Type': image.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'; sandbox" });
        return res.end(Buffer.from(image.data));
      }
      const gameRoute = route.match(/^\/(play|games|source)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\.html)?$/);
      if (req.method === 'GET' && gameRoute) {
        const session = db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires > ?').get(hashToken(tokenFrom(req)), Date.now());
        const download = new URL(req.url, origin).searchParams.get('download') === '1';
        const publicRuntime = gameRoute[1] === 'play' || (gameRoute[1] === 'games' && !download);
        if (!publicRuntime && !session) return send(res, 401, { message: '请登录后查看源文件。' });
        const game = publicRuntime ? games.published(gameRoute[2]) : games.get(gameRoute[2], session.user_id);
        if (!game) return send(res, 404, { message: '游戏不存在或无权访问。' });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (gameRoute[1] === 'source') {
          res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
          return res.end(games.source(game));
        }
        if (gameRoute[1] === 'play') {
          res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
          return res.end(games.preview(game));
        }
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
        if (new URL(req.url, origin).searchParams.get('download') === '1') res.setHeader('Content-Disposition', `attachment; filename="${game.id}.html"`);
        return res.end(games.html(game.id));
      }
      if (req.method === 'GET' && files[route]) {
        res.writeHead(200, { 'Content-Type': files[route][1], 'Cache-Control': 'no-cache' });
        return res.end(files[route][0]);
      }
      if (req.method === 'GET' && route === '/api/me') {
        const user = db.prepare('SELECT users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires > ?').get(hashToken(tokenFrom(req)), Date.now());
        return send(res, 200, { user: user ? { username: user.username } : null });
      }
      if (req.method === 'GET' && route === '/api/ai/status') return send(res, 200, { configured: ai.configured });
      if (req.method === 'GET' && route === '/api/works') {
        const page = Number(new URL(req.url, origin).searchParams.get('page') || 1);
        if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return send(res, 400, { message: '页码无效。' });
        return send(res, 200, games.works(page));
      }
      const workMatch = route.match(/^\/api\/works\/([0-9a-f-]{36})$/);
      if (req.method === 'GET' && workMatch) {
        const game = games.published(workMatch[1]);
        return game ? send(res, 200, { game }) : send(res, 404, { message: '作品不存在。' });
      }
      if (req.method === 'GET' && route === '/api/games') {
        const session = db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires > ?').get(hashToken(tokenFrom(req)), Date.now());
        if (!session) return send(res, 401, { message: '请先登录后查看你的游戏库。' });
        const page = Number(new URL(req.url, origin).searchParams.get('page') || 1);
        if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return send(res, 400, { message: '页码无效。' });
        return send(res, 200, games.list(session.user_id, page));
      }
      if (req.method === 'GET' && route === '/api/activities') {
        const before = Number(new URL(req.url, origin).searchParams.get('before') || Number.MAX_SAFE_INTEGER);
        if (!Number.isSafeInteger(before) || before < 1) return send(res, 400, { message: '分页参数无效。' });
        return send(res, 200, activities.list(before));
      }
      if (req.method !== 'POST' || !['/api/login', '/api/register', '/api/logout', '/api/chat', '/api/activities'].includes(route)) return send(res, 404, { message: '页面或接口不存在。' });
      if (req.headers['x-app-request'] !== '1' || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { message: '请求来源无效，请从本站操作。' });
      if (route === '/api/activities') {
        const session = db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires > ?').get(hashToken(tokenFrom(req)), Date.now());
        if (!session) return send(res, 401, { message: '请登录后发布动态。' });
        if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { message: '请求格式无效。' });
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 42 * 1024 * 1024) return send(res, 413, { message: '图片总大小过大。' });
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { message: '请求格式无效。' }); }
        const content = typeof body?.content === 'string' ? body.content.trim() : '';
        let images;
        try { images = activities.validate(body?.images); } catch (error) { return send(res, 400, { message: error.message }); }
        if (content.length > 2000 || (!content && !images.length)) return send(res, 400, { message: '请添加文字或图片，文字最多 2000 字。' });
        const now = Date.now();
        if (db.prepare('SELECT id FROM activities WHERE user_id = ? AND created > ?').get(session.user_id, now - 10000)) return send(res, 429, { message: '发布过于频繁，请稍后再试。' });
        if (!db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires > ?').get(hashToken(tokenFrom(req)), now)) return send(res, 401, { message: '登录已失效，请重新登录。' });
        return send(res, 201, { activity: activities.save(session.user_id, content, images, now) });
      }
      if (route === '/api/logout') {
        ai.clear(hashToken(tokenFrom(req)));
        removeSession(req);
        return send(res, 200, { user: null }, { 'Set-Cookie': cookie('', 0) });
      }
      if (route === '/api/chat') {
        const sessionHash = hashToken(tokenFrom(req));
        const session = db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires > ?').get(sessionHash, Date.now());
        if (!session) return send(res, 401, { message: '请先登录后再与 AI 对话。' });
        if (!ai.configured) return send(res, 503, { message: 'AI 服务尚未配置，请联系管理员。' });
        if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { message: '请求格式无效。' });
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 85 * 1024 * 1024) return send(res, 413, { message: '图片总大小过大，请减少图片后重试。' });
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { message: '请求格式无效。' }); }
        const controller = new AbortController();
        const disconnect = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', disconnect);
        try {
          let baseGame;
          if (body?.baseGameId !== undefined) {
            if (typeof body.baseGameId !== 'string' || !/^[0-9a-f-]{36}$/.test(body.baseGameId)) return send(res, 400, { message: '作品编号无效。' });
            const original = games.published(body.baseGameId);
            if (!original) return send(res, 404, { message: '原作品不存在。' });
            baseGame = { title: original.title, html: games.html(original.id).toString('utf8') };
          }
          const result = await ai.reply(sessionHash, body, controller.signal, baseGame);
          // 退出登录或会话过期后，不返回此账号的对话内容。
          if (!db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires > ?').get(sessionHash, Date.now())) return send(res, 401, { message: '登录已失效，请重新登录。' });
          const game = result.html ? games.save(session.user_id, result.title, result.html) : null;
          return send(res, 200, { reply: result.reply, game });
        } catch (error) { if (!res.destroyed) return send(res, error.status || 500, { message: error.message }); }
        finally { res.off('close', disconnect); }
        return;
      }
      const now = Date.now();
      for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
      const ip = req.socket.remoteAddress;
      const attempt = attempts.get(ip) || { count: 0, until: now + 15 * 60 * 1000 };
      attempts.set(ip, attempt);
      if (++attempt.count > 20) return send(res, 429, { message: '操作过于频繁，请 15 分钟后再试。' });
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { message: '请求格式无效。' });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) { send(res, 413, { message: '请求内容过长。' }); return; }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { message: '请求格式无效。' }); }
      if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') return send(res, 400, { message: '请输入用户名和密码。' });
      const username = body.username.trim().normalize('NFKC');
      const password = body.password;
      if (!/^[\p{L}\p{N}_-]{2,24}$/u.test(username)) return send(res, 400, { message: '用户名需为 2–24 位中文、字母、数字、下划线或短横线。' });
      if (password.length < (route === '/api/register' ? 8 : 1) || password.length > 128) return send(res, 400, { message: '密码需为 8–128 位。' });
      let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      const salt = route === '/api/register' ? randomBytes(16).toString('hex') : (user?.salt || '00000000000000000000000000000000');
      const derived = await derive(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
      if (route === '/api/register') {
        try {
          const result = db.prepare('INSERT INTO users (username, salt, password_hash) VALUES (?, ?, ?)').run(username, salt, derived.toString('hex'));
          user = { id: Number(result.lastInsertRowid), username };
        } catch (error) {
          if (error.code === 'ERR_SQLITE_ERROR' && error.message.includes('UNIQUE')) return send(res, 409, { message: '该用户名已被使用。' });
          throw error;
        }
      } else if (!user || !timingSafeEqual(derived, Buffer.from(user.password_hash, 'hex'))) {
        return send(res, 401, { message: '用户名或密码错误。' });
      }
      removeSession(req);
      db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now);
      const token = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hashToken(token), user.id, Date.now() + lifetime * 1000);
      return send(res, route === '/api/register' ? 201 : 200, { user: { username: user.username } }, { 'Set-Cookie': cookie(token, lifetime) });
    } catch (error) {
      console.error('Account request failed:', error.code || error.name);
      if (!res.headersSent) send(res, 500, { message: '服务暂时不可用，请稍后重试。' });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.on('close', () => db.close());
  return server;
}
if (require.main === module) {
  try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const port = Number(process.env.PORT || 3000);
  const origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
  const secure = new URL(origin).protocol === 'https:';
  createApp({ origin, secure, ...(process.env.DATA_DIR ? { databasePath: path.join(process.env.DATA_DIR, 'accounts.sqlite') } : {}) }).listen(port, process.env.HOST || '127.0.0.1', () => console.log(`一句一游戏已启动：${origin}`));
}
module.exports = { createApp };

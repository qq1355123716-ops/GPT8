let collectionUser = null;
window.addEventListener('authchange', event => { collectionUser = event.detail.user; });
const collectionDate = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const collectionDefaultAvatar = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88"><rect width="88" height="88" fill="#30364a"/><circle cx="44" cy="31" r="14" fill="#c8f27b"/><path d="M18 78v-7a26 26 0 0 1 52 0v7" fill="#c8f27b"/></svg>');
function setupCollection(kind) {
  const source = kind === 'library';
  const label = { library: '源文件库', works: '作品', favorites: '收藏', author: '作者作品' }[kind];
  const el = name => document.getElementById(`${kind}-${name}`);
  const grid = el('grid'), empty = el('empty'), message = el('message'), count = el('count');
  const create = el('create'), login = el('login'), refresh = el('refresh'), pagination = el('pagination');
  let currentPage = 1, version = 0, controller;
  const active = () => kind === 'author' ? /^#author\/[1-9][0-9]*$/.test(window.location.hash) : window.location.hash === `#${kind}`;
  function clear() {
    version++; controller?.abort(); grid.replaceChildren(); grid.hidden = true; pagination.hidden = true; refresh.disabled = false;
    count.textContent = ''; create.hidden = login.hidden = true; message.textContent = ''; empty.hidden = false;
    if (kind === 'author') { document.getElementById('author-name').textContent = '作者资料'; document.getElementById('author-summary').textContent = ''; document.getElementById('author-avatar').src = collectionDefaultAvatar; }
  }
  async function load(page = 1) {
    clear(); const current = version; const requestController = new AbortController(); controller = requestController;
    const timer = setTimeout(() => requestController.abort(), 15000);
    message.textContent = `正在读取${label}…`; refresh.disabled = true;
    try {
      const authorId = kind === 'author' ? window.location.hash.split('/')[1] : null;
      const endpoint = source ? '/api/games' : kind === 'author' ? `/api/authors/${authorId}` : `/api/${kind}`;
      const response = await fetch(`${endpoint}?page=${page}`, { credentials: 'same-origin', signal: requestController.signal });
      const data = await response.json();
      if (current !== version) return;
      if (!response.ok) { login.hidden = response.status !== 401; throw new Error(data.message || '读取失败，请重试。'); }
      if (page > 1 && data.total && !data.games.length) { load(page - 1); return; }
      currentPage = data.page;
      count.textContent = `共 ${data.total} ${source ? '份源文件' : '个作品'}`;
      if (kind === 'author') {
        document.getElementById('author-name').textContent = data.author.displayName;
        document.getElementById('author-summary').textContent = `${data.total} 个公开作品`;
        document.getElementById('author-avatar').src = data.author.avatarUrl || collectionDefaultAvatar;
        document.title = `${data.author.displayName} · 作者资料 · 一句一游戏`;
      }
      if (!data.total) { message.textContent = kind === 'favorites' ? '还没有收藏，去作品页发现喜欢的游戏吧。' : kind === 'author' ? '这位作者还没有公开作品。' : source ? '还没有源文件，去创造你的第一个游戏吧。' : '还没有作品，去创造你的第一个游戏吧。'; create.hidden = kind === 'author'; create.href = kind === 'favorites' ? '#works' : '#home'; create.textContent = kind === 'favorites' ? '去作品页 ↗' : '去首页创造游戏 ↗'; return; }
      empty.hidden = true;
      for (const game of data.games) {
        const card = document.createElement('article'); card.className = 'library-card';
        const icon = document.createElement('div'); icon.className = 'library-card-icon'; icon.setAttribute('aria-hidden','true'); icon.textContent = source ? '</>' : '✳';
        const title = document.createElement('h3'); title.textContent = game.title;
        const date = document.createElement('time'); date.dateTime = new Date(game.created).toISOString(); date.textContent = `创建于 ${collectionDate.format(new Date(game.created))}`;
        const info = document.createElement(source ? 'p' : 'a'); info.className = source ? 'source-filename' : 'source-filename author-link';
        info.textContent = source ? game.filename : `作者：${game.author}`;
        if (!source) info.href = `/#author/${game.authorId}`;
        const actions = document.createElement('div'); actions.className = 'game-links';
        const play = document.createElement('a'); play.href = source ? game.sourceUrl : game.url; play.textContent = source ? '查看源文件' : '打开游戏 ↗'; actions.append(play);
        if (source) { const download = document.createElement('a'); download.href = game.downloadUrl; download.textContent = '下载源文件'; actions.append(download); }
        else {
          const remix = document.createElement('a'); remix.href = game.remixUrl; remix.textContent = '复制作品并修改'; actions.append(remix);
          const favorite = document.createElement('button'); favorite.type = 'button'; favorite.className = 'favorite-button';
          function renderFavorite() { favorite.textContent = `${game.isFavorite ? '★ 已收藏' : '☆ 收藏'} ${game.favoriteCount}`; favorite.setAttribute('aria-pressed', String(game.isFavorite)); }
          renderFavorite();
          favorite.addEventListener('click', async () => {
            if (!collectionUser) { document.getElementById('open-auth').click(); return; }
            favorite.disabled = true;
            try {
              const data = await request('/api/favorites', { gameId: game.id, favorite: !game.isFavorite });
              if (current !== version) return;
              Object.assign(game, data); renderFavorite();
              if (kind === 'favorites' && !data.isFavorite) load(currentPage);
            } catch (error) { if (current === version) { empty.hidden = false; message.textContent = error.message; } }
            finally { if (current === version) favorite.disabled = false; }
          }); actions.append(favorite);
        }
        card.append(icon, title, info, date, actions); grid.append(card);
      }
      grid.hidden = false;
      const pages = Math.max(1, Math.ceil(data.total / data.pageSize)); pagination.hidden = pages <= 1;
      el('page-number').textContent = `${data.page} / ${pages}`; el('prev').disabled = data.page <= 1; el('next').disabled = data.page >= pages;
    } catch (error) { if (current === version) { empty.hidden = false; message.textContent = requestController.signal.aborted ? '读取超时，请刷新重试。' : error.message === 'Failed to fetch' ? '网络连接失败，请刷新重试。' : error.message; } }
    finally { clearTimeout(timer); if (current === version) { refresh.disabled = false; controller = undefined; } }
  }
  refresh.addEventListener('click', () => load()); el('prev').addEventListener('click', () => load(currentPage - 1)); el('next').addEventListener('click', () => load(currentPage + 1));
  login.addEventListener('click', () => document.getElementById('open-auth').click());
  const entry = source ? 'open-library' : kind === 'favorites' ? 'open-favorites' : kind === 'works' ? 'nav-works' : null;
  if (entry) document.getElementById(entry).addEventListener('click', () => { if (active()) load(); });
  window.addEventListener('pagechange', event => { if (event.detail.page === kind) load(); else clear(); });
  ['authchange','profilechange','gamecreated'].forEach(event => window.addEventListener(event, () => { clear(); if (active()) load(); }));
  if (active()) load();
}
['library','works','favorites','author'].forEach(setupCollection);

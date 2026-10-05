const libraryGrid = document.getElementById('library-grid');
const libraryEmpty = document.getElementById('library-empty');
const libraryMessage = document.getElementById('library-message');
const libraryCount = document.getElementById('library-count');
const libraryCreate = document.getElementById('library-create');
const libraryLogin = document.getElementById('library-login');
const libraryRefresh = document.getElementById('library-refresh');
const libraryPagination = document.getElementById('library-pagination');
const libraryPrev = document.getElementById('library-prev');
const libraryNext = document.getElementById('library-next');
const libraryPageNumber = document.getElementById('library-page-number');
let libraryCurrentPage = 1;
let libraryRequest;
let libraryVersion = 0;
const gameDate = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
async function loadLibrary(page = 1) {
  libraryRequest?.abort();
  const controller = new AbortController();
  libraryRequest = controller;
  const version = ++libraryVersion;
  libraryGrid.replaceChildren();
  libraryGrid.hidden = true;
  libraryPagination.hidden = true;
  libraryEmpty.hidden = false;
  libraryCreate.hidden = libraryLogin.hidden = true;
  libraryMessage.textContent = '正在读取游戏库…';
  libraryCount.textContent = '你创造的每一个游戏，都在这里。';
  libraryRefresh.disabled = true;
  try {
    const response = await fetch(`/api/games?page=${page}`, { credentials: 'same-origin', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
    const data = await response.json();
    if (version !== libraryVersion) return;
    if (!response.ok) {
      libraryLogin.hidden = response.status !== 401;
      throw new Error(data.message || '游戏库暂时无法读取，请重试。');
    }
    libraryCurrentPage = data.page;
    libraryCount.textContent = `共 ${data.total} 个游戏`;
    if (!data.total) {
      libraryMessage.textContent = '库里还没有游戏，去创造你的第一个游戏吧。';
      libraryCreate.hidden = false;
      return;
    }
    libraryEmpty.hidden = true;
    for (const game of data.games) {
      const card = document.createElement('article');
      card.className = 'library-card';
      const icon = document.createElement('div');
      icon.className = 'library-card-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '✳';
      const title = document.createElement('h3');
      title.textContent = game.title;
      const date = document.createElement('time');
      date.dateTime = new Date(game.created).toISOString();
      date.textContent = `创建于 ${gameDate.format(new Date(game.created))}`;
      const actions = document.createElement('div');
      actions.className = 'game-links';
      const play = document.createElement('a');
      play.href = game.url;
      play.textContent = '打开游戏 ↗';
      const download = document.createElement('a');
      download.href = game.downloadUrl;
      download.textContent = '下载 HTML';
      actions.append(play, download);
      card.append(icon, title, date, actions);
      libraryGrid.append(card);
    }
    libraryGrid.hidden = false;
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    libraryPagination.hidden = pages <= 1;
    libraryPageNumber.textContent = `${data.page} / ${pages}`;
    libraryPrev.disabled = data.page <= 1;
    libraryNext.disabled = data.page >= pages;
  } catch (error) {
    if (version !== libraryVersion || controller.signal.aborted) return;
    libraryEmpty.hidden = false;
    libraryMessage.textContent = error.name === 'TimeoutError' ? '读取超时，请点击刷新重试。' : error.message === 'Failed to fetch' ? '网络连接失败，请点击刷新重试。' : error.message;
  } finally {
    if (version === libraryVersion) { libraryRefresh.disabled = false; libraryRequest = undefined; }
  }
}
function clearLibrary() {
  libraryVersion++;
  libraryRequest?.abort();
  libraryGrid.replaceChildren();
  libraryGrid.hidden = true;
  libraryPagination.hidden = true;
  libraryRefresh.disabled = false;
}
libraryRefresh.addEventListener('click', () => loadLibrary());
libraryPrev.addEventListener('click', () => loadLibrary(libraryCurrentPage - 1));
libraryNext.addEventListener('click', () => loadLibrary(libraryCurrentPage + 1));
libraryLogin.addEventListener('click', () => document.getElementById('open-auth').click());
document.getElementById('open-library').addEventListener('click', () => { if (window.location.hash === '#library') loadLibrary(); });
window.addEventListener('pagechange', event => {
  if (event.detail.page === 'library') loadLibrary();
  else clearLibrary();
});
window.addEventListener('authchange', () => { clearLibrary(); if (window.location.hash === '#library') loadLibrary(); });
window.addEventListener('gamecreated', () => { if (window.location.hash === '#library') loadLibrary(); });
if (window.location.hash === '#library') loadLibrary();

const pages = {
  home: document.getElementById('home-page'), activity: document.getElementById('activity-page'),
  library: document.getElementById('library-page'), works: document.getElementById('works-page'),
  favorites: document.getElementById('favorites-page'), author: document.getElementById('author-page')
};
function updatePage(focus = false) {
  const hash = window.location.hash;
  const page = /^#author\/[1-9][0-9]*$/.test(hash) ? 'author' : Object.prototype.hasOwnProperty.call(pages, hash.slice(1)) ? hash.slice(1) : 'home';
  Object.entries(pages).forEach(([name, element]) => { element.hidden = name !== page; });
  document.getElementById('publish-activity').hidden = page !== 'activity';
  ['home','activity','works'].forEach(name => {
    const link = document.getElementById(`nav-${name}`);
    link.removeAttribute('aria-current');
    if (page === name || (name === 'works' && page === 'author')) link.setAttribute('aria-current', 'page');
  });
  const titles = { home: '一句一游戏', activity: '动态', library: '我的游戏库', works: '作品广场', favorites: '我的收藏', author: '作者资料' };
  document.title = page === 'home' ? titles.home : `${titles[page]} · 一句一游戏`;
  if (focus) { pages[page].focus({ preventScroll: true }); window.scrollTo(0,0); }
  window.dispatchEvent(new CustomEvent('pagechange', { detail: { page } }));
}
window.addEventListener('hashchange', () => updatePage(true));
updatePage();

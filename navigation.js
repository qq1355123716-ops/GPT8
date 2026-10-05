const homePage = document.getElementById('home-page');
const activityPage = document.getElementById('activity-page');
const libraryPage = document.getElementById('library-page');
const worksPage = document.getElementById('works-page');
const navWorks = document.getElementById('nav-works');
const navHome = document.getElementById('nav-home');
const navActivity = document.getElementById('nav-activity');
const publishActivity = document.getElementById('publish-activity');
function updatePage(focus = false) {
  const page = window.location.hash === '#activity' ? 'activity' : window.location.hash === '#library' ? 'library' : window.location.hash === '#works' ? 'works' : 'home';
  const activity = page === 'activity';
  homePage.hidden = page !== 'home';
  activityPage.hidden = !activity;
  libraryPage.hidden = page !== 'library';
  worksPage.hidden = page !== 'works';
  navWorks.toggleAttribute('aria-current', page === 'works');
  if (page === 'works') navWorks.setAttribute('aria-current', 'page');
  publishActivity.hidden = !activity;
  navHome.toggleAttribute('aria-current', page === 'home');
  navActivity.toggleAttribute('aria-current', activity);
  if (activity) navActivity.setAttribute('aria-current', 'page');
  else if (page === 'home') navHome.setAttribute('aria-current', 'page');
  document.title = page === 'works' ? '作品广场 · 一句一游戏' : page === 'library' ? '我的游戏库 · 一句一游戏' : activity ? '动态 · 一句一游戏' : '一句一游戏';
  if (focus) {
    (page === 'works' ? worksPage : page === 'library' ? libraryPage : activity ? activityPage : homePage).focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  window.dispatchEvent(new CustomEvent('pagechange', { detail: { page } }));
}
window.addEventListener('hashchange', () => updatePage(true));
updatePage();

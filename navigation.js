const homePage = document.getElementById('home-page');
const activityPage = document.getElementById('activity-page');
const navHome = document.getElementById('nav-home');
const navActivity = document.getElementById('nav-activity');
const publishActivity = document.getElementById('publish-activity');
function updatePage(focus = false) {
  const activity = window.location.hash === '#activity';
  homePage.hidden = activity;
  activityPage.hidden = !activity;
  publishActivity.hidden = !activity;
  navHome.toggleAttribute('aria-current', !activity);
  navActivity.toggleAttribute('aria-current', activity);
  if (activity) navActivity.setAttribute('aria-current', 'page');
  else navHome.setAttribute('aria-current', 'page');
  document.title = activity ? '动态 · 一句一游戏' : '一句一游戏';
  if (focus) {
    (activity ? activityPage : homePage).focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}
window.addEventListener('hashchange', () => updatePage(true));
updatePage();

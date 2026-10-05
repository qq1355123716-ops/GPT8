const dialog = document.getElementById('auth-dialog');
const form = document.getElementById('auth-form');
const username = document.getElementById('username');
const password = document.getElementById('password');
const status = document.getElementById('status');
const loginTab = document.getElementById('login-tab');
const registerTab = document.getElementById('register-tab');
const submit = document.getElementById('submit-auth');
const openAuth = document.getElementById('open-auth');
const accountAvatar = document.getElementById('account-avatar');
let register = false;
let pending = false;
function showStatus(message) { status.textContent = message; status.hidden = false; }
function setUser(user) {
  accountAvatar.hidden = !user;
  accountAvatar.setAttribute('aria-label', user ? `${user.username}，默认头像` : '默认头像');
  accountAvatar.title = user ? user.username : '';
  openAuth.hidden = Boolean(user);
}
async function request(route, body) {
  let response;
  try {
    response = await fetch(route, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-App-Request': '1' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000)
    });
  } catch { throw new Error('无法连接账户服务，请检查网络并确认服务已启动。'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('账户服务响应异常，请通过网站服务地址访问。'); }
  if (!response.ok) throw new Error(data.message || '操作失败，请稍后重试。');
  return data;
}
openAuth.addEventListener('click', () => dialog.showModal());
document.getElementById('close-auth').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
dialog.addEventListener('close', () => { form.reset(); status.hidden = true; });
function setMode(value) {
  if (pending) return;
  register = value;
  loginTab.setAttribute('aria-pressed', String(!register));
  registerTab.setAttribute('aria-pressed', String(register));
  password.autocomplete = register ? 'new-password' : 'current-password';
  password.minLength = register ? 8 : 1;
  password.placeholder = register ? '请设置至少 8 位密码' : '请输入密码';
  password.value = '';
  submit.textContent = register ? '创建账户' : '登录';
  status.hidden = true;
}
loginTab.addEventListener('click', () => setMode(false));
registerTab.addEventListener('click', () => setMode(true));
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (pending) return;
  pending = true;
  submit.disabled = loginTab.disabled = registerTab.disabled = true;
  submit.textContent = register ? '正在创建…' : '正在登录…';
  status.hidden = true;
  try {
    const data = await request(register ? '/api/register' : '/api/login', { username: username.value.trim(), password: password.value });
    setUser(data.user);
    dialog.close();
    accountAvatar.focus();
  } catch (error) { showStatus(error.message); }
  finally {
    password.value = '';
    pending = false;
    submit.disabled = loginTab.disabled = registerTab.disabled = false;
    submit.textContent = register ? '创建账户' : '登录';
  }
});
request('/api/me').then(data => setUser(data.user)).catch(error => {
  showStatus(error.message);
});

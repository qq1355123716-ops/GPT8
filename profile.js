(() => {
  const dialog = document.getElementById('profile-dialog');
  const form = document.getElementById('profile-form');
  const name = document.getElementById('profile-name');
  const preview = document.getElementById('profile-avatar-preview');
  const fileInput = document.getElementById('profile-avatar-input');
  const select = document.getElementById('profile-avatar-select');
  const reset = document.getElementById('profile-avatar-reset');
  const save = document.getElementById('profile-save');
  const status = document.getElementById('profile-status');
  const defaultAvatar = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88"><rect width="88" height="88" fill="#30364a"/><circle cx="44" cy="31" r="14" fill="#c8f27b"/><path d="M18 78v-7a26 26 0 0 1 52 0v7" fill="#c8f27b"/></svg>');
  let user = null;
  let avatar;
  let version = 0;
  let saving = false;
  let selecting = false;
  function message(text) { status.textContent = text; status.hidden = !text; }
  function controls() { save.disabled = select.disabled = reset.disabled = saving || selecting; name.readOnly = saving; }
  function initialize() {
    avatar = undefined;
    fileInput.value = '';
    name.value = user?.displayName || user?.username || '';
    preview.src = user?.avatarUrl || defaultAvatar;
    message('');
  }
  window.addEventListener('authchange', event => {
    user = event.detail.user;
    version++;
    dialog.close();
    initialize();
  });
  window.addEventListener('profilechange', event => { user = event.detail.user; });
  document.getElementById('open-profile').addEventListener('click', () => {
    if (!user) { document.getElementById('open-auth').click(); return; }
    version++;
    initialize();
    setMenuOpen(false);
    dialog.showModal();
    name.focus();
  });
  document.getElementById('profile-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { version++; fileInput.value = ''; });
  select.addEventListener('click', () => fileInput.click());
  reset.addEventListener('click', () => { avatar = null; preview.src = defaultAvatar; message(''); });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)) { message('请选择 PNG、JPG、WebP 或 GIF 图片。'); return; }
    if (file.size > 2 * 1024 * 1024) { message('头像不能超过 2 MB。'); return; }
    const current = version;
    selecting = true; controls(); message('');
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('图片读取失败。'));
        reader.readAsDataURL(file);
      });
      const img = new Image(); img.src = data; await img.decode();
      if (current !== version) return;
      avatar = data; preview.src = data;
    } catch { if (current === version) message('图片无法读取，请重新选择。'); }
    finally { selecting = false; controls(); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || selecting || !user) return;
    const displayName = name.value.trim();
    if (!displayName || Array.from(displayName).length > 24) { message('名称需为 1–24 个字符。'); return; }
    const current = version;
    saving = true; controls(); message(''); save.textContent = '正在保存…';
    try {
      const data = await request('/api/profile', { displayName, avatar });
      if (current !== version) return;
      setUser(data.user, false);
      user = data.user; initialize();
      message('资料已保存。');
    } catch (error) { if (current === version) message(error.message); }
    finally { saving = false; save.textContent = '保存资料'; controls(); }
  });
})();

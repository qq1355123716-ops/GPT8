(() => {
  const dialog = document.getElementById('activity-dialog');
  const form = document.getElementById('activity-form');
  const content = document.getElementById('activity-content');
  const submit = document.getElementById('activity-submit');
  const status = document.getElementById('activity-status');
  const feed = document.getElementById('activity-feed');
  const empty = document.getElementById('activity-empty');
  const feedStatus = document.getElementById('activity-feed-status');
  const refresh = document.getElementById('activity-refresh');
  const more = document.getElementById('activity-more');
  const imageInput = document.getElementById('activity-image-input');
  const addImage = document.getElementById('activity-add-image');
  const previews = document.getElementById('activity-image-previews');
  const images = new Map();
  let selecting = false;
  let user = null;
  let pendingOpen = false;
  let publishing = false;
  let next = null;
  let version = 0;
  let loadingVersion = 0;
  function message(element, text) {
    element.textContent = text;
    element.hidden = !text;
  }
  function clearImages() {
    for (const url of images.keys()) URL.revokeObjectURL(url);
    images.clear();
    previews.replaceChildren();
    previews.hidden = true;
  }
  function imageData(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('图片读取失败，请重新选择。'));
      reader.readAsDataURL(file);
    });
  }
  function refreshControls() {
    submit.disabled = addImage.disabled = publishing || selecting;
    for (const button of previews.querySelectorAll('button')) button.disabled = publishing || selecting;
  }
  addImage.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', async () => {
    const files = Array.from(imageInput.files);
    imageInput.value = '';
    const current = version;
    selecting = true;
    refreshControls();
    const errors = [];
    try {
      for (const file of files) {
        if (current !== version) break;
        if (images.size >= 6) { errors.push('最多添加 6 张图片。'); break; }
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { errors.push('请选择 PNG、JPG、WebP 或 GIF 图片。'); continue; }
        if (file.size > 5 * 1024 * 1024) { errors.push('每张图片不能超过 5 MB。'); continue; }
        const url = URL.createObjectURL(file);
        const img = document.createElement('img');
        img.src = url;
        img.alt = file.name;
        try { await img.decode(); } catch { URL.revokeObjectURL(url); errors.push('图片无法读取，请重新选择。'); continue; }
        if (current !== version) { URL.revokeObjectURL(url); break; }
        images.set(url, file);
        const preview = document.createElement('div');
        preview.className = 'activity-image-preview';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `移除图片 ${file.name}`);
        remove.addEventListener('click', () => {
          images.delete(url); URL.revokeObjectURL(url); preview.remove();
          previews.hidden = !images.size;
        });
        preview.append(img, remove);
        previews.append(preview);
        previews.hidden = false;
      }
      if (current === version) message(status, [...new Set(errors)].join(' '));
    } finally { selecting = false; refreshControls(); }
  });
  function render(activity, prepend = false) {
    if ([...feed.children].some(item => item.dataset.id === String(activity.id))) return;
    const card = document.createElement('article');
    card.className = 'activity-card';
    card.dataset.id = activity.id;
    const header = document.createElement('header');
    const author = document.createElement('strong');
    author.textContent = activity.username;
    const time = document.createElement('time');
    time.dateTime = new Date(activity.created).toISOString();
    time.textContent = new Date(activity.created).toLocaleString('zh-CN');
    const text = document.createElement('p');
    text.textContent = activity.content;
    header.append(author, time);
    card.append(header, text);
    if (activity.images?.length) {
      const gallery = document.createElement('div');
      gallery.className = 'activity-images';
      activity.images.forEach((url, index) => {
        if (!/^\/activity-images\/[0-9a-f-]{36}$/.test(url)) return;
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener';
        const img = document.createElement('img');
        img.src = url;
        img.alt = `${activity.username}发布的图片 ${index + 1}`;
        img.loading = 'lazy';
        link.append(img);
        gallery.append(link);
      });
      card.append(gallery);
    }
    if (prepend) feed.prepend(card); else feed.append(card);
    empty.hidden = true;
  }
  async function load(append = false) {
    const current = ++loadingVersion;
    refresh.disabled = more.disabled = true;
    message(feedStatus, '正在读取动态…');
    try {
      const response = await fetch('/api/activities' + (append && next ? `?before=${next}` : ''), { signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (current !== loadingVersion) return;
      if (!response.ok) throw new Error(data.message || '动态读取失败。');
      if (!append) feed.replaceChildren();
      data.activities.forEach(activity => render(activity));
      next = data.next;
      more.hidden = !next;
      empty.hidden = feed.children.length > 0;
      message(feedStatus, '');
    } catch (error) {
      if (current === loadingVersion) message(feedStatus, error.message === 'Failed to fetch' ? '网络连接失败，请点击刷新重试。' : '动态读取失败，请点击刷新重试。');
    } finally {
      if (current === loadingVersion) refresh.disabled = more.disabled = false;
    }
  }
  document.getElementById('publish-activity').addEventListener('click', () => {
    message(status, '');
    if (!user) {
      pendingOpen = true;
      document.getElementById('open-auth').click();
      return;
    }
    dialog.showModal();
    content.focus();
  });
  document.getElementById('auth-dialog').addEventListener('close', () => { pendingOpen = false; });
  window.addEventListener('authchange', event => {
    user = event.detail.user;
    version++;
    if (!user) { dialog.close(); content.value = ''; clearImages(); }
    else if (pendingOpen) { pendingOpen = false; dialog.showModal(); content.focus(); }
  });
  document.getElementById('activity-close').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (publishing || selecting) return;
    if (!content.value.trim() && !images.size) { message(status, '请添加文字或图片。'); content.focus(); return; }
    const current = version;
    publishing = true;
    refreshControls();
    content.readOnly = true;
    submit.textContent = '正在发布…';
    message(status, '');
    try {
      const text = content.value.trim();
      const encodedImages = await Promise.all([...images.values()].map(imageData));
      if (current !== version) return;
      const response = await fetch('/api/activities', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-App-Request': '1' },
        body: JSON.stringify({ content: text, images: encodedImages }), signal: AbortSignal.timeout(60000)
      });
      const data = await response.json();
      if (current !== version) return;
      if (!response.ok) throw new Error(data.message || '发布失败，请重试。');
      content.value = '';
      clearImages();
      dialog.close();
      // 重新读取最新列表，避免正在进行的刷新覆盖新发布的动态。
      await load();
      message(feedStatus, '动态发布成功。');
    } catch (error) {
      if (current === version) message(status, error.message === 'Failed to fetch' ? '网络连接失败，请稍后重试。' : error.message);
    } finally {
      publishing = false;
      refreshControls();
      content.readOnly = false;
      submit.textContent = '发布';
    }
  });
  refresh.addEventListener('click', () => load());
  more.addEventListener('click', () => load(true));
  window.addEventListener('pagechange', event => { if (event.detail.page === 'activity') load(); });
  if (window.location.hash === '#activity') load();
  window.addEventListener('pagehide', event => { if (!event.persisted) clearImages(); });
})();

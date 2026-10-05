const imageInput = document.getElementById('image-input');
const imagePreviews = document.getElementById('image-previews');
const composerStatus = document.getElementById('composer-status');
const addImage = document.getElementById('add-image');
const imageUrls = new Map();
const promptInput = document.getElementById('game-prompt');
const sendMessage = document.getElementById('send-message');
const composerHint = document.getElementById('composer-hint');
const chatHistory = document.getElementById('chat-history');
let baseGameId = new URLSearchParams(window.location.search).get('remix') || undefined;
let baseLoading = Boolean(baseGameId);
let baseInvalid = false;
const defaultPromptPlaceholder = promptInput.placeholder;
const remixBanner = document.createElement('div');
remixBanner.className = 'remix-banner';
remixBanner.hidden = !baseGameId;
const remixText = document.createElement('p');
remixText.textContent = '正在载入原作品…';
const closeRemix = document.createElement('button');
closeRemix.type = 'button';
closeRemix.className = 'remix-close';
closeRemix.textContent = '×';
closeRemix.setAttribute('aria-label', '关闭当前作品修改');
closeRemix.title = '关闭当前作品修改';
remixBanner.append(remixText, closeRemix);
promptInput.closest('.composer').prepend(remixBanner);
const remixRequest = new AbortController();
closeRemix.addEventListener('click', () => {
  remixRequest.abort();
  baseGameId = undefined;
  baseLoading = baseInvalid = false;
  accountVersion++;
  activeRequest?.abort();
  if (gameWindow && !gameWindow.closed) gameWindow.close();
  gameWindow = undefined;
  remixBanner.hidden = true;
  promptInput.placeholder = defaultPromptPlaceholder;
  composerStatus.hidden = true;
  window.history.replaceState(null, '', '/#home');
  refreshComposer();
  promptInput.focus();
});
if (baseGameId) {
  const remixTimer = setTimeout(() => remixRequest.abort(), 15000);
  fetch('/api/works/' + encodeURIComponent(baseGameId), { signal: remixRequest.signal })
    .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.message); return data.game; })
    .then(game => { if (remixRequest.signal.aborted) return; remixText.textContent = `基于「${game.title}」继续修改 · 原作者：${game.author}。新版本保存到你的账号。`; promptInput.placeholder = '输入你想修改的内容，例如：增加关卡、改变玩法或画面…'; })
    .catch(() => { if (remixRequest.signal.aborted) return; baseInvalid = true; remixText.textContent = '原作品无法读取，请从作品页面重新选择。'; })
    .finally(() => { clearTimeout(remixTimer); baseLoading = false; refreshComposer(); });
}
let configured = false;
let loggedIn = false;
let sending = false;
let selecting = false;
let accountVersion = 0;
let activeRequest;
let gameWindow;
function refreshComposer() {
  sendMessage.disabled = baseLoading || baseInvalid || sending || selecting || !configured || (!promptInput.value.trim() && !imageUrls.size);
  addImage.disabled = sending || selecting;
  promptInput.readOnly = sending;
  for (const button of imagePreviews.querySelectorAll('button')) button.disabled = sending;
  composerHint.textContent = sending ? '正在制作游戏…' : !configured ? 'AI 暂不可用' : !loggedIn ? '登录后开始创作' : 'Ctrl + Enter 生成';
}
function showComposerStatus(message) {
  composerStatus.textContent = message;
  composerStatus.hidden = false;
}
function appendChat(role, text, images = [], game = null) {
  const item = document.createElement('article');
  item.className = `chat-message ${role}`;
  const label = document.createElement('div');
  label.className = 'chat-message-label';
  label.textContent = role === 'user' ? '你' : '一句一游戏 AI';
  const body = document.createElement('p');
  body.className = 'chat-message-body';
  body.textContent = text;
  item.append(label, body);
  if (images.length) {
    const list = document.createElement('div');
    list.className = 'chat-message-images';
    images.forEach(src => { const img = document.createElement('img'); img.src = src; img.alt = '发送的参考图片'; list.append(img); });
    item.append(list);
  }
  if (game) {
    const links = document.createElement('div');
    links.className = 'game-links';
    const open = document.createElement('a');
    open.href = game.url;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = `打开游戏 · ${game.title}`;
    const download = document.createElement('a');
    download.href = game.downloadUrl;
    download.textContent = '下载 HTML';
    links.append(open, download);
    item.append(links);
  }
  chatHistory.append(item);
  // 避免长时间对话在浏览器中累积大量图片和内容。
  while (chatHistory.children.length > 12) chatHistory.firstElementChild.remove();
  chatHistory.hidden = false;
  chatHistory.scrollTop = chatHistory.scrollHeight;
}
function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择。'));
    reader.readAsDataURL(file);
  });
}
window.addEventListener('authchange', event => {
  loggedIn = Boolean(event.detail.user);
  accountVersion++;
  activeRequest?.abort();
  if (gameWindow && !gameWindow.closed) gameWindow.close();
  gameWindow = undefined;
  chatHistory.replaceChildren();
  chatHistory.hidden = true;
  composerStatus.hidden = true;
  refreshComposer();
});
promptInput.addEventListener('input', refreshComposer);
promptInput.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    if (!sendMessage.disabled) sendMessage.click();
  }
});
sendMessage.addEventListener('click', async () => {
  if (baseLoading || baseInvalid || sending || !configured || (!promptInput.value.trim() && !imageUrls.size)) return;
  if (!loggedIn) {
    document.getElementById('open-auth').click();
    showComposerStatus('登录后即可发送消息，输入内容会保留。');
    return;
  }
  const version = accountVersion;
  const text = promptInput.value.trim();
  // 在用户点击时预先打开页面，避免 AI 返回后被浏览器拦截弹窗。
  try {
  gameWindow = window.open('about:blank', '_blank');
  if (gameWindow) {
    gameWindow.opener = null;
    gameWindow.document.title = '正在制作游戏 · 一句一游戏';
    const waiting = gameWindow.document.createElement('p');
    waiting.textContent = '正在制作你的游戏，完成后会自动打开…';
    waiting.style.cssText = 'padding:40px;font:16px system-ui;color:#c8f27b;';
    gameWindow.document.body.style.background = '#1b1e30';
    gameWindow.document.body.append(waiting);
  }
  } catch { gameWindow = undefined; }
  sending = true;
  activeRequest = new AbortController();
  const requestController = activeRequest;
  let timedOut = false;
  const requestTimer = setTimeout(() => { timedOut = true; requestController.abort(); }, 110000);
  composerStatus.hidden = true;
  refreshComposer();
  try {
    const images = await Promise.all([...imageUrls.values()].map(readImage));
    if (version !== accountVersion) return;
    const response = await fetch('/api/chat', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-App-Request': '1' },
      body: JSON.stringify({ text, images, baseGameId }),
      signal: requestController.signal
    });
    const data = await response.json();
    if (version !== accountVersion) return;
    if (!response.ok) {
      if (response.status === 401) {
        loggedIn = false;
        chatHistory.replaceChildren();
        chatHistory.hidden = true;
        // 重新检查登录状态，恢复标题栏的登录按钮。
        const auth = await fetch('/api/me', { credentials: 'same-origin' }).then(res => res.json());
        setUser(auth.user);
      }
      throw new Error(data.message || '发送失败，请稍后重试。');
    }
    if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('AI 回复异常，请重试。');
    appendChat('user', text || '请参考这些图片。', images);
    if (data.game && (!/^\/play\/[0-9a-f-]{36}$/.test(data.game.url) || !/^\/games\/[0-9a-f-]{36}\.html\?download=1$/.test(data.game.downloadUrl))) throw new Error('游戏地址异常，请重试。');
    appendChat('assistant', data.reply, [], data.game);
    if (data.game) {
      baseGameId = undefined;
      remixBanner.hidden = true;
      window.history.replaceState(null, '', '/#home');
      window.dispatchEvent(new CustomEvent('gamecreated'));
      if (gameWindow && !gameWindow.closed) gameWindow.location.replace(data.game.url);
      else window.location.assign(data.game.url);
      gameWindow = undefined;
      showComposerStatus(`游戏已保存为 ${data.game.filename}，已自动打开。`);
    } else {
      if (gameWindow && !gameWindow.closed) gameWindow.close();
      gameWindow = undefined;
    }
    promptInput.value = '';
    for (const url of imageUrls.keys()) URL.revokeObjectURL(url);
    imageUrls.clear();
    imagePreviews.replaceChildren();
    imagePreviews.hidden = true;
  } catch (error) {
    if (gameWindow && !gameWindow.closed) gameWindow.close();
    gameWindow = undefined;
    if (version === accountVersion) showComposerStatus(error.message === 'Failed to fetch' ? '网络连接失败，请稍后重试。' : (timedOut || error.name === 'TimeoutError') ? 'AI 回复超时，请稍后重试。' : error.message);
  } finally {
    clearTimeout(requestTimer);
    sending = false;
    activeRequest = undefined;
    refreshComposer();
  }
});
fetch('/api/ai/status').then(response => {
  if (!response.ok) throw new Error();
  return response.json();
}).then(data => { configured = data.configured === true; refreshComposer(); }).catch(() => {
  showComposerStatus('暂时无法连接 AI 服务，请刷新重试。');
  refreshComposer();
});
const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
addImage.addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', async () => {
  const files = Array.from(imageInput.files);
  imageInput.value = '';
  selecting = true;
  refreshComposer();
  const errors = [];
  try {
    for (const file of files) {
      if (imageUrls.size >= 6) { errors.push('最多添加 6 张图片。'); break; }
      if (!allowedTypes.has(file.type)) { errors.push('请选择 PNG、JPG、WebP 或 GIF 图片。'); continue; }
      if (file.size > 10 * 1024 * 1024) { errors.push('每张图片不能超过 10 MB。'); continue; }
      const url = URL.createObjectURL(file);
      const img = document.createElement('img');
      img.alt = file.name;
      img.src = url;
      try { await img.decode(); }
      catch { URL.revokeObjectURL(url); errors.push('有图片无法读取，请重新选择。'); continue; }
      imageUrls.set(url, file);
      const preview = document.createElement('figure');
      preview.className = 'image-preview';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-image';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `移除图片 ${file.name}`);
      remove.addEventListener('click', () => {
        URL.revokeObjectURL(url);
        imageUrls.delete(url);
        preview.remove();
        imagePreviews.hidden = imageUrls.size === 0;
        composerStatus.hidden = true;
        addImage.focus();
        refreshComposer();
      });
      preview.append(img, remove);
      imagePreviews.append(preview);
      imagePreviews.hidden = false;
    }
    composerStatus.textContent = [...new Set(errors)].join(' ');
    composerStatus.hidden = errors.length === 0;
  } finally { selecting = false; refreshComposer(); }
});
// 仅点击发送时上传图片到服务端，再由服务端发送给 DeepSeek。
window.addEventListener('pagehide', event => {
  if (!event.persisted) {
    activeRequest?.abort();
    for (const url of imageUrls.keys()) URL.revokeObjectURL(url);
  }
});

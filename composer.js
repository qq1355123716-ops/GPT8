const imageInput = document.getElementById('image-input');
const imagePreviews = document.getElementById('image-previews');
const composerStatus = document.getElementById('composer-status');
const addImage = document.getElementById('add-image');
const imageUrls = new Map();
const promptInput = document.getElementById('game-prompt');
const sendMessage = document.getElementById('send-message');
const composerHint = document.getElementById('composer-hint');
const chatHistory = document.getElementById('chat-history');
let configured = false;
let loggedIn = false;
let sending = false;
let selecting = false;
let accountVersion = 0;
let activeRequest;
function refreshComposer() {
  sendMessage.disabled = sending || selecting || !configured || (!promptInput.value.trim() && !imageUrls.size);
  addImage.disabled = sending || selecting;
  promptInput.readOnly = sending;
  for (const button of imagePreviews.querySelectorAll('button')) button.disabled = sending;
  composerHint.textContent = sending ? 'AI 正在回复…' : !configured ? 'AI 暂不可用' : !loggedIn ? '登录后开始对话' : 'Ctrl + Enter 发送';
}
function showComposerStatus(message) {
  composerStatus.textContent = message;
  composerStatus.hidden = false;
}
function appendChat(role, text, images = []) {
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
  if (sending || !configured || (!promptInput.value.trim() && !imageUrls.size)) return;
  if (!loggedIn) {
    document.getElementById('open-auth').click();
    showComposerStatus('登录后即可发送消息，输入内容会保留。');
    return;
  }
  const version = accountVersion;
  const text = promptInput.value.trim();
  sending = true;
  activeRequest = new AbortController();
  composerStatus.hidden = true;
  refreshComposer();
  try {
    const images = await Promise.all([...imageUrls.values()].map(readImage));
    if (version !== accountVersion) return;
    const response = await fetch('/api/chat', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-App-Request': '1' },
      body: JSON.stringify({ text, images }),
      signal: AbortSignal.any([activeRequest.signal, AbortSignal.timeout(110000)])
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
    appendChat('assistant', data.reply);
    promptInput.value = '';
    for (const url of imageUrls.keys()) URL.revokeObjectURL(url);
    imageUrls.clear();
    imagePreviews.replaceChildren();
    imagePreviews.hidden = true;
  } catch (error) {
    if (version === accountVersion) showComposerStatus(error.message === 'Failed to fetch' ? '网络连接失败，请稍后重试。' : error.name === 'TimeoutError' ? 'AI 回复超时，请稍后重试。' : error.message);
  } finally {
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
// 仅点击发送时上传图片到服务端，再由服务端发送给 OpenAI。
window.addEventListener('pagehide', event => {
  if (!event.persisted) {
    activeRequest?.abort();
    for (const url of imageUrls.keys()) URL.revokeObjectURL(url);
  }
});

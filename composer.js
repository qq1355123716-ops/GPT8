const imageInput = document.getElementById('image-input');
const imagePreviews = document.getElementById('image-previews');
const composerStatus = document.getElementById('composer-status');
const addImage = document.getElementById('add-image');
const imageUrls = new Set();
const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
addImage.addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', async () => {
  const files = Array.from(imageInput.files);
  imageInput.value = '';
  addImage.disabled = true;
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
      imageUrls.add(url);
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
      });
      preview.append(img, remove);
      imagePreviews.append(preview);
      imagePreviews.hidden = false;
    }
    composerStatus.textContent = [...new Set(errors)].join(' ');
    composerStatus.hidden = errors.length === 0;
  } finally { addImage.disabled = false; }
});
// 图片仅在当前页面预览；接入 AI 时再通过明确的发送操作上传。
window.addEventListener('pagehide', event => {
  if (!event.persisted) for (const url of imageUrls) URL.revokeObjectURL(url);
});

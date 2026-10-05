const instructions = '你是“一句一游戏”的游戏创意助手。用中文帮助用户把一句灵感发展成游戏想法、玩法和实现方案，结合参考图片。回答简洁具体，可按需要给出代码。不要声称已经创建、运行、保存或发布游戏，除非系统确实执行了这些动作。';
class ChatError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function validateInput(body) {
  if (!body || typeof body.text !== 'string' || body.text.length > 10000 || !Array.isArray(body.images) || body.images.length > 6) throw new ChatError(400, '请输入不超过 10000 字的内容，最多添加 6 张图片。');
  const text = body.text.trim();
  if (!text && !body.images.length) throw new ChatError(400, '请先输入内容或添加图片。');
  for (const image of body.images) {
    if (typeof image !== 'string' || image.length > 14 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new ChatError(400, '图片格式无效或超过 10 MB。');
    const encoded = image.slice(image.indexOf(',') + 1);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length > 10 * 1024 * 1024 || bytes.toString('base64') !== encoded) throw new ChatError(400, '图片格式无效或超过 10 MB。');
    const type = image.slice(5, image.indexOf(';'));
    const valid = (type === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
      (type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
      (type === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') ||
      (type === 'image/gif' && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)));
    if (!valid) throw new ChatError(400, '图片内容与格式不匹配。');
  }
  return { text, images: body.images };
}
function createAI({ apiKey = process.env.DEEPSEEK_API_KEY || '', model = process.env.DEEPSEEK_MODEL || 'deepseek-flash', fetchImpl = fetch } = {}) {
  const sessions = new Map();
  return {
    configured: Boolean(apiKey.trim()),
    clear(session) { sessions.delete(session); },
    async reply(session, body, signal) {
      if (!apiKey.trim()) throw new ChatError(503, 'AI 服务尚未配置，请联系管理员。');
      const { text, images } = validateInput(body);
      const now = Date.now();
      for (const [key, value] of sessions) if (!value.busy && now - value.updated > 60 * 60 * 1000) sessions.delete(key);
      let state = sessions.get(session);
      if (!state) {
        if (sessions.size >= 1000) throw new ChatError(503, 'AI 服务繁忙，请稍后再试。');
        state = { history: [], busy: false, count: 0, reset: now + 60 * 60 * 1000, updated: now };
        sessions.set(session, state);
      }
      if (state.busy) throw new ChatError(409, '上一条消息还在回复中，请稍候。');
      if (state.reset <= now) { state.count = 0; state.reset = now + 60 * 60 * 1000; }
      if (state.count >= 30) throw new ChatError(429, '本小时的对话次数已用完，请稍后再试。');
      state.busy = true;
      state.count++;
      state.updated = now;
      try {
        const content = [{ type: 'input_text', text: text || '请根据这些参考图片帮我构思游戏。' }, ...images.map(image_url => ({ type: 'input_image', image_url, detail: 'auto' }))];
        const response = await fetchImpl('https://api.deepseek.com/responses', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, instructions, reasoning: { effort: 'none' }, max_output_tokens: 4096, input: [...state.history, { role: 'user', content }] }),
          signal: AbortSignal.any([AbortSignal.timeout(90000), ...(signal ? [signal] : [])])
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          const quota = response.status === 402 || detail.error?.type === 'insufficient_quota' || ['insufficient_quota', 'credit_balance_exhausted'].includes(detail.error?.code);
          const message = quota ? 'DeepSeek API 余额或额度不足，请管理员充值或检查额度后重试。' : response.status === 429 ? 'AI 服务请求过于频繁，请稍后再试。' : [401, 403].includes(response.status) ? 'DeepSeek 认证失败，请联系管理员检查密钥。' : response.status === 400 ? 'AI 无法处理此请求，请检查图片或联系管理员。' : 'AI 服务暂时不可用，请稍后重试。';
          throw new ChatError(502, message);
        }
        const data = await response.json();
        const reply = (data.output || []).filter(item => item.type === 'message').flatMap(item => item.content || []).map(item => item.type === 'output_text' ? item.text : item.type === 'refusal' ? item.refusal : '').join('\n').trim();
        if (!reply || data.status === 'incomplete') throw new ChatError(502, 'AI 回复未完成，请缩短问题后重试。');
        if (signal?.aborted) throw new ChatError(499, '请求已取消。');
        // 只保留最近的文字上下文，不在服务端累积图片。
        state.history = [...state.history, { role: 'user', content: text || '[用户提供了参考图片]' }, { role: 'assistant', content: reply }].slice(-12);
        return reply;
      } catch (error) {
        if (error instanceof ChatError) throw error;
        throw new ChatError(502, signal?.aborted ? '请求已取消。' : '无法连接 AI 服务或请求超时，请稍后重试。');
      } finally { state.busy = false; state.updated = Date.now(); }
    }
  };
}
module.exports = { createAI, ChatError };

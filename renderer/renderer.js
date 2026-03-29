/**
 * KlimAgent — Renderer
 * Two panels: Chat + GUI Agent
 * All powered by NVIDIA NIM
 */
'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const STATE_KEY = 'klimagent_v3_state';
let chats        = [];          // [{ id, title, messages }]
let activeChatId = null;
let isStreaming  = false;
let currentMode  = 'chat';
let currentModel = 'meta/llama-3.3-70b-instruct';
let guiRunning   = false;
let guiSessionId = null;
let toastTimer   = null;

// ── DOM helpers ────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  renderChatList();
  bindModeTabs();
  bindChatEvents();
  bindGuiEvents();
  bindMiscEvents();
  checkServers();
  loadModels();
});

// ── Persistence ────────────────────────────────────────────────────────────
function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      chats        = s.chats        || [];
      activeChatId = s.activeChatId || null;
      currentModel = s.currentModel || currentModel;
    }
  } catch {}
  // Sanitise stale IDs
  if (activeChatId && !chats.find(c => c.id === activeChatId)) activeChatId = null;
}

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ chats, activeChatId, currentModel }));
  } catch {}
}

// ── Mode tabs ──────────────────────────────────────────────────────────────
function bindModeTabs() {
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => switchMode(btn.dataset.mode));
  });
}

function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  $('panel-chat').classList.toggle('hidden', mode !== 'chat');
  $('panel-gui').classList.toggle('hidden',  mode !== 'gui');
  $('sidebar-chat').classList.toggle('hidden', mode !== 'chat');
  $('sidebar-gui').classList.toggle('hidden',  mode !== 'gui');
  $('chat-model-field').classList.toggle('hidden', mode !== 'chat');
  $('topbar-title').textContent = mode === 'chat' ? (getActiveChat()?.title || 'KlimAgent') : 'GUI Agent';
}

// ── Chat events ────────────────────────────────────────────────────────────
function bindChatEvents() {
  // Home send
  $('home-send').addEventListener('click', () => startChatFromHome());
  $('home-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startChatFromHome(); }
  });
  autoResize($('home-input'));

  // Prompt cards
  document.querySelectorAll('.prompt-card').forEach(card => {
    card.addEventListener('click', () => {
      $('home-input').value = card.dataset.p;
      startChatFromHome();
    });
  });

  // Chat send
  $('chat-send').addEventListener('click', () => sendChat());
  $('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  autoResize($('chat-input'));

  // New chat
  $('new-chat-btn').addEventListener('click', newChat);

  // Model select
  $('model-select').addEventListener('change', e => {
    currentModel = e.target.value;
    saveState();
  });
  // Set initial model select value
  $('model-select').value = currentModel;
}

function bindMiscEvents() {
  $('clear-btn').addEventListener('click', () => {
    if (currentMode === 'chat') clearChat();
    else clearGuiLog();
  });
}

// ── Chat list ──────────────────────────────────────────────────────────────
function renderChatList() {
  const list = $('chat-list');
  list.innerHTML = '';
  [...chats].reverse().forEach(c => {
    const el = document.createElement('div');
    el.className = 'chat-item' + (c.id === activeChatId ? ' active' : '');
    el.textContent = c.title;
    el.dataset.id = c.id;
    el.addEventListener('click', () => openChat(c.id));
    list.appendChild(el);
  });
}

function getActiveChat() {
  return chats.find(c => c.id === activeChatId) || null;
}

function newChat() {
  activeChatId = null;
  showHomeScreen();
  renderChatList();
  $('topbar-title').textContent = 'KlimAgent';
  $('home-input').value = '';
  $('home-input').focus();
}

function openChat(id) {
  activeChatId = id;
  renderChatList();
  showChatScreen();
  const chat = getActiveChat();
  if (chat) {
    $('topbar-title').textContent = chat.title;
    renderMessages(chat.messages);
    scrollToBottom();
  }
  saveState();
}

function clearChat() {
  const chat = getActiveChat();
  if (!chat) return;
  if (!confirm('Clear this conversation?')) return;
  chat.messages = [];
  klimAPI.clearHistory(chat.id).catch(() => {});
  renderMessages([]);
  saveState();
  showToast('Conversation cleared');
}

// ── Home / Chat screen toggle ──────────────────────────────────────────────
function showHomeScreen() {
  $('home-screen').classList.remove('hidden');
  $('chat-screen').classList.add('hidden');
}

function showChatScreen() {
  $('home-screen').classList.add('hidden');
  $('chat-screen').classList.remove('hidden');
}

// ── Start chat from home ───────────────────────────────────────────────────
function startChatFromHome() {
  const text = $('home-input').value.trim();
  if (!text) return;
  $('home-input').value = '';

  // Create new chat
  const id    = `chat_${Date.now()}`;
  const title = text.slice(0, 48) + (text.length > 48 ? '…' : '');
  const chat  = { id, title, messages: [] };
  chats.push(chat);
  activeChatId = id;
  renderChatList();
  showChatScreen();
  $('topbar-title').textContent = title;
  renderMessages([]);
  saveState();

  sendMessage(text);
}

// ── Send chat message ──────────────────────────────────────────────────────
function sendChat() {
  if (isStreaming) return;
  const text = $('chat-input').value.trim();
  if (!text) return;
  $('chat-input').value = '';
  resetTextarea($('chat-input'));

  if (!activeChatId) {
    // Create chat on the fly
    const id    = `chat_${Date.now()}`;
    const title = text.slice(0, 48) + (text.length > 48 ? '…' : '');
    chats.push({ id, title, messages: [] });
    activeChatId = id;
    renderChatList();
    $('topbar-title').textContent = title;
    renderMessages([]);
    saveState();
  }

  sendMessage(text);
}

async function sendMessage(text) {
  if (isStreaming) return;
  const chat = getActiveChat();
  if (!chat) return;

  isStreaming = true;
  setInputEnabled(false);

  // Add user bubble
  chat.messages.push({ role: 'user', content: text });
  appendUserBubble(text);
  scrollToBottom();
  saveState();

  // Assistant bubble (streaming)
  const assistantEl = appendAssistantBubble();
  let fullText = '';
  let toolBuffer = null;

  try {
    const reader = await klimAPI.sendMessage({
      message:    text,
      chatId:     chat.id,
      model:      currentModel,
    });
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        let ev;
        try { ev = JSON.parse(line.slice(6)); } catch { continue; }

        if (ev.type === 'text') {
          fullText += ev.text;
          renderMarkdownInto(assistantEl, fullText);
          scrollToBottom();
        } else if (ev.type === 'tool_use') {
          toolBuffer = { name: ev.name, input: '' };
          appendToolBlock(assistantEl, ev.name, null);
        } else if (ev.type === 'tool_input_delta') {
          if (toolBuffer) toolBuffer.input += ev.delta || '';
        } else if (ev.type === 'tool_result') {
          const inputData = toolBuffer ? parseToolInput(toolBuffer.input) : {};
          updateLastToolBlock(assistantEl, ev.name || (toolBuffer?.name), inputData, ev.result);
          toolBuffer = null;
        } else if (ev.type === 'done') {
          break;
        } else if (ev.type === 'error') {
          fullText += `\n\n**Error:** ${ev.error}`;
          renderMarkdownInto(assistantEl, fullText);
          break;
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      fullText += `\n\n**Network error:** ${err.message}`;
      renderMarkdownInto(assistantEl, fullText);
    }
  } finally {
    isStreaming = false;
    setInputEnabled(true);
    $('chat-input').focus();
  }

  if (fullText) {
    chat.messages.push({ role: 'assistant', content: fullText });
    saveState();
  }
}

function parseToolInput(str) {
  try { return JSON.parse(str); } catch { return str; }
}

// ── Message rendering ──────────────────────────────────────────────────────
function renderMessages(messages) {
  $('msgs-inner').innerHTML = '';
  messages.forEach(m => {
    if (m.role === 'user') appendUserBubble(m.content);
    else appendAssistantBubble(m.content);
  });
}

function appendUserBubble(text) {
  const msg = document.createElement('div');
  msg.className = 'msg user';
  msg.innerHTML = `
    <div class="msg-header">
      <div class="msg-avatar">U</div>
      <span class="msg-name">You</span>
    </div>
    <div class="msg-body">${escapeHtml(text)}</div>`;
  $('msgs-inner').appendChild(msg);
  return msg;
}

function appendAssistantBubble(text) {
  const msg = document.createElement('div');
  msg.className = 'msg assistant';
  const body = document.createElement('div');
  body.className = 'msg-body md';
  msg.innerHTML = `
    <div class="msg-header">
      <div class="msg-avatar">K</div>
      <span class="msg-name">KlimAgent</span>
    </div>`;
  msg.appendChild(body);
  $('msgs-inner').appendChild(msg);
  if (text) renderMarkdownInto(body, text);
  else body.innerHTML = '<div class="dots"><span></span><span></span><span></span></div>';
  return body;
}

function appendToolBlock(parentEl, name, input) {
  const block = document.createElement('div');
  block.className = 'tool-block';
  block.dataset.name = name;
  block.innerHTML = `
    <div class="tool-head" onclick="this.nextElementSibling.classList.toggle('open')">
      <span>⚙</span>
      <span class="tool-fn">${escapeHtml(name)}</span>
      <span class="tool-stat">running…</span>
    </div>
    <div class="tool-body">
      <pre class="tool-input-pre" style="display:none"></pre>
      <div class="tool-result" style="display:none"></div>
    </div>`;
  parentEl.appendChild(block);
  return block;
}

function updateLastToolBlock(parentEl, name, input, output) {
  const blocks = parentEl.querySelectorAll('.tool-block');
  const block  = blocks[blocks.length - 1];
  if (!block) return;
  block.querySelector('.tool-stat').textContent = 'done';
  if (input && typeof input === 'object' && Object.keys(input).length) {
    const pre = block.querySelector('.tool-input-pre');
    pre.textContent = JSON.stringify(input, null, 2);
    pre.style.display = '';
  }
  if (output !== undefined && output !== null) {
    const out = block.querySelector('.tool-result');
    out.textContent = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
    out.style.display = '';
  }
}

// ── GUI Agent events ───────────────────────────────────────────────────────
function bindGuiEvents() {
  $('gui-run').addEventListener('click',  startGuiAgent);
  $('gui-stop').addEventListener('click', stopGuiAgent);
  $('gui-shot').addEventListener('click', takeScreenshot);
}

async function startGuiAgent() {
  if (guiRunning) return;
  const task = $('gui-task').value.trim();
  if (!task) { showToast('Enter a task first'); return; }

  guiRunning   = true;
  guiSessionId = `gui_${Date.now()}`;
  $('gui-run').classList.add('hidden');
  $('gui-stop').classList.remove('hidden');
  clearGuiLog();

  const genModel = $('gui-gen-model').value;
  const visModel = $('gui-vis-model').value;
  const maxSteps = parseInt($('gui-max-steps').value) || 15;
  const reflect  = $('gui-reflect').checked;

  appendGuiLog('status',`Starting agent · task: "${task.slice(0, 80)}"`);

  try {
    const reader = await klimAPI.runGuiAgent({
      task,
      session_id:        guiSessionId,
      generation_model:  genModel,
      grounding_model:   visModel,
      max_steps:         maxSteps,
      enable_reflection: reflect,
    });
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        let ev;
        try { ev = JSON.parse(line.slice(6)); } catch { continue; }
        handleGuiEvent(ev);
        if (ev.type === 'end' || ev.type === 'done') break;
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') appendGuiLog('error', `Stream error: ${err.message}`);
  } finally {
    guiRunning = false;
    $('gui-run').classList.remove('hidden');
    $('gui-stop').classList.add('hidden');
    $('step-info').textContent = '';
  }
}

function handleGuiEvent(ev) {
  switch (ev.type) {
    case 'status':
      appendGuiLog('status',ev.text);
      break;
    case 'warn':
      appendGuiLog('warn', ev.text);
      break;
    case 'ready':
      appendGuiLog('ready', ev.text);
      break;
    case 'step':
      $('step-info').textContent = `Step ${ev.step} / ${ev.total}`;
      appendGuiLog('step', `Step ${ev.step} of ${ev.total}`);
      break;
    case 'screenshot':
      showScreenshot(ev.data);
      break;
    case 'actions':
      if (ev.actions?.length) appendGuiLog('status',`Actions: ${ev.actions.join(', ')}`);
      break;
    case 'action':
      appendGuiLog('action', ev.action);
      break;
    case 'error':
      appendGuiLog('error', ev.text);
      break;
    case 'stopped':
      appendGuiLog('warn', ev.text || 'Stopped');
      break;
    case 'done':
      appendGuiLog('ready', ev.text || 'Done');
      break;
    case 'end':
      appendGuiLog('status','─── session ended ───');
      break;
  }
}

async function stopGuiAgent() {
  if (!guiRunning) return;
  await klimAPI.stopGuiAgent(guiSessionId).catch(() => {});
  guiRunning = false;
  $('gui-run').classList.remove('hidden');
  $('gui-stop').classList.add('hidden');
  appendGuiLog('warn', 'Stopped by user');
}

async function takeScreenshot() {
  showToast('Capturing screenshot…');
  const result = await klimAPI.takeScreenshot().catch(() => null);
  if (result?.screenshot) {
    showScreenshot(result.screenshot);
    showToast('Screenshot captured');
  } else {
    showToast('Screenshot failed — is bridge running?');
  }
}

// ── GUI Log ────────────────────────────────────────────────────────────────
function appendGuiLog(type, text) {
  const log = $('gui-log');
  // Clear placeholder
  const ph = log.querySelector('.log-placeholder');
  if (ph) ph.remove();

  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  line.textContent = `[${ts}] ${text}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function clearGuiLog() {
  $('gui-log').innerHTML = '<span class="log-placeholder">Log appears when the agent runs…</span>';
}

// ── Live screenshot ────────────────────────────────────────────────────────
function showScreenshot(b64) {
  const img  = $('screen-img');
  const empty = $('screen-empty');
  img.src = `data:image/png;base64,${b64}`;
  img.classList.remove('hidden');
  empty.classList.add('hidden');
}

// ── Models ─────────────────────────────────────────────────────────────────
async function loadModels() {
  try {
    const models = await klimAPI.getModels();
    const sel    = $('model-select');
    const cur    = sel.value || currentModel;
    // Only repopulate if we got real data
    if (models?.length) {
      sel.innerHTML = '';
      models.filter(m => !m.vision).forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name || m.id;
        sel.appendChild(opt);
      });
      // Restore selection
      if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
      else if (sel.options.length) sel.value = sel.options[0].value;
      currentModel = sel.value;
    }
  } catch {}
}

// ── Health checks ──────────────────────────────────────────────────────────
async function checkServers() {
  checkApi();
  checkBridge();
  setInterval(checkApi,    30000);
  setInterval(checkBridge, 30000);
}

async function checkApi() {
  try {
    const h = await klimAPI.healthCheck();
    setDot('api-dot', 'api-txt', h.status === 'ok', `NIM · ${h.model || ''}`);
  } catch {
    setDot('api-dot', 'api-txt', false, 'API offline');
  }
}

async function checkBridge() {
  try {
    const h = await klimAPI.bridgeHealth();
    setDot('bridge-dot', 'bridge-txt', h.status === 'ok', `Bridge · ${h.platform || 'ok'}`);
  } catch {
    setDot('bridge-dot', 'bridge-txt', false, 'Bridge offline');
  }
}

function setDot(dotId, txtId, ok, msg) {
  const dot = $(dotId);
  const txt = $(txtId);
  dot.className = `dot ${ok ? 'online' : 'offline'}`;
  txt.textContent = msg;
}

// ── Input state helpers ────────────────────────────────────────────────────
function setInputEnabled(enabled) {
  $('chat-input').disabled  = !enabled;
  $('chat-send').disabled   = !enabled;
  $('chat-send').textContent = enabled ? '▶' : '■';
  if (!enabled) {
    $('chat-send').onclick = () => {
      klimAPI.abortCurrentRequest();
      setInputEnabled(true);
    };
  } else {
    $('chat-send').onclick = () => sendChat();
  }
}

// ── Auto-resize textareas ──────────────────────────────────────────────────
function autoResize(el) {
  el.addEventListener('input', () => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  });
}

function resetTextarea(el) {
  el.style.height = 'auto';
}

// ── Scroll ─────────────────────────────────────────────────────────────────
function scrollToBottom() {
  const sc = $('msgs-scroll');
  sc.scrollTop = sc.scrollHeight;
}

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg, duration = 3000) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

// ── Markdown renderer (lightweight) ───────────────────────────────────────
function renderMarkdownInto(el, md) {
  el.innerHTML = parseMarkdown(md);
}

function parseMarkdown(text) {
  // Fenced code blocks
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre class="code-block${lang ? ' lang-' + lang : ''}"><code>${escapeHtml(code.trimEnd())}</code></pre>`);
  // Inline code
  text = text.replace(/`([^`]+)`/g, (_, c) => `<code class="inline-code">${escapeHtml(c)}</code>`);
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Headings
  text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  text = text.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  text = text.replace(/^# (.+)$/gm,   '<h1>$1</h1>');
  // Unordered list
  text = text.replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>');
  text = text.replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>');
  // Ordered list
  text = text.replace(/^\s*\d+\. (.+)$/gm, '<li>$1</li>');
  // Horizontal rule
  text = text.replace(/^---$/gm, '<hr>');
  // Paragraphs (double newline)
  text = text.replace(/\n{2,}/g, '</p><p>');
  text = '<p>' + text + '</p>';
  // Single newlines within paragraphs
  text = text.replace(/([^>])\n([^<])/g, '$1<br>$2');
  // Clean up empty paragraphs
  text = text.replace(/<p>\s*<\/p>/g, '');
  return text;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

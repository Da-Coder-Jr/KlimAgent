/**
 * KlimAgent — Renderer
 * Three panels: Chat, GUI Agent, OSWorld Benchmark
 * All powered by NVIDIA NIM via Agent-S
 */
'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let chats = [];
let activeChatId = null;
let isStreaming = false;
let currentMode = 'chat';
let currentModel = 'meta/llama-3.3-70b-instruct';
let guiAgentRunning = false;
let benchmarkRunning = false;
const STATE_KEY = 'klimagent_v2_state';

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const homeScreen     = $('home-screen');
const chatScreen     = $('chat-screen');
const chatMessages   = $('chat-messages-inner');
const chatInput      = $('chat-input');
const chatSendBtn    = $('chat-send-btn');
const homeInput      = $('home-input');
const homeSendBtn    = $('home-send-btn');
const topbarTitle    = $('topbar-title');
const newChatBtn     = $('new-chat-btn');
const clearBtn       = $('clear-btn');
const modelSelector  = $('model-selector');
const statusDot      = $('status-dot');
const statusText     = $('status-text');
const bridgeDot      = $('bridge-dot');
const bridgeText     = $('bridge-text');
const toast          = $('toast');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  loadState();
  renderChatList();
  bindEvents();
  autoResize(homeInput);
  autoResize(chatInput);
  checkServers();
  loadModels();
}

// ── Persistence ────────────────────────────────────────────────────────────
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    chats = s.chats || [];
    currentModel = s.model || currentModel;
    modelSelector.value = currentModel;
    if (s.activeChatId && chats.find(c => c.id === s.activeChatId)) {
      activeChatId = s.activeChatId;
      showChatScreen(activeChatId);
    }
  } catch {}
}

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ chats, activeChatId, model: currentModel }));
  } catch {}
}

// ── Server checks ──────────────────────────────────────────────────────────
async function checkServers() {
  // Node server
  try {
    const h = await window.klimAPI.healthCheck();
    statusDot.className = 'status-dot ' + (h.status === 'ok' ? 'online' : 'offline');
    statusText.textContent = h.status === 'ok'
      ? `NIM · ${shortName(h.model || currentModel)}`
      : 'Server offline';
  } catch {
    statusDot.className = 'status-dot offline';
    statusText.textContent = 'Server offline';
  }
  // Python bridge
  try {
    const b = await window.klimAPI.bridgeHealth();
    bridgeDot.className = 'status-dot ' + (b.status === 'ok' ? 'online' : 'offline');
    bridgeText.textContent = b.status === 'ok' ? 'Bridge online' : 'Bridge offline';
  } catch {
    bridgeDot.className = 'status-dot offline';
    bridgeText.textContent = 'Bridge offline';
  }
}

async function loadModels() {
  try {
    const models = await window.klimAPI.getModels();
    modelSelector.innerHTML = '';
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name + (m.vision ? ' 👁' : '');
      modelSelector.appendChild(opt);
    }
    modelSelector.value = currentModel;
    if (!modelSelector.value && models.length) {
      currentModel = models[0].id;
      modelSelector.value = currentModel;
    }
  } catch {}
}

function shortName(id) {
  return id.split('/').pop().replace(/-instruct.*/, '').slice(0, 18);
}

// ── Mode switching ─────────────────────────────────────────────────────────
function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  $(`panel-${mode}`).classList.remove('hidden');

  // Sidebar sections
  $('sidebar-chat-section').classList.toggle('hidden', mode !== 'chat');
  $('sidebar-gui-section').classList.toggle('hidden', mode !== 'gui');
  $('sidebar-bench-section').classList.toggle('hidden', mode !== 'bench');
  $('chat-model-wrap').classList.toggle('hidden', mode !== 'chat');

  topbarTitle.textContent = {
    chat: 'KlimAgent · Chat',
    gui:  'KlimAgent · GUI Agent',
    bench:'KlimAgent · OSWorld Benchmark',
  }[mode] || 'KlimAgent';
}

// ── Chat management ────────────────────────────────────────────────────────
function createChat(firstMsg) {
  const id = `chat_${Date.now()}`;
  chats.unshift({ id, name: firstMsg.slice(0, 42).trim() || 'New Chat', messages: [] });
  activeChatId = id;
  saveState();
  renderChatList();
  return chats[0];
}

function getActiveChat() { return chats.find(c => c.id === activeChatId); }

function deleteChat(id) {
  chats = chats.filter(c => c.id !== id);
  if (activeChatId === id) {
    activeChatId = chats[0]?.id || null;
    activeChatId ? showChatScreen(activeChatId) : showHomeScreen();
  }
  saveState();
  renderChatList();
}

function renderChatList() {
  const el = $('chat-list');
  if (!chats.length) {
    el.innerHTML = '<div style="padding:12px 16px;color:var(--text-muted);font-size:12px">No chats yet</div>';
    return;
  }
  el.innerHTML = chats.map(c => `
    <div class="chat-item${c.id === activeChatId ? ' active' : ''}" data-id="${c.id}">
      <span class="chat-item-icon">💬</span>
      <span class="chat-item-name">${escHtml(c.name)}</span>
      <button class="chat-item-delete" data-id="${c.id}">✕</button>
    </div>
  `).join('');
  el.querySelectorAll('.chat-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.classList.contains('chat-item-delete')) return;
      showChatScreen(item.dataset.id);
    });
    item.querySelector('.chat-item-delete').addEventListener('click', e => {
      e.stopPropagation();
      deleteChat(item.dataset.id);
    });
  });
}

function showHomeScreen() {
  activeChatId = null;
  homeScreen.classList.remove('hidden');
  chatScreen.classList.add('hidden');
  topbarTitle.textContent = 'KlimAgent · Chat';
  renderChatList();
  saveState();
}

function showChatScreen(chatId) {
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return;
  activeChatId = chatId;
  homeScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  topbarTitle.textContent = chat.name;
  chatMessages.innerHTML = '';
  for (const msg of chat.messages) {
    if (msg.role === 'user') appendUserMessage(msg.content);
    else {
      const el = createAssistantEl();
      el.querySelector('.message-content').innerHTML = renderMarkdown(msg.content);
      addCopyBtns(el);
    }
  }
  scrollBottom();
  renderChatList();
  saveState();
}

// ── Event binding ──────────────────────────────────────────────────────────
function bindEvents() {
  // Mode tabs
  document.querySelectorAll('.mode-tab').forEach(t => {
    t.addEventListener('click', () => switchMode(t.dataset.mode));
  });

  newChatBtn.addEventListener('click', showHomeScreen);

  clearBtn.addEventListener('click', async () => {
    if (currentMode === 'chat') {
      const c = getActiveChat();
      if (c) { c.messages = []; chatMessages.innerHTML = ''; await window.klimAPI.clearHistory(c.id); saveState(); }
    } else if (currentMode === 'gui') {
      $('gui-log').innerHTML = '<div class="log-placeholder">Agent log will appear here…</div>';
      $('screenshot-img').classList.add('hidden');
      $('screenshot-container').querySelector('.screenshot-placeholder')?.classList.remove('hidden');
    } else if (currentMode === 'bench') {
      $('bench-log').innerHTML = '<div class="log-placeholder">Run a benchmark to see per-task results…</div>';
      resetScoreCards();
    }
    showToast('Cleared');
  });

  modelSelector.addEventListener('change', () => { currentModel = modelSelector.value; saveState(); checkServers(); });

  homeInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(homeInput.value.trim()); } });
  homeSendBtn.addEventListener('click', () => sendChatMessage(homeInput.value.trim()));
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(chatInput.value.trim()); } });
  chatSendBtn.addEventListener('click', () => isStreaming ? stopChat() : sendChatMessage(chatInput.value.trim()));

  document.querySelectorAll('.prompt-card').forEach(c => {
    c.addEventListener('click', () => sendChatMessage(c.dataset.prompt));
  });

  // GUI Agent
  $('gui-run-btn').addEventListener('click', runGuiAgent);
  $('gui-stop-btn').addEventListener('click', stopGuiAgent);

  // Benchmark
  $('bench-run-btn').addEventListener('click', runBenchmark);
  $('bench-stop-btn').addEventListener('click', () => {
    benchmarkRunning = false;
    $('bench-run-btn').classList.remove('hidden');
    $('bench-stop-btn').classList.add('hidden');
    benchLog('status', 'Benchmark stopped by user.');
  });
}

function autoResize(el) {
  el.addEventListener('input', () => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  });
}

// ── Text Chat ──────────────────────────────────────────────────────────────
async function sendChatMessage(text) {
  if (!text || isStreaming) return;
  let chat = getActiveChat();
  if (!chat) { chat = createChat(text); showChatScreen(chat.id); }
  homeInput.value = ''; chatInput.value = '';
  homeInput.style.height = ''; chatInput.style.height = '';
  chat.messages.push({ role: 'user', content: text });
  saveState();
  appendUserMessage(text);
  scrollBottom();

  const assistantEl = createAssistantEl();
  isStreaming = true;
  updateChatBtns();

  const contentEl = assistantEl.querySelector('.message-content');
  let accText = '';
  let currentToolBlock = null;

  try {
    const reader = await window.klimAPI.sendMessage({ message: text, chatId: chat.id, model: currentModel });
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let evt;
        try { evt = JSON.parse(line.slice(6)); } catch { continue; }
        if (evt.type === 'done') break;
        if (evt.type === 'text') {
          if (currentToolBlock) { currentToolBlock = null; }
          accText += evt.text;
          contentEl.innerHTML = renderMarkdown(accText) + '<span class="cursor-blink">▋</span>';
          scrollBottom();
        }
        if (evt.type === 'tool_use') {
          currentToolBlock = appendToolBlock(contentEl, evt.name, evt.id);
        }
        if (evt.type === 'tool_result' && currentToolBlock) {
          appendToolResult(currentToolBlock, typeof evt.content === 'string' ? evt.content : JSON.stringify(evt.content, null, 2));
          currentToolBlock = null;
        }
        if (evt.type === 'error') { accText += `\n\n**Error:** ${escHtml(evt.error)}`; contentEl.innerHTML = renderMarkdown(accText); }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') { accText += `\n\n**Error:** ${e.message}`; contentEl.innerHTML = renderMarkdown(accText); }
  } finally {
    isStreaming = false;
    updateChatBtns();
    if (accText) { chat.messages.push({ role: 'assistant', content: accText }); saveState(); }
    contentEl.innerHTML = renderMarkdown(accText || '…');
    addCopyBtns(assistantEl);
    scrollBottom();
  }
}

function stopChat() {
  const c = getActiveChat();
  c ? window.klimAPI.stopQuery(c.id) : window.klimAPI.abortCurrentRequest();
  isStreaming = false;
  updateChatBtns();
}

function updateChatBtns() {
  chatSendBtn.textContent = isStreaming ? '■' : '▶';
  chatSendBtn.className = `chat-send-btn${isStreaming ? ' stop' : ''}`;
  homeSendBtn.disabled = isStreaming;
}

// ── GUI Agent ──────────────────────────────────────────────────────────────
async function runGuiAgent() {
  const task = $('gui-task-input').value.trim();
  if (!task) { showToast('Enter a task first'); return; }

  guiAgentRunning = true;
  $('gui-run-btn').classList.add('hidden');
  $('gui-stop-btn').classList.remove('hidden');
  $('gui-log').innerHTML = '';
  $('step-counter').textContent = '';

  const sessionId = `gui_${Date.now()}`;

  try {
    const reader = await window.klimAPI.runGuiAgent({
      task,
      session_id: sessionId,
      generation_model: $('gui-gen-model').value,
      grounding_model: $('gui-vis-model').value,
      max_steps: parseInt($('gui-max-steps').value) || 15,
      enable_reflection: $('gui-reflection').checked,
    });

    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let evt;
        try { evt = JSON.parse(line.slice(6)); } catch { continue; }
        if (evt.type === 'end') break;
        handleGuiEvent(evt);
        if (!guiAgentRunning) break;
      }
      if (!guiAgentRunning) break;
    }
  } catch (e) {
    guiLog('error', `Error: ${e.message}`);
  } finally {
    guiAgentRunning = false;
    $('gui-run-btn').classList.remove('hidden');
    $('gui-stop-btn').classList.add('hidden');
  }
}

function handleGuiEvent(evt) {
  switch (evt.type) {
    case 'status': guiLog('status', evt.text); break;
    case 'warn': guiLog('warn', '⚠ ' + evt.text); break;
    case 'step':
      guiLog('step', `▶ Step ${evt.step}: ${evt.text || ''}`);
      $('step-counter').textContent = `Step ${evt.step}`;
      break;
    case 'screenshot':
      showScreenshot(evt.data);
      guiLog('screenshot', '📸 Screenshot captured');
      break;
    case 'action': guiLog('action', '⚙ ' + evt.action); break;
    case 'actions':
      if (evt.actions?.length) {
        guiLog('action', `🎯 Actions: ${evt.actions.slice(0, 3).join(' | ')}`);
      }
      break;
    case 'error': guiLog('error', '✗ ' + evt.text); break;
    case 'done': guiLog('done', '✓ ' + (evt.text || 'Complete')); break;
  }
}

function guiLog(type, text) {
  const log = $('gui-log');
  if (log.querySelector('.log-placeholder')) log.innerHTML = '';
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function showScreenshot(b64) {
  const img = $('screenshot-img');
  const placeholder = $('screenshot-container').querySelector('.screenshot-placeholder');
  img.src = `data:image/png;base64,${b64}`;
  img.classList.remove('hidden');
  placeholder?.classList.add('hidden');
}

async function stopGuiAgent() {
  guiAgentRunning = false;
  await window.klimAPI.stopGuiAgent(`gui_${Date.now()}`);
  $('gui-run-btn').classList.remove('hidden');
  $('gui-stop-btn').classList.add('hidden');
  guiLog('status', 'Stopped.');
}

// ── OSWorld Benchmark ──────────────────────────────────────────────────────
async function runBenchmark() {
  benchmarkRunning = true;
  $('bench-run-btn').classList.add('hidden');
  $('bench-stop-btn').classList.remove('hidden');
  $('bench-log').innerHTML = '';
  resetScoreCards();

  // Add progress bar
  const prog = document.createElement('div');
  prog.className = 'progress-bar-wrap';
  prog.innerHTML = '<div class="progress-bar" id="bench-progress"></div>';
  $('bench-log').before(prog);

  const maxTasks = parseInt($('bench-tasks').value) || 5;
  let tasksComplete = 0;

  try {
    const reader = await window.klimAPI.runBenchmark({
      domain: $('bench-domain').value,
      max_steps: parseInt($('bench-steps').value) || 15,
      num_tasks: maxTasks,
      generation_model: $('bench-model').value,
      grounding_model: 'nvidia/llama-3.2-90b-vision-instruct',
    });

    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      if (!benchmarkRunning) break;
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let evt;
        try { evt = JSON.parse(line.slice(6)); } catch { continue; }
        if (evt.type === 'end') break;
        handleBenchEvent(evt, maxTasks, (n) => { tasksComplete = n; });
      }
    }
  } catch (e) {
    benchLog('error', `Error: ${e.message}`);
  } finally {
    benchmarkRunning = false;
    $('bench-run-btn').classList.remove('hidden');
    $('bench-stop-btn').classList.add('hidden');
    prog.remove();
  }
}

function handleBenchEvent(evt, maxTasks, setComplete) {
  switch (evt.type) {
    case 'status': benchLog('status', evt.text); break;
    case 'warn': benchLog('warn', '⚠ ' + evt.text); break;
    case 'task_start':
      benchLog('step', `[${evt.task_num}/${evt.total}] ${evt.domain}/${evt.example_id}`);
      $('score-tasks').textContent = evt.task_num;
      if ($('bench-progress')) {
        $('bench-progress').style.width = `${(evt.task_num / maxTasks) * 100}%`;
      }
      break;
    case 'task_result':
      benchLog(evt.score > 0 ? 'done' : 'error',
        `${evt.domain}/${evt.example_id}: ${evt.score > 0 ? '✓' : '✗'} score=${evt.score.toFixed(2)}  avg=${evt.running_avg.toFixed(2)}`
      );
      $('score-avg').textContent = evt.running_avg.toFixed(2);
      setComplete(evt.task_num || 0);
      break;
    case 'benchmark_done':
      $('score-avg').textContent = evt.avg_score.toFixed(2);
      $('score-pct').textContent = `${evt.success_rate_pct}%`;
      $('score-tasks').textContent = evt.total_tasks;
      $('score-model').textContent = shortName(evt.model || '');
      benchLog('done', `✓ Benchmark complete! Success rate: ${evt.success_rate_pct}% on ${evt.total_tasks} tasks`);
      // Update ref table
      updateRefTable(evt.model, evt.success_rate_pct);
      break;
    case 'error': benchLog('error', '✗ ' + evt.text); break;
  }
}

function updateRefTable(model, pct) {
  const rows = document.querySelectorAll('.ref-table .highlight');
  for (const cell of rows) {
    const row = cell.closest('tr');
    const modelCell = row?.querySelector('td');
    if (modelCell && shortName(model).toLowerCase().includes(shortName(modelCell.textContent).toLowerCase())) {
      cell.textContent = `${pct}%`;
    }
  }
}

function benchLog(type, text) {
  const log = $('bench-log');
  if (log.querySelector('.log-placeholder')) log.innerHTML = '';
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function resetScoreCards() {
  $('score-avg').textContent = '—';
  $('score-pct').textContent = '—';
  $('score-tasks').textContent = '0';
  $('score-model').textContent = '—';
}

// ── DOM helpers ────────────────────────────────────────────────────────────
function appendUserMessage(text) {
  const el = document.createElement('div');
  el.className = 'message user';
  el.innerHTML = `<div class="message-header"><div class="message-avatar">U</div><span class="message-sender">You</span></div><div class="message-content">${escHtml(text)}</div>`;
  chatMessages.appendChild(el);
}

function createAssistantEl() {
  const el = document.createElement('div');
  el.className = 'message assistant';
  el.innerHTML = `<div class="message-header"><div class="message-avatar">K</div><span class="message-sender">KlimAgent</span></div><div class="message-content"><div class="loading-dots"><span></span><span></span><span></span></div></div>`;
  chatMessages.appendChild(el);
  scrollBottom();
  return el;
}

function appendToolBlock(contentEl, name, id) {
  const block = document.createElement('div');
  block.className = 'tool-block';
  block.innerHTML = `<div class="tool-header"><span>⚙</span><span class="tool-name">${escHtml(name)}</span><span class="tool-status">running…</span></div><div class="tool-body"></div>`;
  block.querySelector('.tool-header').addEventListener('click', () => {
    block.querySelector('.tool-body').classList.toggle('expanded');
  });
  contentEl.appendChild(block);
  scrollBottom();
  return block;
}

function appendToolResult(block, result) {
  const body = block.querySelector('.tool-body');
  body.classList.add('expanded');
  const el = document.createElement('div');
  el.className = 'tool-result-block';
  el.textContent = result.slice(0, 2000) + (result.length > 2000 ? '\n…(truncated)' : '');
  body.appendChild(el);
  block.querySelector('.tool-status').textContent = 'done';
  scrollBottom();
}

function addCopyBtns(msgEl) {
  msgEl.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.code-block-header')) return;
    const code = pre.querySelector('code');
    const lang = (code?.className || '').replace('language-', '') || 'code';
    const header = document.createElement('div');
    header.className = 'code-block-header';
    header.innerHTML = `<span>${escHtml(lang)}</span><button class="copy-code-btn">Copy</button>`;
    header.querySelector('.copy-code-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(code?.textContent || pre.textContent).then(() => showToast('Copied!'));
    });
    pre.insertBefore(header, pre.firstChild);
  });
}

function scrollBottom() {
  const c = $('chat-messages');
  if (c) c.scrollTop = c.scrollHeight;
}

// ── Toast ──────────────────────────────────────────────────────────────────
let _toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

// ── Markdown ───────────────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return '';
  let h = escHtml(text);
  h = h.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="language-${escHtml(lang || 'text')}">${code.trimEnd()}</code></pre>`);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  h = h.replace(/^&gt; (.+)$/gm, '<blockquote><p>$1</p></blockquote>');
  h = h.replace(/^---+$/gm, '<hr>');
  h = h.replace(/^[\*\-] (.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>.*<\/li>(\n|$))+/g, m => `<ul>${m}</ul>`);
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  h = h.replace(/\n\n+/g, '</p><p>');
  h = `<p>${h}</p>`;
  h = h.replace(/\n/g, '<br>');
  h = h.replace(/<p>\s*<\/p>/g, '');
  ['h1','h2','h3','ul','pre','blockquote'].forEach(tag => {
    h = h.replace(new RegExp(`<p>(<${tag}>)`, 'g'), '$1');
    h = h.replace(new RegExp(`(</${tag}>)<\/p>`, 'g'), '$1');
  });
  h = h.replace(/<p>(<hr>)<\/p>/g, '$1');
  return `<div class="markdown-content">${h}</div>`;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

// Cursor blink
const sty = document.createElement('style');
sty.textContent = `.cursor-blink{display:inline-block;animation:blink .8s step-end infinite;color:var(--accent-green)}@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`;
document.head.appendChild(sty);

// ── Start ──────────────────────────────────────────────────────────────────
init();

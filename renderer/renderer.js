/**
 * KlimAgent — Renderer Process
 * Handles UI state, SSE streaming, and markdown rendering.
 */

'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let chats = [];           // { id, name, messages[] }
let activeChatId = null;
let isStreaming = false;
let currentModel = 'meta/llama-3.3-70b-instruct';

const STATE_KEY = 'klimagent_state';

// ── DOM ────────────────────────────────────────────────────────────────────
const homeScreen     = document.getElementById('home-screen');
const chatScreen     = document.getElementById('chat-screen');
const chatList       = document.getElementById('chat-list');
const chatMessages   = document.getElementById('chat-messages-inner');
const chatInput      = document.getElementById('chat-input');
const chatSendBtn    = document.getElementById('chat-send-btn');
const homeInput      = document.getElementById('home-input');
const homeSendBtn    = document.getElementById('home-send-btn');
const topbarTitle    = document.getElementById('topbar-title');
const newChatBtn     = document.getElementById('new-chat-btn');
const clearBtn       = document.getElementById('clear-btn');
const modelSelector  = document.getElementById('model-selector');
const statusDot      = document.getElementById('status-dot');
const statusText     = document.getElementById('status-text');
const toast          = document.getElementById('toast');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  loadState();
  renderChatList();
  bindEvents();
  autoResizeTextarea(homeInput);
  autoResizeTextarea(chatInput);
  checkServerHealth();
  await loadModels();
}

// ── Persistence ────────────────────────────────────────────────────────────
function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    chats = state.chats || [];
    currentModel = state.model || currentModel;
    modelSelector.value = currentModel;
    if (state.activeChatId && chats.find(c => c.id === state.activeChatId)) {
      activeChatId = state.activeChatId;
      showChatScreen(activeChatId);
    }
  } catch {}
}

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      chats,
      activeChatId,
      model: currentModel
    }));
  } catch {}
}

// ── Server health ──────────────────────────────────────────────────────────
async function checkServerHealth() {
  try {
    const health = await window.klimAPI.healthCheck();
    if (health.status === 'ok') {
      statusDot.className = 'status-dot online';
      statusText.textContent = `NIM · ${shortModelName(health.model || currentModel)}`;
    } else {
      throw new Error('offline');
    }
  } catch {
    statusDot.className = 'status-dot offline';
    statusText.textContent = 'Server offline';
  }
}

async function loadModels() {
  try {
    const models = await window.klimAPI.getModels();
    modelSelector.innerHTML = '';
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      modelSelector.appendChild(opt);
    }
    modelSelector.value = currentModel;
    if (!modelSelector.value && models.length) {
      currentModel = models[0].id;
      modelSelector.value = currentModel;
    }
  } catch {}
}

function shortModelName(id) {
  const parts = id.split('/');
  return parts[parts.length - 1].replace(/-instruct.*/, '').replace(/-v\d.*/, '');
}

// ── Chat Management ────────────────────────────────────────────────────────
function createChat(firstMessage) {
  const id = `chat_${Date.now()}`;
  const name = firstMessage.slice(0, 40).trim() || 'New Chat';
  const chat = { id, name, messages: [] };
  chats.unshift(chat);
  activeChatId = id;
  saveState();
  renderChatList();
  return chat;
}

function getActiveChat() {
  return chats.find(c => c.id === activeChatId);
}

function deleteChat(id) {
  chats = chats.filter(c => c.id !== id);
  if (activeChatId === id) {
    activeChatId = chats[0]?.id || null;
    if (activeChatId) {
      showChatScreen(activeChatId);
    } else {
      showHomeScreen();
    }
  }
  saveState();
  renderChatList();
}

function renderChatList() {
  chatList.innerHTML = '';
  if (chats.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:16px;text-align:center;color:var(--text-muted);font-size:12px;';
    empty.textContent = 'No chats yet';
    chatList.appendChild(empty);
    return;
  }
  for (const chat of chats) {
    const item = document.createElement('div');
    item.className = `chat-item${chat.id === activeChatId ? ' active' : ''}`;
    item.dataset.id = chat.id;
    item.innerHTML = `
      <span class="chat-item-icon">💬</span>
      <span class="chat-item-name">${escapeHtml(chat.name)}</span>
      <button class="chat-item-delete" title="Delete" data-id="${chat.id}">✕</button>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('chat-item-delete')) return;
      showChatScreen(chat.id);
    });
    item.querySelector('.chat-item-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChat(chat.id);
    });
    chatList.appendChild(item);
  }
}

// ── Screen switching ───────────────────────────────────────────────────────
function showHomeScreen() {
  activeChatId = null;
  homeScreen.classList.remove('hidden');
  chatScreen.classList.add('hidden');
  topbarTitle.textContent = 'KlimAgent';
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
  renderChatList();

  // Re-render messages
  chatMessages.innerHTML = '';
  for (const msg of chat.messages) {
    if (msg.role === 'user') {
      appendUserMessage(msg.content);
    } else if (msg.role === 'assistant') {
      const el = createAssistantMessageEl();
      el.querySelector('.message-content').innerHTML = renderMarkdown(msg.content);
      addCopyButtons(el);
    }
  }
  scrollToBottom();
  saveState();
}

// ── Event Binding ──────────────────────────────────────────────────────────
function bindEvents() {
  newChatBtn.addEventListener('click', showHomeScreen);

  clearBtn.addEventListener('click', async () => {
    const chat = getActiveChat();
    if (!chat) return;
    chat.messages = [];
    chatMessages.innerHTML = '';
    await window.klimAPI.clearHistory(chat.id, 'nvidia-nim');
    saveState();
    showToast('Chat cleared');
  });

  modelSelector.addEventListener('change', () => {
    currentModel = modelSelector.value;
    saveState();
    checkServerHealth();
  });

  // Home input
  homeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(homeInput.value.trim());
    }
  });
  homeSendBtn.addEventListener('click', () => sendMessage(homeInput.value.trim()));

  // Chat input
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(chatInput.value.trim());
    }
  });
  chatSendBtn.addEventListener('click', () => {
    if (isStreaming) {
      stopStreaming();
    } else {
      sendMessage(chatInput.value.trim());
    }
  });

  // Suggested prompts
  document.querySelectorAll('.prompt-card').forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.dataset.prompt;
      if (prompt) sendMessage(prompt);
    });
  });
}

// ── Auto-resize textarea ───────────────────────────────────────────────────
function autoResizeTextarea(el) {
  function resize() {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }
  el.addEventListener('input', resize);
}

// ── Messaging ─────────────────────────────────────────────────────────────
async function sendMessage(text) {
  if (!text || isStreaming) return;

  // Get or create chat
  let chat = getActiveChat();
  if (!chat) {
    chat = createChat(text);
    showChatScreen(chat.id);
  }

  // Clear inputs
  homeInput.value = '';
  chatInput.value = '';
  homeInput.style.height = '';
  chatInput.style.height = '';

  // Save user message
  chat.messages.push({ role: 'user', content: text });
  saveState();
  appendUserMessage(text);
  scrollToBottom();

  // Create assistant placeholder
  const assistantEl = createAssistantMessageEl();
  isStreaming = true;
  updateSendButtons();

  // Streaming
  const contentEl = assistantEl.querySelector('.message-content');
  let accText = '';
  let currentToolBlock = null;
  let toolInput = '';

  try {
    const reader = await window.klimAPI.sendMessage({
      message: text,
      chatId: chat.id,
      model: currentModel,
      provider: 'nvidia-nim'
    });

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;

        let evt;
        try { evt = JSON.parse(payload); } catch { continue; }

        if (evt.type === 'done') break;

        if (evt.type === 'text') {
          // Close any open tool block
          if (currentToolBlock) {
            finalizeToolBlock(currentToolBlock, toolInput);
            currentToolBlock = null;
            toolInput = '';
          }
          accText += evt.text;
          renderStreamingText(contentEl, accText);
        }

        if (evt.type === 'tool_use') {
          // Flush accumulated text first
          if (accText) {
            renderStreamingText(contentEl, accText);
          }
          currentToolBlock = appendToolBlock(contentEl, evt.name, evt.id);
          toolInput = JSON.stringify(evt.input || {}, null, 2);
        }

        if (evt.type === 'tool_result' && currentToolBlock) {
          const resultStr = typeof evt.content === 'string'
            ? evt.content
            : JSON.stringify(evt.content, null, 2);
          appendToolResult(currentToolBlock, resultStr);
          currentToolBlock = null;
          toolInput = '';
        }

        if (evt.type === 'error') {
          accText += `\n\n**Error:** ${escapeHtml(evt.error)}`;
          renderStreamingText(contentEl, accText);
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      accText += `\n\n**Error:** ${err.message}`;
      renderStreamingText(contentEl, accText);
    }
  } finally {
    isStreaming = false;
    updateSendButtons();

    // Save assistant message
    if (accText) {
      chat.messages.push({ role: 'assistant', content: accText });
      saveState();
    }

    // Finalize markdown
    contentEl.innerHTML = renderMarkdown(accText || '…');
    addCopyButtons(assistantEl);
    scrollToBottom();
  }
}

function stopStreaming() {
  const chat = getActiveChat();
  if (chat) {
    window.klimAPI.stopQuery(chat.id, 'nvidia-nim');
  } else {
    window.klimAPI.abortCurrentRequest();
  }
  isStreaming = false;
  updateSendButtons();
}

// ── DOM helpers ────────────────────────────────────────────────────────────
function appendUserMessage(text) {
  const el = document.createElement('div');
  el.className = 'message user';
  el.innerHTML = `
    <div class="message-header">
      <div class="message-avatar">U</div>
      <span class="message-sender">You</span>
    </div>
    <div class="message-content">${escapeHtml(text)}</div>
  `;
  chatMessages.appendChild(el);
}

function createAssistantMessageEl() {
  const el = document.createElement('div');
  el.className = 'message assistant';
  el.innerHTML = `
    <div class="message-header">
      <div class="message-avatar">K</div>
      <span class="message-sender">KlimAgent</span>
    </div>
    <div class="message-content">
      <div class="loading-dots"><span></span><span></span><span></span></div>
    </div>
  `;
  chatMessages.appendChild(el);
  scrollToBottom();
  return el;
}

function renderStreamingText(contentEl, text) {
  contentEl.innerHTML = renderMarkdown(text) + '<span class="cursor-blink">▋</span>';
  scrollToBottom();
}

function appendToolBlock(contentEl, toolName, toolId) {
  const block = document.createElement('div');
  block.className = 'tool-block';
  block.innerHTML = `
    <div class="tool-header">
      <span>⚙</span>
      <span class="tool-name">${escapeHtml(toolName)}</span>
      <span class="tool-status">running…</span>
    </div>
    <div class="tool-body"></div>
  `;
  block.querySelector('.tool-header').addEventListener('click', () => {
    block.querySelector('.tool-body').classList.toggle('expanded');
  });
  contentEl.appendChild(block);
  scrollToBottom();
  return block;
}

function finalizeToolBlock(block, input) {
  const bodyEl = block.querySelector('.tool-body');
  if (input) {
    const pre = document.createElement('pre');
    pre.textContent = input;
    bodyEl.appendChild(pre);
  }
  block.querySelector('.tool-status').textContent = 'done';
}

function appendToolResult(block, result) {
  const bodyEl = block.querySelector('.tool-body');
  bodyEl.classList.add('expanded');
  const resultEl = document.createElement('div');
  resultEl.className = 'tool-result-block';
  resultEl.textContent = result.slice(0, 2000) + (result.length > 2000 ? '\n… (truncated)' : '');
  bodyEl.appendChild(resultEl);
  block.querySelector('.tool-status').textContent = 'done';
  scrollToBottom();
}

function addCopyButtons(msgEl) {
  msgEl.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.code-block-header')) return;
    const code = pre.querySelector('code');
    const lang = (code?.className || '').replace('language-', '') || 'code';

    const header = document.createElement('div');
    header.className = 'code-block-header';
    header.innerHTML = `<span>${escapeHtml(lang)}</span><button class="copy-code-btn">Copy</button>`;
    header.querySelector('.copy-code-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(code?.textContent || pre.textContent).then(() => {
        showToast('Copied!');
      });
    });
    pre.insertBefore(header, pre.firstChild);
  });
}

function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  container.scrollTop = container.scrollHeight;
}

function updateSendButtons() {
  if (isStreaming) {
    chatSendBtn.textContent = '■';
    chatSendBtn.classList.add('stop');
    chatSendBtn.disabled = false;
    homeSendBtn.disabled = true;
  } else {
    chatSendBtn.textContent = '▶';
    chatSendBtn.classList.remove('stop');
    chatSendBtn.disabled = false;
    homeSendBtn.disabled = false;
  }
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimeout;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2000);
}

// ── Markdown Renderer ──────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return '';

  let html = escapeHtml(text);

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const l = lang || 'text';
    return `<pre><code class="language-${escapeHtml(l)}">${code.trimEnd()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');

  // Strikethrough
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Blockquote
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote><p>$1</p></blockquote>');

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr>');

  // Unordered list
  html = html.replace(/^[\*\-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>(\n|$))+/g, m => `<ul>${m}</ul>`);

  // Ordered list
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Paragraphs (double newlines)
  html = html.replace(/\n\n+/g, '</p><p>');
  html = `<p>${html}</p>`;

  // Single newlines → <br>
  html = html.replace(/\n/g, '<br>');

  // Clean up empty <p>
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>(<h[1-6]>)/g, '$1');
  html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre>)/g, '$1');
  html = html.replace(/(<\/pre>)<\/p>/g, '$1');
  html = html.replace(/<p>(<blockquote>)/g, '$1');
  html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
  html = html.replace(/<p>(<hr>)<\/p>/g, '$1');

  return `<div class="markdown-content">${html}</div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── Cursor blink style ─────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  .cursor-blink {
    display: inline-block;
    animation: blink 0.8s step-end infinite;
    color: var(--accent-green);
    margin-left: 1px;
  }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
`;
document.head.appendChild(style);

// ── Start ──────────────────────────────────────────────────────────────────
init();

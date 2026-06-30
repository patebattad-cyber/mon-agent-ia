// ===================== STORAGE KEYS =====================
const LS_KEY_API = 'agentIA_apiKey';
const LS_KEY_MODEL = 'agentIA_model';
const LS_KEY_CONVS = 'agentIA_conversations';
const LS_KEY_ACTIVE = 'agentIA_activeConvId';

// ===================== STATE =====================
let conversations = [];
let activeConvId = null;
let activeMode = 'general';
let isLoading = false;
let abortController = null;

// ===================== SYSTEM PROMPTS =====================
const systemPrompts = {
  general: `Tu es un assistant IA personnel performant et bienveillant, qui aide Dieu Donné — un professionnel IT et cybersécurité basé au Bénin.
Tu réponds toujours en français, de façon claire, structurée et directe.
Tu adaptes ton niveau de détail selon la complexité de la question : bref pour les questions simples, détaillé pour les questions complexes.
Tu peux utiliser du **gras**, des listes, du \`code\` quand c'est utile.
Tu es proactif : si tu vois une meilleure façon de faire quelque chose, tu le signales.`,

  cyber: `Tu es un expert en cybersécurité. L'utilisateur est licencié en Sécurité des Systèmes d'Information (ASSRI).
Réponds toujours en français. Sois précis, technique quand nécessaire, et cite les meilleures pratiques (OWASP, NIST, etc.).`,

  code: `Tu es un expert développeur full-stack (Python/Flask, HTML/CSS/JS, Flutter).
Réponds toujours en français. Donne du code propre, commenté et fonctionnel. Explique brièvement les choix techniques importants.`,

  redac: `Tu es un expert en rédaction professionnelle en français. Aide à rédiger, corriger ou améliorer tout type de document : emails, CV, lettres de motivation, rapports, posts LinkedIn, etc.
Adapte le ton selon le contexte demandé.`,

  web: `Tu es un assistant de recherche. Réponds toujours en français. Structure tes réponses avec des points clés et une synthèse claire. Si tu n'es pas certain d'une information récente, dis-le clairement.`
};

const modeLabels = {
  general: '💬 Général', cyber: '🔐 Cyber', code: '💻 Code', redac: '✍️ Rédaction', web: '🌐 Web search'
};

// ===================== DOM REFS =====================
const $ = (id) => document.getElementById(id);
const chat = $('chat');
const input = $('input');
const sendBtn = $('sendBtn');
const welcome = $('welcome');
const sidebar = $('sidebar');
const sidebarOverlay = $('sidebarOverlay');
const convList = $('convList');
const convTitle = $('convTitle');
const onboarding = $('onboarding');
const settingsModal = $('settingsModal');
const toast = $('toast');

// ===================== INIT =====================
function init() {
  const apiKey = localStorage.getItem(LS_KEY_API);
  if (!apiKey) {
    onboarding.style.display = 'flex';
  }

  loadConversations();
  updateConnectionStatus();
  renderConvList();

  if (conversations.length === 0) {
    createNewConversation();
  } else {
    activeConvId = localStorage.getItem(LS_KEY_ACTIVE) || conversations[0].id;
    if (!conversations.find(c => c.id === activeConvId)) activeConvId = conversations[0].id;
    renderActiveConversation();
  }

  // Restore model selection in settings UI
  const savedModel = localStorage.getItem(LS_KEY_MODEL) || 'gemini-2.5-flash';
  document.querySelectorAll('.select-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.model === savedModel);
  });

  registerServiceWorker();
}

function updateConnectionStatus() {
  const statusEl = $('statusIndicator');
  const statusText = $('statusText');
  if (navigator.onLine) {
    statusEl.classList.remove('offline');
    statusText.textContent = 'En ligne';
  } else {
    statusEl.classList.add('offline');
    statusText.textContent = 'Hors ligne';
  }
}

window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ===================== CONVERSATIONS STORAGE =====================
function loadConversations() {
  try {
    const raw = localStorage.getItem(LS_KEY_CONVS);
    conversations = raw ? JSON.parse(raw) : [];
  } catch (e) {
    conversations = [];
  }
}

function saveConversations() {
  try {
    localStorage.setItem(LS_KEY_CONVS, JSON.stringify(conversations));
    localStorage.setItem(LS_KEY_ACTIVE, activeConvId);
  } catch (e) {
    showToast('⚠️ Stockage plein — exporte tes anciennes conversations');
  }
}

function getActiveConv() {
  return conversations.find(c => c.id === activeConvId);
}

function createNewConversation() {
  const conv = {
    id: 'conv_' + Date.now(),
    title: 'Nouvelle conversation',
    mode: 'general',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  conversations.unshift(conv);
  activeConvId = conv.id;
  activeMode = 'general';
  saveConversations();
  renderConvList();
  renderActiveConversation();
  closeSidebar();
}

function deleteConversation(id, evt) {
  evt.stopPropagation();
  if (!confirm('Supprimer cette conversation ?')) return;
  conversations = conversations.filter(c => c.id !== id);
  if (activeConvId === id) {
    if (conversations.length > 0) {
      activeConvId = conversations[0].id;
    } else {
      createNewConversation();
      return;
    }
  }
  saveConversations();
  renderConvList();
  renderActiveConversation();
}

function switchConversation(id) {
  activeConvId = id;
  const conv = getActiveConv();
  activeMode = conv.mode || 'general';
  saveConversations();
  renderConvList();
  renderActiveConversation();
  closeSidebar();
}

function renderConvList() {
  convList.innerHTML = '';
  conversations.forEach(conv => {
    const item = document.createElement('div');
    item.className = 'conv-item' + (conv.id === activeConvId ? ' active' : '');
    item.innerHTML = `
      <span class="conv-icon">💬</span>
      <span class="conv-title">${escapeHtml(conv.title)}</span>
      <button class="conv-del" data-id="${conv.id}">✕</button>
    `;
    item.addEventListener('click', () => switchConversation(conv.id));
    item.querySelector('.conv-del').addEventListener('click', (e) => deleteConversation(conv.id, e));
    convList.appendChild(item);
  });
}

function renderActiveConversation() {
  const conv = getActiveConv();
  if (!conv) return;

  chat.innerHTML = '';
  convTitle.textContent = conv.title === 'Nouvelle conversation' ? 'Mon Agent IA' : conv.title;

  // Sync mode pills
  document.querySelectorAll('.tool-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.mode === activeMode);
  });

  if (conv.messages.length === 0) {
    chat.appendChild(buildWelcome());
    $('suggestions').style.display = 'flex';
  } else {
    $('suggestions').style.display = 'none';
    conv.messages.forEach(msg => {
      appendMessage(msg.role, msg.content, msg.time, false);
    });
  }
  chat.scrollTop = chat.scrollHeight;
}

function buildWelcome() {
  const div = document.createElement('div');
  div.className = 'welcome';
  div.innerHTML = `
    <div class="welcome-icon">⚡</div>
    <h2>Nouvelle conversation</h2>
    <p>Pose-moi n'importe quelle question — rédaction, recherche, code, cybersécurité ou autre.</p>
  `;
  return div;
}

function updateConvTitleFromFirstMessage(text) {
  const conv = getActiveConv();
  if (conv.title === 'Nouvelle conversation') {
    conv.title = text.slice(0, 40) + (text.length > 40 ? '…' : '');
    renderConvList();
    convTitle.textContent = conv.title;
  }
}

// ===================== SIDEBAR =====================
function openSidebar() {
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('show');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('show');
}

$('menuBtn').addEventListener('click', openSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);
$('newChatBtn').addEventListener('click', createNewConversation);
$('clearBtn').addEventListener('click', createNewConversation);

// ===================== MODE PILLS =====================
document.querySelectorAll('.tool-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.tool-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    activeMode = pill.dataset.mode;
    const conv = getActiveConv();
    if (conv) { conv.mode = activeMode; saveConversations(); }
  });
});

// ===================== SUGGESTIONS =====================
document.querySelectorAll('.suggestion-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    input.value = chip.dataset.q;
    send();
  });
});

// ===================== MESSAGE RENDERING =====================
function getTime(ts) {
  return new Date(ts || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatText(text) {
  let codeBlocks = [];
  // Extract code blocks first to protect them from other formatting
  text = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || 'text', code: code.trim() });
    return `__CODEBLOCK_${idx}__`;
  });

  text = escapeHtmlPreserveCode(text);

  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  // Headers
  text = text.replace(/^### (.+)$/gm, '<h4 style="margin:10px 0 4px;font-size:13px;color:var(--accent)">$1</h4>');
  text = text.replace(/^## (.+)$/gm, '<h3 style="margin:10px 0 5px;font-size:14px">$1</h3>');
  text = text.replace(/^# (.+)$/gm, '<h2 style="margin:10px 0 6px;font-size:15px">$1</h2>');
  // Lists
  text = text.replace(/^[-•] (.+)$/gm, '<li>$1</li>');
  text = text.replace(/(<li>.*?<\/li>\s*)+/gs, (m) => `<ul>${m}</ul>`);
  text = text.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // Paragraphs
  text = text.split('\n\n').map(p => {
    p = p.trim();
    if (!p) return '';
    if (p.startsWith('<ul>') || p.startsWith('<h') || p.startsWith('__CODEBLOCK_')) return p;
    return `<p>${p}</p>`;
  }).join('');
  text = text.replace(/\n/g, '<br>');

  // Re-insert code blocks
  text = text.replace(/__CODEBLOCK_(\d+)__/g, (_, idx) => {
    const block = codeBlocks[idx];
    const safeCode = escapeHtml(block.code);
    return `<div class="code-block">
      <span class="code-lang">${block.lang}</span>
      <button class="copy-btn" onclick="copyCode(this)">Copier</button>
      <pre><code>${safeCode}</code></pre>
    </div>`;
  });

  return text;
}

function escapeHtmlPreserveCode(text) {
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function copyCode(btn) {
  const code = btn.nextElementSibling.querySelector('code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'Copié ✓';
    setTimeout(() => btn.textContent = 'Copier', 1500);
  });
}

function appendMessage(role, text, time, animate = true) {
  if (welcome && welcome.parentNode) welcome.remove();
  $('suggestions').style.display = 'none';

  const row = document.createElement('div');
  row.className = `msg-row ${role}`;

  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'msg-avatar';
  avatarDiv.textContent = role === 'ai' ? '🤖' : '👤';

  const wrapper = document.createElement('div');
  wrapper.className = 'bubble-wrapper';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = formatText(text);

  const timeEl = document.createElement('div');
  timeEl.className = 'msg-time';
  timeEl.textContent = getTime(time);

  wrapper.appendChild(bubble);

  if (role === 'ai') {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    actions.innerHTML = `<button class="msg-action-btn" onclick="copyMessage(this)">📋 Copier</button>`;
    wrapper.appendChild(actions);
  }

  wrapper.appendChild(timeEl);

  row.appendChild(avatarDiv);
  row.appendChild(wrapper);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;

  return bubble;
}

function copyMessage(btn) {
  const bubble = btn.closest('.bubble-wrapper').querySelector('.bubble');
  navigator.clipboard.writeText(bubble.textContent).then(() => {
    showToast('Message copié ✓');
  });
}

function showTyping() {
  const row = document.createElement('div');
  row.className = 'msg-row ai';
  row.id = 'typing';
  row.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="bubble"><div class="typing-indicator">
      <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
    </div></div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function removeTyping() {
  const t = $('typing');
  if (t) t.remove();
}

// ===================== SEND MESSAGE (STREAMING) =====================
async function send() {
  const text = input.value.trim();
  if (!text || isLoading) return;

  const apiKey = localStorage.getItem(LS_KEY_API);
  if (!apiKey) {
    onboarding.style.display = 'flex';
    return;
  }

  isLoading = true;
  sendBtn.disabled = false;
  input.value = '';
  input.style.height = 'auto';
  setSendButtonState(true);

  const conv = getActiveConv();
  const now = Date.now();
  appendMessage('user', text, now);
  conv.messages.push({ role: 'user', content: text, time: now });
  updateConvTitleFromFirstMessage(text);
  saveConversations();

  showTyping();

  const model = localStorage.getItem(LS_KEY_MODEL) || 'gemini-2.5-flash';

  // Gemini format: roles are "user" / "model", history mapped from our "ai" role
  const contents = conv.messages.map(m => ({
    role: m.role === 'ai' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const body = {
    contents: contents,
    systemInstruction: {
      parts: [{ text: systemPrompts[activeMode] || systemPrompts.general }]
    },
    generationConfig: { maxOutputTokens: 2000 }
  };

  if (activeMode === 'web') {
    body.tools = [{ google_search: {} }];
  }

  abortController = new AbortController();
  let bubble = null;
  let fullText = '';

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abortController.signal
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `Erreur ${response.status}`);
    }

    removeTyping();
    bubble = appendMessage('ai', '', Date.now());

    const reader = response.body.getReader();
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
        const dataStr = line.slice(6);
        if (!dataStr || dataStr === '[DONE]') continue;
        try {
          const evt = JSON.parse(dataStr);
          const piece = evt?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (piece) {
            fullText += piece;
            bubble.innerHTML = formatText(fullText);
            chat.scrollTop = chat.scrollHeight;
          }
        } catch (e) { /* ignore parse errors on partial chunks */ }
      }
    }

    if (!fullText) fullText = "Désolé, je n'ai pas pu générer de réponse. Réessaie.";
    bubble.innerHTML = formatText(fullText);

    conv.messages.push({ role: 'ai', content: fullText, time: Date.now() });
    conv.updatedAt = Date.now();
    saveConversations();

  } catch (err) {
    removeTyping();
    if (err.name === 'AbortError') {
      if (bubble) {
        fullText += '\n\n_[Réponse arrêtée]_';
        bubble.innerHTML = formatText(fullText);
        conv.messages.push({ role: 'ai', content: fullText, time: Date.now() });
        saveConversations();
      }
    } else {
      const lower = err.message.toLowerCase();
      const msg = (lower.includes('api key') || lower.includes('401') || lower.includes('permission') || lower.includes('invalid'))
        ? '⚠️ Clé API invalide. Vérifie-la dans Paramètres.'
        : lower.includes('quota') || lower.includes('429') || lower.includes('resource_exhausted')
        ? '⚠️ Limite quotidienne gratuite atteinte. Réessaie plus tard ou demain.'
        : `⚠️ Erreur : ${err.message}`;
      appendMessage('ai', msg, Date.now());
    }
  }

  isLoading = false;
  setSendButtonState(false);
  input.focus();
}

function setSendButtonState(loading) {
  if (loading) {
    sendBtn.classList.add('stop');
    sendBtn.innerHTML = `<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
    sendBtn.onclick = stopGeneration;
  } else {
    sendBtn.classList.remove('stop');
    sendBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
    sendBtn.onclick = send;
  }
}

function stopGeneration() {
  if (abortController) abortController.abort();
}

sendBtn.addEventListener('click', send);

input.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

// ===================== ONBOARDING =====================
$('onboardSaveBtn').addEventListener('click', () => {
  const key = $('onboardKeyInput').value.trim();
  if (key.length < 15) {
    showToast('⚠️ Clé invalide — copie-la entièrement');
    return;
  }
  localStorage.setItem(LS_KEY_API, key);
  onboarding.style.display = 'none';
  showToast('Clé enregistrée ✓');
});

// ===================== SETTINGS =====================
$('settingsBtn').addEventListener('click', () => {
  $('apiKeyInput').value = localStorage.getItem(LS_KEY_API) || '';
  settingsModal.classList.add('show');
  closeSidebar();
});

$('closeSettingsBtn').addEventListener('click', () => settingsModal.classList.remove('show'));
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) settingsModal.classList.remove('show'); });

document.querySelectorAll('.select-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.select-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
  });
});

$('saveSettingsBtn').addEventListener('click', () => {
  const key = $('apiKeyInput').value.trim();
  if (key) localStorage.setItem(LS_KEY_API, key);
  const activeChip = document.querySelector('.select-chip.active');
  if (activeChip) localStorage.setItem(LS_KEY_MODEL, activeChip.dataset.model);
  settingsModal.classList.remove('show');
  showToast('Paramètres enregistrés ✓');
});

$('resetAllBtn').addEventListener('click', () => {
  if (!confirm('Cela supprimera TOUTES tes conversations et ta clé API. Continuer ?')) return;
  localStorage.removeItem(LS_KEY_API);
  localStorage.removeItem(LS_KEY_CONVS);
  localStorage.removeItem(LS_KEY_ACTIVE);
  localStorage.removeItem(LS_KEY_MODEL);
  location.reload();
});

// ===================== EXPORT =====================
$('exportBtn').addEventListener('click', () => {
  const data = JSON.stringify(conversations, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `agent-ia-conversations-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  closeSidebar();
  showToast('Export téléchargé ✓');
});

// ===================== TOAST =====================
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ===================== START =====================
init();

/* =========================================================
   Chats module — Discord-style group chats ("servers").
   Admins create chats and manage membership; anyone can also
   join a chat themselves with an invite code. Messages refresh
   on a short poll rather than a live socket (v1 scope).
========================================================= */

const user = SmsAuth.getUser();
const isAdmin = user && user.role === 'admin';

let chatsState = [];
let usersState = [];
let activeChatId = null;
let pollTimer = null;
let memberSearchTerm = '';
let settingsMemberSearchTerm = '';
let settingsCheckedIds = new Set();

if (isAdmin) {
  document.getElementById('createChatBtn').style.display = '';
}

/* ---------- Chat list ---------- */
async function loadChats() {
  try {
    chatsState = await SmsAuth.apiFetch('/chats');
  } catch (err) {
    chatsState = [];
  }
  renderServerRail();
}

function renderServerRail() {
  const list = document.getElementById('serverRailList');
  if (!chatsState.length) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = chatsState.map(c => `
    <div class="server-icon ${c.id === activeChatId ? 'is-active' : ''}" data-chat="${c.id}" title="${c.name}">
      ${c.name.slice(0, 2).toUpperCase()}
    </div>
  `).join('');

  list.querySelectorAll('[data-chat]').forEach(el => {
    el.addEventListener('click', () => selectChat(el.dataset.chat));
  });
}

/* ---------- Selecting / opening a chat ---------- */
async function selectChat(chatId) {
  activeChatId = chatId;
  renderServerRail();
  const chat = chatsState.find(c => c.id === chatId);
  if (!chat) return;

  document.getElementById('chatThreadHeader').innerHTML = `
    <span class="chat-thread-title">${chat.name}</span>
    ${isAdmin ? `<button class="chat-thread-settings-btn" id="openSettingsBtn">Settings</button>` : ''}
  `;
  if (isAdmin) {
    document.getElementById('openSettingsBtn').addEventListener('click', () => openSettingsOverlay(chat));
  }
  document.getElementById('chatInputForm').style.display = 'flex';

  await loadMessages();
  restartPolling();
}

async function loadMessages() {
  if (!activeChatId) return;
  const container = document.getElementById('chatMessages');
  try {
    const messages = await SmsAuth.apiFetch(`/chats/${activeChatId}/messages`);
    renderMessages(messages);
  } catch (err) {
    container.innerHTML = `<div class="error-state">Couldn't load messages: ${err.message}</div>`;
  }
}

function renderMessages(messages) {
  const container = document.getElementById('chatMessages');
  const wasAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 40;

  if (!messages.length) {
    container.innerHTML = `<div class="empty-state">No messages yet — say hi!</div>`;
    return;
  }

  container.innerHTML = messages.map(m => `
    <div class="chat-message ${m.senderId === user.id ? 'is-own' : ''}">
      <div class="chat-message-meta">${m.senderName} · ${new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      <div class="chat-message-bubble">${escapeHtml(m.text)}</div>
    </div>
  `).join('');

  if (wasAtBottom) container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function restartPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(loadMessages, 4000);
}

/* ---------- Sending a message ---------- */
document.getElementById('chatInputForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !activeChatId) return;
  input.value = '';
  try {
    await SmsAuth.apiFetch(`/chats/${activeChatId}/messages`, {
      method: 'POST',
      body: { text },
    });
    await loadMessages();
  } catch (err) {
    alert(`Couldn't send message: ${err.message}`);
  }
});

/* ---------- Join-by-code overlay ---------- */
const joinOverlay = document.getElementById('joinOverlay');
document.getElementById('joinChatBtn').addEventListener('click', () => {
  document.getElementById('joinCodeInput').value = '';
  document.getElementById('joinMessage').textContent = '';
  joinOverlay.style.display = 'flex';
});
document.getElementById('joinCancelBtn').addEventListener('click', () => joinOverlay.style.display = 'none');
document.getElementById('joinSubmitBtn').addEventListener('click', async () => {
  const code = document.getElementById('joinCodeInput').value.trim();
  const msgEl = document.getElementById('joinMessage');
  if (!code) {
    msgEl.textContent = 'Enter a code first.';
    msgEl.classList.add('is-error');
    return;
  }
  try {
    const chat = await SmsAuth.apiFetch('/chats/join', {
      method: 'POST',
      body: { code },
    });
    joinOverlay.style.display = 'none';
    await loadChats();
    selectChat(chat.id);
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.classList.add('is-error');
  }
});

/* ---------- Create-chat overlay (admin only) ---------- */
const createOverlay = document.getElementById('createOverlay');

async function loadUsersForMemberPicker() {
  try {
    usersState = await SmsAuth.apiFetch('/auth/users');
  } catch (err) {
    usersState = [];
  }
}

function renderMemberCheckboxList(containerId, searchTerm, preCheckedIds) {
  const container = document.getElementById(containerId);
  const filtered = usersState
    .filter(u =>
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state">No users match.</div>`;
    return;
  }

  const checkedNow = new Set(
    Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(el => el.value)
  );
  const checkedIds = checkedNow.size ? checkedNow : (preCheckedIds || new Set());

  container.innerHTML = filtered.map(u => `
    <label class="child-checkbox-item">
      <input type="checkbox" value="${u.id}" ${checkedIds.has(u.id) ? 'checked' : ''}>
      <span class="child-name">${u.name}</span>
      <span class="child-class">${u.role}</span>
    </label>
  `).join('');
}

document.getElementById('createChatBtn').addEventListener('click', async () => {
  document.getElementById('newChatName').value = '';
  document.getElementById('createMessage').textContent = '';
  memberSearchTerm = '';
  document.getElementById('memberSearchInput').value = '';
  createOverlay.style.display = 'flex';
  document.getElementById('memberCheckboxList').innerHTML = `<div class="loading-state">Loading users…</div>`;
  await loadUsersForMemberPicker();
  renderMemberCheckboxList('memberCheckboxList', memberSearchTerm, new Set());
});

document.getElementById('memberSearchInput').addEventListener('input', (e) => {
  memberSearchTerm = e.target.value;
  renderMemberCheckboxList('memberCheckboxList', memberSearchTerm, new Set());
});

document.getElementById('createCancelBtn').addEventListener('click', () => createOverlay.style.display = 'none');

document.getElementById('createSubmitBtn').addEventListener('click', async () => {
  const name = document.getElementById('newChatName').value.trim();
  const msgEl = document.getElementById('createMessage');
  msgEl.classList.remove('is-error', 'is-success');
  if (!name) {
    msgEl.textContent = 'Give the chat a name.';
    msgEl.classList.add('is-error');
    return;
  }
  const memberIds = Array.from(
    document.querySelectorAll('#memberCheckboxList input[type="checkbox"]:checked')
  ).map(el => el.value);

  try {
    const chat = await SmsAuth.apiFetch('/chats', {
      method: 'POST',
      body: { name, memberIds },
    });
    createOverlay.style.display = 'none';
    await loadChats();
    selectChat(chat.id);
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.classList.add('is-error');
  }
});

/* ---------- Settings overlay (admin only) ---------- */
const settingsOverlay = document.getElementById('settingsOverlay');

async function openSettingsOverlay(chat) {
  document.getElementById('settingsInviteCode').textContent = chat.inviteCode;
  document.getElementById('settingsMessage').textContent = '';
  settingsMemberSearchTerm = '';
  document.getElementById('settingsMemberSearchInput').value = '';
  settingsCheckedIds = new Set(chat.memberIds);
  settingsOverlay.style.display = 'flex';
  document.getElementById('settingsMemberCheckboxList').innerHTML = `<div class="loading-state">Loading users…</div>`;
  await loadUsersForMemberPicker();
  renderMemberCheckboxList('settingsMemberCheckboxList', settingsMemberSearchTerm, settingsCheckedIds);
}

document.getElementById('settingsMemberSearchInput').addEventListener('input', (e) => {
  settingsMemberSearchTerm = e.target.value;
  renderMemberCheckboxList('settingsMemberCheckboxList', settingsMemberSearchTerm, settingsCheckedIds);
});

document.getElementById('settingsCancelBtn').addEventListener('click', () => settingsOverlay.style.display = 'none');

document.getElementById('regenerateCodeBtn').addEventListener('click', async () => {
  if (!activeChatId) return;
  try {
    const updated = await SmsAuth.apiFetch(`/chats/${activeChatId}/regenerate-code`, { method: 'POST' });
    document.getElementById('settingsInviteCode').textContent = updated.inviteCode;
    const idx = chatsState.findIndex(c => c.id === updated.id);
    if (idx >= 0) chatsState[idx] = updated;
  } catch (err) {
    document.getElementById('settingsMessage').textContent = err.message;
    document.getElementById('settingsMessage').classList.add('is-error');
  }
});

document.getElementById('settingsSaveBtn').addEventListener('click', async () => {
  if (!activeChatId) return;
  const memberIds = Array.from(
    document.querySelectorAll('#settingsMemberCheckboxList input[type="checkbox"]:checked')
  ).map(el => el.value);
  const msgEl = document.getElementById('settingsMessage');
  msgEl.classList.remove('is-error', 'is-success');
  try {
    await SmsAuth.apiFetch(`/chats/${activeChatId}`, {
      method: 'PATCH',
      body: { memberIds },
    });
    msgEl.textContent = 'Members updated.';
    msgEl.classList.add('is-success');
    await loadChats();
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.classList.add('is-error');
  }
});

/* ---------- Init ---------- */
loadChats();

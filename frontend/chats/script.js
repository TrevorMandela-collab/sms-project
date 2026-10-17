/* =========================================================
   Chats module — Discord-style group chats ("servers").
   Admins create chats and manage membership; anyone can also
   join a chat themselves with an invite code. New messages,
   edits, deletes, and reactions arrive instantly over a
   WebSocket; a slow poll runs underneath purely as a safety
   net in case the socket connection drops.
========================================================= */

const user = SmsAuth.getUser();
const isAdmin = user && ["admin", "school_admin"].includes(user.role);

let chatsState = [];
let usersState = [];
let messagesState = [];
let activeChatId = null;
let pollTimer = null;
let memberSearchTerm = "";
let settingsMemberSearchTerm = "";
let settingsCheckedIds = new Set();
let replyingToId = null;
let editingMessageId = null;
let socket = null;
let socketReconnectDelay = 1000;

if (isAdmin) {
  document.getElementById("createChatBtn").style.display = "";
}

/* ---------- Live updates (WebSocket) ---------- */
function connectSocket() {
  const httpBase = SmsAuth.getApiBase().replace(/\/api\/?$/, "");
  const wsBase = httpBase.replace(/^http/, "ws");
  const token = SmsAuth.getToken();
  if (!token) return;

  socket = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}`);

  socket.addEventListener("open", () => {
    socketReconnectDelay = 1000; // reset backoff once a connection succeeds
    if (activeChatId) sendSocketMessage({ type: "join", chatId: activeChatId });
  });

  socket.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "chat:update" && msg.chatId === activeChatId) {
      loadMessages();
    }
  });

  socket.addEventListener("close", () => {
    socket = null;
    setTimeout(connectSocket, socketReconnectDelay);
    socketReconnectDelay = Math.min(socketReconnectDelay * 2, 15000);
  });

  socket.addEventListener("error", () => {
    socket.close();
  });
}

function sendSocketMessage(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

connectSocket();

/* ---------- Chat list ---------- */
async function loadChats() {
  try {
    chatsState = await SmsAuth.apiFetch("/chats");
  } catch (err) {
    chatsState = [];
  }
  renderServerRail();
}

function renderServerRail() {
  const list = document.getElementById("serverRailList");
  if (!chatsState.length) {
    list.innerHTML = "";
    return;
  }
  list.innerHTML = chatsState
    .map(
      (c) => `
    <div class="server-icon ${c.id === activeChatId ? "is-active" : ""}" data-chat="${c.id}" title="${c.name}">
      ${c.name.slice(0, 2).toUpperCase()}
    </div>
  `,
    )
    .join("");

  list.querySelectorAll("[data-chat]").forEach((el) => {
    el.addEventListener("click", () => selectChat(el.dataset.chat));
  });
}

/* ---------- Selecting / opening a chat ---------- */
async function selectChat(chatId) {
  if (activeChatId && activeChatId !== chatId) {
    sendSocketMessage({ type: "leave", chatId: activeChatId });
  }
  activeChatId = chatId;
  sendSocketMessage({ type: "join", chatId });
  renderServerRail();
  const chat = chatsState.find((c) => c.id === chatId);
  if (!chat) return;

  document.getElementById("chatThreadHeader").innerHTML = `
    <span class="chat-thread-title">${chat.name}</span>
    ${isAdmin ? `<button class="chat-thread-settings-btn" id="openSettingsBtn">Settings</button>` : ""}
  `;
  if (isAdmin) {
    document
      .getElementById("openSettingsBtn")
      .addEventListener("click", () => openSettingsOverlay(chat));
  }
  document.getElementById("chatInputForm").style.display = "flex";
  clearContextBar();

  await loadMessages();
  restartPolling();
}

async function loadMessages() {
  if (!activeChatId) return;
  const container = document.getElementById("chatMessages");
  try {
    const messages = await SmsAuth.apiFetch(`/chats/${activeChatId}/messages`);
    renderMessages(messages);
  } catch (err) {
    container.innerHTML = `<div class="error-state">Couldn't load messages: ${err.message}</div>`;
  }
}

function renderMessages(messages) {
  messagesState = messages;
  const container = document.getElementById("chatMessages");
  const wasAtBottom =
    container.scrollTop + container.clientHeight >= container.scrollHeight - 40;
  ChatMessageRenderer.renderChatMessages(container, messages, user.id);

  if (wasAtBottom) container.scrollTop = container.scrollHeight;
}

/* ---------- Reply / Edit context bar ---------- */
function setReplyingTo(messageId) {
  editingMessageId = null;
  replyingToId = messageId;
  const target = messagesState.find((m) => m.id === messageId);
  const bar = document.getElementById("chatContextBar");
  document.getElementById("chatContextLabel").textContent =
    `Replying to ${target ? target.senderName : "message"}`;
  bar.classList.remove("is-editing");
  bar.style.display = "flex";
  document.getElementById("chatInput").value = "";
  document.getElementById("chatInput").focus();
  document.getElementById("chatSendBtn").textContent = "Send";
}

function setEditingMessage(messageId) {
  replyingToId = null;
  editingMessageId = messageId;
  const target = messagesState.find((m) => m.id === messageId);
  if (!target) return;
  const bar = document.getElementById("chatContextBar");
  document.getElementById("chatContextLabel").textContent = "Editing message";
  bar.classList.add("is-editing");
  bar.style.display = "flex";
  document.getElementById("chatInput").value = target.text;
  document.getElementById("chatInput").focus();
  document.getElementById("chatSendBtn").textContent = "Save";
}

function clearContextBar() {
  replyingToId = null;
  editingMessageId = null;
  document.getElementById("chatContextBar").style.display = "none";
  document.getElementById("chatContextBar").classList.remove("is-editing");
  document.getElementById("chatInput").value = "";
  document.getElementById("chatSendBtn").textContent = "Send";
}

document
  .getElementById("chatContextCancelBtn")
  .addEventListener("click", clearContextBar);

/* ---------- Message action clicks (reply, edit, delete, react) ---------- */
document.getElementById("chatMessages").addEventListener("click", async (e) => {
  const actionBtn = e.target.closest("[data-action]");
  const reactBtn = e.target.closest("[data-react]");

  if (actionBtn) {
    const { action, msg } = actionBtn.dataset;
    if (action === "reply") {
      setReplyingTo(msg);
    } else if (action === "edit") {
      setEditingMessage(msg);
    } else if (action === "delete") {
      if (!confirm("Delete this message? This cannot be undone.")) return;
      try {
        await SmsAuth.apiFetch(`/chats/${activeChatId}/messages/${msg}`, {
          method: "DELETE",
        });
        await loadMessages();
      } catch (err) {
        alert(`Couldn't delete message: ${err.message}`);
      }
    } else if (action === "react-toggle") {
      const picker = document.getElementById(`picker-${msg}`);
      document.querySelectorAll(".chat-reaction-picker").forEach((p) => {
        if (p !== picker) p.style.display = "none";
      });
      picker.style.display = picker.style.display === "none" ? "flex" : "none";
    }
    return;
  }

  if (reactBtn) {
    const { react, msg } = reactBtn.dataset;
    try {
      await SmsAuth.apiFetch(`/chats/${activeChatId}/messages/${msg}/react`, {
        method: "POST",
        body: { emoji: react },
      });
      document
        .querySelectorAll(".chat-reaction-picker")
        .forEach((p) => (p.style.display = "none"));
      await loadMessages();
    } catch (err) {
      alert(`Couldn't react: ${err.message}`);
    }
  }
});

function restartPolling() {
  if (pollTimer) clearInterval(pollTimer);
  // Real-time updates arrive over the WebSocket; this is just a safety
  // net in case that connection drops and hasn't reconnected yet.
  pollTimer = setInterval(loadMessages, 15000);
}

/* ---------- Sending a message ---------- */
document
  .getElementById("chatInputForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("chatInput");
    const text = input.value.trim();
    if (!text || !activeChatId) return;

    try {
      if (editingMessageId) {
        const idToEdit = editingMessageId;
        clearContextBar();
        await SmsAuth.apiFetch(`/chats/${activeChatId}/messages/${idToEdit}`, {
          method: "PATCH",
          body: { text },
        });
      } else {
        const replyToId = replyingToId;
        clearContextBar();
        await SmsAuth.apiFetch(`/chats/${activeChatId}/messages`, {
          method: "POST",
          body: { text, replyToId },
        });
      }
      await loadMessages();
    } catch (err) {
      alert(`Couldn't send message: ${err.message}`);
    }
  });

/* ---------- Join-by-code overlay ---------- */
const joinOverlay = document.getElementById("joinOverlay");
document.getElementById("joinChatBtn").addEventListener("click", () => {
  document.getElementById("joinCodeInput").value = "";
  document.getElementById("joinMessage").textContent = "";
  joinOverlay.style.display = "flex";
});
document
  .getElementById("joinCancelBtn")
  .addEventListener("click", () => (joinOverlay.style.display = "none"));
document.getElementById("joinSubmitBtn").addEventListener("click", async () => {
  const code = document.getElementById("joinCodeInput").value.trim();
  const msgEl = document.getElementById("joinMessage");
  if (!code) {
    msgEl.textContent = "Enter a code first.";
    msgEl.classList.add("is-error");
    return;
  }
  try {
    const chat = await SmsAuth.apiFetch("/chats/join", {
      method: "POST",
      body: { code },
    });
    joinOverlay.style.display = "none";
    await loadChats();
    selectChat(chat.id);
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.classList.add("is-error");
  }
});

/* ---------- Create-chat overlay (admin only) ---------- */
const createOverlay = document.getElementById("createOverlay");

async function loadUsersForMemberPicker() {
  try {
    usersState = await SmsAuth.apiFetch("/auth/users");
  } catch (err) {
    usersState = [];
  }
}

function renderMemberCheckboxList(containerId, searchTerm, preCheckedIds) {
  const container = document.getElementById(containerId);
  const filtered = usersState
    .filter(
      (u) =>
        u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (u.email || "").toLowerCase().includes(searchTerm.toLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state">No users match.</div>`;
    return;
  }

  const checkedNow = new Set(
    Array.from(
      container.querySelectorAll('input[type="checkbox"]:checked'),
    ).map((el) => el.value),
  );
  const checkedIds = checkedNow.size ? checkedNow : preCheckedIds || new Set();

  container.innerHTML = filtered
    .map(
      (u) => `
    <label class="child-checkbox-item">
      <input type="checkbox" value="${u.id}" ${checkedIds.has(u.id) ? "checked" : ""}>
      <span class="child-name">${u.name}</span>
      <span class="child-class">${u.role}</span>
    </label>
  `,
    )
    .join("");
}

document.getElementById("createChatBtn").addEventListener("click", async () => {
  document.getElementById("newChatName").value = "";
  document.getElementById("createMessage").textContent = "";
  memberSearchTerm = "";
  document.getElementById("memberSearchInput").value = "";
  createOverlay.style.display = "flex";
  document.getElementById("memberCheckboxList").innerHTML =
    `<div class="loading-state">Loading users…</div>`;
  await loadUsersForMemberPicker();
  renderMemberCheckboxList("memberCheckboxList", memberSearchTerm, new Set());
});

document.getElementById("memberSearchInput").addEventListener("input", (e) => {
  memberSearchTerm = e.target.value;
  renderMemberCheckboxList("memberCheckboxList", memberSearchTerm, new Set());
});

document
  .getElementById("createCancelBtn")
  .addEventListener("click", () => (createOverlay.style.display = "none"));

document
  .getElementById("createSubmitBtn")
  .addEventListener("click", async () => {
    const name = document.getElementById("newChatName").value.trim();
    const msgEl = document.getElementById("createMessage");
    msgEl.classList.remove("is-error", "is-success");
    if (!name) {
      msgEl.textContent = "Give the chat a name.";
      msgEl.classList.add("is-error");
      return;
    }
    const memberIds = Array.from(
      document.querySelectorAll(
        '#memberCheckboxList input[type="checkbox"]:checked',
      ),
    ).map((el) => el.value);

    try {
      const chat = await SmsAuth.apiFetch("/chats", {
        method: "POST",
        body: { name, memberIds },
      });
      createOverlay.style.display = "none";
      await loadChats();
      selectChat(chat.id);
    } catch (err) {
      msgEl.textContent = err.message;
      msgEl.classList.add("is-error");
    }
  });

/* ---------- Settings overlay (admin only) ---------- */
const settingsOverlay = document.getElementById("settingsOverlay");

async function openSettingsOverlay(chat) {
  document.getElementById("settingsChatName").value = chat.name;
  document.getElementById("settingsInviteCode").textContent = chat.inviteCode;
  document.getElementById("settingsMessage").textContent = "";
  settingsMemberSearchTerm = "";
  document.getElementById("settingsMemberSearchInput").value = "";
  settingsCheckedIds = new Set(chat.memberIds);
  settingsOverlay.style.display = "flex";
  document.getElementById("settingsMemberCheckboxList").innerHTML =
    `<div class="loading-state">Loading users…</div>`;
  await loadUsersForMemberPicker();
  renderMemberCheckboxList(
    "settingsMemberCheckboxList",
    settingsMemberSearchTerm,
    settingsCheckedIds,
  );
}

document
  .getElementById("settingsMemberSearchInput")
  .addEventListener("input", (e) => {
    settingsMemberSearchTerm = e.target.value;
    renderMemberCheckboxList(
      "settingsMemberCheckboxList",
      settingsMemberSearchTerm,
      settingsCheckedIds,
    );
  });

document
  .getElementById("settingsCancelBtn")
  .addEventListener("click", () => (settingsOverlay.style.display = "none"));

document.getElementById("deleteChatBtn").addEventListener("click", async () => {
  if (!activeChatId) return;
  const chat = chatsState.find((c) => c.id === activeChatId);
  const confirmed = confirm(
    `Delete "${chat ? chat.name : "this chat"}" and all of its messages? This cannot be undone.`,
  );
  if (!confirmed) return;
  try {
    await SmsAuth.apiFetch(`/chats/${activeChatId}`, { method: "DELETE" });
    settingsOverlay.style.display = "none";
    activeChatId = null;
    document.getElementById("chatThreadHeader").innerHTML =
      `<span class="chat-thread-title">Select a chat</span>`;
    document.getElementById("chatMessages").innerHTML =
      `<div class="empty-state">Pick a chat from the left, or join one with an invite code.</div>`;
    document.getElementById("chatInputForm").style.display = "none";
    clearContextBar();
    if (pollTimer) clearInterval(pollTimer);
    await loadChats();
  } catch (err) {
    document.getElementById("settingsMessage").textContent = err.message;
    document.getElementById("settingsMessage").classList.add("is-error");
  }
});

document
  .getElementById("regenerateCodeBtn")
  .addEventListener("click", async () => {
    if (!activeChatId) return;
    try {
      const updated = await SmsAuth.apiFetch(
        `/chats/${activeChatId}/regenerate-code`,
        { method: "POST" },
      );
      document.getElementById("settingsInviteCode").textContent =
        updated.inviteCode;
      const idx = chatsState.findIndex((c) => c.id === updated.id);
      if (idx >= 0) chatsState[idx] = updated;
    } catch (err) {
      document.getElementById("settingsMessage").textContent = err.message;
      document.getElementById("settingsMessage").classList.add("is-error");
    }
  });

document
  .getElementById("settingsSaveBtn")
  .addEventListener("click", async () => {
    if (!activeChatId) return;
    const name = document.getElementById("settingsChatName").value.trim();
    const memberIds = Array.from(
      document.querySelectorAll(
        '#settingsMemberCheckboxList input[type="checkbox"]:checked',
      ),
    ).map((el) => el.value);
    const msgEl = document.getElementById("settingsMessage");
    msgEl.classList.remove("is-error", "is-success");
    try {
      await SmsAuth.apiFetch(`/chats/${activeChatId}`, {
        method: "PATCH",
        body: { name, memberIds },
      });
      msgEl.textContent = "Chat updated.";
      msgEl.classList.add("is-success");
      await loadChats();
      const updatedChat = chatsState.find((c) => c.id === activeChatId);
      if (updatedChat) {
        document.querySelector(
          "#chatThreadHeader .chat-thread-title",
        ).textContent = updatedChat.name;
      }
    } catch (err) {
      msgEl.textContent = err.message;
      msgEl.classList.add("is-error");
    }
  });

/* ---------- Init ---------- */
loadChats();

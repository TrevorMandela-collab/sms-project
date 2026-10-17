const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function renderChatMessages(container, messages, userId) {
  const doc = container.ownerDocument;
  const fragment = doc.createDocumentFragment();

  if (!messages.length) {
    const empty = doc.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No messages yet — say hi!";
    fragment.appendChild(empty);
    container.replaceChildren(fragment);
    return;
  }

  const byId = new Map(messages.map((message) => [message.id, message]));
  for (const message of messages) {
    const isOwn = message.senderId === userId;
    const card = doc.createElement("div");
    card.className = `chat-message${isOwn ? " is-own" : ""}${message.deleted ? " is-deleted" : ""}`;
    card.setAttribute("data-id", message.id);

    const replyTarget = message.replyToId
      ? byId.get(message.replyToId)
      : null;
    if (replyTarget) {
      const quote = doc.createElement("div");
      quote.className = "chat-reply-quote";
      const quoteName = doc.createElement("span");
      quoteName.className = "chat-reply-quote-name";
      quoteName.textContent = replyTarget.deleted
        ? "Deleted message"
        : replyTarget.senderName;
      const quoteText = doc.createElement("span");
      quoteText.className = "chat-reply-quote-text";
      const replyText = String(replyTarget.text || "");
      quoteText.textContent =
        replyTarget.deleted
          ? ""
          : replyText.slice(0, 60) + (replyText.length > 60 ? "…" : "");
      quote.append(quoteName, quoteText);
      card.appendChild(quote);
    } else if (message.replyToId) {
      const quote = doc.createElement("div");
      quote.className = "chat-reply-quote";
      const quoteText = doc.createElement("span");
      quoteText.className = "chat-reply-quote-text";
      quoteText.textContent = "Original message not found";
      quote.appendChild(quoteText);
      card.appendChild(quote);
    }

    const meta = doc.createElement("div");
    meta.className = "chat-message-meta";
    meta.textContent = `${message.senderName || ""} · ${new Date(message.createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
    if (message.edited && !message.deleted) {
      const edited = doc.createElement("span");
      edited.className = "chat-edited-tag";
      edited.textContent = " · edited";
      meta.appendChild(edited);
    }
    card.appendChild(meta);

    const bubble = doc.createElement("div");
    bubble.className = message.deleted
      ? "chat-message-bubble chat-message-bubble--deleted"
      : "chat-message-bubble";
    if (message.deleted) {
      const deletedLabel = doc.createElement("em");
      deletedLabel.textContent = "Message deleted";
      bubble.appendChild(deletedLabel);
    } else {
      bubble.textContent = message.text;
    }
    card.appendChild(bubble);

    if (!message.deleted) {
      const reactions = Object.entries(message.reactions || {}).filter(
        ([, ids]) => Array.isArray(ids) && ids.length,
      );
      if (reactions.length) {
        const reactionList = doc.createElement("div");
        reactionList.className = "chat-reactions";
        for (const [emoji, ids] of reactions) {
          const button = doc.createElement("button");
          button.type = "button";
          button.className = `chat-reaction-pill${ids.includes(userId) ? " is-mine" : ""}`;
          button.setAttribute("data-react", emoji);
          button.setAttribute("data-msg", message.id);
          button.textContent = `${emoji} ${ids.length}`;
          reactionList.appendChild(button);
        }
        card.appendChild(reactionList);
      }

      const actions = doc.createElement("div");
      actions.className = "chat-message-actions";
      const actionButtons = [
        ["react-toggle", "React", "😊"],
        ["reply", "Reply", "↩"],
        ...(isOwn ? [["edit", "Edit", "✎"], ["delete", "Delete", "🗑"]] : []),
      ];
      for (const [action, title, label] of actionButtons) {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = `chat-action-btn${action === "delete" ? " chat-action-btn--danger" : ""}`;
        button.setAttribute("data-action", action);
        button.setAttribute("data-msg", message.id);
        button.title = title;
        button.textContent = label;
        actions.appendChild(button);
      }
      card.appendChild(actions);

      const picker = doc.createElement("div");
      picker.className = "chat-reaction-picker";
      picker.id = `picker-${message.id}`;
      picker.style.display = "none";
      for (const emoji of QUICK_REACTIONS) {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "chat-reaction-pick";
        button.setAttribute("data-react", emoji);
        button.setAttribute("data-msg", message.id);
        button.textContent = emoji;
        picker.appendChild(button);
      }
      card.appendChild(picker);
    }

    fragment.appendChild(card);
  }
  container.replaceChildren(fragment);
}

const ChatMessageRenderer = { QUICK_REACTIONS, renderChatMessages };
globalThis.ChatMessageRenderer = ChatMessageRenderer;
if (typeof module !== "undefined" && module.exports) {
  module.exports = ChatMessageRenderer;
}

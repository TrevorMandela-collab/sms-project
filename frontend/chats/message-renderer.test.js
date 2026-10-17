const assert = require("node:assert/strict");
const test = require("node:test");
const { renderChatMessages } = require("./message-renderer");

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.className = "";
    this._textContent = "";
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  appendChild(child) {
    if (child.isFragment) {
      this.children.push(...child.children);
      child.children = [];
    } else {
      this.children.push(child);
    }
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  replaceChildren(child) {
    this.children = [];
    if (child) this.appendChild(child);
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  createDocumentFragment() {
    const fragment = new FakeElement("#fragment", this);
    fragment.isFragment = true;
    return fragment;
  }
}

function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

test("renders HTML-like sender names and stored reaction keys as inert text", () => {
  const doc = new FakeDocument();
  const container = doc.createElement("div");
  const senderName = '<img src=x onerror="alert(1)">';
  const reaction = '<svg onload="alert(2)">';

  renderChatMessages(container, [{
    id: "message-1",
    senderId: "other-user",
    senderName,
    text: "Hello",
    createdAt: "2026-01-01T12:00:00.000Z",
    reactions: { [reaction]: ["other-user"] },
  }], "viewer");

  const rendered = descendants(container);
  assert.deepEqual(
    rendered.filter((element) => element.tagName === "IMG" || element.tagName === "SVG"),
    [],
  );
  assert.ok(rendered.some((element) =>
    element.className === "chat-message-meta" &&
    element.textContent.includes(senderName),
  ));
  assert.ok(rendered.some((element) =>
    element.className.includes("chat-reaction-pill") &&
    element.textContent === `${reaction} 1`,
  ));
});

test("retains the existing quick reaction buttons", () => {
  const doc = new FakeDocument();
  const container = doc.createElement("div");
  renderChatMessages(container, [{
    id: "message-2",
    senderId: "viewer",
    senderName: "Viewer",
    text: "Hello",
    createdAt: "2026-01-01T12:00:00.000Z",
    reactions: {},
  }], "viewer");
  const buttons = descendants(container).filter(
    (element) => element.className === "chat-reaction-pick",
  );
  assert.deepEqual(buttons.map((button) => button.textContent), [
    "👍", "❤️", "😂", "😮", "😢", "🙏",
  ]);
});

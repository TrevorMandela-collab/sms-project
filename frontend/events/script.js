let events = [];
let range = "upcoming";

const $ = (selector) => document.querySelector(selector);
const safeText = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]);

function eventDate(record) {
  const date = new Date(record.date);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isUpcoming(record) {
  const date = eventDate(record);
  return date && date >= new Date();
}

function renderStats() {
  const upcoming = events.filter(isUpcoming).sort((a, b) => eventDate(a) - eventDate(b));
  const past = events.filter((record) => !isUpcoming(record));
  $("#upcomingCount").textContent = upcoming.length;
  $("#pastCount").textContent = past.length;
  $("#nextEventDate").textContent = upcoming.length
    ? eventDate(upcoming[0]).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : "None scheduled";
}

function renderEvents() {
  const query = $("#eventSearch").value.trim().toLowerCase();
  const filtered = events
    .filter((record) => range === "all" || (range === "upcoming" ? isUpcoming(record) : !isUpcoming(record)))
    .filter((record) => `${record.name || ""} ${record.description || ""}`.toLowerCase().includes(query))
    .sort((a, b) => range === "past" ? eventDate(b) - eventDate(a) : eventDate(a) - eventDate(b));
  const container = $("#eventsList");

  if (!filtered.length) {
    container.innerHTML = `<div class="event-empty">${query ? "No events match your search." : range === "past" ? "No past events to show." : "No upcoming events. Add a school date to get started."}</div>`;
    return;
  }

  const monthGroups = new Map();
  filtered.forEach((record) => {
    const date = eventDate(record);
    if (!date) return;
    const key = date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    if (!monthGroups.has(key)) monthGroups.set(key, []);
    monthGroups.get(key).push(record);
  });
  container.innerHTML = [...monthGroups.entries()].map(([month, records]) => `
    <section class="event-month"><h2>${safeText(month)}</h2>
      ${records.map((record) => {
        const date = eventDate(record);
        const timestamp = date.toLocaleDateString("en-GB", { weekday: "long", hour: "2-digit", minute: "2-digit" });
        return `<article class="event-row"><time class="event-date" datetime="${date.toISOString()}"><strong>${date.toLocaleDateString("en-GB", { day: "2-digit" })}</strong><span>${date.toLocaleDateString("en-GB", { month: "short" })}</span></time><div class="event-copy"><h3>${safeText(record.name || "Untitled event")}</h3>${record.description ? `<p>${safeText(record.description)}</p>` : ""}<time>${timestamp}</time></div><div class="event-actions"><button type="button" data-edit="${safeText(record.id)}">Edit</button><button type="button" data-delete="${safeText(record.id)}">Delete</button></div></article>`;
      }).join("")}
    </section>`).join("");

  container.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => openEvent(button.dataset.edit));
  });
  container.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteEvent(button.dataset.delete));
  });
}

async function loadEvents() {
  $("#eventsList").innerHTML = `<div class="event-empty">Loading school events…</div>`;
  try {
    events = await SmsAuth.apiFetch("/events");
    renderStats();
    renderEvents();
  } catch (error) {
    $("#eventsList").innerHTML = `<div class="event-empty">Couldn't load events: ${safeText(error.message)}</div>`;
  }
}

function openEvent(id = "") {
  const record = events.find((item) => item.id === id);
  $("#eventId").value = record?.id || "";
  $("#eventName").value = record?.name || "";
  $("#eventDescription").value = record?.description || "";
  if (record?.date) {
    const date = eventDate(record);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    $("#eventDate").value = local.toISOString().slice(0, 16);
  } else {
    const nextHour = new Date();
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    const local = new Date(nextHour.getTime() - nextHour.getTimezoneOffset() * 60000);
    $("#eventDate").value = local.toISOString().slice(0, 16);
  }
  $("#eventModalTitle").textContent = record ? "Edit event" : "Add event";
  $("#eventFormError").textContent = "";
  $("#eventModal").classList.add("is-open");
  $("#eventModal").setAttribute("aria-hidden", "false");
  $("#eventName").focus();
}

function closeEvent() {
  $("#eventModal").classList.remove("is-open");
  $("#eventModal").setAttribute("aria-hidden", "true");
  $("#eventForm").reset();
}

async function deleteEvent(id) {
  const record = events.find((item) => item.id === id);
  const confirmed = await SmsUI.confirm(`Delete “${record?.name || "this event"}”?`, {
    title: "Delete event",
    confirmLabel: "Delete",
    danger: true,
  });
  if (!confirmed) return;
  try {
    await SmsAuth.apiFetch(`/events/${encodeURIComponent(id)}`, { method: "DELETE" });
    SmsUI.toast("Event deleted", "success");
    await loadEvents();
  } catch (error) {
    SmsUI.toast(`Couldn't delete event: ${error.message}`, "error");
  }
}

$("#addEventButton").addEventListener("click", () => openEvent());
$("#cancelEventButton").addEventListener("click", closeEvent);
$("#eventModal").addEventListener("click", (event) => {
  if (event.target === $("#eventModal")) closeEvent();
});
$("#eventSearch").addEventListener("input", renderEvents);
document.querySelectorAll("[data-range]").forEach((button) => {
  button.addEventListener("click", () => {
    range = button.dataset.range;
    document.querySelectorAll("[data-range]").forEach((item) => item.classList.toggle("is-active", item === button));
    renderEvents();
  });
});
$("#eventForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#eventId").value;
  const payload = {
    name: $("#eventName").value.trim(),
    date: new Date($("#eventDate").value).toISOString(),
    description: $("#eventDescription").value.trim(),
  };
  const button = $("#saveEventButton");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    await SmsAuth.apiFetch(id ? `/events/${encodeURIComponent(id)}` : "/events", {
      method: id ? "PATCH" : "POST",
      body: payload,
    });
    closeEvent();
    SmsUI.toast(id ? "Event updated" : "Event added", "success");
    await loadEvents();
  } catch (error) {
    $("#eventFormError").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Save event";
  }
});

loadEvents();
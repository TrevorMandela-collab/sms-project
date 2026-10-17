(function () {
  const pathname = window.location.pathname;
  if (/(?:^|\/)qa-testing(?:\/|$)/i.test(pathname)) return;
  if (new URLSearchParams(window.location.search).get("qaEmbed") === "1") return;

  const hostname = window.location.hostname.replace(/^\[|\]$/g, "");
  const developmentHosts = ["localhost", "127.0.0.1", "::1"];
  if (!developmentHosts.includes(hostname)) return;
  if (document.getElementById("mandelaDevStrip")) return;

  const scriptUrl = document.currentScript && document.currentScript.src;
  if (!scriptUrl) return;
  const appShell = document.querySelector(".app-shell, .dashboard-shell");
  if (!appShell || !document.body) return;

  const strip = document.createElement("div");
  strip.id = "mandelaDevStrip";
  strip.className = "mandela-dev-strip";
  strip.setAttribute("role", "region");
  strip.setAttribute("aria-label", "Development environment");

  const label = document.createElement("div");
  label.className = "mandela-dev-strip-label";
  const indicator = document.createElement("span");
  indicator.className = "mandela-dev-strip-indicator";
  indicator.setAttribute("aria-hidden", "true");
  label.appendChild(indicator);

  const text = document.createElement("span");
  text.textContent = "Development Environment";
  label.appendChild(text);

  const link = document.createElement("a");
  link.className = "mandela-dev-strip-link";
  link.href = new URL("../qa-testing/index.html", scriptUrl).href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Open QA Lab";
  const arrow = document.createElement("span");
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "\u2197";
  link.appendChild(arrow);

  strip.appendChild(label);
  strip.appendChild(link);
  document.body.insertBefore(strip, appShell);
  document.documentElement.classList.add("has-mandela-dev-strip");
})();

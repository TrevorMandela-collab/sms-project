(() => {
  const STARTUP_KEY = "mandela-nexus-startup-seen";
  const MINIMUM_DURATION_MS = 3650;
  const REDUCED_MOTION_DURATION_MS = 800;
  const MAXIMUM_WAIT_MS = 12000;
  const pathname = window.location.pathname.replace(/\/+$/, "");
  const isLoginPage = /\/login(?:\/index\.html)?$/i.test(pathname);
  const isPublicEntryPage =
    /\/(?:login|register|forgot-password|reset-password)(?:\/index\.html)?$/i.test(
      pathname,
    );
  const hasSession = Boolean(localStorage.getItem("sms_token"));

  if (
    sessionStorage.getItem(STARTUP_KEY) === "1" ||
    (isLoginPage && hasSession) ||
    (!isPublicEntryPage && !hasSession)
  ) {
    return;
  }

  sessionStorage.setItem(STARTUP_KEY, "1");
  document.documentElement.classList.add("nexus-startup-pending");

  const reducedMotion =
    localStorage.getItem("sms:reduce-motion") === "true" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const startedAt = performance.now();
  const minimumDuration = reducedMotion
    ? REDUCED_MOTION_DURATION_MS
    : MINIMUM_DURATION_MS;
  const previousAttributes = new Map();
  let overlay;
  let bodyObserver;
  let contentObserver;
  let domReadyHandler;
  let pageReady = document.readyState === "complete";
  let timedOut = false;
  let dismissed = false;
  let minimumTimer;
  let timeoutTimer;
  let removalTimer;

  function blockPageContent() {
    Array.from(document.body.children).forEach((element) => {
      if (element === overlay || previousAttributes.has(element)) return;
      previousAttributes.set(element, {
        inert: element.getAttribute("inert"),
        ariaHidden: element.getAttribute("aria-hidden"),
      });
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    });
  }

  function restorePage() {
    if (contentObserver) {
      contentObserver.disconnect();
      contentObserver = null;
    }
    previousAttributes.forEach((attributes, element) => {
      if (attributes.inert === null) element.removeAttribute("inert");
      else element.setAttribute("inert", attributes.inert);

      if (attributes.ariaHidden === null) {
        element.removeAttribute("aria-hidden");
      } else {
        element.setAttribute("aria-hidden", attributes.ariaHidden);
      }
    });
    previousAttributes.clear();
  }

  function cleanup() {
    window.removeEventListener("load", onPageLoad);
    window.removeEventListener("pagehide", onPageHide);
    window.clearTimeout(minimumTimer);
    window.clearTimeout(timeoutTimer);
    window.clearTimeout(removalTimer);
    if (bodyObserver) {
      bodyObserver.disconnect();
      bodyObserver = null;
    }
    if (domReadyHandler) {
      document.removeEventListener("DOMContentLoaded", domReadyHandler);
      domReadyHandler = null;
    }
  }

  function onPageHide() {
    dismissed = true;
    cleanup();
    restorePage();
    document.documentElement.classList.remove("nexus-startup-pending");
    if (overlay) overlay.remove();
  }

  function dismiss(force = false) {
    if (dismissed || (!pageReady && !force) || !overlay) return;
    dismissed = true;
    cleanup();
    overlay.classList.add("is-exiting");
    removalTimer = window.setTimeout(() => {
      restorePage();
      document.documentElement.classList.remove("nexus-startup-pending");
      overlay.remove();
    }, reducedMotion ? 0 : 380);
  }

  function showSlowState() {
    if (!overlay || pageReady || dismissed) return;

    const notice = overlay.querySelector(".nexus-startup__notice");
    notice.textContent =
      "The app is taking longer than expected to start. You can continue or try loading it again.";
    notice.hidden = false;
    notice.setAttribute("role", "alert");

    const actions = overlay.querySelector(".nexus-startup__actions");
    actions.hidden = false;
    actions.querySelector(".nexus-startup__continue").focus();
  }

  function createOverlay() {
    if (overlay || !document.body) return;

    overlay = document.createElement("section");
    overlay.id = "nexus-startup";
    overlay.className = "nexus-startup";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "nexus-startup-title");
    overlay.setAttribute("aria-describedby", "nexus-startup-tagline");
    overlay.tabIndex = -1;
    overlay.innerHTML = `
      <div class="nexus-startup__loader" aria-hidden="true">
        <div class="nexus-loader-bars">
          <span class="nexus-loader-bar"></span>
          <span class="nexus-loader-bar"></span>
          <span class="nexus-loader-bar"></span>
          <span class="nexus-loader-bar"></span>
          <span class="nexus-loader-bar"></span>
          <span class="nexus-loader-indicator"></span>
        </div>
      </div>
      <div class="nexus-startup__reveal">
        <svg class="nexus-startup__beams" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polygon points="0,0 50,54 0,100" fill="#cbd2e2" opacity=".15"></polygon>
          <polygon points="100,0 50,54 100,100" fill="#cbd2e2" opacity=".15"></polygon>
          <polygon points="28,0 50,48 0,34" fill="#f3e9ce" opacity=".13"></polygon>
          <polygon points="72,0 50,48 100,34" fill="#f3e9ce" opacity=".13"></polygon>
          <polygon points="42,0 58,0 51,56 49,56" fill="#f1dba8" opacity=".22"></polygon>
          <polygon points="47,44 53,44 66,100 34,100" fill="#f1dba8" opacity=".08"></polygon>
        </svg>
        <div class="nexus-startup__horizon" aria-hidden="true"></div>
        <div class="nexus-startup__brand">
          <span class="nexus-startup__mark" role="img" aria-label="Replaceable logo placeholder">
            <span></span>
          </span>
          <p class="nexus-startup__wordmark" id="nexus-startup-title">MANDELA NEXUS</p>
          <p class="nexus-startup__tagline" id="nexus-startup-tagline">One School. One Nexus.</p>
          <p class="nexus-startup__notice" hidden></p>
          <div class="nexus-startup__actions" hidden>
            <button class="nexus-startup__button nexus-startup__continue" type="button">Continue</button>
            <button class="nexus-startup__button nexus-startup__retry" type="button">Retry</button>
          </div>
        </div>
      </div>`;

    if (reducedMotion) overlay.classList.add("is-reduced-motion");
    document.body.appendChild(overlay);

    contentObserver = new MutationObserver(blockPageContent);
    contentObserver.observe(document.body, { childList: true });
    blockPageContent();

    overlay
      .querySelector(".nexus-startup__continue")
      .addEventListener("click", () => dismiss(true));
    overlay
      .querySelector(".nexus-startup__retry")
      .addEventListener("click", () => {
        sessionStorage.removeItem(STARTUP_KEY);
        window.location.reload();
      });
    overlay.focus();

    if (timedOut) showSlowState();
    if (pageReady) scheduleDismissal();
  }

  function scheduleDismissal() {
    const remaining = Math.max(
      0,
      minimumDuration - (performance.now() - startedAt),
    );
    minimumTimer = window.setTimeout(dismiss, remaining);
  }

  function onPageLoad() {
    pageReady = true;
    window.clearTimeout(timeoutTimer);
    scheduleDismissal();
  }

  window.addEventListener("load", onPageLoad, { once: true });
  window.addEventListener("pagehide", onPageHide, { once: true });
  timeoutTimer = window.setTimeout(() => {
    timedOut = true;
    showSlowState();
  }, MAXIMUM_WAIT_MS);

  if (document.body) {
    createOverlay();
  } else {
    bodyObserver = new MutationObserver(() => {
      if (!document.body) return;
      bodyObserver.disconnect();
      bodyObserver = null;
      createOverlay();
    });
    bodyObserver.observe(document.documentElement, { childList: true });
    domReadyHandler = () => {
      if (bodyObserver) {
        bodyObserver.disconnect();
        bodyObserver = null;
      }
      domReadyHandler = null;
      createOverlay();
    };
    document.addEventListener("DOMContentLoaded", domReadyHandler, {
      once: true,
    });
  }

})();

(() => {
  const OPENING_DURATION_MS = 3000;
  const SPOTLIGHT_REVEAL_DURATION_MS = 3000;
  const EXIT_DURATION_MS = 480;
  const SLOW_REQUEST_DURATION_MS = 12000;
  const PAGE_READY_TIMEOUT_MS = 10000;
  const SESSION_STARTUP_KEY = "mandela-nexus-startup-played";
  const startupScriptUrl = new URL(
    document.currentScript.src,
    window.location.href,
  );
  const openingVideoUrl = new URL("assets/nexus-opening.mp4", startupScriptUrl);
  const openingPosterUrl = new URL(
    "assets/nexus-opening-poster.jpg",
    startupScriptUrl,
  );
  let activeStartup;
  let pageStartupTimer;

  function shouldStartOnPageLoad() {
    const navigation = performance.getEntriesByType("navigation")[0];
    return (
      sessionStorage.getItem(SESSION_STARTUP_KEY) !== "true" ||
      navigation?.type === "reload"
    );
  }

  function waitForPageReady() {
    if (document.readyState !== "loading") return Promise.resolve();

    return new Promise((resolve) => {
      let readyTimer;
      const finish = () => {
        window.clearTimeout(readyTimer);
        window.removeEventListener("load", finish);
        resolve();
      };

      window.addEventListener("load", finish, { once: true });
      readyTimer = window.setTimeout(finish, PAGE_READY_TIMEOUT_MS);
    });
  }

  function isReducedMotion() {
    return (
      localStorage.getItem("sms:reduce-motion") === "true" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function start() {
    if (activeStartup) return activeStartup;
    if (!document.body) {
      throw new Error("The startup animation requires a loaded page body.");
    }
    window.clearTimeout(pageStartupTimer);
    pageStartupTimer = null;

    const reducedMotion = isReducedMotion();
    const startedAt = performance.now();
    const openingDuration = reducedMotion ? 0 : OPENING_DURATION_MS;
    const spotlightRevealDuration = reducedMotion
      ? 0
      : SPOTLIGHT_REVEAL_DURATION_MS;
    const previousAttributes = new Map();
    const overlay = document.createElement("section");
    let timeoutTimer;
    let closeTimer;
    let contentObserver;
    let dismissed = false;

    overlay.id = "nexus-startup";
    overlay.className = "nexus-startup";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "nexus-startup-title");
    overlay.setAttribute("aria-describedby", "nexus-startup-tagline");
    overlay.tabIndex = -1;
    overlay.innerHTML = `
      <div class="nexus-startup__opening" aria-hidden="true">
        <div class="nexus-startup__opening-fallback">
          <div class="nexus-loader-bars">
            <span class="nexus-loader-bar"></span>
            <span class="nexus-loader-bar"></span>
            <span class="nexus-loader-bar"></span>
            <span class="nexus-loader-bar"></span>
            <span class="nexus-loader-bar"></span>
            <span class="nexus-loader-indicator"></span>
          </div>
        </div>
        <video class="nexus-startup__opening-video" muted playsinline preload="auto"
          poster="${openingPosterUrl.href}" src="${openingVideoUrl.href}"></video>
      </div>
      <div class="nexus-startup__reveal">
        <svg class="nexus-startup__beams" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polygon class="nexus-beam nexus-beam--left" points="0,0 50,58 0,100" fill="#cbd2e2" opacity=".2"></polygon>
          <polygon class="nexus-beam nexus-beam--right" points="100,0 50,58 100,100" fill="#cbd2e2" opacity=".2"></polygon>
          <polygon class="nexus-beam nexus-beam--cross-left" points="0,0 50,58 16,100" fill="#cbd2e2" opacity=".12"></polygon>
          <polygon class="nexus-beam nexus-beam--cross-right" points="100,0 50,58 84,100" fill="#cbd2e2" opacity=".12"></polygon>
          <polygon class="nexus-beam nexus-beam--warm" points="40,0 60,0 77,100 23,100" fill="#f1dba8" opacity=".18"></polygon>
        </svg>
        <div class="nexus-startup__floor" aria-hidden="true"></div>
        <div class="nexus-startup__dust" aria-hidden="true">
          <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
        </div>
        <div class="nexus-startup__brand">
          <span class="nexus-startup__mark" aria-hidden="true">M</span>
          <p class="nexus-startup__wordmark" id="nexus-startup-title">MANDELA NEXUS</p>
          <p class="nexus-startup__tagline" id="nexus-startup-tagline">One School. One Nexus.</p>
          <p class="nexus-startup__notice" hidden></p>
          <div class="nexus-startup__actions" hidden>
            <button class="nexus-startup__button nexus-startup__continue" type="button">Continue without animation</button>
          </div>
        </div>
      </div>`;

    if (reducedMotion) overlay.classList.add("is-reduced-motion");
    document.documentElement.classList.add("nexus-startup-pending");
    document.body.appendChild(overlay);
    document.documentElement.classList.remove("nexus-startup-booting");

    const openingVideo = overlay.querySelector(".nexus-startup__opening-video");
    const playOpeningClip = () => {
      if (reducedMotion || document.hidden || dismissed) return;

      openingVideo.play().catch((error) => {
        if (document.hidden && error.name === "AbortError") return;
        overlay.classList.add("is-opening-fallback");
        console.error(
          "[startup] Unable to play the opening reference clip.",
          error,
        );
      });
    };
    const onOpeningVideoPlaying = () =>
      overlay.classList.remove("is-opening-fallback");
    const onVisibilityChange = () => {
      if (!document.hidden) playOpeningClip();
    };

    if (!reducedMotion) {
      openingVideo.addEventListener("playing", onOpeningVideoPlaying);
      document.addEventListener("visibilitychange", onVisibilityChange);
      playOpeningClip();
    }

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
      document.documentElement.classList.remove("nexus-startup-pending");
      if (activeStartup === startup) activeStartup = null;
    }

    function cleanup() {
      window.clearTimeout(timeoutTimer);
      window.clearTimeout(closeTimer);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      openingVideo.removeEventListener("playing", onOpeningVideoPlaying);
      openingVideo.pause();
    }

    function onPageHide() {
      dismissed = true;
      cleanup();
      restorePage();
      overlay.remove();
    }

    function close() {
      if (dismissed) return Promise.resolve();
      dismissed = true;
      cleanup();
      overlay.classList.add("is-exiting");

      return new Promise((resolve) => {
        closeTimer = window.setTimeout(() => {
          restorePage();
          overlay.remove();
          resolve();
        }, reducedMotion ? 0 : EXIT_DURATION_MS);
      });
    }

    function showSlowState() {
      if (dismissed) return;
      const notice = overlay.querySelector(".nexus-startup__notice");
      notice.textContent =
        "This is taking longer than expected. You can continue without the animation.";
      notice.hidden = false;
      notice.setAttribute("role", "alert");
      const actions = overlay.querySelector(".nexus-startup__actions");
      actions.hidden = false;
      actions
        .querySelector(".nexus-startup__continue")
        .addEventListener("click", fail);
      actions.querySelector(".nexus-startup__continue").focus();
    }

    async function fail() {
      if (dismissed) return;
      await close();
    }

    async function playReveal() {
      if (dismissed) return false;

      window.clearTimeout(timeoutTimer);
      const openingRemaining = Math.max(
        0,
        openingDuration - (performance.now() - startedAt),
      );
      await new Promise((resolve) =>
        window.setTimeout(resolve, openingRemaining),
      );
      if (dismissed) return false;

      overlay.classList.add("is-spotlight");
      await new Promise((resolve) =>
        window.setTimeout(resolve, spotlightRevealDuration),
      );
      return !dismissed;
    }

    async function complete(destination) {
      if (!(await playReveal())) return false;

      const target = new URL(destination, window.location.href);
      if (target.origin !== window.location.origin) {
        throw new Error("Startup navigation must stay on the current site.");
      }
      const remainingReveal = Math.max(
        0,
        openingDuration +
          spotlightRevealDuration -
          (performance.now() - startedAt),
      );
      if (remainingReveal > 0) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, remainingReveal),
        );
      }
      if (dismissed) return false;
      overlay.classList.add("is-exiting");
      await new Promise((resolve) =>
        window.setTimeout(resolve, reducedMotion ? 0 : EXIT_DURATION_MS),
      );
      window.location.href = `${target.pathname}${target.search}${target.hash}`;
      return true;
    }

    async function reveal(readyPromise = Promise.resolve()) {
      if (!(await playReveal())) return false;
      await readyPromise;
      if (dismissed) return false;
      await close();
      return true;
    }

    const startup = { complete, fail, reveal };
    activeStartup = startup;
    contentObserver = new MutationObserver(blockPageContent);
    contentObserver.observe(document.body, { childList: true });
    blockPageContent();
    overlay
      .querySelector(".nexus-startup__continue")
      .addEventListener("click", fail);
    overlay.focus();
    window.addEventListener("pagehide", onPageHide, { once: true });
    timeoutTimer = window.setTimeout(showSlowState, SLOW_REQUEST_DURATION_MS);

    return startup;
  }

  window.MandelaNexusStartup = { start };

  if (shouldStartOnPageLoad()) {
    document.documentElement.classList.add("nexus-startup-booting");
    pageStartupTimer = window.setTimeout(() => {
      document.documentElement.classList.remove("nexus-startup-booting");
      console.error("[startup] Page initialization did not reach DOMContentLoaded.");
    }, SLOW_REQUEST_DURATION_MS);
    const beginPageStartup = () => {
      sessionStorage.setItem(SESSION_STARTUP_KEY, "true");
      let startup;

      try {
        startup = start();
      } catch (error) {
        window.clearTimeout(pageStartupTimer);
        pageStartupTimer = null;
        document.documentElement.classList.remove("nexus-startup-booting");
        console.error("[startup] Unable to initialize the page overlay.", error);
        return;
      }

      startup.reveal(waitForPageReady()).catch((error) => {
        console.error("[startup] Unable to complete the page reveal.", error);
        startup.fail().catch((dismissError) => {
          console.error("[startup] Unable to dismiss the page overlay.", dismissError);
        });
      });
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", beginPageStartup, {
        once: true,
      });
    } else {
      beginPageStartup();
    }
  }
})();

/**
 * Combined Header & Footer Loader
 */
const GLOBAL_ALERTS_PAGE_PATH = "/pages/alerts.html";
let notificationRoutingAttached = false;
let mobileInputScrollAttached = false;
let activeTextInput = null;

function loadSiteComponents() {
  const headerPlaceholder = document.getElementById('header-placeholder');
  const footerPlaceholder = document.getElementById('footer-placeholder');

  const fetchHeader = fetch('../elements/header.html').then(res => res.text());
  const fetchFooter = fetch('../elements/footer.html').then(res => res.text());

  Promise.all([fetchHeader, fetchFooter])
    .then(([headerHtml, footerHtml]) => {
      if (headerPlaceholder) headerPlaceholder.innerHTML = headerHtml;
      if (footerPlaceholder) footerPlaceholder.innerHTML = footerHtml;
    })
    .catch(err => console.error("Error loading components:", err));
}

function resolveGlobalNotificationTarget(data) {
  if (!data || typeof data !== "object") return null;

  const targetPath = data.targetPath || data.path || data.route;
  return targetPath === GLOBAL_ALERTS_PAGE_PATH ? GLOBAL_ALERTS_PAGE_PATH : null;
}

function navigateToAlertsPage() {
  const currentPath = window.location.pathname || "";
  if (currentPath.endsWith(GLOBAL_ALERTS_PAGE_PATH)) return;
  window.location.href = GLOBAL_ALERTS_PAGE_PATH;
}

async function attachGlobalNotificationRouting() {
  if (notificationRoutingAttached) return;

  const pushNotifications = window.Capacitor?.Plugins?.PushNotifications;
  const localNotifications = window.Capacitor?.Plugins?.LocalNotifications;
  const appPlugin = window.Capacitor?.Plugins?.App;

  if (pushNotifications?.addListener) {
    await pushNotifications.addListener("pushNotificationActionPerformed", event => {
      if (resolveGlobalNotificationTarget(event.notification?.data) === GLOBAL_ALERTS_PAGE_PATH) {
        navigateToAlertsPage();
      }
    });
  }

  if (localNotifications?.addListener) {
    await localNotifications.addListener("localNotificationActionPerformed", event => {
      if (resolveGlobalNotificationTarget(event.notification?.extra) === GLOBAL_ALERTS_PAGE_PATH) {
        navigateToAlertsPage();
      }
    });
  }

  if (appPlugin?.addListener) {
    await appPlugin.addListener("appUrlOpen", event => {
      if (typeof event?.url === "string" && event.url.includes("themeparkinfo://alerts")) {
        navigateToAlertsPage();
      }
    });
  }

  notificationRoutingAttached = true;
}

function isTextInput(element) {
  if (!element || !(element instanceof HTMLElement)) return false;

  if (element.matches("textarea, select")) {
    return true;
  }

  if (!element.matches("input")) {
    return false;
  }

  const type = String(element.getAttribute("type") || "text").toLowerCase();
  return !["checkbox", "radio", "range", "button", "submit", "reset", "color", "file", "hidden"].includes(type);
}

function scrollFocusedInputIntoView(target) {
  const footer = document.querySelector(".site-footer");
  const footerHeight = footer?.offsetHeight || 0;
  const extraOffset = 20;
  const runScroll = () => {
    if (!target || document.activeElement !== target) return;

    target.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest"
    });

    if (footerHeight) {
      window.scrollBy({
        top: -(footerHeight / 2 + extraOffset),
        behavior: "smooth"
      });
    }
  };

  [80, 220, 420].forEach(delay => {
    window.setTimeout(runScroll, delay);
  });
}

function attachMobileInputScrollHandling() {
  if (mobileInputScrollAttached) return;

  document.addEventListener("focusin", event => {
    const target = event.target;
    if (!isTextInput(target)) return;

    activeTextInput = target;
    scrollFocusedInputIntoView(target);
  });

  document.addEventListener("focusout", event => {
    if (event.target === activeTextInput) {
      activeTextInput = null;
    }
  });

  const viewport = window.visualViewport;
  const reflowActiveInput = () => {
    if (activeTextInput && document.activeElement === activeTextInput) {
      scrollFocusedInputIntoView(activeTextInput);
    }
  };

  window.addEventListener("resize", reflowActiveInput);
  viewport?.addEventListener("resize", reflowActiveInput);
  viewport?.addEventListener("scroll", reflowActiveInput);

  mobileInputScrollAttached = true;
}

document.addEventListener("DOMContentLoaded", () => {
  loadSiteComponents();
  attachMobileInputScrollHandling();
  attachGlobalNotificationRouting().catch(err => console.error("Notification routing setup failed:", err));
});

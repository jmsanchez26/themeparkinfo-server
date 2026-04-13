/**
 * Combined Header & Footer Loader
 */
const GLOBAL_ALERTS_PAGE_PATH = "/pages/alerts.html";
let notificationRoutingAttached = false;

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

document.addEventListener("DOMContentLoaded", () => {
  loadSiteComponents();
  attachGlobalNotificationRouting().catch(err => console.error("Notification routing setup failed:", err));
});

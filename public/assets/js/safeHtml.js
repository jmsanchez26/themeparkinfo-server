(function () {
  // All dynamic HTML goes through a locally bundled, maintained sanitizer.
  // A CSP independently prohibits inline scripts/event handlers.
  DOMPurify.addHook('afterSanitizeAttributes', node => {
    for (const attribute of ['href', 'src']) {
      const value = node.getAttribute?.(attribute);
      if (!value) continue;
      try {
        const url = new URL(value, window.location.href);
        if (url.pathname.startsWith('/_capacitor_http_interceptor_')) node.removeAttribute(attribute);
        if (node.tagName === 'IFRAME' && (url.origin !== 'https://www.google.com' || url.pathname !== '/maps')) node.removeAttribute(attribute);
      } catch { node.removeAttribute(attribute); }
    }
    if (node.tagName === 'IFRAME') {
      node.setAttribute('referrerpolicy', 'no-referrer');
      node.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    }
    if (node.getAttribute?.('target') === '_blank') node.setAttribute('rel', 'noopener noreferrer');
  });
  window.SafeHTML = {
    text(value) {
      return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[character]);
    },
    sanitize(value) {
      return DOMPurify.sanitize(String(value ?? ''), {
        USE_PROFILES: { html: true }, ADD_TAGS: ['iframe'],
        ADD_ATTR: ['loading', 'allowfullscreen', 'referrerpolicy', 'sandbox'],
        FORBID_TAGS: ['style', 'form', 'object', 'embed'],
        FORBID_ATTR: ['srcdoc', 'formaction'], SANITIZE_NAMED_PROPS: false
      });
    }
  };
})();

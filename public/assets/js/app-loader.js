(function () {
  window.AppAuth.ready.then(async () => {
    for (const placeholder of document.querySelectorAll('script[data-auth-src]')) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = placeholder.dataset.authSrc;
        script.onload = resolve;
        script.onerror = () => reject(new Error('App files could not be loaded. Refresh to try again.'));
        placeholder.replaceWith(script);
      });
    }
    document.dispatchEvent(new Event('DOMContentLoaded'));
  }).catch(error => console.warn('App startup failed:', error.message));
})();

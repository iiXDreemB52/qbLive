(() => {
  // Keep unsupported mobile browsers from crashing on Notification references.
  if (typeof window.Notification === 'undefined') window.Notification = { permission: 'denied' };

  // v11 is loaded as an additive refinement so the stable v10 call stack remains intact.
  if (!document.querySelector('link[data-sawalef-v11]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = '/room-experience-v11.css?v=11'; link.dataset.sawalefV11 = '1';
    document.head.appendChild(link);
  }
  if (!document.querySelector('script[data-sawalef-v11]')) {
    const script = document.createElement('script');
    script.src = '/room-experience-v11.js?v=11'; script.defer = true; script.dataset.sawalefV11 = '1';
    document.head.appendChild(script);
  }
})();

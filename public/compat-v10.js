(() => {
  // Some mobile browsers do not expose the Notification constructor at all.
  // Keep the call UI alive; the notification button remains hidden because v4 checks support before this file loads.
  if (typeof window.Notification === 'undefined') {
    window.Notification = { permission: 'denied' };
  }
})();

(() => {
  if (window.__sawalefAndroidUpdateV21) return;
  window.__sawalefAndroidUpdateV21 = true;

  const RELEASE_API = 'https://api.github.com/repos/iiXDreemB52/qbLive/releases/tags/sawalef-dev-latest';
  const APK_URL = 'https://github.com/iiXDreemB52/qbLive/releases/download/sawalef-dev-latest/Sawalef.apk';

  function nativeVersionCode() {
    try { return Number(window.SawalefNative?.getVersionCode?.() || 0); } catch { return 0; }
  }
  function isAndroidApp() {
    try { return window.SawalefNative?.getPlatform?.() === 'android'; } catch { return false; }
  }
  function ensureBanner(versionName) {
    if (document.getElementById('nativeUpdateBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'nativeUpdateBanner';
    banner.className = 'native-update-banner';
    banner.innerHTML = `
      <div class="native-update-copy">
        <b>تحديث جديد لتطبيق سوالف</b>
        <small>${versionName ? `نسخة ${versionName} • ` : ''}ميزات Android جديدة جاهزة للتثبيت.</small>
      </div>
      <button id="nativeUpdateNow" type="button">تحديث التطبيق</button>
      <button id="nativeUpdateLater" class="native-update-later" type="button" aria-label="لاحقًا">✕</button>`;
    document.body.appendChild(banner);
    document.getElementById('nativeUpdateNow').onclick = () => { location.href = APK_URL; };
    document.getElementById('nativeUpdateLater').onclick = () => banner.remove();
  }

  async function checkNativeUpdate() {
    if (!isAndroidApp()) return;
    try {
      const res = await fetch(RELEASE_API, { cache:'no-store', headers:{ Accept:'application/vnd.github+json' } });
      if (!res.ok) return;
      const release = await res.json();
      const body = String(release?.body || '');
      const latestCode = Number(body.match(/versionCode=(\d+)/)?.[1] || 0);
      const latestName = body.match(/versionName=([^\s]+)/)?.[1] || '';
      if (latestCode > nativeVersionCode()) ensureBanner(latestName);
    } catch {}
  }

  setTimeout(checkNativeUpdate, 1800);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) setTimeout(checkNativeUpdate, 700);
  });
})();

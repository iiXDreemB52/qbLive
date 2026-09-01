import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = 'https://sawalef-voice-chat-ekoj.onrender.com';
const USER = `e2e${Date.now().toString(36).slice(-8)}`;
const PASS = 'SawalefE2E_2026!';
const started = Date.now();
const since = () => ((Date.now() - started) / 1000).toFixed(2);
const localLoader = readFileSync('public/room-runtime-loader.js', 'utf8');
const EXPECTED_VERSION = localLoader.match(/const VERSION = ['"]([^'"]+)['"]/)?.[1] || '';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForExactDeploy() {
  if (!EXPECTED_VERSION) throw new Error('Could not read expected Sawalef runtime version');
  const marker = `const VERSION = '${EXPECTED_VERSION}'`;
  for (let i = 0; i < 45; i++) {
    try {
      const res = await fetch(`${BASE}/room-runtime-loader.js?probe=${Date.now()}`, { cache: 'no-store' });
      const text = await res.text();
      if (res.ok && text.includes(marker)) {
        console.log(`[${since()}s] production runtime v${EXPECTED_VERSION} is live`);
        return;
      }
    } catch {}
    await sleep(2000);
  }
  throw new Error(`Production did not reach runtime v${EXPECTED_VERSION}`);
}

await waitForExactDeploy();

const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
const page = await context.newPage();
const pageErrors = [];

page.on('console', msg => console.log(`[${since()}s] console:${msg.type()} ${msg.text()}`));
page.on('pageerror', err => { const line = `[${since()}s] pageerror ${String(err)}`; console.error(line); pageErrors.push(line); });
page.on('requestfailed', req => console.error(`[${since()}s] requestfailed ${req.url()} ${req.failure()?.errorText || ''}`));
page.on('response', res => {
  const u = res.url();
  if (u.includes('livekit') || u.includes('/vendor/') || u.startsWith(BASE)) console.log(`[${since()}s] ${res.status()} ${u}`);
});

try {
  console.log(`[${since()}s] opening ${BASE}`);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !document.body.classList.contains('booting'), { timeout: 8000 });
  console.log(`[${since()}s] boot cleared`);

  await page.click('#registerTab');
  await page.fill('#registerUsername', USER);
  await page.fill('#registerPassword', PASS);
  await page.click('#registerForm button[type="submit"]');
  await page.waitForSelector('#lobbyPage:not(.hidden)', { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('connectionBadge')?.textContent?.trim() === 'متصل', { timeout: 10000 });
  console.log(`[${since()}s] lobby + socket ready as ${USER}`);

  await page.click('#openCreateGroup');
  await page.fill('#groupName', `E2E ${Date.now()}`);
  await page.click('#groupTypePrivate');
  const roomStart = Date.now();
  await page.click('#confirmCreateGroup');
  await page.waitForSelector('#roomPage:not(.hidden)', { timeout: 10000 });
  const roomVisibleMs = Date.now() - roomStart;
  console.log(`[${since()}s] room visible in ${roomVisibleMs}ms`);

  await page.waitForFunction(() => Boolean(window.LivekitClient?.Room), { timeout: 10000 });
  console.log(`[${since()}s] LiveKit client loaded`);
  await page.waitForFunction(() => Boolean(window.SawalefLiveKit), { timeout: 10000 });
  console.log(`[${since()}s] Sawalef LiveKit runtime loaded`);
  await page.waitForFunction(() => Boolean(window.SawalefLiveKit?.room), { timeout: 15000 });
  console.log(`[${since()}s] listener room exists`);
  await page.waitForFunction(() => {
    const r = window.SawalefLiveKit?.room;
    return String(r?.state || r?.connectionState || '').toLowerCase() === 'connected';
  }, { timeout: 15000 });
  console.log(`[${since()}s] listener room connected`);
  await page.waitForFunction(() => document.documentElement.dataset.roomRuntime === 'ready', { timeout: 10000 });
  console.log(`[${since()}s] room runtime ready`);

  const joinStarted = Date.now();
  await page.click('#joinVoice', { timeout: 3000 });
  await page.waitForFunction(() => {
    const mute = document.getElementById('muteBtn');
    const join = document.getElementById('joinVoice');
    let joined = false;
    try { joined = Boolean(joinedVoice); } catch {}
    return joined && mute && !mute.classList.contains('hidden') && join?.classList.contains('hidden');
  }, { timeout: 12000 });
  const joinMs = Date.now() - joinStarted;
  console.log(`[${since()}s] voice join completed in ${joinMs}ms`);

  const micState = await page.evaluate(() => {
    const r = window.SawalefLiveKit?.room;
    let joined = false, isMuted = false;
    try { joined = Boolean(joinedVoice); isMuted = Boolean(muted); } catch {}
    return {
      joined,
      muted: isMuted,
      micEnabled: Boolean(r?.localParticipant?.isMicrophoneEnabled),
      audioPubs: r?.localParticipant?.audioTrackPublications?.size || 0,
      joinDisabled: Boolean(document.getElementById('joinVoice')?.disabled),
      muteHidden: document.getElementById('muteBtn')?.classList.contains('hidden'),
    };
  });
  console.log('MIC_DIAGNOSTIC', JSON.stringify(micState));

  const controlDiag = await page.evaluate(() => {
    const b = document.getElementById('screenShareBtn');
    const nav = document.querySelector('.room-controls');
    const br = b?.getBoundingClientRect?.();
    const nr = nav?.getBoundingClientRect?.();
    const bs = b ? getComputedStyle(b) : null;
    const ns = nav ? getComputedStyle(nav) : null;
    return {
      buttonExists: Boolean(b),
      buttonParent: b?.parentElement?.className || '',
      buttonClass: b?.className || '',
      buttonDisplay: bs?.display || '',
      buttonVisibility: bs?.visibility || '',
      buttonOpacity: bs?.opacity || '',
      buttonRect: br ? { x:br.x,y:br.y,w:br.width,h:br.height } : null,
      navDisplay: ns?.display || '',
      navVisibility: ns?.visibility || '',
      navRect: nr ? { x:nr.x,y:nr.y,w:nr.width,h:nr.height } : null,
      navChildren: nav ? [...nav.children].map(x => ({id:x.id,className:x.className})) : [],
      roomHidden: document.getElementById('roomPage')?.classList.contains('hidden'),
      runtime: document.documentElement.dataset.roomRuntime || '',
      runtimeStep: document.documentElement.dataset.roomRuntimeStep || '',
      hdrOption: Boolean(document.getElementById('screenHdrCheck')),
      activeSharePanel: Boolean(document.getElementById('activeSharePanel')),
      topNotification: Boolean(document.querySelector('.top-call-notify')),
    };
  });
  console.log('CONTROL_DIAGNOSTIC', JSON.stringify(controlDiag));

  if (!controlDiag.buttonExists) throw new Error(`Screen share control missing: ${JSON.stringify(controlDiag)}`);
  if (controlDiag.buttonDisplay === 'none' || controlDiag.buttonVisibility === 'hidden' || !controlDiag.buttonRect || controlDiag.buttonRect.w < 1 || controlDiag.buttonRect.h < 1) {
    throw new Error(`Screen share control not visible: ${JSON.stringify(controlDiag)}`);
  }
  if (!controlDiag.hdrOption || !controlDiag.activeSharePanel || !controlDiag.topNotification) {
    throw new Error(`v11 room extras missing: ${JSON.stringify(controlDiag)}`);
  }
  if (!micState.joined || !micState.micEnabled || micState.audioPubs < 1) {
    throw new Error(`Microphone join failed: ${JSON.stringify(micState)}`);
  }

  const before = await page.locator('#chatSheet').evaluate(el => el.classList.contains('collapsed'));
  const clickStarted = Date.now();
  await page.click('#chatToggle');
  await page.waitForFunction(prev => document.getElementById('chatSheet')?.classList.contains('collapsed') !== prev, before, { timeout: 1500 });
  const clickMs = Date.now() - clickStarted;
  console.log(`[${since()}s] control click responded in ${clickMs}ms`);

  const perf = await page.evaluate(() => ({
    booting: document.body.classList.contains('booting'),
    roomVisible: !document.getElementById('roomPage')?.classList.contains('hidden'),
    livekit: Boolean(window.LivekitClient?.Room),
    sawalefLiveKit: Boolean(window.SawalefLiveKit),
    livekitState: window.SawalefLiveKit?.room?.state || window.SawalefLiveKit?.room?.connectionState || '',
    screenButton: Boolean(document.getElementById('screenShareBtn')),
    runtimeState: document.documentElement.dataset.roomRuntime || '',
    runtimeStep: document.documentElement.dataset.roomRuntimeStep || '',
    runtimeMs: Number(window.__sawalefRoomRuntimeMs || 0),
    longTasks: Number(window.__sawalefRoomPerf?.longTasks || 0),
    maxLongTaskMs: Number(window.__sawalefRoomPerf?.maxLongTaskMs || 0),
  }));
  console.log('FINAL_STATE', JSON.stringify({ ...perf, roomVisibleMs, joinMs, clickMs }));

  if (perf.booting || !perf.roomVisible || !perf.livekit || !perf.sawalefLiveKit || !perf.screenButton || perf.runtimeState !== 'ready') throw new Error(`Invalid final state: ${JSON.stringify(perf)}`);
  if (roomVisibleMs > 3500) throw new Error(`Room navigation too slow: ${roomVisibleMs}ms`);
  if (perf.runtimeMs > 8000) throw new Error(`Room runtime too slow: ${perf.runtimeMs}ms`);
  if (joinMs > 6000) throw new Error(`Voice join too slow: ${joinMs}ms`);
  if (clickMs > 1200) throw new Error(`Room controls are sluggish: ${clickMs}ms`);
  if (perf.maxLongTaskMs > 250) throw new Error(`Main thread long task too large: ${perf.maxLongTaskMs}ms`);
  if (pageErrors.length) throw new Error(`Page errors detected: ${pageErrors.join(' | ')}`);

  console.log(`[${since()}s] E2E PASS`);
} finally {
  await browser.close();
}

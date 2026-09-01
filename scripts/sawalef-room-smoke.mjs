import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = 'https://sawalef-voice-chat-ekoj.onrender.com';
const USER = `smoke${Date.now().toString(36).slice(-8)}`;
const PASS = 'SawalefSmoke_2026!';
const started = Date.now();
const since = () => ((Date.now() - started) / 1000).toFixed(2);
const localLoader = readFileSync('public/room-runtime-loader.js', 'utf8');
const EXPECTED_VERSION = localLoader.match(/const VERSION = ['"]([^'"]+)['"]/)?.[1] || '';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForDeploy() {
  const marker = `const VERSION = '${EXPECTED_VERSION}'`;
  for (let i = 0; i < 45; i++) {
    try {
      const res = await fetch(`${BASE}/room-runtime-loader.js?smoke=${Date.now()}`, { cache: 'no-store' });
      const text = await res.text();
      if (res.ok && text.includes(marker)) {
        console.log(`[${since()}s] runtime v${EXPECTED_VERSION} is live`);
        return;
      }
    } catch {}
    await sleep(2000);
  }
  throw new Error(`runtime v${EXPECTED_VERSION} did not become live`);
}

await waitForDeploy();

const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  permissions: ['microphone']
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', err => pageErrors.push(String(err)));
page.on('console', msg => console.log(`[${since()}s] console:${msg.type()} ${msg.text()}`));

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !document.body.classList.contains('booting'), { timeout: 10000 });

  await page.click('#registerTab');
  await page.fill('#registerUsername', USER);
  await page.fill('#registerPassword', PASS);
  await page.click('#registerForm button[type="submit"]');
  await page.waitForSelector('#lobbyPage:not(.hidden)', { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('connectionBadge')?.textContent?.trim() === 'متصل', { timeout: 12000 });
  console.log(`[${since()}s] socket connected`);

  await page.click('#openCreateGroup');
  await page.fill('#groupName', `Smoke ${Date.now()}`);
  await page.click('#groupTypePrivate');
  const roomStart = Date.now();
  await page.click('#confirmCreateGroup');
  await page.waitForSelector('#roomPage:not(.hidden)', { timeout: 10000 });
  const roomVisibleMs = Date.now() - roomStart;
  console.log(`[${since()}s] room visible in ${roomVisibleMs}ms`);

  await page.waitForFunction(() => Boolean(window.LivekitClient?.Room), { timeout: 10000 });
  await page.waitForFunction(() => Boolean(window.SawalefLiveKit?.room), { timeout: 15000 });
  await page.waitForFunction(() => {
    const r = window.SawalefLiveKit?.room;
    return String(r?.state || r?.connectionState || '').toLowerCase() === 'connected';
  }, { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.roomRuntime === 'ready', { timeout: 10000 });

  const runtime = await page.evaluate(() => ({
    state: document.documentElement.dataset.roomRuntime || '',
    step: document.documentElement.dataset.roomRuntimeStep || '',
    ms: Number(window.__sawalefRoomRuntimeMs || 0),
    screen: Boolean(document.getElementById('screenShareBtn')),
    longTasks: Number(window.__sawalefRoomPerf?.longTasks || 0),
    maxLongTaskMs: Number(window.__sawalefRoomPerf?.maxLongTaskMs || 0),
  }));
  console.log('RUNTIME', JSON.stringify(runtime));

  const joinStart = Date.now();
  await page.click('#joinVoice', { timeout: 3000 });
  await page.waitForFunction(() => {
    let joined = false;
    try { joined = Boolean(joinedVoice); } catch {}
    const mute = document.getElementById('muteBtn');
    return joined && mute && !mute.classList.contains('hidden');
  }, { timeout: 12000 });
  const joinMs = Date.now() - joinStart;

  const mic = await page.evaluate(() => {
    const r = window.SawalefLiveKit?.room;
    let joined = false;
    try { joined = Boolean(joinedVoice); } catch {}
    return {
      joined,
      enabled: Boolean(r?.localParticipant?.isMicrophoneEnabled),
      publications: r?.localParticipant?.audioTrackPublications?.size || 0,
    };
  });
  console.log('MIC', JSON.stringify(mic));

  const before = await page.locator('#chatSheet').evaluate(el => el.classList.contains('collapsed'));
  const clickStart = Date.now();
  await page.click('#chatToggle');
  await page.waitForFunction(prev => document.getElementById('chatSheet')?.classList.contains('collapsed') !== prev, before, { timeout: 1500 });
  const clickMs = Date.now() - clickStart;

  const result = { roomVisibleMs, runtimeMs: runtime.ms, joinMs, clickMs, ...mic };
  console.log('FINAL', JSON.stringify(result));

  if (!runtime.screen || runtime.state !== 'ready') throw new Error(`runtime invalid: ${JSON.stringify(runtime)}`);
  if (!mic.joined || !mic.enabled || mic.publications < 1) throw new Error(`microphone invalid: ${JSON.stringify(mic)}`);
  if (roomVisibleMs > 3500) throw new Error(`room entry slow: ${roomVisibleMs}ms`);
  if (runtime.ms > 8000) throw new Error(`runtime slow: ${runtime.ms}ms`);
  if (joinMs > 6000) throw new Error(`voice join slow: ${joinMs}ms`);
  if (clickMs > 1200) throw new Error(`controls slow: ${clickMs}ms`);
  if (runtime.maxLongTaskMs > 250) throw new Error(`main thread blocked: ${runtime.maxLongTaskMs}ms`);
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);

  console.log('SMOKE PASS');
} finally {
  await browser.close();
}

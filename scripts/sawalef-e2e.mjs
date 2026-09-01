import { chromium } from 'playwright';

const BASE = 'https://sawalef-voice-chat-ekoj.onrender.com';
const USER = `e2e${Date.now().toString(36).slice(-8)}`;
const PASS = 'SawalefE2E_2026!';
const started = Date.now();
const since = () => ((Date.now() - started) / 1000).toFixed(2);

const browser = await chromium.launch({ headless: true });
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
  try {
    await page.waitForSelector('#roomPage:not(.hidden)', { timeout: 10000 });
  } catch (e) {
    const diagnostic = await page.evaluate(() => ({
      connectionBadge: document.getElementById('connectionBadge')?.textContent || '',
      roomId: typeof roomId === 'string' ? roomId : '',
      toast: document.getElementById('toast')?.textContent || '',
      createDisabled: Boolean(document.getElementById('confirmCreateGroup')?.disabled),
      modalHidden: document.getElementById('createGroupModal')?.classList.contains('hidden'),
    }));
    console.error('ROOM_ENTRY_DIAGNOSTIC', JSON.stringify(diagnostic));
    throw e;
  }
  const roomVisibleMs = Date.now() - roomStart;
  console.log(`[${since()}s] room visible in ${roomVisibleMs}ms`);

  await page.waitForFunction(() => Boolean(window.LivekitClient?.Room), { timeout: 10000 });
  console.log(`[${since()}s] LiveKit client loaded`);
  await page.waitForFunction(() => Boolean(window.SawalefLiveKit), { timeout: 10000 });
  console.log(`[${since()}s] Sawalef LiveKit runtime loaded`);
  await page.waitForFunction(() => Boolean(window.SawalefLiveKit?.room), { timeout: 15000 });
  console.log(`[${since()}s] listener room connected`);
  await page.waitForSelector('#screenShareBtn', { timeout: 10000 });
  await page.waitForFunction(() => document.documentElement.dataset.roomRuntime === 'ready', { timeout: 10000 });
  console.log(`[${since()}s] room runtime ready`);

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
    runtimeMs: Number(window.__sawalefRoomRuntimeMs || 0),
    longTasks: Number(window.__sawalefRoomPerf?.longTasks || 0),
    maxLongTaskMs: Number(window.__sawalefRoomPerf?.maxLongTaskMs || 0),
  }));
  console.log('FINAL_STATE', JSON.stringify({ ...perf, roomVisibleMs, clickMs }));

  if (perf.booting || !perf.roomVisible || !perf.livekit || !perf.sawalefLiveKit || !perf.screenButton || perf.runtimeState !== 'ready') throw new Error(`Invalid final state: ${JSON.stringify(perf)}`);
  if (roomVisibleMs > 3000) throw new Error(`Room navigation too slow: ${roomVisibleMs}ms`);
  if (perf.runtimeMs > 8000) throw new Error(`Room runtime too slow: ${perf.runtimeMs}ms`);
  if (clickMs > 1200) throw new Error(`Room controls are sluggish: ${clickMs}ms`);
  if (pageErrors.length) throw new Error(`Page errors detected: ${pageErrors.join(' | ')}`);

  console.log(`[${since()}s] E2E PASS`);
} finally {
  await browser.close();
}

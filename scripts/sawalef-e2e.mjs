import { chromium } from 'playwright';

const BASE = 'https://sawalef-voice-chat-ekoj.onrender.com';
const USER = 'sawalef_e2e_bot';
const PASS = 'SawalefE2E_2026!';
const started = Date.now();
const since = () => ((Date.now() - started) / 1000).toFixed(2);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  permissions: ['microphone'],
});
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

page.on('console', msg => {
  const line = `[${since()}s] console:${msg.type()} ${msg.text()}`;
  console.log(line);
  if (msg.type() === 'error') consoleErrors.push(line);
});
page.on('pageerror', err => {
  const line = `[${since()}s] pageerror ${String(err)}`;
  console.error(line);
  pageErrors.push(line);
});
page.on('requestfailed', req => {
  const line = `[${since()}s] requestfailed ${req.url()} ${req.failure()?.errorText || ''}`;
  console.error(line);
  failedRequests.push(line);
});
page.on('response', res => {
  const u = res.url();
  if (u.includes('livekit') || u.startsWith(BASE)) {
    console.log(`[${since()}s] ${res.status()} ${u}`);
  }
});

async function waitForLobby() {
  await page.waitForSelector('#lobbyPage:not(.hidden)', { timeout: 15000 });
}

try {
  console.log(`[${since()}s] opening ${BASE}`);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !document.body.classList.contains('booting'), { timeout: 8000 });
  console.log(`[${since()}s] boot cleared`);

  const lobbyVisible = await page.locator('#lobbyPage').evaluate(el => !el.classList.contains('hidden'));
  if (!lobbyVisible) {
    await page.click('#loginTab');
    await page.fill('#loginUsername', USER);
    await page.fill('#loginPassword', PASS);
    await page.click('#loginForm button[type="submit"]');
    try {
      await waitForLobby();
    } catch {
      // First run: register the reusable E2E account.
      await page.click('#registerTab');
      await page.fill('#registerUsername', USER);
      await page.fill('#registerPassword', PASS);
      await page.click('#registerForm button[type="submit"]');
      await waitForLobby();
    }
  }
  console.log(`[${since()}s] lobby ready`);

  await page.click('#openCreateGroup');
  await page.fill('#groupName', `E2E ${Date.now()}`);
  await page.click('#groupTypePrivate');
  const roomStart = Date.now();
  await page.click('#confirmCreateGroup');
  await page.waitForSelector('#roomPage:not(.hidden)', { timeout: 10000 });
  console.log(`[${since()}s] room visible in ${((Date.now()-roomStart)/1000).toFixed(2)}s`);

  await page.waitForFunction(() => Boolean(window.LivekitClient?.Room), { timeout: 12000 });
  console.log(`[${since()}s] LiveKit client loaded`);
  await page.waitForFunction(() => Boolean(window.SawalefLiveKit), { timeout: 12000 });
  console.log(`[${since()}s] Sawalef LiveKit runtime loaded`);
  await page.waitForFunction(() => Boolean(window.SawalefLiveKit?.room), { timeout: 15000 });
  console.log(`[${since()}s] listener room connected`);
  await page.waitForSelector('#screenShareBtn', { timeout: 10000 });
  console.log(`[${since()}s] call controls ready`);

  const perf = await page.evaluate(() => ({
    booting: document.body.classList.contains('booting'),
    roomVisible: !document.getElementById('roomPage')?.classList.contains('hidden'),
    livekit: Boolean(window.LivekitClient?.Room),
    sawalefLiveKit: Boolean(window.SawalefLiveKit),
    livekitState: window.SawalefLiveKit?.room?.state || window.SawalefLiveKit?.room?.connectionState || '',
    screenButton: Boolean(document.getElementById('screenShareBtn')),
  }));
  console.log('FINAL_STATE', JSON.stringify(perf));

  if (perf.booting || !perf.roomVisible || !perf.livekit || !perf.sawalefLiveKit || !perf.screenButton) {
    throw new Error(`Invalid final state: ${JSON.stringify(perf)}`);
  }
  if (pageErrors.length) throw new Error(`Page errors detected: ${pageErrors.join(' | ')}`);

  console.log(`[${since()}s] E2E PASS`);
} finally {
  await browser.close();
}

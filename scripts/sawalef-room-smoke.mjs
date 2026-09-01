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
  for (let i = 0; i < 50; i++) {
    try {
      const [runtimeRes, polish19Res, polish20Res] = await Promise.all([
        fetch(`${BASE}/room-runtime-loader.js?smoke=${Date.now()}`, { cache: 'no-store' }),
        fetch(`${BASE}/polish-v19.js?smoke=${Date.now()}`, { cache: 'no-store' }),
        fetch(`${BASE}/polish-v20.js?smoke=${Date.now()}`, { cache: 'no-store' })
      ]);
      const [runtimeText, polish19Text, polish20Text] = await Promise.all([runtimeRes.text(), polish19Res.text(), polish20Res.text()]);
      if (runtimeRes.ok && runtimeText.includes(marker) && polish19Res.ok && polish19Text.includes('__sawalefPolishV19') && polish20Res.ok && polish20Text.includes('__sawalefPolishV20')) {
        console.log(`[${since()}s] runtime v${EXPECTED_VERSION} + polish v20 are live`);
        return;
      }
    } catch {}
    await sleep(2000);
  }
  throw new Error('production did not reach Sawalef polish v20');
}

await waitForDeploy();

const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ['microphone'],
  isMobile: true,
  hasTouch: true
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
  await page.waitForSelector('#lobbyNotifyBtn', { state: 'visible', timeout: 5000 });
  const brand = await page.evaluate(() => getComputedStyle(document.querySelector('.brand-mark')).backgroundImage);
  if (!brand || brand === 'none') throw new Error('Sawalef custom brand image did not load');
  console.log(`[${since()}s] mobile lobby + custom brand ready`);

  await page.click('#openCreateGroup');
  await page.fill('#groupName', `Smoke ${Date.now()}`);
  await page.click('#groupTypePrivate');
  const roomStart = Date.now();
  await page.click('#confirmCreateGroup');
  await page.waitForSelector('#roomPage:not(.hidden)', { timeout: 10000 });
  const roomVisibleMs = Date.now() - roomStart;
  console.log(`[${since()}s] room visible in ${roomVisibleMs}ms`);

  await page.waitForFunction(() => Number(document.getElementById('memberCount')?.textContent || 0) >= 1, { timeout: 5000 });
  await page.waitForFunction(() => document.getElementById('voiceCountTop')?.textContent === document.getElementById('memberCount')?.textContent, { timeout: 5000 });

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

  const controls = await page.evaluate(() => {
    const nav = document.querySelector('.room-controls');
    const visible = [...nav.querySelectorAll('.control-btn')].filter(el => getComputedStyle(el).display !== 'none');
    const notif = document.getElementById('callNotifyBtn');
    return {
      clientWidth: nav.clientWidth,
      scrollWidth: nav.scrollWidth,
      visibleIds: visible.map(el => el.id),
      roomNotificationDisplay: notif ? getComputedStyle(notif).display : 'missing',
    };
  });

  const collapsed = await page.locator('#chatSheet').evaluate(el => el.classList.contains('collapsed'));
  if (collapsed) await page.click('#chatToggle');
  const chatText = `رسالة أثناء المكالمة ${Date.now()}`;
  await page.fill('#messageInput', chatText);
  await page.click('#messageForm .send-btn');
  await page.waitForFunction(text => [...document.querySelectorAll('.msg-text')].some(el => el.textContent?.includes(text)), chatText, { timeout: 5000 });

  await page.waitForSelector('#mediaSendBtn', { timeout: 5000 });
  const composer = await page.evaluate(() => {
    const media = document.getElementById('mediaSendBtn').getBoundingClientRect();
    const input = document.getElementById('messageInput').getBoundingClientRect();
    const send = document.querySelector('#messageForm .send-btn').getBoundingClientRect();
    return { mediaX: media.x, inputX: input.x, sendX: send.x };
  });

  await page.waitForFunction(() => Boolean(window.SawalefOwnerMeta?.createdBy), { timeout: 5000 });
  await page.waitForSelector('.owner-msg-delete', { timeout: 5000 });
  await page.waitForSelector('.owner-name-badge', { timeout: 5000 });
  const messageNode = page.locator('.msg:not(.msg-media)').filter({ hasText: chatText }).last();
  const messageId = await messageNode.getAttribute('data-message-id');
  page.once('dialog', dialog => dialog.accept());
  await messageNode.locator('.owner-msg-delete').click();
  await page.waitForFunction(id => !document.querySelector(`#messages .msg[data-message-id="${CSS.escape(id)}"]`), messageId, { timeout: 5000 });

  const chatState = await page.evaluate(() => ({
    disabled: document.getElementById('messageInput')?.disabled,
    readOnly: document.getElementById('messageInput')?.readOnly,
    pointer: getComputedStyle(document.getElementById('messageInput')).pointerEvents,
  }));

  await page.click('#muteBtn');
  await page.waitForFunction(() => { try { return Boolean(muted); } catch { return false; } }, { timeout: 5000 });
  await page.waitForSelector('.mute-badge', { timeout: 5000 });
  const muteBadge = await page.evaluate(() => {
    const badge = document.querySelector('.mute-badge');
    const s = getComputedStyle(badge);
    return { backgroundImage: s.backgroundImage, fontSize: s.fontSize, width: s.width, height: s.height };
  });

  const result = {
    roomVisibleMs,
    runtimeMs: runtime.ms,
    joinMs,
    ...mic,
    controls,
    composer,
    chatState,
    ownerDeleteWorked: true,
    memberCount: await page.textContent('#memberCount'),
    topCount: await page.textContent('#voiceCountTop'),
    muteBadge,
  };
  console.log('FINAL', JSON.stringify(result));

  if (!runtime.screen || runtime.state !== 'ready') throw new Error(`runtime invalid: ${JSON.stringify(runtime)}`);
  if (!mic.joined || !mic.enabled || mic.publications < 1) throw new Error(`microphone invalid: ${JSON.stringify(mic)}`);
  if (controls.scrollWidth > controls.clientWidth + 2) throw new Error(`mobile controls overflow horizontally: ${JSON.stringify(controls)}`);
  if (controls.roomNotificationDisplay !== 'none') throw new Error(`notification button still occupies room dock: ${JSON.stringify(controls)}`);
  if (!controls.visibleIds.includes('chatToggle')) throw new Error('chat control disappeared while in call');
  if (chatState.disabled || chatState.readOnly || chatState.pointer === 'none') throw new Error(`chat input unusable in call: ${JSON.stringify(chatState)}`);
  if (!(composer.mediaX < composer.inputX && composer.inputX < composer.sendX)) throw new Error(`composer order incorrect: ${JSON.stringify(composer)}`);
  if (result.memberCount !== '1' || result.topCount !== '1') throw new Error(`member count incorrect: ${JSON.stringify({ memberCount: result.memberCount, topCount: result.topCount })}`);
  if (!muteBadge.backgroundImage.includes('svg') && muteBadge.backgroundImage === 'none') throw new Error(`mute badge not polished: ${JSON.stringify(muteBadge)}`);
  if (roomVisibleMs > 3500) throw new Error(`room entry slow: ${roomVisibleMs}ms`);
  if (runtime.ms > 8000) throw new Error(`runtime slow: ${runtime.ms}ms`);
  if (joinMs > 6000) throw new Error(`voice join slow: ${joinMs}ms`);
  if (runtime.maxLongTaskMs > 250) throw new Error(`main thread blocked: ${runtime.maxLongTaskMs}ms`);
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);

  console.log('V20 MOBILE SMOKE PASS');
} finally {
  await browser.close();
}

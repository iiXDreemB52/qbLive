(() => {
  if (window.__sawalefRoomDataV1) return;
  window.__sawalefRoomDataV1 = true;

  const $ = id => document.getElementById(id);
  const seenMedia = new Set();
  let settingsImage = null;

  const escHtml = value => {
    const d = document.createElement('div');
    d.textContent = String(value ?? '');
    return d.innerHTML;
  };
  const toast = text => { try { showToast(text); } catch {} };

  function linkify(el) {
    if (!el || el.dataset.sawalefLinkified === '1') return;
    const text = el.textContent || '';
    const re = /(https?:\/\/[^\s<>"']+)/gi;
    if (!re.test(text)) { el.dataset.sawalefLinkified = '1'; return; }
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let match;
    while ((match = re.exec(text))) {
      if (match.index > last) frag.append(document.createTextNode(text.slice(last, match.index)));
      let url = match[0];
      let tail = '';
      while (/[),.!؟،؛:]$/.test(url)) { tail = url.slice(-1) + tail; url = url.slice(0, -1); }
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
      a.className = 'chat-link';
      a.textContent = url;
      frag.append(a);
      if (tail) frag.append(document.createTextNode(tail));
      last = match.index + match[0].length;
    }
    if (last < text.length) frag.append(document.createTextNode(text.slice(last)));
    el.replaceChildren(frag);
    el.dataset.sawalefLinkified = '1';
  }

  function linkifyAll(root = document) {
    root.querySelectorAll?.('.msg-text').forEach(linkify);
  }

  const messages = $('messages');
  if (messages) {
    linkifyAll(messages);
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches?.('.msg-text')) linkify(node);
          linkifyAll(node);
        }
      }
    }).observe(messages, { childList: true, subtree: true });
  }

  function mediaMarkup(m) {
    if (m.kind === 'video') return `<video class="msg-media-video" src="${escHtml(m.dataUrl)}" controls playsinline preload="metadata"></video>`;
    return `<button class="msg-media-open" type="button" aria-label="فتح الصورة"><img class="msg-media-image" src="${escHtml(m.dataUrl)}" alt="صورة مرسلة" loading="lazy" /></button>`;
  }

  function renderMedia(m) {
    const box = $('messages');
    if (!box || !m?.id || !m?.dataUrl || seenMedia.has(String(m.id))) return;
    seenMedia.add(String(m.id));
    const mine = m.userId === me?.id;
    const el = document.createElement('div');
    el.className = `msg msg-media${mine ? ' mine' : ''}`;
    el.dataset.ts = String(Number(m.ts) || Date.now());
    const src = typeof safeAvatar === 'function' ? safeAvatar(m.avatar || '') : '';
    const fallback = typeof initials === 'function' ? initials(m.name || '؟') : '؟';
    const when = typeof time === 'function' ? time(m.ts) : '';
    el.innerHTML = `<div class="msg-avatar">${src ? `<img src="${escHtml(src)}" alt="" />` : `<span>${escHtml(fallback)}</span>`}</div><div class="msg-bubble"><div class="msg-head"><b>${escHtml(m.name || 'مستخدم')}${mine ? ' • أنت' : ''}</b><span class="msg-time">${escHtml(when)}</span></div><div class="msg-media-wrap">${mediaMarkup(m)}</div>${m.caption ? `<div class="msg-text media-caption">${escHtml(m.caption)}</div>` : ''}</div>`;
    box.appendChild(el);
    linkify(el.querySelector('.media-caption'));
    el.querySelector('.msg-media-open')?.addEventListener('click', () => openMedia(m));
    requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  }

  function openMedia(m) {
    let modal = $('mediaViewer');
    if (!modal) {
      document.body.insertAdjacentHTML('beforeend', '<div id="mediaViewer" class="media-viewer hidden"><button id="mediaViewerClose" type="button">✕</button><div id="mediaViewerBody"></div></div>');
      modal = $('mediaViewer');
      $('mediaViewerClose').onclick = () => modal.classList.add('hidden');
      modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
    }
    $('mediaViewerBody').innerHTML = m.kind === 'video'
      ? `<video src="${escHtml(m.dataUrl)}" controls autoplay playsinline></video>`
      : `<img src="${escHtml(m.dataUrl)}" alt="" />`;
    modal.classList.remove('hidden');
  }

  const readDataUrl = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('تعذر قراءة الملف.'));
    reader.readAsDataURL(file);
  });

  function imageData(file) {
    if (file.type === 'image/gif') {
      if (file.size > 1_800_000) return Promise.reject(new Error('GIF كبير جدًا. الحد تقريبًا 1.8MB.'));
      return readDataUrl(file).then(dataUrl => ({ mime: file.type, dataUrl }));
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const max = 1600;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
          if (dataUrl.length > 2_500_000) throw new Error('الصورة ما زالت كبيرة بعد الضغط.');
          resolve({ mime: 'image/jpeg', dataUrl });
        } catch (e) { reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذر قراءة الصورة.')); };
      img.src = url;
    });
  }

  function setupMediaComposer() {
    const form = $('messageForm');
    if (!form || $('mediaSendBtn')) return;
    const input = document.createElement('input');
    input.id = 'chatMediaInput';
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime';
    input.hidden = true;
    const button = document.createElement('button');
    button.id = 'mediaSendBtn';
    button.type = 'button';
    button.className = 'composer-media-btn';
    button.title = 'إرسال صورة أو فيديو';
    button.innerHTML = '＋<span>وسائط</span>';
    form.insertBefore(button, form.firstChild);
    form.appendChild(input);
    button.onclick = () => input.click();
    input.onchange = async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file || !socket?.connected || !roomId) return;
      button.disabled = true;
      try {
        let kind, mime, dataUrl;
        if (file.type.startsWith('image/')) {
          kind = 'image';
          ({ mime, dataUrl } = await imageData(file));
        } else if (file.type.startsWith('video/')) {
          if (file.size > 8_000_000) throw new Error('الفيديو كبير. الحد الحالي 8MB.');
          kind = 'video'; mime = file.type; dataUrl = await readDataUrl(file);
        } else throw new Error('الملف غير مدعوم.');
        const caption = $('messageInput')?.value.trim().slice(0, 500) || '';
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('تأخر إرسال الملف.')), 25000);
          socket.emit('chat-media-message', { kind, mime, dataUrl, caption }, res => {
            clearTimeout(timer);
            res?.ok ? resolve() : reject(new Error(res?.error || 'تعذر إرسال الملف.'));
          });
        });
        if (caption) { $('messageInput').value = ''; $('messageInput').style.height = 'auto'; }
      } catch (e) { toast(e?.message || 'تعذر إرسال الملف.'); }
      finally { button.disabled = false; }
    };
  }

  function requestMediaHistory() {
    if (!socket?.connected || !roomId) return;
    socket.emit('media:history', {}, res => { if (res?.ok) (res.messages || []).forEach(renderMedia); });
  }

  function setupGroupSettings() {
    const sheet = document.querySelector('#ownerModal .owner-sheet');
    if (!sheet || $('ownerGroupSettingsLite')) return;
    const membersTitle = sheet.querySelector('.owner-section-title');
    const section = document.createElement('div');
    section.id = 'ownerGroupSettingsLite';
    section.className = 'owner-group-settings';
    section.innerHTML = `<div class="owner-section-title">إعدادات المجموعة</div><label>اسم المجموعة<input id="editGroupNameLite" maxlength="45" /></label><div class="group-image-picker compact"><button id="editGroupImagePickLite" type="button" class="group-image-preview"><span id="editGroupImageFallbackLite">＋</span><img id="editGroupImagePreviewLite" class="hidden" alt="صورة المجموعة" /></button><div><b>صورة المجموعة</b><small>غيّر صورة المجموعة من هنا</small></div><input id="editGroupImageInputLite" type="file" accept="image/png,image/jpeg,image/webp" hidden /></div><button id="saveGroupSettingsLite" class="primary wide" type="button">حفظ الاسم والصورة</button>`;
    if (membersTitle) membersTitle.before(section); else sheet.appendChild(section);

    $('editGroupImagePickLite').onclick = () => $('editGroupImageInputLite').click();
    $('editGroupImageInputLite').onchange = async () => {
      const file = $('editGroupImageInputLite').files?.[0];
      if (!file) return;
      try {
        settingsImage = typeof resizeGroupImage === 'function' ? await resizeGroupImage(file) : (await imageData(file)).dataUrl;
        $('editGroupImagePreviewLite').src = settingsImage;
        $('editGroupImagePreviewLite').classList.remove('hidden');
        $('editGroupImageFallbackLite').classList.add('hidden');
      } catch (e) { toast(e?.message || 'تعذر قراءة صورة المجموعة.'); }
    };
    $('saveGroupSettingsLite').onclick = () => {
      const name = $('editGroupNameLite').value.trim();
      if (!name || !roomId || !socket?.connected) return toast('اكتب اسم المجموعة.');
      const button = $('saveGroupSettingsLite');
      button.disabled = true;
      const payload = { roomId, name };
      if (settingsImage !== null) payload.image = settingsImage;
      socket.emit('owner:group:update', payload, res => {
        button.disabled = false;
        if (!res?.ok) return toast(res?.error || 'تعذر حفظ التعديلات.');
        $('roomLabel').textContent = res.group?.name || name;
        toast('تم حفظ اسم وصورة المجموعة.');
        try { refreshCommunity?.(); } catch {}
      });
    };
  }

  function loadGroupSettings() {
    if (!roomId || !socket?.connected || !$('ownerGroupSettingsLite')) return;
    socket.emit('owner:room-info', { roomId }, res => {
      if (!res?.ok || !res?.canManage) return;
      settingsImage = res.group?.image || '';
      $('editGroupNameLite').value = res.group?.name || roomId;
      const preview = $('editGroupImagePreviewLite');
      const fallback = $('editGroupImageFallbackLite');
      if (settingsImage) { preview.src = settingsImage; preview.classList.remove('hidden'); fallback.classList.add('hidden'); }
      else { preview.classList.add('hidden'); fallback.classList.remove('hidden'); }
    });
  }

  function callActive() { return Boolean(roomId && window.SawalefLiveKit?.active); }
  async function syncBackgroundCall() {
    try {
      if ('mediaSession' in navigator) {
        if (callActive()) {
          navigator.mediaSession.metadata = new MediaMetadata({ title: 'مكالمة سوالف', artist: $('roomLabel')?.textContent || roomId, album: 'مكالمة صوتية' });
          navigator.mediaSession.playbackState = 'playing';
        } else {
          navigator.mediaSession.playbackState = 'none';
          navigator.mediaSession.metadata = null;
        }
      }
    } catch {}
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (!reg) return;
      if (callActive() && document.hidden) {
        await reg.showNotification('سوالف • مكالمة صوتية نشطة', { body: `أنت داخل ${$('roomLabel')?.textContent || roomId}`, tag: 'sawalef-call', renotify: false, requireInteraction: true, silent: true, data: { url: location.href } });
      } else {
        const list = await reg.getNotifications?.({ tag: 'sawalef-call' });
        list?.forEach(n => n.close());
      }
    } catch {}
  }

  setupMediaComposer();
  setupGroupSettings();
  linkifyAll();

  if (socket) {
    socket.on('media-history', list => (list || []).forEach(renderMedia));
    socket.on('chat-media-message', renderMedia);
    socket.on('message-history', () => setTimeout(requestMediaHistory, 0));
    socket.on('group:updated', ({ group } = {}) => {
      if (group?.roomId === roomId) $('roomLabel').textContent = group.name || roomId;
      try { refreshCommunity?.(); } catch {}
    });
  }
  requestMediaHistory();
  $('ownerManageBtn')?.addEventListener('click', () => setTimeout(loadGroupSettings, 0));
  document.addEventListener('visibilitychange', syncBackgroundCall);
  document.addEventListener('sawalef:voice-core-ready', syncBackgroundCall);
})();

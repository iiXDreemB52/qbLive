(() => {
  const $id = id => document.getElementById(id);
  const lk = window.LivekitClient;
  let boundSocket = null;
  let wiredRoom = null;
  let screenSharing = false;
  let localScreenTrack = null;
  let editGroupImage = null;
  const screenVideos = new Map();

  function toast(t) { if (typeof showToast === 'function') showToast(t); }
  function escapeHtml(s='') { const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }
  function currentRoom() { return window.SawalefLiveKit?.room || null; }
  function callActive() { return Boolean(roomId && window.SawalefLiveKit?.active); }

  function linkifyElement(el) {
    if (!el || el.dataset.linkified === '1') return;
    const text = el.textContent || '';
    const re = /(https?:\/\/[^\s<>"']+)/gi;
    if (!re.test(text)) { el.dataset.linkified='1'; return; }
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.append(document.createTextNode(text.slice(last, m.index)));
      let url = m[0];
      let tail = '';
      while (/[),.!؟،؛:]$/.test(url)) { tail = url.slice(-1) + tail; url = url.slice(0,-1); }
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow';
      a.className = 'chat-link'; a.textContent = url;
      frag.append(a);
      if (tail) frag.append(document.createTextNode(tail));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(document.createTextNode(text.slice(last)));
    el.textContent=''; el.append(frag); el.dataset.linkified='1';
  }

  function sortMessages() {
    const box = $id('messages'); if (!box) return;
    [...box.children].sort((a,b)=>(Number(a.dataset.ts)||0)-(Number(b.dataset.ts)||0)).forEach(n=>box.appendChild(n));
    requestAnimationFrame(()=>{ box.scrollTop=box.scrollHeight; });
  }

  const originalRenderMessage = window.renderMessage;
  function renderTextMessage(m) {
    if (typeof originalRenderMessage !== 'function') return;
    originalRenderMessage(m);
    const el = $id('messages')?.lastElementChild;
    if (!el) return;
    el.dataset.ts = String(Number(m?.ts)||Date.now());
    linkifyElement(el.querySelector('.msg-text'));
    sortMessages();
  }

  function mediaThumb(m) {
    if (m.kind === 'video') {
      return `<video class="msg-media-video" src="${escapeHtml(m.dataUrl)}" controls playsinline preload="metadata"></video>`;
    }
    return `<button class="msg-media-open" type="button" aria-label="فتح الصورة"><img class="msg-media-image" src="${escapeHtml(m.dataUrl)}" alt="صورة مرسلة" /></button>`;
  }
  function renderMediaMessage(m) {
    const box = $id('messages'); if (!box || !m?.dataUrl) return;
    if (document.querySelector(`[data-media-id="${CSS.escape(String(m.id||''))}"]`)) return;
    const mine = m.userId === me?.id;
    const el = document.createElement('div');
    el.className = `msg msg-media${mine?' mine':''}`;
    el.dataset.mediaId = String(m.id||''); el.dataset.ts = String(Number(m.ts)||Date.now());
    const src = typeof safeAvatar === 'function' ? safeAvatar(m.avatar||'') : '';
    el.innerHTML = `<div class="msg-avatar">${src?`<img src="${escapeHtml(src)}" alt=""/>`:`<span>${escapeHtml(typeof initials==='function'?initials(m.name):'؟')}</span>`}</div><div class="msg-bubble"><div class="msg-head"><b>${escapeHtml(m.name||'مستخدم')}${mine?' • أنت':''}</b><span class="msg-time">${typeof time==='function'?time(m.ts):''}</span></div><div class="msg-media-wrap">${mediaThumb(m)}</div>${m.caption?`<div class="msg-text media-caption">${escapeHtml(m.caption)}</div>`:''}</div>`;
    box.appendChild(el);
    linkifyElement(el.querySelector('.media-caption'));
    el.querySelector('.msg-media-open')?.addEventListener('click',()=>openMediaViewer(m));
    sortMessages();
  }

  function openMediaViewer(m) {
    let modal = $id('mediaViewer');
    if (!modal) {
      document.body.insertAdjacentHTML('beforeend', `<div id="mediaViewer" class="media-viewer hidden"><button id="mediaViewerClose" type="button">✕</button><div id="mediaViewerBody"></div></div>`);
      modal=$id('mediaViewer');
      $id('mediaViewerClose').onclick=()=>modal.classList.add('hidden');
      modal.addEventListener('click',e=>{ if(e.target===modal) modal.classList.add('hidden'); });
    }
    $id('mediaViewerBody').innerHTML = m.kind==='video' ? `<video src="${escapeHtml(m.dataUrl)}" controls autoplay playsinline></video>` : `<img src="${escapeHtml(m.dataUrl)}" alt=""/>`;
    modal.classList.remove('hidden');
  }

  async function imageData(file) {
    if (file.type === 'image/gif') {
      if (file.size > 1_800_000) throw new Error('GIF كبير جدًا. الحد تقريبًا 1.8MB.');
      return { mime:file.type, dataUrl:await readDataUrl(file) };
    }
    return new Promise((resolve,reject)=>{
      const img=new Image(), url=URL.createObjectURL(file);
      img.onload=()=>{
        try {
          const max=1600, scale=Math.min(1,max/Math.max(img.width,img.height));
          const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(img.width*scale)); c.height=Math.max(1,Math.round(img.height*scale));
          c.getContext('2d').drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url);
          const dataUrl=c.toDataURL('image/jpeg',.84);
          if(dataUrl.length>2_500_000) throw new Error('الصورة ما زالت كبيرة بعد الضغط.');
          resolve({mime:'image/jpeg',dataUrl});
        } catch(e){ reject(e); }
      };
      img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('تعذر قراءة الصورة.'));}; img.src=url;
    });
  }
  function readDataUrl(file) { return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(String(r.result||'')); r.onerror=()=>reject(r.error||new Error('تعذر قراءة الملف.')); r.readAsDataURL(file); }); }

  function setupComposer() {
    const form=$id('messageForm'); if(!form || $id('mediaSendBtn')) return;
    const input=document.createElement('input'); input.type='file'; input.id='chatMediaInput'; input.accept='image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime'; input.hidden=true;
    const btn=document.createElement('button'); btn.type='button'; btn.id='mediaSendBtn'; btn.className='composer-media-btn'; btn.title='إرسال صورة أو فيديو'; btn.innerHTML='＋<span>وسائط</span>';
    form.insertBefore(btn, form.firstChild); form.appendChild(input);
    btn.onclick=()=>input.click();
    input.onchange=async()=>{
      const file=input.files?.[0]; input.value=''; if(!file || !socket?.connected || !roomId) return;
      btn.disabled=true; const old=btn.innerHTML; btn.innerHTML='…<span>يرسل</span>';
      try {
        let kind='', mime='', dataUrl='';
        if(file.type.startsWith('image/')) { kind='image'; ({mime,dataUrl}=await imageData(file)); }
        else if(file.type.startsWith('video/')) {
          if(file.size>8_000_000) throw new Error('الفيديو كبير. الحد الحالي 8MB للمقطع.');
          kind='video'; mime=file.type; dataUrl=await readDataUrl(file);
        } else throw new Error('الملف غير مدعوم.');
        const caption=$id('messageInput')?.value.trim().slice(0,500)||'';
        await new Promise((resolve,reject)=>{
          let done=false; const t=setTimeout(()=>{if(!done){done=true;reject(new Error('تأخر إرسال الملف.'));}},25000);
          socket.emit('chat-media-message',{kind,mime,dataUrl,caption},res=>{if(done)return;done=true;clearTimeout(t);res?.ok?resolve(res):reject(new Error(res?.error||'تعذر إرسال الملف.'));});
        });
        if(caption){$id('messageInput').value='';$id('messageInput').style.height='auto';}
      } catch(e){ toast(e?.message||'تعذر إرسال الملف.'); }
      finally{btn.disabled=false;btn.innerHTML=old;}
    };
  }

  function bindRichSocket() {
    if(!socket?.connected || boundSocket===socket) return;
    boundSocket=socket;
    socket.off('message-history');
    socket.off('chat-message');
    socket.on('message-history', history=>{
      const box=$id('messages'); if(box) box.innerHTML='';
      (history||[]).forEach(renderTextMessage);
      socket.emit('media:history',{},r=>{ if(r?.ok)(r.messages||[]).forEach(renderMediaMessage); });
    });
    socket.on('chat-message',renderTextMessage);
    socket.on('media-history',list=>(list||[]).forEach(renderMediaMessage));
    socket.on('chat-media-message',renderMediaMessage);
    socket.on('group:updated',({group}={})=>{
      if(group?.roomId===roomId) $id('roomLabel').textContent=group.name||roomId;
      refreshGroupsV2();
    });
  }

  function refreshGroupsV2() {
    if(!socket?.connected || typeof renderPublicGroups!=='function') return;
    socket.emit('groups:list:v2',{},res=>{ if(res?.ok)renderPublicGroups(res.groups||[]); });
  }

  function setupControlLabels() {
    const labels={deafenBtn:'السماع',joinVoice:'المايك',muteBtn:'المايك',leaveVoice:'إغلاق المايك',chatToggle:'الشات'};
    for(const [id,label] of Object.entries(labels)){const b=$id(id);if(b)b.dataset.label=label;}
    const nav=document.querySelector('.room-controls'); if(!nav || $id('screenShareBtn')) return;
    const screen=document.createElement('button'); screen.id='screenShareBtn';screen.className='control-btn';screen.type='button';screen.dataset.label='مشاركة الشاشة';screen.innerHTML='▣';screen.title='مشاركة الشاشة والصوت';
    const notif=document.createElement('button');notif.id='callNotifyBtn';notif.className='control-btn';notif.type='button';notif.dataset.label='إشعار المكالمة';notif.innerHTML='🔔';notif.title='تفعيل إشعار المكالمة بالخلفية';
    nav.insertBefore(screen,$id('chatToggle'));
    nav.insertBefore(notif,$id('chatToggle'));
    screen.onclick=toggleScreenShare; notif.onclick=requestCallNotifications;
    if(!('Notification'in window))notif.classList.add('hidden');
  }

  async function requestCallNotifications(){
    if(!('Notification'in window))return toast('الإشعارات غير مدعومة على هذا المتصفح.');
    try{
      const p=Notification.permission==='default'?await Notification.requestPermission():Notification.permission;
      toast(p==='granted'?'تم تفعيل إشعارات المكالمة.':'لم يتم السماح بالإشعارات.');
      syncCallNotification();
    }catch{toast('تعذر تفعيل الإشعارات.');}
  }
  async function showCallNotification(){
    if(Notification.permission!=='granted'||!roomId||!document.hidden)return;
    try{
      const reg=await navigator.serviceWorker?.ready; if(!reg)return;
      await reg.showNotification('سوالف • مكالمة صوتية نشطة',{body:`أنت داخل ${$id('roomLabel')?.textContent||roomId} — اضغط للرجوع للمكالمة`,tag:'sawalef-call',renotify:false,requireInteraction:true,silent:true,data:{url:location.href}});
    }catch{}
  }
  async function closeCallNotification(){
    try{const reg=await navigator.serviceWorker?.ready;const ns=await reg?.getNotifications?.({tag:'sawalef-call'});ns?.forEach(n=>n.close());}catch{}
  }
  function syncMediaSession(){
    if(!('mediaSession'in navigator))return;
    try{
      if(callActive()){
        navigator.mediaSession.metadata=new MediaMetadata({title:'مكالمة سوالف',artist:$id('roomLabel')?.textContent||roomId,album:'مكالمة صوتية'});
        navigator.mediaSession.playbackState='playing';
      }else{
        navigator.mediaSession.playbackState='none'; navigator.mediaSession.metadata=null;
      }
    }catch{}
  }
  function syncCallNotification(){
    syncMediaSession();
    if(callActive()&&document.hidden)showCallNotification(); else closeCallNotification();
  }
  document.addEventListener('visibilitychange',syncCallNotification);
  window.addEventListener('pagehide',()=>{ if(!document.hidden)closeCallNotification(); });

  function isScreenVideo(pub,track){
    const source=pub?.source||track?.source||'';
    return track?.kind==='video' && (source===lk?.Track?.Source?.ScreenShare || source==='screen_share');
  }
  function ensureScreenArea(){
    let area=$id('screenShareArea');
    if(!area){
      area=document.createElement('section');area.id='screenShareArea';area.className='screen-share-area hidden';
      document.querySelector('.voice-stage-wrap')?.before(area);
    }
    return area;
  }
  function screenKey(track,participant){return `${participant?.identity||'local'}:${track?.sid||track?.mediaStreamTrack?.id||Math.random()}`;}
  function attachScreen(track,pub,participant,local=false){
    if(!track)return; const key=screenKey(track,participant); if(screenVideos.has(track))return;
    const area=ensureScreenArea(), card=document.createElement('article');card.className='screen-share-card';card.dataset.key=key;
    const label=local?'أنت تشارك الشاشة':`${participant?.name||'مستخدم'} يشارك الشاشة`;
    card.innerHTML=`<header><span class="screen-live-dot"></span><b>${escapeHtml(label)}</b><small>حتى 1080p • طلب 60fps</small></header><div class="screen-video-host"></div>`;
    const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.controls=false;video.muted=local;
    try{track.attach(video);}catch{return;}
    card.querySelector('.screen-video-host').appendChild(video);area.appendChild(card);area.classList.remove('hidden');screenVideos.set(track,{card,video});
  }
  function detachScreen(track){
    const data=screenVideos.get(track);if(!data)return;try{track.detach(data.video);}catch{}data.card.remove();screenVideos.delete(track);if(!screenVideos.size)ensureScreenArea().classList.add('hidden');
  }
  function wireScreenRoom(){
    const r=currentRoom();if(!r||r===wiredRoom)return;wiredRoom=r;
    r.on(lk.RoomEvent.TrackSubscribed,(track,pub,participant)=>{if(isScreenVideo(pub,track))attachScreen(track,pub,participant,false);});
    r.on(lk.RoomEvent.TrackUnsubscribed,(track,pub)=>{if(isScreenVideo(pub,track)||screenVideos.has(track))detachScreen(track);});
    try{for(const p of r.remoteParticipants.values())for(const pub of p.videoTrackPublications.values())if(pub.track&&isScreenVideo(pub,pub.track))attachScreen(pub.track,pub,p,false);}catch{}
  }
  function setScreenButton(active){const b=$id('screenShareBtn');if(!b)return;b.classList.toggle('live',active);b.innerHTML=active?'■':'▣';b.dataset.label=active?'إيقاف الشاشة':'مشاركة الشاشة';}
  async function toggleScreenShare(){
    const r=currentRoom();if(!r)return toast('انتظر اتصال الصوت بالمجموعة أولًا.');
    const btn=$id('screenShareBtn');if(btn)btn.disabled=true;
    try{
      if(screenSharing){
        await r.localParticipant.setScreenShareEnabled(false);screenSharing=false;if(localScreenTrack)detachScreen(localScreenTrack);localScreenTrack=null;socket?.emit('screen-share-state',{active:false});setScreenButton(false);return;
      }
      const pub=await r.localParticipant.setScreenShareEnabled(true,{
        audio:true,systemAudio:'include',surfaceSwitching:'include',selfBrowserSurface:'exclude',contentHint:'motion',
        resolution:{width:1920,height:1080,frameRate:60},video:true
      },{
        screenShareEncoding:{maxBitrate:9_000_000,maxFramerate:60,priority:'high'},
        simulcast:false,degradationPreference:'balanced',videoCodec:'vp8'
      });
      if(!pub?.track)throw new Error('لم يبدأ بث الشاشة.');
      screenSharing=true;localScreenTrack=pub.track;setScreenButton(true);attachScreen(pub.track,pub,r.localParticipant,true);socket?.emit('screen-share-state',{active:true});
      pub.track.mediaStreamTrack?.addEventListener?.('ended',async()=>{if(!screenSharing)return;try{await r.localParticipant.setScreenShareEnabled(false);}catch{}screenSharing=false;detachScreen(pub.track);localScreenTrack=null;setScreenButton(false);socket?.emit('screen-share-state',{active:false});},{once:true});
      toast('بدأت مشاركة الشاشة. لمشاركة صوت الجهاز اختر تبويب/شاشة تدعم الصوت وفعّل خيار مشاركة الصوت.');
    }catch(e){toast(e?.name==='NotAllowedError'?'تم إلغاء مشاركة الشاشة.':(e?.message||'تعذر مشاركة الشاشة.'));}
    finally{if(btn)btn.disabled=false;}
  }

  function injectGroupSettings(){
    const modal=$id('ownerModal');if(!modal||$id('groupSettingsBox'))return;
    const del=$id('ownerDeleteGroup');
    const box=document.createElement('div');box.id='groupSettingsBox';box.className='group-settings-box';
    box.innerHTML=`<div class="owner-section-title">إعدادات المجموعة</div><label>اسم المجموعة<input id="editGroupName" maxlength="45" /></label><div class="group-settings-image"><button id="editGroupImageBtn" type="button"><span id="editGroupImageFallback">＋</span><img id="editGroupImagePreview" class="hidden" alt=""/></button><div><b>صورة المجموعة</b><small>تغيير صورة المجموعة وحفظها للجميع</small></div></div><input id="editGroupImageInput" type="file" accept="image/png,image/jpeg,image/webp" hidden/><button id="saveGroupSettings" class="primary wide" type="button">حفظ التعديلات</button>`;
    del?.before(box);
    $id('editGroupImageBtn').onclick=()=>$id('editGroupImageInput').click();
    $id('editGroupImageInput').onchange=async()=>{
      const f=$id('editGroupImageInput').files?.[0];if(!f)return;try{editGroupImage=typeof resizeGroupImage==='function'?await resizeGroupImage(f):(await imageData(f)).dataUrl;$id('editGroupImagePreview').src=editGroupImage;$id('editGroupImagePreview').classList.remove('hidden');$id('editGroupImageFallback').classList.add('hidden');}catch(e){toast(e?.message||'تعذر قراءة الصورة.');}
    };
    $id('saveGroupSettings').onclick=saveGroupSettings;
    $id('ownerManageBtn')?.addEventListener('click',()=>setTimeout(loadGroupSettings,60));
  }
  function loadGroupSettings(){
    if(!socket?.connected||!roomId)return;socket.emit('owner:room-info',{roomId},res=>{
      if(!res?.ok||!res.canManage)return;
      $id('editGroupName').value=res.group?.name||'';editGroupImage=res.group?.image||'';
      const img=$id('editGroupImagePreview'),fb=$id('editGroupImageFallback');if(editGroupImage){img.src=editGroupImage;img.classList.remove('hidden');fb.classList.add('hidden');}else{img.removeAttribute('src');img.classList.add('hidden');fb.classList.remove('hidden');}
    });
  }
  function saveGroupSettings(){
    const name=$id('editGroupName')?.value.trim();if(!name)return toast('اكتب اسم المجموعة.');const b=$id('saveGroupSettings');b.disabled=true;
    socket.emit('owner:group:update',{roomId,name,image:editGroupImage??''},res=>{b.disabled=false;if(!res?.ok)return toast(res?.error||'تعذر حفظ التعديلات.');$id('roomLabel').textContent=res.group.name;toast('تم حفظ اسم وصورة المجموعة.');refreshGroupsV2();});
  }

  function loadRoomTitle(){
    if(!socket?.connected||!roomId)return;socket.emit('owner:room-info',{roomId},res=>{if(res?.ok&&res.group?.name)$id('roomLabel').textContent=res.group.name;});
  }

  function injectAdminStats(){
    const sheet=document.querySelector('#adminPanel .admin-sheet');if(!sheet||$id('advancedAdminStats'))return;
    const normal=sheet.querySelector('.admin-stats');const wrap=document.createElement('div');wrap.id='advancedAdminStats';wrap.className='advanced-admin-stats';wrap.innerHTML='<div><b id="statListeners">0</b><span>مستمع</span></div><div><b id="statMics">0</b><span>مايك مفتوح</span></div><div><b id="statScreens">0</b><span>مشاركة شاشة</span></div><div><b id="statMedia">0</b><span>وسائط محفوظة</span></div>';normal?.after(wrap);
  }
  function refreshAdvancedAdmin(){
    if(me?.role!=='admin'||!socket?.connected||$id('adminPanel')?.classList.contains('hidden'))return;socket.emit('admin:advanced-summary',{},r=>{if(!r?.ok)return;$id('statListeners').textContent=r.listeners||0;$id('statMics').textContent=r.speakers||0;$id('statScreens').textContent=r.screenShares||0;$id('statMedia').textContent=r.mediaMessages||0;});
  }

  function bindGroupRefresh(){
    if(!socket?.connected||socket.__advancedGroupsBound)return;socket.__advancedGroupsBound=true;socket.on('groups-updated',()=>setTimeout(refreshGroupsV2,40));socket.on('group:deleted',refreshGroupsV2);
  }

  setupComposer();setupControlLabels();injectGroupSettings();injectAdminStats();
  setInterval(()=>{
    bindRichSocket();bindGroupRefresh();wireScreenRoom();syncMediaSession();
    if(roomId){loadRoomTitle();if(document.hidden)syncCallNotification();}
    refreshAdvancedAdmin();
  },1800);
  setInterval(refreshGroupsV2,4500);
})();

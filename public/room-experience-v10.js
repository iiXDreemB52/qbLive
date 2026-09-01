(() => {
  const $id = id => document.getElementById(id);
  const lk = window.LivekitClient;
  if (!lk) return;

  const screenCards = new Map();
  const pendingScreenAudio = new Map();
  let wiredRoom = null;
  let screenSharing = false;
  let localScreenIdentity = '';
  let localScreenTrack = null;
  let shareSettings = { quality: '1080', fps: 60, audio: true, mode: 'motion' };

  const icons = {
    speaker:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="M15 8.5a5 5 0 0 1 0 7M17.5 6a8.5 8.5 0 0 1 0 12"/></svg>',
    speakerOff:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="m16 9 5 5M21 9l-5 5"/></svg>',
    headset:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14h3v6H5a1 1 0 0 1-1-1v-5Zm16 0h-3v6h2a1 1 0 0 0 1-1v-5Z"/><path d="M8 5.5a8 8 0 0 1 8 0"/></svg>',
    mic:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>',
    micOff:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8V6a3 3 0 0 1 5.7-1.3M15 10v1a3 3 0 0 1-.4 1.5"/><path d="M5.5 11a6.5 6.5 0 0 0 10.8 4.9M18.5 11a6.4 6.4 0 0 1-.5 2.5M12 17.5V21M8.5 21h7M3 3l18 18"/></svg>',
    phoneOff:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7.5c3.8-2.7 10.2-2.7 14 0"/><path d="m7.5 9.5-2 4 3.2 1.4 2-3.1M16.5 9.5l2 4-3.2 1.4-2-3.1"/></svg>',
    screen:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M8 10l4-4 4 4M12 6v7"/></svg>',
    stop:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    bell:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Z"/><path d="M10 20h4"/></svg>',
    chat:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4V5Z"/><path d="M8 9h8M8 12h5"/></svg>',
    media:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9" r="1.5"/><path d="m5 17 4.5-4 3 2.5 2.5-2 4 3.5"/></svg>',
    send:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 17 8-17 8 3-8-3-8Z"/><path d="M7 12h14"/></svg>',
    maximize:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>',
    volume:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="M15 9a4 4 0 0 1 0 6"/></svg>',
    volumeOff:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="m16 10 5 5M21 10l-5 5"/></svg>'
  };

  function toast(text){ try { showToast(text); } catch {} }
  function currentRoom(){ return window.SawalefLiveKit?.room || null; }
  function esc(s=''){ const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }
  function sourceOf(pub,track){ return String(pub?.source || track?.source || '').toLowerCase(); }
  function isScreenVideo(pub,track){ const s=sourceOf(pub,track); return track?.kind==='video' && (s==='screen_share' || s===String(lk.Track?.Source?.ScreenShare||'').toLowerCase()); }
  function isScreenAudio(pub,track){ const s=sourceOf(pub,track); return track?.kind==='audio' && (s==='screen_share_audio' || s===String(lk.Track?.Source?.ScreenShareAudio||'').toLowerCase()); }
  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

  function setButtonVisual(btn, iconKey, label, state=''){
    if(!btn) return;
    const key=`${iconKey}:${label}:${state}`;
    if(btn.dataset.v10Visual!==key){ btn.innerHTML=icons[iconKey]||''; btn.dataset.v10Visual=key; }
    btn.dataset.label=label;
    btn.setAttribute('aria-label',label);
    btn.title=label;
  }

  function ensureModernControls(){
    const nav=document.querySelector('.room-controls');
    if(!nav) return;
    let screen=$id('screenShareBtn');
    if(!screen){ screen=document.createElement('button'); screen.id='screenShareBtn'; screen.className='control-btn'; screen.type='button'; nav.appendChild(screen); }
    let notif=$id('callNotifyBtn');
    if(!notif){ notif=document.createElement('button'); notif.id='callNotifyBtn'; notif.className='control-btn'; notif.type='button'; nav.appendChild(notif); }

    const order=['chatToggle','callNotifyBtn','screenShareBtn','joinVoice','muteBtn','leaveVoice','deafenBtn'];
    order.forEach(id=>{ const el=$id(id); if(el) nav.appendChild(el); });
    screen.onclick=()=>screenSharing ? stopScreenShare() : openScreenSettings();

    const send=document.querySelector('.send-btn');
    if(send && send.dataset.v10Icon!=='1'){ send.innerHTML=icons.send; send.dataset.v10Icon='1'; send.title='إرسال'; }
    const media=$id('mediaSendBtn');
    if(media && !media.disabled && media.dataset.v10Icon!=='1'){ media.innerHTML=icons.media; media.dataset.v10Icon='1'; media.title='إرسال صورة أو فيديو'; }
  }

  function syncControlState(){
    ensureModernControls();
    const join=$id('joinVoice'), mute=$id('muteBtn'), leave=$id('leaveVoice'), deafen=$id('deafenBtn'), screen=$id('screenShareBtn'), notif=$id('callNotifyBtn'), chat=$id('chatToggle');
    let speaking=false, isMuted=false, isDeaf=false;
    try { speaking=Boolean(joinedVoice); isMuted=Boolean(muted); isDeaf=Boolean(deafened); } catch {}
    join?.classList.toggle('hidden',speaking);
    mute?.classList.toggle('hidden',!speaking);
    leave?.classList.toggle('hidden',!speaking);
    setButtonVisual(join,'headset','انضم للمكالمة',speaking?'on':'off');
    setButtonVisual(mute,isMuted?'micOff':'mic',isMuted?'فتح المايك':'ميوت',isMuted?'muted':'live');
    setButtonVisual(leave,'phoneOff','إغلاق المايك');
    setButtonVisual(deafen,isDeaf?'speakerOff':'speaker',isDeaf?'تشغيل السماع':'كتم السماع',isDeaf?'off':'on');
    setButtonVisual(screen,screenSharing?'stop':'screen',screenSharing?'إيقاف المشاركة':'مشاركة الشاشة',screenSharing?'live':'idle');
    setButtonVisual(notif,'bell','الإشعارات',Notification?.permission||'');
    setButtonVisual(chat,'chat','الشات',$id('chatSheet')?.classList.contains('collapsed')?'closed':'open');
    screen?.classList.toggle('live',screenSharing);
    notif?.classList.toggle('live',typeof Notification!=='undefined' && Notification.permission==='granted');
    chat?.classList.toggle('live',!$id('chatSheet')?.classList.contains('collapsed'));
    deafen?.classList.toggle('live',isDeaf);
    mute?.classList.toggle('danger-state',isMuted);
    syncShareAudioMute();
  }

  function ensureCallLayout(){
    const roomPage=$id('roomPage');
    const voiceWrap=document.querySelector('.voice-stage-wrap');
    if(!roomPage || !voiceWrap) return null;
    let content=$id('roomCallContent');
    if(!content){
      content=document.createElement('section');
      content.id='roomCallContent';
      content.className='room-call-content';
      roomPage.querySelector('.room-topbar')?.after(content);
    }
    if(voiceWrap.parentElement!==content) content.appendChild(voiceWrap);
    let area=$id('screenShareArea');
    if(!area){ area=document.createElement('section'); area.id='screenShareArea'; area.className='screen-share-area hidden'; }
    if(area.parentElement!==content) content.appendChild(area);

    const chat=$id('chatSheet');
    if(chat && !chat.__v10Observed){
      chat.__v10Observed=true;
      const update=()=>roomPage.classList.toggle('chat-collapsed-v10',chat.classList.contains('collapsed'));
      new MutationObserver(update).observe(chat,{attributes:true,attributeFilter:['class']});
      update();
    }
    return content;
  }

  function removeLegacyScreenCards(){
    const area=$id('screenShareArea');
    if(!area) return;
    area.querySelectorAll('.screen-share-card:not(.screen-v10)').forEach(card=>{
      card.querySelectorAll('video,audio').forEach(el=>{ try { el.pause(); el.srcObject=null; } catch {} });
      card.remove();
    });
  }

  function updateScreenLayout(){
    const content=ensureCallLayout();
    const area=$id('screenShareArea');
    if(!content || !area) return;
    removeLegacyScreenCards();
    const count=screenCards.size;
    area.dataset.count=String(Math.min(count,4));
    area.classList.toggle('hidden',count===0);
    content.classList.toggle('has-screen',count>0);
  }

  function participantName(identity,participant,local){
    if(local) return 'أنت';
    const fromPresence=Array.isArray(currentPresence)?currentPresence.find(u=>String(u.id||'')===String(identity||'')):null;
    return participant?.name || fromPresence?.name || 'مشارك';
  }

  function actualQuality(track,fallback=''){
    try{
      const s=track?.mediaStreamTrack?.getSettings?.()||{};
      const w=s.width, h=s.height, fps=Math.round(Number(s.frameRate||0));
      if(w && h) return `${w}×${h}${fps?` • ${fps} FPS`:''}`;
    }catch{}
    return fallback || 'جودة تلقائية';
  }

  function ensureScreenCard(identity,participant,local=false){
    let data=screenCards.get(identity);
    if(data) return data;
    const area=$id('screenShareArea') || ensureCallLayout()?.querySelector('#screenShareArea');
    if(!area) return null;
    const card=document.createElement('article');
    card.className='screen-share-card screen-v10';
    card.dataset.identity=identity;
    card.innerHTML=`
      <header class="screen-card-head">
        <div class="screen-card-title"><span class="screen-live-dot"></span><div><b>${esc(participantName(identity,participant,local))} يشارك الشاشة</b><small class="screen-quality">جاري قراءة الجودة…</small></div></div>
        <div class="screen-card-tools">
          <button class="screen-audio-toggle" type="button" title="كتم صوت المشاركة" disabled>${icons.volume}</button>
          <input class="screen-volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="مستوى صوت المشاركة" disabled />
          <button class="screen-fullscreen" type="button" title="تكبير الشاشة">${icons.maximize}</button>
        </div>
      </header>
      <div class="screen-video-host"><video autoplay playsinline></video><span class="screen-live-badge">LIVE</span></div>`;
    area.appendChild(card);
    data={ identity, participant, local, card, video:card.querySelector('video'), videoTrack:null, audio:null, audioTrack:null, shareMuted:false };
    screenCards.set(identity,data);
    card.querySelector('.screen-fullscreen').onclick=()=>openFullscreen(data);
    card.querySelector('.screen-audio-toggle').onclick=()=>{
      if(!data.audio) return;
      data.shareMuted=!data.shareMuted;
      syncOneShareAudio(data);
    };
    card.querySelector('.screen-volume').oninput=e=>{
      if(!data.audio) return;
      const v=Math.max(0,Math.min(1,Number(e.target.value)||0));
      data.audio.volume=v;
      data.shareMuted=v===0;
      syncOneShareAudio(data);
    };
    updateScreenLayout();
    return data;
  }

  function openFullscreen(data){
    const el=data?.card;
    const video=data?.video;
    if(el?.requestFullscreen) return el.requestFullscreen().catch(()=>{});
    if(video?.webkitEnterFullscreen) try { video.webkitEnterFullscreen(); } catch {}
  }

  function attachScreenVideo(track,pub,participant,local=false,requested=''){
    if(!track) return;
    const identity=String(participant?.identity || (local?currentRoom()?.localParticipant?.identity:'') || track.sid || 'screen');
    let data=screenCards.get(identity);
    if(data?.videoTrack && data.videoTrack!==track) removeScreenByIdentity(identity);
    data=ensureScreenCard(identity,participant,local);
    if(!data) return;
    data.participant=participant; data.local=local; data.videoTrack=track;
    try { track.attach(data.video); } catch { return; }
    data.video.muted=true;
    data.video.autoplay=true;
    data.video.playsInline=true;
    const updateQuality=()=>{ const q=data.card.querySelector('.screen-quality'); if(q) q.textContent=actualQuality(track,requested); };
    updateQuality(); setTimeout(updateQuality,250); setTimeout(updateQuality,1000);
    track.mediaStreamTrack?.addEventListener?.('ended',()=>removeScreenByIdentity(identity),{once:true});
    if(pendingScreenAudio.has(identity)){
      const pending=pendingScreenAudio.get(identity); pendingScreenAudio.delete(identity);
      attachScreenAudio(pending.track,pending.pub,pending.participant);
    }
    updateScreenLayout();
  }

  function removeGenericAudioForTrack(track){
    const id=track?.mediaStreamTrack?.id;
    if(!id) return;
    setTimeout(()=>{
      document.querySelectorAll('#audioRack audio').forEach(el=>{
        const same=(el.srcObject?.getAudioTracks?.()||[]).some(t=>t.id===id);
        if(!same) return;
        try { track.detach(el); } catch {}
        try { el.pause(); el.srcObject=null; el.remove(); } catch {}
      });
    },0);
  }

  function attachScreenAudio(track,pub,participant){
    if(!track) return;
    const identity=String(participant?.identity||'');
    if(!identity) return;
    removeGenericAudioForTrack(track);
    const data=screenCards.get(identity);
    if(!data){ pendingScreenAudio.set(identity,{track,pub,participant}); return; }
    if(data.audioTrack===track) return;
    if(data.audioTrack) detachScreenAudio(data);
    const audio=document.createElement('audio');
    audio.autoplay=true; audio.playsInline=true; audio.volume=1;
    try { track.attach(audio); } catch { return; }
    data.card.appendChild(audio);
    data.audio=audio; data.audioTrack=track; data.shareMuted=false;
    const btn=data.card.querySelector('.screen-audio-toggle'), slider=data.card.querySelector('.screen-volume');
    if(btn) btn.disabled=false; if(slider) slider.disabled=false;
    syncOneShareAudio(data);
    audio.play().catch(()=>{});
    track.mediaStreamTrack?.addEventListener?.('ended',()=>detachScreenAudio(data),{once:true});
  }

  function detachScreenAudio(data){
    if(!data?.audioTrack) return;
    try { data.audioTrack.detach(data.audio); } catch {}
    try { data.audio?.pause(); data.audio.srcObject=null; data.audio?.remove(); } catch {}
    data.audio=null; data.audioTrack=null;
    const btn=data.card.querySelector('.screen-audio-toggle'), slider=data.card.querySelector('.screen-volume');
    if(btn) btn.disabled=true; if(slider) slider.disabled=true;
  }

  function syncOneShareAudio(data){
    if(!data?.audio) return;
    let globalDeaf=false;
    try { globalDeaf=Boolean(deafened); } catch {}
    data.audio.muted=globalDeaf || data.shareMuted;
    const btn=data.card.querySelector('.screen-audio-toggle');
    if(btn){ btn.innerHTML=data.audio.muted?icons.volumeOff:icons.volume; btn.classList.toggle('muted',data.audio.muted); }
  }
  function syncShareAudioMute(){ for(const data of screenCards.values()) syncOneShareAudio(data); }

  function removeScreenByIdentity(identity){
    const data=screenCards.get(identity);
    if(!data){ pendingScreenAudio.delete(identity); updateScreenLayout(); return; }
    if(data.videoTrack) try { data.videoTrack.detach(data.video); } catch {}
    detachScreenAudio(data);
    try { data.video.pause(); data.video.srcObject=null; } catch {}
    data.card.remove();
    screenCards.delete(identity); pendingScreenAudio.delete(identity);
    updateScreenLayout();
  }

  function removeScreenByTrack(track){
    for(const [identity,data] of screenCards){
      if(data.videoTrack===track || data.audioTrack===track){
        if(data.audioTrack===track && data.videoTrack!==track) detachScreenAudio(data); else removeScreenByIdentity(identity);
        return;
      }
    }
    for(const [identity,p] of pendingScreenAudio){ if(p.track===track) pendingScreenAudio.delete(identity); }
    updateScreenLayout();
  }

  function cleanupAllScreens(){
    for(const identity of [...screenCards.keys()]) removeScreenByIdentity(identity);
    pendingScreenAudio.clear();
    removeLegacyScreenCards();
    updateScreenLayout();
  }

  function wireScreenRoom(){
    const r=currentRoom();
    if(!r || r===wiredRoom) return;
    if(wiredRoom && wiredRoom!==r) cleanupAllScreens();
    wiredRoom=r;
    const ev=lk.RoomEvent;
    r.on(ev.TrackSubscribed,(track,pub,participant)=>{
      if(isScreenVideo(pub,track)) attachScreenVideo(track,pub,participant,false);
      else if(isScreenAudio(pub,track)) attachScreenAudio(track,pub,participant);
    });
    r.on(ev.TrackUnsubscribed,(track,pub)=>{ if(isScreenVideo(pub,track)||isScreenAudio(pub,track)||[...screenCards.values()].some(d=>d.videoTrack===track||d.audioTrack===track)) removeScreenByTrack(track); });
    if(ev.ParticipantDisconnected) r.on(ev.ParticipantDisconnected,p=>removeScreenByIdentity(String(p?.identity||'')));
    if(ev.TrackUnpublished) r.on(ev.TrackUnpublished,(pub,participant)=>{ if(sourceOf(pub).includes('screen_share')) removeScreenByIdentity(String(participant?.identity||'')); });
    if(ev.LocalTrackUnpublished) r.on(ev.LocalTrackUnpublished,pub=>{ if(sourceOf(pub).includes('screen_share')){ removeScreenByIdentity(String(r.localParticipant?.identity||'')); screenSharing=false; localScreenTrack=null; syncControlState(); } });
    if(ev.Disconnected) r.on(ev.Disconnected,()=>{ cleanupAllScreens(); screenSharing=false; localScreenTrack=null; localScreenIdentity=''; syncControlState(); });
    try{
      for(const p of r.remoteParticipants.values()){
        for(const pub of p.videoTrackPublications.values()) if(pub.track && isScreenVideo(pub,pub.track)) attachScreenVideo(pub.track,pub,p,false);
        for(const pub of p.audioTrackPublications.values()) if(pub.track && isScreenAudio(pub,pub.track)) attachScreenAudio(pub.track,pub,p);
      }
    }catch{}
  }

  function qualityPreset(id){
    return {
      '480':{w:854,h:480,label:'480p'},
      '720':{w:1280,h:720,label:'720p'},
      '1080':{w:1920,h:1080,label:'1080p'},
      '1440':{w:2560,h:1440,label:'1440p'},
      '2160':{w:3840,h:2160,label:'4K'}
    }[id]||null;
  }
  function bitrateFor(q,fps){
    const base={480:2_500_000,720:4_500_000,1080:8_500_000,1440:14_000_000,2160:22_000_000}[Number(q)]||9_000_000;
    return Math.min(30_000_000,Math.round(base*Math.max(.65,Math.min(2.1,Number(fps||60)/60))));
  }

  function ensureScreenSettingsModal(){
    if($id('screenSettingsModal')) return;
    document.body.insertAdjacentHTML('beforeend',`
      <div id="screenSettingsModal" class="screen-settings-modal hidden">
        <div class="screen-settings-backdrop" data-screen-close></div>
        <section class="screen-settings-sheet">
          <header><div><span class="eyebrow">مشاركة الشاشة</span><h2>اختر جودة المشاركة</h2><p>نطلب الجودة والفريمات من المتصفح، ويظهر لك داخل المشاركة الرقم الفعلي الذي شغّله جهازك.</p></div><button class="round-btn" type="button" data-screen-close>✕</button></header>
          <div class="screen-settings-grid">
            <label>الدقة<select id="screenQualitySelect"><option value="auto">تلقائي — أعلى المصدر</option><option value="480">480p</option><option value="720">720p</option><option value="1080" selected>1080p</option><option value="1440">1440p / 2K</option><option value="2160">2160p / 4K</option></select></label>
            <label>الفريمات<select id="screenFpsSelect"><option value="30">30 FPS</option><option value="60" selected>60 FPS</option><option value="90">90 FPS — إذا مدعوم</option><option value="120">120 FPS — إذا مدعوم</option><option value="144">144 FPS — إذا مدعوم</option></select></label>
            <label>نوع المحتوى<select id="screenModeSelect"><option value="motion" selected>حركة / ألعاب — أولوية للسلاسة</option><option value="detail">نصوص / شروحات — أولوية للوضوح</option><option value="balanced">متوازن</option></select></label>
            <label class="screen-audio-option"><input id="screenAudioCheck" type="checkbox" checked/><span><b>مشاركة صوت الجهاز</b><small>جودة عالية Opus Stereo حتى 192kbps عند دعم المتصفح</small></span></label>
          </div>
          <div id="screenCapabilityNote" class="screen-capability-note"></div>
          <button id="screenStartShare" class="primary wide" type="button">ابدأ المشاركة</button>
        </section>
      </div>`);
    document.querySelectorAll('[data-screen-close]').forEach(el=>el.onclick=()=>closeScreenSettings());
    $id('screenStartShare').onclick=()=>startScreenShare();
  }

  function openScreenSettings(){
    if(!navigator.mediaDevices?.getDisplayMedia){ toast('مشاركة الشاشة غير مدعومة من هذا المتصفح على الجهاز الحالي.'); return; }
    ensureScreenSettingsModal();
    $id('screenQualitySelect').value=shareSettings.quality;
    $id('screenFpsSelect').value=String(shareSettings.fps);
    $id('screenModeSelect').value=shareSettings.mode;
    $id('screenAudioCheck').checked=shareSettings.audio;
    const note=$id('screenCapabilityNote');
    const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    note.textContent=mobile?'دعم مشاركة الشاشة على الجوال يعتمد على المتصفح والنظام. القيم العالية تُخفَّض تلقائيًا إذا الجهاز ما يدعمها.':'تقدر تختار حتى 4K و144 FPS؛ المتصفح يطبق الأعلى المتاح للمصدر والشاشة والشبكة.';
    $id('screenSettingsModal').classList.remove('hidden');
  }
  function closeScreenSettings(){ $id('screenSettingsModal')?.classList.add('hidden'); }

  async function findLocalScreenPublication(r){
    for(let i=0;i<18;i++){
      try{ for(const pub of r.localParticipant.videoTrackPublications.values()) if(pub.track && isScreenVideo(pub,pub.track)) return pub; }catch{}
      await sleep(80);
    }
    return null;
  }

  async function startScreenShare(){
    const r=currentRoom();
    if(!r) return toast('انتظر اتصال LiveKit بالمجموعة أولًا.');
    if(screenSharing) return;
    const button=$id('screenStartShare'); if(button) button.disabled=true;
    try{
      shareSettings={
        quality:$id('screenQualitySelect')?.value||'1080',
        fps:Number($id('screenFpsSelect')?.value||60),
        audio:Boolean($id('screenAudioCheck')?.checked),
        mode:$id('screenModeSelect')?.value||'motion'
      };
      try { localStorage.setItem('sawalef_screen_settings',JSON.stringify(shareSettings)); } catch {}
      const preset=qualityPreset(shareSettings.quality);
      const capture={
        video:true,
        audio:shareSettings.audio,
        systemAudio:shareSettings.audio?'include':'exclude',
        surfaceSwitching:'include',
        selfBrowserSurface:'exclude',
        contentHint:shareSettings.mode==='detail'?'detail':'motion'
      };
      if(preset) capture.resolution={width:preset.w,height:preset.h,frameRate:shareSettings.fps};
      const publish={
        screenShareEncoding:{maxBitrate:bitrateFor(shareSettings.quality,shareSettings.fps),maxFramerate:shareSettings.fps,priority:'high'},
        simulcast:false,
        degradationPreference:shareSettings.mode==='detail'?'maintain-resolution':(shareSettings.mode==='motion'?'maintain-framerate':'balanced'),
        videoCodec:'vp8',
        audioPreset:{maxBitrate:192000,priority:'high'},
        forceStereo:true,
        dtx:false,
        red:true
      };
      const result=await r.localParticipant.setScreenShareEnabled(true,capture,publish);
      const pub=(result?.track?result:null) || await findLocalScreenPublication(r);
      if(!pub?.track) throw new Error('المتصفح ما بدأ مسار مشاركة الشاشة.');
      const mediaTrack=pub.track.mediaStreamTrack;
      try{
        const constraints={frameRate:{ideal:shareSettings.fps,max:shareSettings.fps}};
        if(preset){ constraints.width={ideal:preset.w}; constraints.height={ideal:preset.h}; }
        await mediaTrack?.applyConstraints?.(constraints);
      }catch{}
      screenSharing=true;
      localScreenTrack=pub.track;
      localScreenIdentity=String(r.localParticipant?.identity||'local');
      const requested=`${preset?.label||'تلقائي'} • طلب ${shareSettings.fps} FPS`;
      attachScreenVideo(pub.track,pub,r.localParticipant,true,requested);
      socket?.emit('screen-share-state',{active:true,quality:shareSettings.quality,fps:shareSettings.fps});
      mediaTrack?.addEventListener?.('ended',()=>{ if(screenSharing) stopScreenShare(false); },{once:true});
      closeScreenSettings();
      syncControlState();
      toast(`بدأت المشاركة — ${actualQuality(pub.track,requested)}.`);
    }catch(e){
      toast(e?.name==='NotAllowedError'?'تم إلغاء اختيار الشاشة.':(e?.message||'تعذر بدء مشاركة الشاشة.'));
    }finally{ if(button) button.disabled=false; }
  }

  async function stopScreenShare(showToast=true){
    const r=currentRoom();
    try { await r?.localParticipant?.setScreenShareEnabled(false); } catch {}
    screenSharing=false;
    socket?.emit('screen-share-state',{active:false});
    if(localScreenIdentity) removeScreenByIdentity(localScreenIdentity);
    else if(localScreenTrack) removeScreenByTrack(localScreenTrack);
    localScreenTrack=null; localScreenIdentity='';
    syncControlState(); updateScreenLayout();
    if(showToast) toast('تم إيقاف مشاركة الشاشة.');
  }

  function restoreShareSettings(){
    try{
      const v=JSON.parse(localStorage.getItem('sawalef_screen_settings')||'null');
      if(v && typeof v==='object') shareSettings={...shareSettings,...v,fps:Number(v.fps||60)};
    }catch{}
  }

  function pruneScreens(){
    const r=currentRoom();
    if(!r){ if(screenCards.size) cleanupAllScreens(); return; }
    for(const [identity,data] of [...screenCards.entries()]){
      const ended=data.videoTrack?.mediaStreamTrack?.readyState==='ended';
      const local=identity===String(r.localParticipant?.identity||'');
      const remoteExists=local || r.remoteParticipants?.has?.(identity);
      if(ended || !remoteExists) removeScreenByIdentity(identity);
    }
  }

  document.addEventListener('pointerdown',()=>{ for(const d of screenCards.values()) d.audio?.play?.().catch(()=>{}); },{passive:true,capture:true});
  restoreShareSettings();
  ensureCallLayout();
  ensureModernControls();
  ensureScreenSettingsModal();
  updateScreenLayout();

  setInterval(()=>{
    ensureCallLayout();
    wireScreenRoom();
    syncControlState();
    pruneScreens();
    removeLegacyScreenCards();
  },260);
})();
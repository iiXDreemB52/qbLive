(() => {
  if (window.__sawalefV11) return;
  window.__sawalefV11 = true;
  const $ = id => document.getElementById(id);
  const lk = window.LivekitClient;
  const state = { sharing:false, pub:null, track:null, audioPub:null, quality:'1080', fps:60, audio:true, hdr:false, mode:'motion' };
  const presets = {
    '480':{w:854,h:480,label:'480p'}, '720':{w:1280,h:720,label:'720p'}, '1080':{w:1920,h:1080,label:'1080p'},
    '1440':{w:2560,h:1440,label:'1440p'}, '2160':{w:3840,h:2160,label:'4K'}
  };
  const iconBell='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Z"/><path d="M10 20h4"/></svg>';
  const iconStop='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  const iconTune='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M10 17h10M4 17h2M14 4v6M8 14v6"/></svg>';

  function toast(t){ try{ showToast(t); }catch{} }
  function room(){ return window.SawalefLiveKit?.room || null; }
  function hasNotifications(){ return typeof window.Notification!=='undefined' && typeof window.Notification.requestPermission==='function'; }
  function supportedCodec(){
    try{
      const codecs=RTCRtpSender.getCapabilities?.('video')?.codecs||[];
      if(codecs.some(c=>/VP9/i.test(c.mimeType))) return 'vp9';
      if(codecs.some(c=>/H264/i.test(c.mimeType))) return 'h264';
    }catch{}
    return 'vp8';
  }
  function actualSettings(){
    try{ return state.track?.mediaStreamTrack?.getSettings?.()||{}; }catch{return{};}
  }
  function qualityText(){
    const s=actualSettings();
    const w=s.width, h=s.height, fps=Math.round(Number(s.frameRate||0));
    return w&&h?`${w}×${h}${fps?` • ${fps} FPS`:''}`:`${presets[state.quality]?.label||'تلقائي'} • ${state.fps} FPS`;
  }

  function ensureTopNotifications(){
    const userActions=document.querySelector('.user-actions');
    const meChip=document.querySelector('.me-chip');
    if(userActions&&meChip&&!document.querySelector('.profile-notify-wrap')){
      const wrap=document.createElement('div'); wrap.className='profile-notify-wrap';
      meChip.before(wrap); wrap.append(meChip);
      const b=document.createElement('button'); b.type='button'; b.className='top-call-notify'; b.innerHTML=iconBell; b.title='إشعارات المكالمة';
      b.onclick=enableNotifications; wrap.prepend(b);
    }
    const top=document.querySelector('.room-topbar');
    const mini=document.querySelector('.room-mini-users');
    if(top&&mini&&!$('roomTopNotify')){
      const b=document.createElement('button'); b.id='roomTopNotify'; b.type='button'; b.className='top-call-notify room-notify'; b.innerHTML=iconBell; b.title='إشعارات المكالمة';
      b.onclick=enableNotifications; mini.before(b);
    }
    syncNotificationVisual();
  }
  async function enableNotifications(){
    if(!hasNotifications()) return toast('الإشعارات غير مدعومة على هذا المتصفح.');
    try{
      const p=Notification.permission==='default'?await Notification.requestPermission():Notification.permission;
      syncNotificationVisual();
      toast(p==='granted'?'تم تفعيل إشعارات المكالمة.':'لم يتم السماح بالإشعارات.');
    }catch{ toast('تعذر تفعيل الإشعارات.'); }
  }
  function syncNotificationVisual(){
    const granted=hasNotifications()&&Notification.permission==='granted';
    document.querySelectorAll('.top-call-notify').forEach(b=>b.classList.toggle('active',granted));
  }

  function ensureHdrOption(){
    const grid=document.querySelector('.screen-settings-grid');
    if(!grid||$('screenHdrCheck')) return;
    const label=document.createElement('label'); label.className='screen-audio-option hdr-option';
    label.innerHTML='<input id="screenHdrCheck" type="checkbox"><span><b>HDR</b><small>تشغيل HDR عند دعم المتصفح والشاشة ومصدر المشاركة</small></span>';
    grid.appendChild(label);
  }
  function readStartControls(){
    state.quality=$('screenQualitySelect')?.value||state.quality;
    state.fps=Number($('screenFpsSelect')?.value||state.fps||60);
    state.mode=$('screenModeSelect')?.value||state.mode;
    state.audio=Boolean($('screenAudioCheck')?.checked);
    state.hdr=Boolean($('screenHdrCheck')?.checked);
    try{localStorage.setItem('sawalef_share_v11',JSON.stringify({quality:state.quality,fps:state.fps,audio:state.audio,hdr:state.hdr,mode:state.mode}));}catch{}
  }
  function restoreStartControls(){
    try{ const v=JSON.parse(localStorage.getItem('sawalef_share_v11')||'null'); if(v) Object.assign(state,v,{fps:Number(v.fps||60)}); }catch{}
    ensureHdrOption();
    if($('screenQualitySelect')) $('screenQualitySelect').value=state.quality;
    if($('screenFpsSelect')) $('screenFpsSelect').value=String(state.fps);
    if($('screenModeSelect')) $('screenModeSelect').value=state.mode;
    if($('screenAudioCheck')) $('screenAudioCheck').checked=state.audio;
    if($('screenHdrCheck')) $('screenHdrCheck').checked=state.hdr;
  }

  function bitrate(){
    const base={480:4_000_000,720:7_000_000,1080:14_000_000,1440:22_000_000,2160:35_000_000}[Number(state.quality)]||16_000_000;
    return Math.min(40_000_000,Math.round(base*Math.max(1,Math.min(2.4,state.fps/60))));
  }
  async function findScreenPub(r){
    for(let i=0;i<24;i++){
      try{ for(const p of r.localParticipant.videoTrackPublications.values()){ const src=String(p.source||p.track?.source||'').toLowerCase(); if(p.track&&src.includes('screen')) return p; } }catch{}
      await new Promise(res=>setTimeout(res,70));
    }
    return null;
  }
  function findScreenAudioPub(r){
    try{ for(const p of r.localParticipant.audioTrackPublications.values()){ const src=String(p.source||p.track?.source||'').toLowerCase(); if(src.includes('screen')) return p; } }catch{}
    return null;
  }

  async function startShareV11(){
    const r=room(); if(!r) return toast('انتظر اتصال LiveKit بالمجموعة أولًا.');
    if(state.sharing) return openLiveSharePanel();
    readStartControls();
    const p=presets[state.quality];
    const capture={video:true,audio:state.audio,systemAudio:state.audio?'include':'exclude',surfaceSwitching:'include',selfBrowserSurface:'exclude',contentHint:state.mode==='detail'?'detail':'motion'};
    if(p) capture.resolution={width:p.w,height:p.h,frameRate:state.fps};
    const publish={
      screenShareEncoding:{maxBitrate:Math.max(18_000_000,bitrate()),maxFramerate:144,priority:'high'},
      simulcast:false,degradationPreference:'maintain-framerate',videoCodec:supportedCodec(),
      audioPreset:{maxBitrate:192000,priority:'high'},forceStereo:true,dtx:false,red:true
    };
    const btn=$('screenStartShare'); if(btn){btn.disabled=true;btn.textContent='جاري بدء المشاركة...';}
    try{
      await r.localParticipant.setScreenShareEnabled(true,capture,publish);
      const pub=await findScreenPub(r); if(!pub?.track) throw new Error('لم يبدأ مسار مشاركة الشاشة.');
      state.pub=pub; state.track=pub.track; state.audioPub=findScreenAudioPub(r); state.sharing=true;
      const mt=state.track.mediaStreamTrack;
      try{ mt.contentHint=state.mode==='detail'?'detail':'motion'; }catch{}
      await applyLiveConstraints(false);
      mt?.addEventListener?.('ended',()=>stopShareV11(false),{once:true});
      document.body.classList.add('v11-sharing');
      closeLegacyShareModal();
      ensureLiveSharePanel(); syncLivePanel(); syncFastControls();
      socket?.emit?.('screen-share-state',{active:true,quality:state.quality,fps:state.fps,hdr:state.hdr});
      toast(`بدأت المشاركة — ${qualityText()}`);
    }catch(e){ toast(e?.name==='NotAllowedError'?'تم إلغاء اختيار الشاشة.':(e?.message||'تعذر بدء مشاركة الشاشة.')); }
    finally{ if(btn){btn.disabled=false;btn.textContent='ابدأ المشاركة';} }
  }

  async function applyLiveConstraints(show=true){
    if(!state.track) return;
    const p=presets[state.quality]; const mt=state.track.mediaStreamTrack;
    try{
      const c={frameRate:{ideal:state.fps,max:state.fps}};
      if(p){c.width={ideal:p.w,max:p.w};c.height={ideal:p.h,max:p.h};}
      if(state.hdr){
        const sup=navigator.mediaDevices?.getSupportedConstraints?.()||{};
        if(sup.colorSpace) c.colorSpace={ideal:'rec2020'};
      }
      await mt.applyConstraints?.(c);
    }catch{}
    try{ mt.contentHint=state.mode==='detail'?'detail':'motion'; }catch{}
    try{
      const sender=state.track?.sender||state.pub?.track?.sender;
      if(sender?.getParameters&&sender?.setParameters){
        const params=sender.getParameters(); params.encodings=params.encodings?.length?params.encodings:[{}];
        for(const enc of params.encodings){ enc.maxFramerate=Math.min(144,state.fps); enc.maxBitrate=bitrate(); enc.priority='high'; enc.networkPriority='high'; }
        params.degradationPreference='maintain-framerate'; await sender.setParameters(params);
      }
    }catch{}
    try{
      state.audioPub=findScreenAudioPub(room());
      if(state.audioPub){
        if(state.audio) await state.audioPub.unmute?.(); else await state.audioPub.mute?.();
      }
    }catch{}
    syncLivePanel();
    if(show) toast(`تم تطبيق الإعدادات — ${qualityText()}${state.hdr?' • HDR حسب دعم الجهاز':''}`);
  }

  async function stopShareV11(show=true){
    const r=room();
    try{await r?.localParticipant?.setScreenShareEnabled(false);}catch{}
    state.sharing=false; state.pub=null; state.track=null; state.audioPub=null;
    document.body.classList.remove('v11-sharing');
    $('activeSharePanel')?.classList.add('hidden');
    socket?.emit?.('screen-share-state',{active:false});
    syncFastControls();
    if(show) toast('تم إيقاف مشاركة الشاشة.');
  }

  function closeLegacyShareModal(){ $('screenSettingsModal')?.classList.add('hidden'); }
  function openLiveSharePanel(){ ensureLiveSharePanel(); $('activeSharePanel')?.classList.remove('hidden'); syncLivePanel(); }
  function ensureLiveSharePanel(){
    let panel=$('activeSharePanel'); if(panel) return panel;
    const host=$('roomCallContent')||document.querySelector('.room-call-content')||$('roomPage'); if(!host) return null;
    panel=document.createElement('section'); panel.id='activeSharePanel'; panel.className='active-share-panel hidden';
    panel.innerHTML=`<div class="share-panel-title"><span class="share-live-dot"></span><div><b>إعدادات مشاركة الشاشة</b><small id="liveShareActual">—</small></div></div>
      <label>الجودة<select id="liveShareQuality"><option value="480">480p</option><option value="720">720p</option><option value="1080">1080p</option><option value="1440">1440p</option><option value="2160">4K</option></select></label>
      <label>FPS<select id="liveShareFps"><option>30</option><option>60</option><option>90</option><option>120</option><option>144</option></select></label>
      <label class="share-switch"><input id="liveShareAudio" type="checkbox"><span>صوت المشاركة</span></label>
      <label class="share-switch"><input id="liveShareHdr" type="checkbox"><span>HDR</span></label>
      <button id="liveShareApply" class="share-apply" type="button">${iconTune}<span>تطبيق</span></button>
      <button id="liveShareStop" class="share-stop" type="button">${iconStop}<span>إيقاف المشاركة</span></button>`;
    host.appendChild(panel);
    $('liveShareApply').onclick=()=>{ state.quality=$('liveShareQuality').value;state.fps=Number($('liveShareFps').value||60);state.audio=$('liveShareAudio').checked;state.hdr=$('liveShareHdr').checked;applyLiveConstraints(true); };
    $('liveShareStop').onclick=()=>stopShareV11(true);
    return panel;
  }
  function syncLivePanel(){
    const p=ensureLiveSharePanel(); if(!p) return;
    p.classList.toggle('hidden',!state.sharing);
    if($('liveShareQuality')) $('liveShareQuality').value=state.quality;
    if($('liveShareFps')) $('liveShareFps').value=String(state.fps);
    if($('liveShareAudio')) $('liveShareAudio').checked=state.audio;
    if($('liveShareHdr')) $('liveShareHdr').checked=state.hdr;
    if($('liveShareActual')) $('liveShareActual').textContent=`فعلي: ${qualityText()}${state.hdr?' • HDR حسب الدعم':''}`;
  }

  function syncFastControls(){
    const sharing=state.sharing;
    const screen=$('screenShareBtn');
    if(screen){
      screen.classList.toggle('live',sharing); screen.classList.toggle('share-manage',sharing);
      screen.dataset.label=sharing?'إدارة المشاركة':'مشاركة الشاشة';
      screen.setAttribute('aria-label',screen.dataset.label); screen.title=screen.dataset.label;
    }
    const join=$('joinVoice'),mute=$('muteBtn'),leave=$('leaveVoice');
    let joined=false,isMuted=false; try{joined=Boolean(joinedVoice);isMuted=Boolean(muted);}catch{}
    if(join){join.classList.toggle('hidden',joined);join.dataset.label='انضم للمكالمة';}
    if(mute){mute.classList.toggle('hidden',!joined);mute.dataset.label=isMuted?'فتح المايك':'ميوت';}
    if(leave){leave.classList.toggle('hidden',!joined);leave.dataset.label='إغلاق المايك';}
  }

  function wrapVoiceActions(){
    if(window.__v11VoiceWrapped) return; window.__v11VoiceWrapped=true;
    const join=window.joinVoice, leave=window.leaveVoice;
    if(typeof join==='function') window.joinVoice=async function(...a){ const b=$('joinVoice');b?.classList.add('pending');if(b)b.dataset.label='جاري الانضمام'; try{return await join.apply(this,a);} finally{b?.classList.remove('pending');syncFastControls();} };
    if(typeof leave==='function') window.leaveVoice=async function(...a){ const b=$('leaveVoice');b?.classList.add('pending');if(b)b.dataset.label='جاري الإغلاق'; try{return await leave.apply(this,a);} finally{b?.classList.remove('pending');syncFastControls();} };
    document.querySelector('.room-controls')?.addEventListener('click',()=>{queueMicrotask(syncFastControls);setTimeout(syncFastControls,40);setTimeout(syncFastControls,160);});
  }

  function interceptShareButtons(){
    document.addEventListener('click',e=>{
      const t=e.target.closest?.('#screenShareBtn,#screenStartShare'); if(!t) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if(t.id==='screenShareBtn'){
        if(state.sharing) openLiveSharePanel(); else { restoreStartControls(); $('screenSettingsModal')?.classList.remove('hidden'); }
      }else startShareV11();
    },true);
  }

  function attachViewerFps(video){
    if(!video||video.__v11Fps||!video.requestVideoFrameCallback) return; video.__v11Fps=true;
    let frames=0,last=performance.now();
    const tick=()=>{ frames++; const now=performance.now(); if(now-last>=1000){ const fps=Math.round(frames*1000/(now-last));frames=0;last=now;const q=video.closest('.screen-share-card')?.querySelector('.screen-quality');if(q){const base=q.textContent.replace(/ • مشاهدة \d+ FPS$/,'');q.textContent=`${base} • مشاهدة ${fps} FPS`;}} video.requestVideoFrameCallback(tick); };
    video.requestVideoFrameCallback(tick);
  }
  function monitorScreenCards(){ document.querySelectorAll('.screen-share-card video').forEach(attachViewerFps); }

  function boot(){
    ensureTopNotifications(); ensureHdrOption(); restoreStartControls(); ensureLiveSharePanel(); wrapVoiceActions(); interceptShareButtons(); syncFastControls(); monitorScreenCards();
    const observer=new MutationObserver(()=>{ensureTopNotifications();ensureHdrOption();syncFastControls();monitorScreenCards();syncLivePanel();});
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    document.addEventListener('pointerdown',e=>{const b=e.target.closest?.('.room-controls .control-btn');if(b){b.classList.add('instant-press');requestAnimationFrame(()=>b.classList.remove('instant-press'));}},{passive:true,capture:true});
    setInterval(()=>{ if(state.sharing&&!state.track) stopShareV11(false); syncLivePanel(); syncNotificationVisual(); },1000);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
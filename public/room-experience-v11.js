(() => {
  if (window.__sawalefV11) return;
  window.__sawalefV11 = true;
  const $ = id => document.getElementById(id);
  const lk = window.LivekitClient;
  const state = { sharing:false, pub:null, track:null, audioPub:null, quality:'1080', fps:60, audio:true, hdr:false, mode:'motion', codec:'h264' };
  const network = { target:0, timer:null, lastBytes:0, lastAt:0, label:'تلقائي' };
  const presets = {
    '480':{w:854,h:480,label:'480p'}, '720':{w:1280,h:720,label:'720p'}, '1080':{w:1920,h:1080,label:'1080p'},
    '1440':{w:2560,h:1440,label:'1440p'}, '2160':{w:3840,h:2160,label:'4K'}
  };
  const iconBell='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Z"/><path d="M10 20h4"/></svg>';
  const iconStop='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  const iconTune='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M10 17h10M4 17h2M14 4v6M8 14v6"/></svg>';

  function toast(t){ try{ showToast(t); }catch{} }
  function room(){ return window.SawalefLiveKit?.room || null; }
  function normalizeFps(v){ return Number(v)===30 ? 30 : 60; }
  function hasNotifications(){ return typeof window.Notification!=='undefined' && typeof window.Notification.requestPermission==='function'; }
  function supportedCodec(mode=state.mode){
    try{
      const codecs=RTCRtpSender.getCapabilities?.('video')?.codecs||[];
      const hasH264=codecs.some(c=>/H264/i.test(c.mimeType));
      const hasVP9=codecs.some(c=>/VP9/i.test(c.mimeType));
      if(mode==='motion' && hasH264) return 'h264';
      if(mode==='detail' && hasVP9) return 'vp9';
      if(hasH264) return 'h264';
      if(hasVP9) return 'vp9';
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
  function codecLabel(){ return String(state.codec||'').toUpperCase().replace('H264','H.264'); }

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
  function ensureFpsOptions(){
    const select=$('screenFpsSelect');
    if(select && select.dataset.v12Fps!=='1'){
      const wanted=normalizeFps(select.value||state.fps);
      select.innerHTML='<option value="30">30 FPS</option><option value="60">60 FPS</option>';
      select.value=String(wanted);
      select.dataset.v12Fps='1';
    }
    const note=$('screenCapabilityNote');
    if(note) note.textContent='مشاركة الألعاب تستخدم H.264 عند دعمه. المتاح 30 أو 60 FPS، والجودة والبيتريت يتكيّفان مع الشبكة للحفاظ على السلاسة.';
  }
  function readStartControls(){
    state.quality=$('screenQualitySelect')?.value||state.quality;
    state.fps=normalizeFps($('screenFpsSelect')?.value||state.fps||60);
    state.mode=$('screenModeSelect')?.value||state.mode;
    state.audio=Boolean($('screenAudioCheck')?.checked);
    state.hdr=Boolean($('screenHdrCheck')?.checked);
    try{localStorage.setItem('sawalef_share_v11',JSON.stringify({quality:state.quality,fps:state.fps,audio:state.audio,hdr:state.hdr,mode:state.mode}));}catch{}
  }
  function restoreStartControls(){
    try{ const v=JSON.parse(localStorage.getItem('sawalef_share_v11')||'null'); if(v) Object.assign(state,v,{fps:normalizeFps(v.fps||60)}); }catch{}
    ensureHdrOption(); ensureFpsOptions();
    if($('screenQualitySelect')) $('screenQualitySelect').value=state.quality;
    if($('screenFpsSelect')) $('screenFpsSelect').value=String(state.fps);
    if($('screenModeSelect')) $('screenModeSelect').value=state.mode;
    if($('screenAudioCheck')) $('screenAudioCheck').checked=state.audio;
    if($('screenHdrCheck')) $('screenHdrCheck').checked=state.hdr;
  }

  function bitrateBounds(){
    const q=Number(state.quality)||1080;
    const is60=normalizeFps(state.fps)===60;
    const min30={480:700_000,720:1_200_000,1080:2_000_000,1440:3_500_000,2160:6_000_000};
    const max30={480:2_500_000,720:4_500_000,1080:7_500_000,1440:12_000_000,2160:20_000_000};
    const min60={480:1_000_000,720:1_800_000,1080:3_000_000,1440:5_000_000,2160:8_000_000};
    const max60={480:4_000_000,720:7_000_000,1080:12_000_000,1440:20_000_000,2160:32_000_000};
    return {min:(is60?min60:min30)[q]||2_000_000,max:(is60?max60:max30)[q]||10_000_000};
  }
  function initialBitrate(){ const b=bitrateBounds(); return Math.round(b.min+(b.max-b.min)*0.82); }
  function bitrateText(){ return network.target?`${(network.target/1_000_000).toFixed(network.target<10_000_000?1:0)} Mbps`:'تلقائي'; }
  function currentSender(){ return state.track?.sender||state.pub?.track?.sender||null; }
  async function applySenderLimits(target=network.target||initialBitrate()){
    const sender=currentSender(); if(!sender?.getParameters||!sender?.setParameters) return;
    const b=bitrateBounds(); network.target=Math.max(b.min,Math.min(b.max,Math.round(target)));
    try{
      const params=sender.getParameters(); params.encodings=params.encodings?.length?params.encodings:[{}];
      for(const enc of params.encodings){
        enc.maxFramerate=state.fps;
        enc.maxBitrate=network.target;
        enc.priority='high'; enc.networkPriority='high';
      }
      params.degradationPreference=state.mode==='detail'?'balanced':'maintain-framerate';
      await sender.setParameters(params);
    }catch{}
  }
  function stopAdaptiveMonitor(){
    if(network.timer) clearInterval(network.timer);
    network.timer=null; network.lastBytes=0; network.lastAt=0; network.label='تلقائي';
  }
  async function adaptBitrate(){
    if(!state.sharing) return;
    const sender=currentSender(); if(!sender?.getStats) return;
    try{
      const report=await sender.getStats();
      let out=null, remote=null;
      report.forEach(s=>{
        const kind=String(s.kind||s.mediaType||'').toLowerCase();
        if(s.type==='outbound-rtp' && kind==='video' && !s.isRemote) out=s;
        if(s.type==='remote-inbound-rtp' && kind==='video') remote=s;
      });
      if(!out) return;
      const now=performance.now();
      const bytes=Number(out.bytesSent||0);
      const elapsed=network.lastAt ? Math.max(.25,(now-network.lastAt)/1000) : 0;
      const sending=elapsed && bytes>=network.lastBytes ? ((bytes-network.lastBytes)*8/elapsed) : 0;
      network.lastBytes=bytes; network.lastAt=now;
      const loss=Math.max(0,Number(remote?.fractionLost||0));
      const rtt=Math.max(0,Number(remote?.roundTripTime||0));
      const reason=String(out.qualityLimitationReason||'').toLowerCase();
      const b=bitrateBounds();
      let target=network.target||initialBitrate();
      const severe=reason==='bandwidth' || loss>=0.08 || rtt>=0.45;
      const weak=!severe && (loss>=0.035 || rtt>=0.28);
      const good=!severe && !weak && loss<0.015 && (rtt===0 || rtt<0.18) && reason!=='bandwidth';
      if(severe) target*=0.72;
      else if(weak) target*=0.86;
      else if(good) target+=Math.max(220_000,target*0.10);
      if(sending>0 && sending<target*0.55 && (reason==='bandwidth'||loss>=0.03)) target=Math.min(target,sending*1.15);
      target=Math.max(b.min,Math.min(b.max,target));
      network.label=severe?'شبكة ضعيفة':weak?'شبكة متوسطة':good?'شبكة قوية':'تكيّف تلقائي';
      if(Math.abs(target-network.target)>150_000) await applySenderLimits(target);
      syncLivePanel();
    }catch{}
  }
  function startAdaptiveMonitor(){
    stopAdaptiveMonitor();
    network.target=initialBitrate();
    applySenderLimits(network.target);
    network.timer=setInterval(adaptBitrate,2500);
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
    state.codec=supportedCodec(state.mode);
    network.target=initialBitrate();
    const p=presets[state.quality];
    const capture={video:true,audio:state.audio,systemAudio:state.audio?'include':'exclude',surfaceSwitching:'include',selfBrowserSurface:'exclude',contentHint:state.mode==='detail'?'detail':'motion'};
    if(p) capture.resolution={width:p.w,height:p.h,frameRate:state.fps};
    const publish={
      screenShareEncoding:{maxBitrate:network.target,maxFramerate:state.fps,priority:'high'},
      simulcast:false,degradationPreference:state.mode==='detail'?'balanced':'maintain-framerate',videoCodec:state.codec,
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
      startAdaptiveMonitor();
      mt?.addEventListener?.('ended',()=>stopShareV11(false),{once:true});
      document.body.classList.add('v11-sharing');
      closeLegacyShareModal();
      ensureLiveSharePanel(); syncLivePanel(); syncFastControls();
      socket?.emit?.('screen-share-state',{active:true,quality:state.quality,fps:state.fps,hdr:state.hdr,codec:state.codec});
      toast(`بدأت المشاركة — ${qualityText()} • ${codecLabel()}`);
    }catch(e){ toast(e?.name==='NotAllowedError'?'تم إلغاء اختيار الشاشة.':(e?.message||'تعذر بدء مشاركة الشاشة.')); }
    finally{ if(btn){btn.disabled=false;btn.textContent='ابدأ المشاركة';} }
  }

  async function applyLiveConstraints(show=true){
    if(!state.track) return;
    state.fps=normalizeFps(state.fps);
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
    const b=bitrateBounds();
    if(!network.target) network.target=initialBitrate();
    network.target=Math.max(b.min,Math.min(b.max,network.target));
    await applySenderLimits(network.target);
    try{
      state.audioPub=findScreenAudioPub(room());
      if(state.audioPub){
        if(state.audio) await state.audioPub.unmute?.(); else await state.audioPub.mute?.();
      }
    }catch{}
    try{localStorage.setItem('sawalef_share_v11',JSON.stringify({quality:state.quality,fps:state.fps,audio:state.audio,hdr:state.hdr,mode:state.mode}));}catch{}
    syncLivePanel();
    socket?.emit?.('screen-share-state',{active:true,quality:state.quality,fps:state.fps,hdr:state.hdr,codec:state.codec});
    if(show) toast(`تم تطبيق الإعدادات مباشرة — ${qualityText()} • ${network.label} ${bitrateText()}`);
  }

  async function stopShareV11(show=true){
    const r=room();
    stopAdaptiveMonitor(); network.target=0;
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
      <label>FPS<select id="liveShareFps"><option value="30">30</option><option value="60">60</option></select></label>
      <label class="share-switch"><input id="liveShareAudio" type="checkbox"><span>صوت المشاركة</span></label>
      <label class="share-switch"><input id="liveShareHdr" type="checkbox"><span>HDR</span></label>
      <button id="liveShareApply" class="share-apply" type="button">${iconTune}<span>تطبيق الآن</span></button>
      <button id="liveShareStop" class="share-stop" type="button">${iconStop}<span>إيقاف المشاركة</span></button>`;
    host.appendChild(panel);
    const readLive=()=>{
      state.quality=$('liveShareQuality')?.value||state.quality;
      state.fps=normalizeFps($('liveShareFps')?.value||state.fps);
      state.audio=Boolean($('liveShareAudio')?.checked);
      state.hdr=Boolean($('liveShareHdr')?.checked);
    };
    const autoApply=()=>{ readLive(); applyLiveConstraints(false); };
    $('liveShareQuality').onchange=autoApply;
    $('liveShareFps').onchange=autoApply;
    $('liveShareAudio').onchange=autoApply;
    $('liveShareHdr').onchange=autoApply;
    $('liveShareApply').onclick=()=>{ readLive(); applyLiveConstraints(true); };
    $('liveShareStop').onclick=()=>stopShareV11(true);
    return panel;
  }
  function syncLivePanel(){
    const p=ensureLiveSharePanel(); if(!p) return;
    p.classList.toggle('hidden',!state.sharing);
    if($('liveShareQuality')) $('liveShareQuality').value=state.quality;
    if($('liveShareFps')) $('liveShareFps').value=String(normalizeFps(state.fps));
    if($('liveShareAudio')) $('liveShareAudio').checked=state.audio;
    if($('liveShareHdr')) $('liveShareHdr').checked=state.hdr;
    if($('liveShareActual')) $('liveShareActual').textContent=`فعلي: ${qualityText()} • ${codecLabel()} • ${network.label} ${bitrateText()}${state.hdr?' • HDR حسب الدعم':''}`;
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
    ensureTopNotifications(); ensureHdrOption(); ensureFpsOptions(); restoreStartControls(); ensureLiveSharePanel(); wrapVoiceActions(); interceptShareButtons(); syncFastControls(); monitorScreenCards();
    const observer=new MutationObserver(()=>{ensureTopNotifications();ensureHdrOption();ensureFpsOptions();syncFastControls();monitorScreenCards();syncLivePanel();});
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    document.addEventListener('pointerdown',e=>{const b=e.target.closest?.('.room-controls .control-btn');if(b){b.classList.add('instant-press');requestAnimationFrame(()=>b.classList.remove('instant-press'));}},{passive:true,capture:true});
    setInterval(()=>{ if(state.sharing&&!state.track) stopShareV11(false); syncLivePanel(); syncNotificationVisual(); },1000);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
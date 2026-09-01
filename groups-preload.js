const fs=require('fs');
const crypto=require('crypto');
const socketIo=require('socket.io');
const OriginalServer=socketIo.Server;
const STORE=process.env.GROUPS_FALLBACK_FILE||'/tmp/sawalef-groups.json';
const AUTH_STORE=process.env.AUTH_FALLBACK_FILE||'/tmp/sawalef-auth.json';
const ADMIN_NAME=String(process.env.SAWALEF_ADMIN_USERNAME||'KEMO').trim().toLowerCase();
const LIVEKIT_URL=String(process.env.LIVEKIT_URL||'').trim();
const LIVEKIT_API_KEY=String(process.env.LIVEKIT_API_KEY||'').trim();
const LIVEKIT_API_SECRET=String(process.env.LIVEKIT_API_SECRET||'').trim();
const DATABASE_URL=String(process.env.DATABASE_URL||'').trim();
let AccessToken=null;
let Pool=null;
try{({AccessToken}=require('livekit-server-sdk'));}catch(e){console.warn('LiveKit SDK unavailable:',e.message||e)}
try{({Pool}=require('pg'));}catch(e){console.warn('PostgreSQL SDK unavailable:',e.message||e)}
const db=DATABASE_URL&&Pool?new Pool({connectionString:DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:4}):null;
let groups=[];

function livekitReady(){return Boolean(AccessToken&&LIVEKIT_URL&&LIVEKIT_API_KEY&&LIVEKIT_API_SECRET)}
function isAdminUser(u){
  const key=String(u?.username_key||u?.username||'').trim().toLowerCase();
  return key===ADMIN_NAME||u?.role==='admin';
}
function forceAdmin(u){
  if(u&&isAdminUser(u))u.role='admin';
  return u;
}
function persistFallbackAdmin(){
  try{
    if(!fs.existsSync(AUTH_STORE))return;
    const d=JSON.parse(fs.readFileSync(AUTH_STORE,'utf8'));
    if(!Array.isArray(d.users))return;
    let changed=false;
    for(const u of d.users){
      if(isAdminUser(u)&&u.role!=='admin'){u.role='admin';changed=true;}
    }
    if(changed)fs.writeFileSync(AUTH_STORE,JSON.stringify(d),{mode:0o600});
  }catch(e){console.error('Admin role persistence failed:',e.message||e)}
}

// Keep the configured KEMO account admin without changing its password.
try{
  const pg=require('pg');
  const originalQuery=pg.Pool.prototype.query;
  pg.Pool.prototype.query=function(...args){
    const out=originalQuery.apply(this,args);
    if(!out||typeof out.then!=='function')return out;
    return out.then(result=>{
      if(Array.isArray(result?.rows))result.rows.forEach(forceAdmin);
      return result;
    });
  };
}catch{}

async function load(){
  if(db){
    try{
      const {rows}=await db.query('SELECT id, room_id, name, type, image, created_by, created_at FROM groups ORDER BY created_at DESC');
      groups=rows.map(r=>({id:r.id,roomId:r.room_id,name:r.name,type:r.type,image:r.image||'',createdBy:r.created_by,createdAt:r.created_at}));
      return;
    }catch(e){console.error('Groups database load failed:',e.message||e)}
  }
  try{if(fs.existsSync(STORE)){const d=JSON.parse(fs.readFileSync(STORE,'utf8'));groups=Array.isArray(d.groups)?d.groups:[]}}catch(e){console.error('Groups load failed:',e.message||e)}
}
function saveFallback(){
  if(db)return;
  try{fs.writeFileSync(STORE,JSON.stringify({groups}),{mode:0o600})}catch(e){console.error('Groups save failed:',e.message||e)}
}
async function persistGroup(g){
  if(!db){saveFallback();return;}
  await db.query(
    `INSERT INTO groups(id,room_id,name,type,image,created_by,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET room_id=EXCLUDED.room_id,name=EXCLUDED.name,type=EXCLUDED.type,image=EXCLUDED.image,created_by=EXCLUDED.created_by`,
    [g.id,g.roomId,g.name,g.type,g.image||'',g.createdBy||null,g.createdAt]
  );
}
async function deletePersistedGroup(roomId){
  const room=roomCode(roomId);
  const index=groups.findIndex(g=>g.roomId===room);
  if(index<0)return null;
  const group=groups[index];
  if(db)await db.query('DELETE FROM groups WHERE room_id=$1',[room]);
  groups.splice(index,1);
  if(!db)saveFallback();
  return group;
}
function clean(v,max=80){return String(v??'').replace(/[\u0000-\u001F\u007F]/g,'').trim().slice(0,max)}
function roomCode(v){return clean(v,36).toLowerCase().replace(/[^a-z0-9_-]/g,'')}
function validImage(v){if(!v)return'';return /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(v)&&v.length<=650000?v:''}
function makeCode(){let c;do{c='grp-'+crypto.randomBytes(4).toString('hex')}while(groups.some(g=>g.roomId===c));return c}
function publicUser(u){if(!u)return null;forceAdmin(u);return{id:u.id,name:u.display_name||u.username||'زائر',username:u.username||'',avatar:u.avatar||'',role:u.role||'user'}}
async function makeLiveKitToken(socket,requestedRoom){
  if(!livekitReady())return{ok:false,configured:false,error:'LiveKit غير مربوط بعد.'};
  const u=socket.data.user;
  if(!u?.id)return{ok:false,configured:true,error:'يلزم تسجيل الدخول.'};
  const room=roomCode(requestedRoom||socket.data.roomId||'');
  if(!room||socket.data.roomId!==room)return{ok:false,configured:true,error:'ادخل المجموعة أولًا.'};
  const at=new AccessToken(LIVEKIT_API_KEY,LIVEKIT_API_SECRET,{
    identity:String(u.id),
    name:clean(u.display_name||u.username||'user',60),
    ttl:'2h'
  });
  at.addGrant({roomJoin:true,room,canPublish:true,canSubscribe:true,canPublishData:false});
  return{ok:true,configured:true,url:LIVEKIT_URL,token:await at.toJwt(),room};
}
function install(io){
  const ready=load();
  function siteUsers(){const map=new Map();for(const s of io.sockets.sockets.values()){const u=publicUser(s.data.user);if(u&&!map.has(u.id))map.set(u.id,u)}return [...map.values()]}
  function groupPayload(g){const active=[];const seen=new Set();let voiceCount=0;for(const s of io.sockets.sockets.values()){if(s.data.roomId!==g.roomId)continue;const u=publicUser(s.data.user);if(s.data.voice)voiceCount++;if(u&&!seen.has(u.id)){seen.add(u.id);active.push(u)}}return{id:g.id,roomId:g.roomId,name:g.name,type:g.type,image:g.image||'',createdAt:g.createdAt,activeCount:active.length,voiceCount,activeUsers:active.slice(0,6)}}
  function publicGroups(){return groups.filter(g=>g.type==='public').map(groupPayload).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))}
  function allGroups(){return groups.map(groupPayload).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))}
  function emitPresence(){io.emit('site-presence',{users:siteUsers()})}
  function emitGroups(){io.emit('groups-updated',{groups:publicGroups()})}
  ready.then(()=>emitGroups()).catch(()=>{});
  io.on('connection',socket=>{
    if(isAdminUser(socket.data.user)){
      socket.data.user.role='admin';
      persistFallbackAdmin();
    }
    setTimeout(()=>{emitPresence();socket.emit('groups-updated',{groups:publicGroups()})},0);
    socket.on('groups:list',async(_p,ack=()=>{})=>{try{await ready;ack({ok:true,groups:publicGroups()})}catch(e){ack({ok:false,error:'تعذر تحميل المجموعات.'})}});
    socket.on('site-presence:list',(_p,ack=()=>{})=>ack({ok:true,users:siteUsers()}));
    socket.on('livekit:status',(_p,ack=()=>{})=>ack({ok:true,configured:livekitReady()}));
    socket.on('livekit:token',async(payload={},ack=()=>{})=>{
      try{ack(await makeLiveKitToken(socket,payload.roomId));}
      catch(e){console.error('LiveKit token error:',e.message||e);ack({ok:false,configured:true,error:'تعذر تجهيز اتصال الصوت عالي الجودة.'});}
    });
    socket.on('admin:groups:list',async(_p,ack=()=>{})=>{
      if(!isAdminUser(socket.data.user))return ack({ok:false,error:'صلاحية أدمن مطلوبة.'});
      try{await ready;ack({ok:true,groups:allGroups()})}catch(e){ack({ok:false,error:'تعذر تحميل القروبات.'})}
    });
    socket.on('admin:group:delete',async(payload={},ack=()=>{})=>{
      if(!isAdminUser(socket.data.user))return ack({ok:false,error:'صلاحية أدمن مطلوبة.'});
      try{
        await ready;
        const room=roomCode(payload.roomId);
        if(!room)return ack({ok:false,error:'رمز القروب غير صالح.'});
        const removed=await deletePersistedGroup(room);
        if(!removed)return ack({ok:false,error:'القروب غير موجود.'});
        io.to(room).emit('room-closed',{reason:'تم حذف القروب بواسطة الأدمن.'});
        emitGroups();
        ack({ok:true,roomId:room});
      }catch(e){console.error('Admin group delete failed:',e.message||e);ack({ok:false,error:'تعذر حذف القروب.'})}
    });
    socket.on('group:create',async(payload={},ack=()=>{})=>{
      const u=socket.data.user;if(!u)return ack({ok:false,error:'يلزم تسجيل الدخول.'});
      const name=clean(payload.name,45),type=payload.type==='private'?'private':'public',image=validImage(payload.image);
      if(name.length<2)return ack({ok:false,error:'اكتب اسم المجموعة.'});
      try{
        await ready;
        const g={id:crypto.randomUUID(),roomId:makeCode(),name,type,image,createdBy:u.id,createdAt:new Date().toISOString()};
        groups.unshift(g);
        await persistGroup(g);
        emitGroups();
        ack({ok:true,group:groupPayload(g)});
      }catch(e){
        console.error('Group create failed:',e.message||e);
        ack({ok:false,error:'تعذر حفظ المجموعة.'});
      }
    });
    socket.on('disconnect',()=>setTimeout(()=>{emitPresence();emitGroups()},0));
    socket.on('join-room',()=>setTimeout(emitGroups,80));
    socket.on('leave-room',()=>setTimeout(emitGroups,80));
  });
}
class PatchedServer extends OriginalServer{constructor(...args){super(...args);install(this)}}
socketIo.Server=PatchedServer;

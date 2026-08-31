const fs=require('fs');
const crypto=require('crypto');
const socketIo=require('socket.io');
const OriginalServer=socketIo.Server;
const STORE=process.env.GROUPS_FALLBACK_FILE||'/tmp/sawalef-groups.json';
let groups=[];
function load(){try{if(fs.existsSync(STORE)){const d=JSON.parse(fs.readFileSync(STORE,'utf8'));groups=Array.isArray(d.groups)?d.groups:[]}}catch(e){console.error('Groups load failed:',e.message||e)}}
function save(){try{fs.writeFileSync(STORE,JSON.stringify({groups}),{mode:0o600})}catch(e){console.error('Groups save failed:',e.message||e)}}
function clean(v,max=80){return String(v??'').replace(/[\u0000-\u001F\u007F]/g,'').trim().slice(0,max)}
function validImage(v){if(!v)return'';return /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(v)&&v.length<=650000?v:''}
function makeCode(){let c;do{c='grp-'+crypto.randomBytes(4).toString('hex')}while(groups.some(g=>g.roomId===c));return c}
function publicUser(u){return u?{id:u.id,name:u.display_name||u.username||'زائر',username:u.username||'',avatar:u.avatar||'',role:u.role||'user'}:null}
function install(io){load();
  function siteUsers(){const map=new Map();for(const s of io.sockets.sockets.values()){const u=publicUser(s.data.user);if(u&&!map.has(u.id))map.set(u.id,u)}return [...map.values()]}
  function groupPayload(g){const active=[];const seen=new Set();for(const s of io.sockets.sockets.values()){if(s.data.roomId!==g.roomId)continue;const u=publicUser(s.data.user);if(u&&!seen.has(u.id)){seen.add(u.id);active.push(u)}}return{id:g.id,roomId:g.roomId,name:g.name,type:g.type,image:g.image||'',createdAt:g.createdAt,activeCount:active.length,activeUsers:active.slice(0,6)}}
  function publicGroups(){return groups.filter(g=>g.type==='public').map(groupPayload).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))}
  function emitPresence(){io.emit('site-presence',{users:siteUsers()})}
  function emitGroups(){io.emit('groups-updated',{groups:publicGroups()})}
  io.on('connection',socket=>{
    setTimeout(()=>{emitPresence();socket.emit('groups-updated',{groups:publicGroups()})},0);
    socket.on('groups:list',(_p,ack=()=>{})=>ack({ok:true,groups:publicGroups()}));
    socket.on('site-presence:list',(_p,ack=()=>{})=>ack({ok:true,users:siteUsers()}));
    socket.on('group:create',(payload={},ack=()=>{})=>{
      const u=socket.data.user;if(!u)return ack({ok:false,error:'يلزم تسجيل الدخول.'});
      const name=clean(payload.name,45),type=payload.type==='private'?'private':'public',image=validImage(payload.image);
      if(name.length<2)return ack({ok:false,error:'اكتب اسم المجموعة.'});
      const g={id:crypto.randomUUID(),roomId:makeCode(),name,type,image,createdBy:u.id,createdAt:new Date().toISOString()};groups.push(g);save();emitGroups();ack({ok:true,group:groupPayload(g)});
    });
    socket.on('disconnect',()=>setTimeout(()=>{emitPresence();emitGroups()},0));
    socket.on('join-room',()=>setTimeout(emitGroups,80));
    socket.on('leave-room',()=>setTimeout(emitGroups,80));
  });
}
class PatchedServer extends OriginalServer{constructor(...args){super(...args);install(this)}}
socketIo.Server=PatchedServer;

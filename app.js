const $=id=>document.getElementById(id), audio=$('audio');


// Programação: abertura -> podcast -> identificação -> 2 músicas -> identificação -> podcast -> ...
const playlist=[
 {type:'vinheta',title:'Rádio Trânsito SP — Abertura',artist:'Vinheta da rádio',src:'media/vinheta-abertura-mix.mp3'},
 {type:'podcast',title:'Maníaco do Parque: era psicopata ou doente?',artist:'Histórias que Marcaram',src:'media/maniaco-do-parque.mp4'},
 {type:'vinheta',title:'Rádio Trânsito SP',artist:'Identificação',src:'media/vinheta-identificacao-mix.mp3'},
 {type:'music',title:'Instrumental Retrô 80',artist:'Composição instrumental original • Rádio Trânsito SP',src:'media/instrumental-retro-80.mp3'},
 {type:'music',title:'Instrumental Pop 90',artist:'Composição instrumental original • Rádio Trânsito SP',src:'media/instrumental-pop-90.mp3'},
 {type:'vinheta',title:'Rádio Trânsito SP',artist:'Identificação',src:'media/vinheta-identificacao-mix.mp3'},
 {type:'podcast',title:'Carandiru: do massacre ao indulto',artist:'Histórias que Marcaram',src:'media/carandiru.mp4'},
 {type:'vinheta',title:'Rádio Trânsito SP',artist:'Identificação',src:'media/vinheta-identificacao-mix.mp3'},
 {type:'music',title:'Instrumental Retrô 80',artist:'Composição instrumental original • Rádio Trânsito SP',src:'media/instrumental-retro-80.mp3'},
 {type:'music',title:'Instrumental Pop 90',artist:'Composição instrumental original • Rádio Trânsito SP',src:'media/instrumental-pop-90.mp3'},
 {type:'vinheta',title:'Rádio Trânsito SP',artist:'Identificação',src:'media/vinheta-identificacao-mix.mp3'},
 {type:'podcast',title:'Caso Isabella Nardoni: mídia e perícia',artist:'Histórias que Marcaram',src:'media/isabella-nardoni.mp3'},
 {type:'vinheta',title:'Rádio Trânsito SP',artist:'Identificação',src:'media/vinheta-identificacao-mix.mp3'},
 {type:'music',title:'Instrumental Retrô 80',artist:'Composição instrumental original • Rádio Trânsito SP',src:'media/instrumental-retro-80.mp3'},
 {type:'music',title:'Instrumental Pop 90',artist:'Composição instrumental original • Rádio Trânsito SP',src:'media/instrumental-pop-90.mp3'},
 {type:'vinheta',title:'Rádio Trânsito SP',artist:'Identificação',src:'media/vinheta-identificacao-mix.mp3'},
 {type:'podcast',title:'Chico Picadinho: por que continua preso?',artist:'Histórias que Marcaram',src:'media/chico-picadinho.mp3'},
 {type:'vinheta',title:'Rádio Trânsito SP',artist:'Identificação',src:'media/vinheta-identificacao-mix.mp3'},
 {type:'music',title:'Instrumental Retrô 80',artist:'Composição instrumental original • Rádio Trânsito SP',src:'media/instrumental-retro-80.mp3'},
 {type:'music',title:'Instrumental Pop 90',artist:'Composição instrumental original • Rádio Trânsito SP',src:'media/instrumental-pop-90.mp3'},
];
let idx=0,active=false,items=[],updated=null,interrupted=null;
const mediaCache=new Map();
let preloadToken=0;
async function preloadNext(){
  const upcoming=playlist[(idx+1)%playlist.length];
  if(!upcoming||mediaCache.has(upcoming.src))return;
  const token=++preloadToken;
  try{
    const r=await fetch(upcoming.src,{cache:'force-cache'});
    if(!r.ok)throw Error('HTTP '+r.status);
    const blob=await r.blob();
    if(token<=preloadToken&&!mediaCache.has(upcoming.src))mediaCache.set(upcoming.src,URL.createObjectURL(blob));
  }catch(e){ /* fallback normal do navegador */ }
}
function load(i=idx){idx=(i+playlist.length)%playlist.length;const t=playlist[idx];$('track').textContent=t.title;$('artist').textContent=t.artist;audio.preload='auto';audio.src=mediaCache.get(t.src)||t.src;audio.load();const upcoming=playlist[(idx+1)%playlist.length];preloadNext();$('player-status').textContent=active?'NO AR • programação contínua':'Toque em “Ouvir ao vivo” para entrar na programação.';if($('next-title'))$('next-title').textContent=upcoming.title;if($('next-type'))$('next-type').textContent=upcoming.type==='podcast'?'Podcast • Histórias que Marcaram':upcoming.type==='music'?'Faixa instrumental • programação musical':'Identificação da Rádio Trânsito SP';}
function play(){active=true;audio.play().catch(()=>{$('player-status').textContent='Toque em Ouvir para liberar o áudio neste navegador.';});}
function change(n){load(idx+n);if(active)play();}
$('play').onclick=()=>{if(audio.paused){play()}else{audio.pause();active=false}};
$('next').onclick=()=>change(1);$('prev').onclick=()=>change(-1);
audio.onplay=()=>{$('play').innerHTML='<span>❚❚</span> NO AR';active=true;$('player-status').textContent='NO AR • programação contínua'};
audio.onpause=()=>{$('play').innerHTML='<span>▶</span> OUVIR AO VIVO';if(active===false)$('player-status').textContent='Toque em “Ouvir ao vivo” para entrar na programação.'};
audio.onended=()=>{if(interrupted)return;idx=(idx+1)%playlist.length;load();play()};
let skips=0;audio.onerror=()=>{if(interrupted)return;$('player-status').textContent='Áudio indisponível; avançando.';if(++skips<playlist.length)setTimeout(()=>change(1),250);else{active=false;$('player-status').textContent='Não foi possível carregar a programação. Verifique se a pasta media foi enviada.'}};audio.oncanplay=()=>{skips=0};
const podcastStarts=playlist.map((t,i)=>t.type==='podcast'?i:-1).filter(i=>i>=0);
idx=podcastStarts[Math.floor(Math.random()*podcastStarts.length)];
load(idx);

// Feed de trânsito: pronto para ARTESP/Worker quando a chave for aprovada.
const feed=$('feed');feed.value=localStorage.getItem('radio_feed')||'';
$('save').onclick=()=>{const v=feed.value.trim();if(v&&!/^https:\/\//i.test(v)){$('feed-status').textContent='Use somente HTTPS.';return}localStorage.setItem('radio_feed',v);$('feed-status').textContent=v?'Fonte salva.':'Fonte removida.';refresh()};
function report(){if(!items.length){$('traffic-status').textContent='Aguardando conexão com a fonte oficial';$('traffic').textContent='Nenhum boletim automático de trânsito está conectado no momento.';return}const age=Date.now()-new Date(updated).getTime();if(!Number.isFinite(age)||age<0||age>30*60000){$('traffic-status').textContent='Boletim desatualizado — não transmitir';$('traffic').textContent='A fonte não apresenta atualização recente.';return}$('traffic-status').textContent='Atualizado: '+new Date(updated).toLocaleString('pt-BR');$('traffic').textContent=items.slice(0,6).join(' • ')}
async function refresh(){const url=localStorage.getItem('radio_feed');if(!url){items=[];updated=null;report();return}try{const c=new AbortController(),tm=setTimeout(()=>c.abort(),10000),r=await fetch(url,{cache:'no-store',signal:c.signal});clearTimeout(tm);if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();if(!Array.isArray(d.items)||typeof d.updated_at!=='string')throw Error('JSON inválido');items=d.items.filter(x=>typeof x==='string'&&x.length<350).slice(0,10);updated=d.updated_at;$('feed-status').textContent='Fonte consultada com sucesso.'}catch(e){items=[];updated=null;$('feed-status').textContent='Não foi possível consultar a fonte: '+e.message}report()}
async function trafficBulletin(){if(!items.length){report();return}if(interrupted)return;interrupted={idx,time:audio.currentTime,wasPlaying:!audio.paused};audio.pause();const sting=new Audio('media/vinheta-transito-mix.mp3');sting.onended=()=>{const u=new SpeechSynthesisUtterance(items.slice(0,6).join('. '));u.lang='pt-BR';u.rate=1;u.onend=u.onerror=()=>{const back=new Audio('media/vinheta-retorno-mix.mp3');back.onended=resume;back.play().catch(resume)};speechSynthesis.cancel();speechSynthesis.speak(u)};sting.play().catch(()=>{interrupted=null})}
function resume(){const s=interrupted;interrupted=null;if(!s)return;load(s.idx);audio.addEventListener('loadedmetadata',function once(){audio.removeEventListener('loadedmetadata',once);audio.currentTime=Math.min(s.time,audio.duration||s.time);if(s.wasPlaying)play()})}
$('speak').onclick=trafficBulletin;$('refresh').onclick=refresh;refresh();setInterval(async()=>{await refresh();if(items.length)trafficBulletin()},15*60*1000);


// Hora certa: entra a cada 10 minutos, pausa a programação e depois retoma do mesmo ponto.
let lastTimeSlot='';
function timeText(d=new Date()){
  const h=d.getHours(),m=d.getMinutes();
  if(m===0) return `Rádio Trânsito SP. Agora, ${h} ${h===1?'hora':'horas'}.`;
  return `Rádio Trânsito SP. Agora, ${h} ${h===1?'hora':'horas'} e ${m} minutos.`;
}
function resumeProgram(s){
  interrupted=null;
  if(!s)return;
  load(s.idx);
  audio.addEventListener('loadedmetadata',function once(){
    audio.removeEventListener('loadedmetadata',once);
    audio.currentTime=Math.min(s.time,audio.duration||s.time);
    if(s.wasPlaying)play();
  });
}
function announceTime(){
  if(!active||audio.paused||interrupted)return;
  const s={idx,time:audio.currentTime,wasPlaying:true};
  interrupted=s;
  audio.pause();
  const u=new SpeechSynthesisUtterance(timeText());
  u.lang='pt-BR';u.rate=1;u.pitch=1;
  u.onend=u.onerror=()=>resumeProgram(s);
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
function checkTimeAnnouncement(){
  const d=new Date(),m=d.getMinutes();
  if(m%10!==0)return;
  const slot=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${m}`;
  if(slot===lastTimeSlot)return;
  lastTimeSlot=slot;
  // Se houver boletim de trânsito no mesmo minuto, ele tem prioridade; a hora entra no próximo ciclo.
  if(interrupted)return;
  announceTime();
}
setInterval(checkTimeAnnouncement,5000);

if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});

function fmt(t){if(!Number.isFinite(t))return '--:--';const m=Math.floor(t/60),s=Math.floor(t%60);return m+':'+String(s).padStart(2,'0')}audio.addEventListener('timeupdate',()=>{if($('elapsed'))$('elapsed').textContent=fmt(audio.currentTime);if($('duration'))$('duration').textContent=fmt(audio.duration);if($('progress'))$('progress').style.width=(audio.duration?audio.currentTime/audio.duration*100:0)+'%'});audio.addEventListener('loadedmetadata',()=>{if($('duration'))$('duration').textContent=fmt(audio.duration)});function tick(){if($('clock'))$('clock').textContent=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}tick();setInterval(tick,1000);
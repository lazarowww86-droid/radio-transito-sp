const $=id=>document.getElementById(id);
const mainAudio=$('audio');
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

let idx=0, active=false, items=[], updated=null, interrupted=null, lastTimeSlot='';
let current=mainAudio;
let standby=new Audio();
standby.preload='auto';
current.preload='auto';

function fmt(t){if(!Number.isFinite(t))return '--:--';const m=Math.floor(t/60),s=Math.floor(t%60);return m+':'+String(s).padStart(2,'0')}
function nextIndex(){return (idx+1)%playlist.length}

function updateUI(){
  const t=playlist[idx], n=playlist[nextIndex()];
  $('track').textContent=t.title;
  $('artist').textContent=t.artist;
  if($('next-title'))$('next-title').textContent=n.title;
  if($('next-type'))$('next-type').textContent=n.type==='podcast'?'Podcast • Histórias que Marcaram':n.type==='music'?'Faixa instrumental • programação musical':'Identificação da Rádio Trânsito SP';
  $('player-status').textContent=active?'NO AR • programação contínua':'Toque em “Ouvir ao vivo” para entrar na programação.';
}

function prepareStandby(){
  const n=playlist[nextIndex()];
  standby.src=n.src;
  standby.preload='auto';
  standby.load();
}

function attachPlayerEvents(a){
  a.addEventListener('timeupdate',()=>{
    if(a!==current)return;
    if($('elapsed'))$('elapsed').textContent=fmt(a.currentTime);
    if($('duration'))$('duration').textContent=fmt(a.duration);
    if($('progress'))$('progress').style.width=(a.duration?a.currentTime/a.duration*100:0)+'%';
  });
  a.addEventListener('loadedmetadata',()=>{if(a===current&&$('duration'))$('duration').textContent=fmt(a.duration)});
  a.addEventListener('play',()=>{if(a!==current)return;$('play').innerHTML='<span>❚❚</span> NO AR';active=true;$('player-status').textContent='NO AR • programação contínua'});
  a.addEventListener('pause',()=>{if(a!==current)return;if(!active){$('play').innerHTML='<span>▶</span> OUVIR AO VIVO';$('player-status').textContent='Toque em “Ouvir ao vivo” para entrar na programação.'}});
  a.addEventListener('ended',()=>{if(a!==current||interrupted)return;swapToNext()});
  a.addEventListener('error',()=>{if(a!==current||interrupted)return;$('player-status').textContent='Áudio indisponível; avançando.';swapToNext()});
}
attachPlayerEvents(current);
attachPlayerEvents(standby);

function loadCurrent(i){
  idx=(i+playlist.length)%playlist.length;
  current.src=playlist[idx].src;
  current.preload='auto';
  current.load();
  updateUI();
  prepareStandby();
}

async function playCurrent(){
  active=true;
  try{await current.play()}catch(e){$('player-status').textContent='Toque em “Ouvir ao vivo” para liberar o áudio neste navegador.'}
}

function swapToNext(){
  const old=current;
  current=standby;
  standby=old;
  idx=nextIndex();
  updateUI();

  // O próximo já estava carregando no segundo player: começa imediatamente.
  if(active) current.play().catch(()=>{$('player-status').textContent='Carregando próximo áudio…';});
  standby.pause();
  standby.removeAttribute('src');
  standby.load();
  prepareStandby();
}

function change(n){
  current.pause();
  active=true;
  loadCurrent(idx+n);
  playCurrent();
}

$('play').onclick=()=>{
  if(current.paused){playCurrent()}
  else{active=false;current.pause()}
};
$('next').onclick=()=>change(1);
$('prev').onclick=()=>change(-1);

// Começa aleatoriamente em um podcast.
const podcastStarts=playlist.map((t,i)=>t.type==='podcast'?i:-1).filter(i=>i>=0);
idx=podcastStarts[Math.floor(Math.random()*podcastStarts.length)];
loadCurrent(idx);

// Feed de trânsito preservado.
const feed=$('feed');
feed.value=localStorage.getItem('radio_feed')||'';
$('save').onclick=()=>{const v=feed.value.trim();if(v&&!/^https:\/\//i.test(v)){$('feed-status').textContent='Use somente HTTPS.';return}localStorage.setItem('radio_feed',v);$('feed-status').textContent=v?'Fonte salva.':'Fonte removida.';refresh()};

function report(){
  if(!items.length){$('traffic-status').textContent='Aguardando conexão com a fonte oficial';$('traffic').textContent='Nenhum boletim automático de trânsito está conectado no momento.';return}
  const age=Date.now()-new Date(updated).getTime();
  if(!Number.isFinite(age)||age<0||age>30*60000){$('traffic-status').textContent='Boletim desatualizado — não transmitir';$('traffic').textContent='A fonte não apresenta atualização recente.';return}
  $('traffic-status').textContent='Atualizado: '+new Date(updated).toLocaleString('pt-BR');
  $('traffic').textContent=items.slice(0,6).join(' • ');
}
async function refresh(){
  const url=localStorage.getItem('radio_feed');
  if(!url){items=[];updated=null;report();return}
  try{
    const c=new AbortController(),tm=setTimeout(()=>c.abort(),10000),r=await fetch(url,{cache:'no-store',signal:c.signal});
    clearTimeout(tm);if(!r.ok)throw Error('HTTP '+r.status);
    const d=await r.json();if(!Array.isArray(d.items)||typeof d.updated_at!=='string')throw Error('JSON inválido');
    items=d.items.filter(x=>typeof x==='string'&&x.length<350).slice(0,10);updated=d.updated_at;$('feed-status').textContent='Fonte consultada com sucesso.';
  }catch(e){items=[];updated=null;$('feed-status').textContent='Não foi possível consultar a fonte: '+e.message}
  report();
}

function resumeSaved(s){
  interrupted=null;
  if(!s)return;
  if(s.wasPlaying&&active) current.play().catch(()=>{});
}

async function trafficBulletin(){
  if(!items.length||interrupted)return;
  interrupted={wasPlaying:!current.paused};
  current.pause();
  const sting=new Audio('media/vinheta-transito-mix.mp3');
  const speak=()=>{
    const u=new SpeechSynthesisUtterance(items.slice(0,6).join('. '));u.lang='pt-BR';u.rate=1;
    u.onend=u.onerror=()=>{
      const back=new Audio('media/vinheta-retorno-mix.mp3');
      back.onended=()=>resumeSaved(interrupted);
      back.play().catch(()=>resumeSaved(interrupted));
    };
    speechSynthesis.cancel();speechSynthesis.speak(u);
  };
  sting.onended=speak;sting.play().catch(speak);
}
$('speak').onclick=trafficBulletin;
$('refresh').onclick=refresh;
refresh();
setInterval(async()=>{await refresh();if(items.length)trafficBulletin()},15*60*1000);

// Hora certa: independente do trânsito e sem recarregar o podcast.
function timeText(d=new Date()){
  const h=d.getHours(),m=d.getMinutes();
  if(m===0)return `Rádio Trânsito SP. Agora, ${h} ${h===1?'hora':'horas'}.`;
  return `Rádio Trânsito SP. Agora, ${h} ${h===1?'hora':'horas'} e ${m} minutos.`;
}
function announceTime(){
  if(!active||current.paused||interrupted)return;
  const saved={wasPlaying:true};
  interrupted=saved;
  current.pause();
  const u=new SpeechSynthesisUtterance(timeText());
  u.lang='pt-BR';u.rate=1;u.pitch=1;
  u.onend=u.onerror=()=>resumeSaved(saved);
  speechSynthesis.cancel();speechSynthesis.speak(u);
}
function checkTimeAnnouncement(){
  const d=new Date(),m=d.getMinutes();
  if(m%10!==0||d.getSeconds()>20)return;
  const slot=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${m}`;
  if(slot===lastTimeSlot)return;
  if(interrupted)return;
  lastTimeSlot=slot;
  announceTime();
}
setInterval(checkTimeAnnouncement,1000);

if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
function tick(){if($('clock'))$('clock').textContent=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,1000);

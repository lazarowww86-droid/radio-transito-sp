const $=id=>document.getElementById(id);
const WORKER_URL='';
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

const audio=$('audio');
audio.preload='auto';

let idx=0;
let active=false;
let started=false;
let interrupting=false;
let pendingInterrupts=[];
let nextBuffer=null;
let nextBufferIndex=null;
let trafficItems=[];
let trafficUpdated=null;
let lastClockKey='';
let lastTrafficKey='';

function fmt(sec){
  if(!Number.isFinite(sec)) return '0:00';
  const m=Math.floor(sec/60), s=Math.floor(sec%60);
  return `${m}:${String(s).padStart(2,'0')}`;
}

function upcomingIndex(){ return (idx+1)%playlist.length; }

function buildNextBuffer(){
  const ni=upcomingIndex();
  const t=playlist[ni];
  const b=new Audio();
  b.preload='auto';
  b.src=t.src;
  b.load();
  nextBuffer=b;
  nextBufferIndex=ni;
}

function updateNow(){
  const t=playlist[idx];
  $('track').textContent=t.title;
  $('artist').textContent=t.artist;
  $('player-status').textContent=active?'NO AR • programação contínua':'Toque em “Ouvir ao vivo” para entrar na programação.';
  const upcoming=playlist[upcomingIndex()];
  if($('next-title')) $('next-title').textContent=upcoming.title;
  if($('next-type')) $('next-type').textContent=
    upcoming.type==='podcast'?'Podcast • Histórias que Marcaram':
    upcoming.type==='music'?'Faixa instrumental • programação musical':
    'Identificação da Rádio Trânsito SP';
}

function setTrack(i, autoplay=false){
  idx=(i+playlist.length)%playlist.length;
  const t=playlist[idx];
  audio.src=t.src;
  audio.preload='auto';
  audio.load();
  updateNow();
  buildNextBuffer();
  if(autoplay && active) audio.play().catch(()=>{});
}

function advance(){
  const ni=upcomingIndex();
  idx=ni;
  const t=playlist[idx];

  // Reuse the already-buffered media URL immediately. The browser media cache
  // normally serves it without a second network wait.
  if(nextBuffer && nextBufferIndex===idx){
    audio.src=nextBuffer.src;
  } else {
    audio.src=t.src;
  }
  audio.preload='auto';
  audio.load();
  updateNow();

  const p=audio.play();
  if(p) p.catch(()=>{});
  buildNextBuffer();
}

audio.addEventListener('ended',()=>{
  if(!interrupting) advance();
});
audio.addEventListener('timeupdate',()=>{
  if(Number.isFinite(audio.duration) && audio.duration>0){
    $('progress').style.width=`${Math.min(100,(audio.currentTime/audio.duration)*100)}%`;
    $('elapsed').textContent=fmt(audio.currentTime);
    $('duration').textContent=fmt(audio.duration);
  }
});
audio.addEventListener('waiting',()=>{ if(active&&!interrupting) $('player-status').textContent='NO AR • carregando próximo áudio…'; });
audio.addEventListener('playing',()=>{ if(active&&!interrupting) $('player-status').textContent='NO AR • programação contínua'; });

function pickRandomPodcast(){
  const podcastIndexes=playlist.map((t,i)=>t.type==='podcast'?i:null).filter(i=>i!==null);
  return podcastIndexes[Math.floor(Math.random()*podcastIndexes.length)] ?? 0;
}

$('listen').addEventListener('click',async()=>{
  if(!started){
    started=true;
    active=true;
    setTrack(pickRandomPodcast(),false);
    try{ await audio.play(); }catch(e){}
    $('listen').textContent='🔊 NO AR';
    return;
  }
  if(audio.paused){
    active=true;
    await audio.play().catch(()=>{});
    $('listen').textContent='🔊 NO AR';
  }else{
    active=false;
    audio.pause();
    $('listen').textContent='▶ CONTINUAR';
    $('player-status').textContent='Programação pausada';
  }
});

function ptHourText(d){
  const h=d.getHours(), min=d.getMinutes();
  const hs = h===0 ? 'meia-noite' : h===1 ? 'uma hora' : h===12 ? 'meio-dia' : `${h} horas`;
  if(min===0) return hs;
  return `${hs} e ${min} minutos`;
}

function speakText(text){
  return new Promise(resolve=>{
    if(!('speechSynthesis' in window)){ resolve(); return; }
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    u.lang='pt-BR';
    u.rate=0.96;
    u.pitch=1;
    u.onend=resolve;
    u.onerror=resolve;
    speechSynthesis.speak(u);
  });
}

async function runInterrupt(text,label){
  if(!active || interrupting){
    pendingInterrupts.push({text,label});
    return;
  }
  interrupting=true;
  const wasPaused=audio.paused;
  audio.pause();
  $('player-status').textContent=label;
  await speakText(text);
  if(active && !wasPaused){
    await audio.play().catch(()=>{});
  }
  interrupting=false;
  $('player-status').textContent=active?'NO AR • programação contínua':'Programação pausada';
  if(pendingInterrupts.length){
    const n=pendingInterrupts.shift();
    setTimeout(()=>runInterrupt(n.text,n.label),250);
  }
}

function clockTick(){
  if(!active) return;
  const now=new Date();
  // Fires once in the first 20 seconds of every 10-minute mark.
  if(now.getMinutes()%10===0 && now.getSeconds()<20){
    const key=`${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if(key!==lastClockKey){
      lastClockKey=key;
      runInterrupt(`Rádio Trânsito SP. Agora, ${ptHourText(now)}.`,'🕒 HORA CERTA');
    }
  }
}
setInterval(clockTick,1000);

async function loadTraffic(){
  if(!WORKER_URL) return;
  try{
    const r=await fetch(WORKER_URL,{cache:'no-store'});
    if(!r.ok) return;
    const data=await r.json();
    trafficItems=Array.isArray(data)?data:(data.items||data.ocorrencias||[]);
    trafficUpdated=new Date();
    if($('traffic-count')) $('traffic-count').textContent=trafficItems.length;
    if($('traffic-update')) $('traffic-update').textContent='Atualizado agora';
  }catch(e){}
}

function trafficSummary(){
  if(!trafficItems.length) return '';
  const first=trafficItems.slice(0,3).map(x=>{
    const road=x.rodovia||x.road||x.via||'rodovia';
    const desc=x.descricao||x.description||x.tipo||x.evento||'ocorrência';
    return `${road}: ${desc}`;
  }).join('. ');
  return `Informação de trânsito na Rádio Trânsito SP. ${first}.`;
}

function trafficTick(){
  if(!active) return;
  const now=new Date();
  if(now.getMinutes()%15===0 && now.getSeconds()<20){
    const key=`${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if(key!==lastTrafficKey){
      lastTrafficKey=key;
      const text=trafficSummary();
      if(text) runInterrupt(text,'🚦 BOLETIM DE TRÂNSITO');
    }
  }
}
setInterval(trafficTick,1000);
setInterval(loadTraffic,5*60*1000);
loadTraffic();

setInterval(()=>{
  const d=new Date();
  if($('clock')) $('clock').textContent=d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
},1000);

setTrack(0,false);

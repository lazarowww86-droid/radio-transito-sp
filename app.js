const $=id=>document.getElementById(id), audio=$('audio');
const remote=file=>'https://commons.wikimedia.org/wiki/Special:Redirect/file/'+encodeURIComponent(file);

// Programação: abertura -> podcast -> identificação -> 2 músicas -> identificação -> podcast -> ...
const playlist=[
 {type:'vinheta',title:'Rádio Trânsito SP — Abertura',artist:'Vinheta da rádio',src:'media/vinheta-abertura.mp4'},
 {type:'podcast',title:'Maníaco do Parque: era psicopata ou doente?',artist:'Histórias que Marcaram',src:'media/maniaco-do-parque.mp4'},
 {type:'vinheta',title:'Rádio Trânsito SP',artist:'Identificação',src:'media/vinheta-identificacao.mp4'},
 {type:'music',title:'GameBGM',artist:'Yuyuyunoyuusuke1 • CC0',src:remote('GameBGM.ogg')},
 {type:'music',title:'Thoughtness',artist:'Kian Moretz • CC0',src:remote('Thoughtness.ogg')},
 {type:'vinheta',title:'Rádio Trânsito SP',artist:'Identificação',src:'media/vinheta-identificacao.mp4'},
 {type:'podcast',title:'Carandiru: do massacre ao indulto',artist:'Histórias que Marcaram',src:'media/carandiru.mp4'},
 {type:'vinheta',title:'Rádio Trânsito SP',artist:'Identificação',src:'media/vinheta-identificacao.mp4'},
 {type:'music',title:'GameBGM',artist:'Yuyuyunoyuusuke1 • CC0',src:remote('GameBGM.ogg')},
 {type:'music',title:'Thoughtness',artist:'Kian Moretz • CC0',src:remote('Thoughtness.ogg')},
];
let idx=0,active=false,items=[],updated=null,interrupted=null;
function load(i=idx){idx=(i+playlist.length)%playlist.length;const t=playlist[idx];$('track').textContent=t.title;$('artist').textContent=t.artist;audio.src=t.src;audio.load();$('player-status').textContent=t.type==='podcast'?'Podcast':'Programação da Rádio Trânsito SP';}
function play(){active=true;audio.play().catch(()=>{$('player-status').textContent='Toque em Ouvir para liberar o áudio neste navegador.';});}
function change(n){load(idx+n);if(active)play();}
$('play').onclick=()=>{if(audio.paused){play()}else{audio.pause();active=false}};
$('next').onclick=()=>change(1);$('prev').onclick=()=>change(-1);
audio.onplay=()=>{$('play').textContent='⏸ Pausar';active=true};
audio.onpause=()=>{$('play').textContent='▶ Ouvir'};
audio.onended=()=>{idx=(idx+1)%playlist.length;load();play()};
audio.onerror=()=>{$('player-status').textContent='Não foi possível carregar este áudio. Pulando para o próximo.';setTimeout(()=>change(1),1200)};
load();

// Feed de trânsito: pronto para ARTESP/Worker quando a chave for aprovada.
const feed=$('feed');feed.value=localStorage.getItem('radio_feed')||'';
$('save').onclick=()=>{const v=feed.value.trim();if(v&&!/^https:\/\//i.test(v)){$('feed-status').textContent='Use somente HTTPS.';return}localStorage.setItem('radio_feed',v);$('feed-status').textContent=v?'Fonte salva.':'Fonte removida.';refresh()};
function report(){if(!items.length){$('traffic-status').textContent='Aguardando conexão com a fonte oficial';$('traffic').textContent='Nenhum boletim automático de trânsito está conectado no momento.';return}const age=Date.now()-new Date(updated).getTime();if(!Number.isFinite(age)||age<0||age>30*60000){$('traffic-status').textContent='Boletim desatualizado — não transmitir';$('traffic').textContent='A fonte não apresenta atualização recente.';return}$('traffic-status').textContent='Atualizado: '+new Date(updated).toLocaleString('pt-BR');$('traffic').textContent=items.slice(0,6).join(' • ')}
async function refresh(){const url=localStorage.getItem('radio_feed');if(!url){items=[];updated=null;report();return}try{const c=new AbortController(),tm=setTimeout(()=>c.abort(),10000),r=await fetch(url,{cache:'no-store',signal:c.signal});clearTimeout(tm);if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();if(!Array.isArray(d.items)||typeof d.updated_at!=='string')throw Error('JSON inválido');items=d.items.filter(x=>typeof x==='string'&&x.length<350).slice(0,10);updated=d.updated_at;$('feed-status').textContent='Fonte consultada com sucesso.'}catch(e){items=[];updated=null;$('feed-status').textContent='Não foi possível consultar a fonte: '+e.message}report()}
async function trafficBulletin(){if(!items.length){report();return}if(interrupted)return;interrupted={idx,time:audio.currentTime,wasPlaying:!audio.paused};audio.pause();const sting=new Audio('media/vinheta-transito.mp4');sting.onended=()=>{const u=new SpeechSynthesisUtterance(items.slice(0,6).join('. '));u.lang='pt-BR';u.rate=1;u.onend=u.onerror=()=>{const back=new Audio('media/vinheta-retorno.mp4');back.onended=resume;back.play().catch(resume)};speechSynthesis.cancel();speechSynthesis.speak(u)};sting.play().catch(()=>{interrupted=null})}
function resume(){const s=interrupted;interrupted=null;if(!s)return;load(s.idx);audio.addEventListener('loadedmetadata',function once(){audio.removeEventListener('loadedmetadata',once);audio.currentTime=Math.min(s.time,audio.duration||s.time);if(s.wasPlaying)play()})}
$('speak').onclick=trafficBulletin;$('refresh').onclick=refresh;refresh();setInterval(async()=>{await refresh();if(items.length)trafficBulletin()},15*60*1000);
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});

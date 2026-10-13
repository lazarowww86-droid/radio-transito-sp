(() => {
'use strict';
const $ = id => document.getElementById(id);

// Duas músicas entre os podcasts; o rodízio percorre todas as faixas do CD.
const podcasts = [
 {type:'podcast',title:'Maníaco do Parque: era psicopata ou doente?',artist:'Histórias que Marcaram',src:'media/maniaco-do-parque.mp3'},
 {type:'podcast',title:'Carandiru: do massacre ao indulto',artist:'Histórias que Marcaram',src:'media/carandiru.mp3'},
 {type:'podcast',title:'Caso Isabella Nardoni: mídia e perícia',artist:'Histórias que Marcaram',src:'media/isabella-nardoni.mp3'},
 {type:'podcast',title:'Chico Picadinho: por que continua preso?',artist:'Histórias que Marcaram',src:'media/chico-picadinho.mp3'}
];
const musicTracks = Array.from({ length: 20 }, (_, index) => {
 const number = index + 2;
 return {type:'music',title:`Faixa ${number}`,artist:'Seleção musical • Rádio Trânsito SP',src:`media/musica-faixa-${String(number).padStart(2, '0')}.mp3`};
});
const identification = {type:'vinheta',title:'Rádio Trânsito SP',artist:'Identificação',src:'media/vinheta-identificacao-mix.mp3'};
const playlist = [{type:'vinheta',title:'Rádio Trânsito SP — Abertura',artist:'Vinheta da rádio',src:'media/vinheta-abertura-mix.mp3'}];
let blocks = podcasts.length;
while (blocks * 2 % musicTracks.length !== 0) blocks += podcasts.length;
for (let block = 0; block < blocks; block++) {
 playlist.push(podcasts[block % podcasts.length], identification,
  musicTracks[block * 2 % musicTracks.length], musicTracks[(block * 2 + 1) % musicTracks.length]);
 if (block < blocks - 1) playlist.push(identification);
}

// O estado do botão representa a intenção do ouvinte, inclusive durante avisos.
const BUILD = '20261013-r2-light';
let current = $('audio'), standby = $('audio-next');
const bulletinAudio = $('bulletin-audio');
let idx = 0, wanted = false, announcement = null, playSequence = 0;
let pendingPlay = false, singleDeck = false, unlocked = false;
let failureTimer = null, lastProgress = Date.now(), lastPosition = -1;
const failedSources = new Set();
const mediaCache = new Map(), preloads = new Map();
const mediaURL = src => new URL(`${src}?v=${BUILD}`, document.baseURI).href;
const wrap = i => (i + playlist.length) % playlist.length;
const status = message => { $('player-status').textContent = message; };

function controls() {
  const listening = wanted || announcement !== null;
  $('play').innerHTML = listening ? '<span aria-hidden="true">❚❚</span> NO AR' : '<span aria-hidden="true">▶</span> OUVIR AO VIVO';
  $('play').setAttribute('aria-label', listening ? 'Pausar a rádio' : 'Ouvir a rádio');
  $('play').setAttribute('aria-pressed', String(listening));
  document.body.classList.toggle('is-playing', listening);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = listening ? 'playing' : 'paused';
}

function fmt(t) {
  if (!Number.isFinite(t) || t < 0) return '--:--';
  return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
}

function progress() {
  const duration = current.duration, time = current.currentTime || 0;
  $('elapsed').textContent = fmt(time);
  $('duration').textContent = fmt(duration);
  $('progress').style.width = (Number.isFinite(duration) && duration > 0 ? Math.min(100, time / duration * 100) : 0) + '%';
}

function trackInfo() {
  const track = playlist[idx], next = playlist[wrap(idx + 1)];
  $('track').textContent = track.title;
  $('artist').textContent = track.artist;
  $('next-title').textContent = next.title;
  $('next-type').textContent = next.type === 'podcast' ? 'Podcast • Histórias que Marcaram' : next.type === 'music' ? 'Música • seleção musical' : 'Identificação da Rádio Trânsito SP';
  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: 'Rádio Trânsito SP' });
  }
  progress();
}

function prepare(element, index, force = false) {
  const src = playlist[index].src;
  element.dataset.index = String(index);
  if (!force && element.dataset.source === src && !element.error) {
    if (element.ended) element.currentTime = 0;
    return;
  }
  element.dataset.source = src;
  element.preload = 'auto';
  element.src = mediaCache.get(src) || mediaURL(src);
  element.load();
}

// Dois elementos reutilizados: a próxima faixa já está carregada antes da troca.
function preloadFollowing() {
  prepare(standby, wrap(idx + 1));
  for (const distance of [1, 2]) warmMedia(playlist[wrap(idx + distance)].src);
}

function warmMedia(src) {
  if (mediaCache.has(src) || preloads.has(src)) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  const task = fetch(mediaURL(src), { cache: 'force-cache', signal: controller.signal })
    .then(response => {
      if (!response.ok || response.status === 206) throw new Error('Áudio incompleto');
      return response.blob();
    })
    .then(blob => {
      if (!blob.size) return;
      mediaCache.set(src, URL.createObjectURL(blob));
      // Não recarrega um elemento que já esteja pronto ou em reprodução.
      if (standby.dataset.source === src && standby.paused && standby.readyState < 3) {
        prepare(standby, Number(standby.dataset.index), true);
      }
    })
    .catch(() => {}) // A reprodução direta continua disponível se o pré-carregamento falhar.
    .finally(() => { clearTimeout(timeout); preloads.delete(src); });
  preloads.set(src, task);
}

function unlockAuxiliaryAudio() {
  if (unlocked) return;
  unlocked = true;
  // Safari concede permissão por elemento. Estes elementos são liberados no clique.
  for (const element of [standby, bulletinAudio]) {
    element.muted = true;
    const attempt = element.play();
    if (attempt) attempt.then(() => {
      if (element !== current && !(element === bulletinAudio && announcement)) {
        element.pause();
        element.currentTime = 0;
      }
      element.muted = false;
    }).catch(() => { element.muted = false; });
  }
}

function playCurrent(fallbackElement = null) {
  if (!wanted || announcement) return;
  if (current.error) prepare(current, idx, true);
  const element = current, sequence = ++playSequence;
  pendingPlay = true;
  lastProgress = Date.now();
  lastPosition = element.currentTime;
  controls();
  status('Carregando o áudio…');
  // play() é chamado diretamente no clique, sem esperar fetch ou metadados.
  const attempt = element.play();
  Promise.resolve(attempt).then(() => {
    if (sequence !== playSequence || element !== current || !wanted || announcement) return;
    pendingPlay = false;
    failedSources.clear();
    status('NO AR • programação contínua');
  }).catch(error => {
    if (sequence !== playSequence || element !== current || !wanted || announcement) return;
    pendingPlay = false;
    if (error.name === 'NotAllowedError') {
      if (fallbackElement && fallbackElement !== current) {
        // Navegadores que bloqueiam o segundo elemento reutilizam o já autorizado.
        singleDeck = true;
        activate(idx, fallbackElement);
        return;
      }
      wanted = false;
      controls();
      status('Toque em Ouvir para permitir o áudio neste navegador.');
    } else if (error.name === 'AbortError') {
      wanted = false;
      controls();
      status('Reprodução interrompida. Toque em Ouvir para retomar.');
    } else {
      failTrack(element);
    }
  });
}

function activate(index, reuse = null) {
  clearTimeout(failureTimer);
  failureTimer = null;
  cancelAnnouncement();
  ++playSequence;
  pendingPlay = false;
  const previous = current, target = reuse || (singleDeck ? current : standby);
  idx = wrap(index);
  if (target !== previous) {
    current = target;
    standby = previous;
    previous.pause();
  }
  current.muted = false;
  for (const element of [current, standby]) element.dataset.current = String(element === current);
  prepare(current, idx);
  current.currentTime = 0;
  lastPosition = -1;
  lastProgress = Date.now();
  trackInfo();
  if (wanted) playCurrent(target !== previous ? previous : null);
  else { controls(); status('Programação pausada. Toque em Ouvir para continuar.'); }
  preloadFollowing();
}

function failTrack(element) {
  if (element !== current || announcement || failureTimer !== null) return;
  failedSources.add(playlist[idx].src);
  let next = wrap(idx + 1), searched = 0;
  while (failedSources.has(playlist[next].src) && ++searched < playlist.length) next = wrap(next + 1);
  if (searched >= playlist.length) {
    wanted = false;
    ++playSequence;
    pendingPlay = false;
    current.pause();
    controls();
    status('Áudios indisponíveis. Confira a conexão e a pasta media; toque em Ouvir para tentar novamente.');
    return;
  }
  status('Faixa indisponível. Avançando para o próximo áudio…');
  failureTimer = setTimeout(() => { failureTimer = null; activate(next); }, 0);
}

function pauseProgram() {
  wanted = false;
  ++playSequence;
  pendingPlay = false;
  clearTimeout(failureTimer);
  failureTimer = null;
  cancelAnnouncement();
  current.pause();
  controls();
  status('Programação pausada. Toque em Ouvir para continuar.');
}

function startProgram() {
  failedSources.clear();
  wanted = true;
  unlockAuxiliaryAudio();
  if (current.ended) { activate(idx + 1); return; }
  playCurrent();
}

$('play').addEventListener('click', () => {
  if (wanted || announcement) pauseProgram();
  else startProgram();
});
$('next').addEventListener('click', () => activate(idx + 1));
$('prev').addEventListener('click', () => activate(idx - 1));

for (const element of [current, standby]) {
  element.addEventListener('ended', () => {
    if (element === current && wanted && !announcement) activate(idx + 1);
  });
  element.addEventListener('error', () => failTrack(element));
  element.addEventListener('playing', () => {
    if (element !== current || !wanted || announcement) return;
    lastProgress = Date.now();
    failedSources.clear();
    status('NO AR • programação contínua');
    controls();
  });
  element.addEventListener('pause', () => {
    if (element === current && element.paused && wanted && !announcement && !pendingPlay && !element.ended && element.readyState >= 2) {
      wanted = false; // Pausa solicitada pelo sistema ou por controles externos.
      controls();
      status('Programação pausada. Toque em Ouvir para continuar.');
    }
  });
  element.addEventListener('waiting', () => {
    if (element === current && wanted && !announcement) status('Carregando o áudio…');
  });
  element.addEventListener('loadedmetadata', () => { if (element === current) progress(); });
  element.addEventListener('timeupdate', () => {
    if (element !== current) return;
    if (element.currentTime !== lastPosition) {
      lastPosition = element.currentTime;
      lastProgress = Date.now();
    }
    progress();
  });
}

// Um download defeituoso não deixa a rádio presa indefinidamente.
setInterval(() => {
  if (wanted && !announcement && Date.now() - lastProgress > 12000) failTrack(current);
}, 1000);

// Avisos pausam o elemento atual e o retomam sem recarregar o podcast.
function canSpeak() {
  return 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

function beginAnnouncement(kind) {
  if (announcement || !canSpeak()) return null;
  const job = { kind, cancelled: false, cleanups: new Set() };
  announcement = job;
  ++playSequence;
  pendingPlay = false;
  current.pause();
  controls();
  status(kind === 'time' ? 'NO AR • hora certa' : kind === 'weather' ? 'NO AR • previsão do tempo' : 'NO AR • boletim de trânsito');
  return job;
}

function cancelAnnouncement() {
  const job = announcement;
  if (!job) return;
  announcement = null;
  job.cancelled = true;
  for (const cleanup of [...job.cleanups]) cleanup();
  bulletinAudio.pause();
  if (canSpeak()) window.speechSynthesis.cancel();
}

function finishAnnouncement(job) {
  if (announcement !== job || job.cancelled) return;
  announcement = null;
  for (const cleanup of [...job.cleanups]) cleanup();
  bulletinAudio.pause();
  if (wanted) {
    if (current.ended) activate(idx + 1);
    else playCurrent();
  } else {
    controls();
    status('Programação pausada. Toque em Ouvir para continuar.');
  }
}

function playSting(src, job) {
  if (job.cancelled || announcement !== job) return Promise.resolve(false);
  return new Promise(resolve => {
    let settled = false, timer;
    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      bulletinAudio.onended = bulletinAudio.onerror = bulletinAudio.onplaying = null;
      bulletinAudio.pause();
      job.cleanups.delete(cancel);
      resolve(ok);
    };
    const cancel = () => finish(false);
    job.cleanups.add(cancel);
    bulletinAudio.onended = () => finish(true);
    bulletinAudio.onerror = cancel;
    bulletinAudio.onplaying = () => {
      clearTimeout(timer);
      timer = setTimeout(cancel, 10000);
    };
    timer = setTimeout(cancel, 3000);
    bulletinAudio.muted = false;
    bulletinAudio.src = mediaCache.get(src) || mediaURL(src);
    bulletinAudio.load();
    Promise.resolve(bulletinAudio.play()).catch(cancel);
  });
}

function speakText(text, job) {
  if (job.cancelled || announcement !== job || !canSpeak()) return Promise.resolve(false);
  return new Promise(resolve => {
    const synth = window.speechSynthesis, utterance = new SpeechSynthesisUtterance(text);
    let settled = false, started = false, timer, poll;
    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      utterance.onstart = utterance.onend = utterance.onerror = null;
      job.cleanups.delete(cancel);
      if (!ok) synth.cancel();
      resolve(ok);
    };
    const cancel = () => finish(false);
    job.cleanups.add(cancel);
    job.utterance = utterance; // Mantém a referência até a fala terminar.
    utterance.lang = 'pt-BR';
    utterance.rate = 1;
    const voice = synth.getVoices().find(v => v.lang.replace('_', '-').toLowerCase() === 'pt-br');
    if (voice) utterance.voice = voice;
    utterance.onstart = () => {
      started = true;
      clearTimeout(timer);
      timer = setTimeout(cancel, Math.min(180000, Math.max(15000, text.length / 8 * 1000 + 5000)));
    };
    utterance.onend = () => finish(true);
    utterance.onerror = cancel;
    // Algumas implementações deixam de emitir onend. O estado do sintetizador é a reserva.
    poll = setInterval(() => { if (started && !synth.speaking && !synth.pending) finish(true); }, 500);
    timer = setTimeout(cancel, 3000);
    try {
      synth.cancel();
      synth.resume();
      synth.speak(utterance);
    } catch (_) { cancel(); }
  });
}

let items = [], updated = null, timestampVerified = true;
let feedURL = '', feedRequest = 0, feedController = null;
try { feedURL = localStorage.getItem('radio_feed') || ''; } catch (_) {}
const feed = $('feed');
feed.value = feedURL;

function feedFresh() {
  const age = Date.now() - Date.parse(updated);
  return items.length > 0 && timestampVerified && Number.isFinite(age) && age >= -60000 && age <= 30 * 60000;
}

function report() {
  if (!items.length) {
    $('traffic-status').textContent = 'Aguardando conexão com a fonte de trânsito';
    $('traffic').textContent = 'Nenhum boletim automático de trânsito está conectado no momento.';
  } else if (!timestampVerified) {
    $('traffic-status').textContent = 'Horário da medição não confirmado — boletim automático suspenso';
    $('traffic').textContent = 'A fonte informa o horário da coleta, sem confirmar o horário dos dados de trânsito.';
  } else if (!feedFresh()) {
    $('traffic-status').textContent = 'Boletim desatualizado — não transmitir';
    $('traffic').textContent = 'A fonte não apresenta atualização recente.';
  } else {
    $('traffic-status').textContent = 'Atualizado: ' + new Date(updated).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    $('traffic').textContent = items.slice(0, 6).join(' • ');
  }
}

async function refresh() {
  const sequence = ++feedRequest, url = feedURL;
  if (feedController) feedController.abort();
  if (!url) { items = []; updated = null; report(); return false; }
  const controller = new AbortController();
  feedController = controller;
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (!Array.isArray(data.items) || typeof data.updated_at !== 'string' || !Number.isFinite(Date.parse(data.updated_at))) throw new Error('JSON inválido');
    if (sequence !== feedRequest) return false;
    items = data.items.filter(x => typeof x === 'string' && x.trim().length > 0 && x.length < 350).map(x => x.trim()).slice(0, 10);
    updated = data.updated_at;
    timestampVerified = data.data_timestamp_verified !== false;
    $('feed-status').textContent = 'Fonte consultada com sucesso.';
    report();
    return feedFresh();
  } catch (error) {
    if (sequence !== feedRequest) return false;
    items = []; updated = null;
    $('feed-status').textContent = 'Não foi possível consultar a fonte: ' + error.message;
    report();
    return false;
  } finally {
    clearTimeout(timer);
    if (feedController === controller) feedController = null;
  }
}

async function trafficBulletin() {
  if (!feedFresh()) { report(); return; }
  const text = items.slice(0, 6).join('. ');
  const job = beginAnnouncement('traffic');
  if (!job) {
    if (!canSpeak()) $('feed-status').textContent = 'A leitura por voz não está disponível neste navegador.';
    return;
  }
  try {
    await playSting('media/vinheta-transito-mix.mp3', job);
    const spoken = await speakText(text, job);
    if (spoken) await playSting('media/vinheta-retorno-mix.mp3', job);
  } finally { finishAnnouncement(job); }
}

$('save').addEventListener('click', () => {
  const value = feed.value.trim();
  if (value) {
    try { if (new URL(value).protocol !== 'https:') throw new Error(); }
    catch (_) { $('feed-status').textContent = 'Use um endereço HTTPS válido.'; return; }
  }
  feedURL = value;
  try { localStorage.setItem('radio_feed', value); }
  catch (_) { $('feed-status').textContent = 'Fonte aplicada nesta sessão; o navegador bloqueou o salvamento.'; }
  refresh();
});
$('speak').addEventListener('click', trafficBulletin);
$('refresh').addEventListener('click', refresh);
refresh();
setInterval(async () => {
  const fresh = await refresh();
  if (fresh && wanted && !current.paused && !announcement) trafficBulletin();
}, 15 * 60 * 1000);
setInterval(report, 60000);

// A hora da rádio é a de São Paulo, independentemente do fuso do dispositivo.
const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
let lastTimeSlot = '';
function radioTime(date = new Date()) {
  return Object.fromEntries(timeFormatter.formatToParts(date).map(part => [part.type, part.value]));
}
function timeText(parts) {
  const hour = Number(parts.hour), minute = Number(parts.minute);
  return `Rádio Trânsito SP. Agora, ${hour} ${hour === 1 ? 'hora' : 'horas'}` +
    (minute ? ` e ${minute} ${minute === 1 ? 'minuto' : 'minutos'}` : '') + '.';
}
function checkTimeAnnouncement() {
  if (!wanted || current.paused || pendingPlay || current.readyState < 2 || announcement) return;
  const parts = radioTime();
  if (Number(parts.minute) % 10 !== 0) return;
  const slot = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}-${parts.minute}`;
  if (slot === lastTimeSlot) return;
  const job = beginAnnouncement('time');
  if (!job) return;
  lastTimeSlot = slot;
  speakText(timeText(parts), job).finally(() => finishAnnouncement(job));
}
function tick() {
  const parts = radioTime();
  $('clock').textContent = `${parts.hour}:${parts.minute}`;
}
tick();
setInterval(tick, 1000);
setInterval(checkTimeAnnouncement, 5000);

if ('mediaSession' in navigator) {
  for (const [action, handler] of Object.entries({ play: startProgram, pause: pauseProgram, nexttrack: () => activate(idx + 1), previoustrack: () => activate(idx - 1) })) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) {}
  }
}

const podcastStarts = playlist.map((track, index) => track.type === 'podcast' ? index : -1).filter(index => index >= 0);
idx = podcastStarts[Math.floor(Math.random() * podcastStarts.length)];
current.dataset.current = 'true';
standby.dataset.current = 'false';
prepare(current, idx);
bulletinAudio.src = mediaURL('media/vinheta-transito-mix.mp3');
preloadFollowing();
trackInfo();
controls();
status('Toque em “Ouvir ao vivo” para entrar na programação.');

// A previsão usa a mesma retomada dos avisos; sua consulta não pausa o player.
if (window.RadioWeather && typeof window.RadioWeather.create === 'function') {
  try {
    window.RadioWeather.create({
      isListening: () => wanted,
      canAnnounce: manual => !announcement && !pendingPlay && (manual || (wanted && !current.paused && current.readyState >= 2)),
      announce: async text => {
        const job = beginAnnouncement('weather');
        if (!job) return false;
        try {
          // Frases curtas mantêm os limites de espera da voz pequenos.
          const phrases = text.match(/[^.!?]+[.!?]?/g) || [text];
          for (const phrase of phrases) {
            if (!await speakText(phrase.trim(), job)) return false;
          }
          return true;
        }
        finally { finishAnnouncement(job); }
      }
    });
  } catch (_) {
    if ($('weather-status')) $('weather-status').textContent = 'Previsão temporariamente indisponível.';
  }
}

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Os primeiros downloads podem terminar antes de o novo worker assumir a página.
    for (const src of mediaCache.keys()) fetch(mediaURL(src), { cache: 'force-cache' }).catch(() => {});
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(registration => {
    registration.update().catch(() => {});
  }).catch(() => {});
}

})();

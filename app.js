(() => {
'use strict';
const $ = id => document.getElementById(id);

// Volume único para os dois players e o áudio dos boletins.
const radioVolume = (() => {
  const key = 'radio-transito-sp-volume';
  let value = 1;
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null && saved !== '' && Number.isFinite(Number(saved))) value = Math.max(0, Math.min(1, Number(saved)));
  } catch (_) {}
  const apply = () => {
    for (const id of ['audio', 'audio-next', 'bulletin-audio']) {
      const audio = $(id);
      if (audio) { try { audio.volume = value; } catch (_) {} }
    }
    const label = $('volume-level');
    if (label) label.textContent = Math.round(value * 100) + '%';
    const down = $('volume-down'), up = $('volume-up');
    if (down) down.disabled = value === 0;
    if (up) up.disabled = value === 1;
  };
  const change = delta => {
    value = Math.max(0, Math.min(1, Math.round((value + delta) * 10) / 10));
    apply();
    try { localStorage.setItem(key, String(value)); } catch (_) {}
  };
  const down = $('volume-down'), up = $('volume-up');
  if (down) down.addEventListener('click', () => change(-0.1));
  if (up) up.addEventListener('click', () => change(0.1));
  apply();
  return {get: () => value};
})();


// Cache rápido em memória (2 min) para que o clique no telemóvel não espere pela rede antes de falar
if (typeof window.fetch === 'function') {
  const nativeFetch = window.fetch.bind(window);
  let lastWeatherBody = null, lastWeatherTime = 0;
  let lastNewsBody = null, lastNewsTime = 0;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.includes('api.open-meteo.com/v1/forecast')) {
      if (lastWeatherBody && Date.now() - lastWeatherTime < 120000) {
        return new Response(lastWeatherBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const res = await nativeFetch(input, init);
      if (res.ok) {
        try { lastWeatherBody = await res.clone().text(); lastWeatherTime = Date.now(); } catch (_) {}
      }
      return res;
    }
    if (url.includes('/noticias')) {
      if (lastNewsBody && Date.now() - lastNewsTime < 120000) {
        return new Response(lastNewsBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const res = await nativeFetch(input, init);
      if (res.ok) {
        try { lastNewsBody = await res.clone().text(); lastNewsTime = Date.now(); } catch (_) {}
      }
      return res;
    }
    return nativeFetch(input, init);
  };
}

// Um podcast por dia, repetido nos horários fixos; música aleatória no restante do dia.
const podcasts = [
 {type:'podcast',title:'Maníaco do Parque: era psicopata ou doente?',artist:'Histórias que Marcaram',src:'media/maniaco-do-parque.mp3',duration:1192.882},
 {type:'podcast',title:'Carandiru: do massacre ao indulto',artist:'Histórias que Marcaram',src:'media/carandiru.mp3',duration:793.182},
 {type:'podcast',title:'Caso Isabella Nardoni: mídia e perícia',artist:'Histórias que Marcaram',src:'media/isabella-nardoni.mp3',duration:695.144},
 {type:'podcast',title:'Chico Picadinho: por que continua preso?',artist:'Histórias que Marcaram',src:'media/chico-picadinho.mp3',duration:601.783}
];
const musicTracks = window.RadioMusicTracks;
const audiobooks = [
 {type:'audiobook',title:'O Idiota — Resumo',artist:'Fiódor Dostoiévski • Audiobooks — Resumos',src:'media/o-idiota-resumo.mp3',duration:1199.986939,weekday:1,minute:750},
 {type:'audiobook',title:'Duas Viagens ao Brasil — Resumo',artist:'Hans Staden • Audiobooks — Resumos',src:'media/hans-staden-duas-viagens-resumo.mp3',duration:1500.029388,weekday:2,minute:750}
];
const playlist = [...musicTracks, ...podcasts, ...audiobooks];
const programming = window.RadioProgramming.create(
  musicTracks.map((_, i) => i),
  podcasts.map((track, i) => ({index: musicTracks.length + i, duration: track.duration})),
  Math.random,
  audiobooks.map((track, i) => ({index: musicTracks.length + podcasts.length + i, duration: track.duration, weekday:track.weekday, minute:track.minute})),
  {sequence: ['media/selecoes/alanis-completo.m4a', 'media/selecoes/emocionar1987-completo.m4a', 'media/selecoes/selecao89-completo.m4a'].map(src => musicTracks.findIndex(track => track.src === src)).filter(index => index >= 0)}
);

// O estado do botão representa a intenção do ouvinte, inclusive durante avisos.
const BUILD = '20261013-r2-light';
let current = $('audio'), standby = $('audio-next');
const bulletinAudio = $('bulletin-audio');
let idx = 0, wanted = false, announcement = null, playSequence = 0;
let pendingPlay = false, singleDeck = false, unlocked = false;
let failureTimer = null, lastProgress = Date.now(), lastPosition = -1;
const failedSources = new Set();
const RECOVERY_WINDOW = 6000;
let recovery = null, recoveryTimer = null;
let postBulletin = null;
const mediaCache = new Map(), preloads = new Map();
const mediaURL = src => new URL(`${src}?v=${BUILD}`, document.baseURI).href;
const streamedAlbums = new Set(musicTracks.filter(track => track.streamed).map(track => track.src));
let albumTransportReady = false, albumTransportPromise = null;
function ensureAlbumTransport() {
  if (albumTransportReady) return Promise.resolve();
  if (albumTransportPromise) return albumTransportPromise;
  if (!navigator.serviceWorker || typeof MessageChannel === 'undefined') return Promise.reject(new Error('Reabra a rádio para carregar a seleção.'));
  const sw = navigator.serviceWorker;
  albumTransportPromise = new Promise((resolve,reject) => {
    let done = false;
    const channels = new Set();
    const finish = ok => {
      if (done) return;
      done = true;
      clearTimeout(deadline); clearInterval(poll);
      sw.removeEventListener('controllerchange',ping);
      for (const channel of channels) { channel.port1.close(); channel.port2.close(); }
      if (ok) { albumTransportReady = true; resolve(); }
      else reject(new Error('Reabra a rádio para carregar a seleção.'));
    };
    const ping = () => {
      if (!sw.controller || done) return;
      const channel = new MessageChannel(); channels.add(channel);
      channel.port1.onmessage = event => { if (event.data?.albumStreams === 1) finish(true); };
      try { sw.controller.postMessage({type:'RADIO_ALBUM_STREAMS'},[channel.port2]); } catch (_) {}
    };
    const deadline = setTimeout(() => finish(false),15000);
    const poll = setInterval(ping,500);
    sw.addEventListener('controllerchange',ping);
    ping();
  }).finally(() => { albumTransportPromise = null; });
  return albumTransportPromise;
}

const wrap = i => (i + playlist.length) % playlist.length;
const status = message => { $('player-status').textContent = message; };

function controls() {
  const listening = wanted || announcement !== null;
  $('play').innerHTML = listening ? '<span aria-hidden="true">❚❚</span> NO AR' : '<span aria-hidden="true">▶</span> OUVIR AO VIVO';
  $('play').setAttribute('aria-label', listening ? 'Pausar a rádio' : 'Ouvir a rádio');
  $('play').setAttribute('aria-pressed', String(listening));
  document.body.classList.toggle('is-playing', listening);
  
  // Mantém a sessão de mídia ativa para o S24 Ultra não suspender o áudio com a tela desligada
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = listening ? 'playing' : 'paused';
    try {
      navigator.mediaSession.setActionHandler('play', startProgram);
      navigator.mediaSession.setActionHandler('pause', pauseProgram);
      navigator.mediaSession.setActionHandler('previoustrack', previousProgram);
      navigator.mediaSession.setActionHandler('nexttrack', advanceProgram);
    } catch (_) {}
  }
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
  const track = playlist[idx], next = playlist[programming.peek()];
  $('track').textContent = track.title;
  $('artist').textContent = track.artist;
  $('next-title').textContent = next.title;
  $('next-type').textContent = next.type === 'podcast' ? 'Podcast • Histórias que Marcaram' : next.type === 'audiobook' ? 'Audiobooks — Resumos' : next.type === 'music' ? 'Música • seleção musical' : 'Identificação da Rádio Trânsito SP';
  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: 'Rádio Trânsito SP' });
  }
  const daily = programming.daily();
  if ($('daily-podcast')) $('daily-podcast').textContent = playlist[daily.index].title;
  progress();
}

function prepare(element, index, force = false) {
  const src = playlist[index].src;
  element.dataset.index = String(index);
  if (streamedAlbums.has(src) && !albumTransportReady) {
    if (element.dataset.source !== src || element.dataset.albumWaiting !== 'true') {
      element.removeAttribute('src'); element.load();
    }
    element.dataset.source = src;
    element.dataset.albumWaiting = 'true';
    return;
  }
  if (element.dataset.albumWaiting === 'true') { force = true; delete element.dataset.albumWaiting; }
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
  prepare(standby, programming.peek());
  for (const distance of [1, 2]) warmMedia(playlist[programming.peek(distance)].src);
  const upcoming = programming.upcoming();
  if (upcoming && upcoming.inSeconds <= 120) warmMedia(playlist[upcoming.index].src);
}

function warmMedia(src) {
  if (streamedAlbums.has(src)) return; // Pré-carregamento nativo por intervalos; não guarda o álbum inteiro na memória.
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
      if (standby.dataset.source === src && standby.paused && standby.readyState < 3) {
        prepare(standby, Number(standby.dataset.index), true);
      }
    })
    .catch(() => {})
    .finally(() => { clearTimeout(timeout); preloads.delete(src); });
  preloads.set(src, task);
}

function unlockAuxiliaryAudio() {
  if (!unlocked) {
    unlocked = true;
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
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.getVoices(); } catch (_) {}
  }
}

// A transição de volta à música não deve entrar no avanço por falha de arquivo.
function cancelPostBulletin() {
  if (!postBulletin) return;
  clearTimeout(postBulletin.timer);
  clearTimeout(postBulletin.retry);
  postBulletin = null;
}
function retryPostBulletin() {
  const job = postBulletin;
  if (!job || !wanted || announcement || current !== job.element || idx !== job.index || job.retry !== null || job.attempts >= 3) return;
  job.retry = setTimeout(() => {
    job.retry = null;
    if (postBulletin !== job || !wanted || announcement || current !== job.element || idx !== job.index) return;
    if (!current.paused && current.currentTime > job.position + 1) return;
    job.attempts++;
    window.RadioDiagnostics?.record('resume-retry', {attempt:job.attempts, position:current.currentTime});
    playCurrent();
  }, 250);
}
function protectBulletinReturn() {
  cancelPostBulletin();
  const job = {element:current, index:idx, position:current.currentTime, attempts:0, retry:null, timer:null};
  postBulletin = job;
  job.timer = setTimeout(() => {
    if (postBulletin !== job) return;
    const resumed = !current.paused && current.currentTime > job.position + 1;
    window.RadioDiagnostics?.record('resume-result', {ok:resumed, position:current.currentTime});
    cancelPostBulletin();
    if (!resumed && wanted && !announcement && current === job.element && idx === job.index) {
      pauseProgram();
      status('Não foi possível retomar a faixa. Toque em Ouvir para continuar do mesmo ponto.');
    }
  }, 5000);
}
function releaseBulletinAudio() {
  bulletinAudio.pause();
  bulletinAudio.removeAttribute('src');
  bulletinAudio.load();
}

function playCurrent(fallbackElement = null) {
  if (!wanted || announcement) return;
  if (streamedAlbums.has(playlist[idx].src) && !albumTransportReady) {
    const element = current, sequence = ++playSequence;
    pendingPlay = true;
    status('Preparando a seleção musical…');
    ensureAlbumTransport().then(() => {
      if (sequence !== playSequence || element !== current || !wanted || announcement) return;
      prepare(element,idx,true);
      playCurrent(fallbackElement);
    }).catch(() => {
      if (sequence !== playSequence || element !== current || !wanted || announcement) return;
      pendingPlay = false; wanted = false; controls();
      status('Reabra a rádio para carregar a seleção ou escolha a próxima faixa.');
    });
    return;
  }
  if (current.error) prepare(current, idx, true);
  const element = current, sequence = ++playSequence;
  pendingPlay = true;
  lastProgress = Date.now();
  lastPosition = element.currentTime;
  controls();
  status('Carregando o áudio…');
  const attempt = element.play();
  Promise.resolve(attempt).then(() => {
    if (sequence !== playSequence || element !== current || !wanted || announcement) return;
    pendingPlay = false;
    failedSources.clear();
    status('NO AR • programação contínua');
  }).catch(error => {
    if (sequence !== playSequence || element !== current || !wanted || announcement) return;
    pendingPlay = false;
    window.RadioDiagnostics?.record('music-play-error', {error:error?.name, position:current.currentTime});
    if (postBulletin) { retryPostBulletin(); return; }
    if (error.name === 'NotAllowedError') {
      if (fallbackElement && fallbackElement !== current) {
        singleDeck = true;
        activate(idx, fallbackElement, Number(current.dataset.startOffset || 0));
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

function activate(index, reuse = null, seek = 0) {
  cancelPostBulletin();
  cancelRecovery();
  clearTimeout(failureTimer);
  failureTimer = null;
  cancelAnnouncement();
  ++playSequence;
  pendingPlay = false;
  // Em segundo plano, mantém o elemento já autorizado pelo toque do ouvinte.
  const keepDeck = singleDeck || (isMobile && document.visibilityState === 'hidden');
  const previous = current, target = reuse || (keepDeck ? current : standby);
  idx = wrap(index);
  if (target !== previous) {
    current = target;
    standby = previous;
    previous.pause();
  }
  current.muted = false;
  for (const element of [current, standby]) element.dataset.current = String(element === current);
  prepare(current, idx);
  current.dataset.startOffset = String(seek);
  if (current.readyState >= 1) current.currentTime = seek;
  lastPosition = -1;
  lastProgress = Date.now();
  trackInfo();
  if (wanted) playCurrent(target !== previous ? previous : null);
  else { controls(); status('Programação pausada. Toque em Ouvir para continuar.'); }
  preloadFollowing();
}

function skipFailedTrack(element) {
  if (element !== current || !wanted || announcement || failureTimer !== null) return;
  cancelRecovery();
  failedSources.add(playlist[idx].src);
  let next = programming.next(), searched = 0;
  while (failedSources.has(playlist[next].src) && ++searched < musicTracks.length) next = programming.next();
  if (searched >= musicTracks.length) {
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

// A ausência de timeupdate não prova que o áudio parou (por exemplo, em segundo plano).
function cancelRecovery() {
  clearTimeout(recoveryTimer);
  recoveryTimer = null;
  recovery = null;
}

function recoveryAdvanced(job) {
  return current === job.element && idx === job.index &&
    Number.isFinite(current.currentTime) && current.currentTime > job.position + 0.1;
}

function observePlayback() {
  const position = current.currentTime;
  if (Number.isFinite(position) && position !== lastPosition) {
    lastPosition = position;
    lastProgress = Date.now();
  }
  if (recovery && recoveryAdvanced(recovery)) cancelRecovery();
}

function failTrack(element) {
  if (streamedAlbums.has(playlist[idx].src) && !albumTransportReady && pendingPlay) return;
  if (element === current && postBulletin && wanted && !announcement) { retryPostBulletin(); return; }
  if (element !== current || !wanted || announcement || failureTimer !== null) return;
  if (recovery) {
    // Um novo erro após a tentativa confirma a falha; não reinicia um ciclo infinito.
    if (element.error) skipFailedTrack(element);
    return;
  }
  const position = Math.max(0, Number(element.currentTime) || 0, Number(lastPosition) || 0);
  const job = { element, index: idx, position };
  recovery = job;
  // Só recarrega o arquivo quando o elemento informou erro. Em buffering,
  // preserva o que já está carregado e tenta continuar no mesmo elemento.
  if (element.error) {
    ++playSequence;
    pendingPlay = false;
    element.dataset.startOffset = String(position);
    prepare(element, idx, true);
    if (element.readyState >= 1) {
      try { element.currentTime = position; } catch (_) {}
    }
  }
  playCurrent();
  if (recovery !== job || !wanted || announcement) return;
  status('Restabelecendo a mesma faixa…');
  recoveryTimer = setTimeout(() => {
    if (recovery !== job) return;
    if (!wanted || announcement || current !== job.element || idx !== job.index || recoveryAdvanced(job)) {
      cancelRecovery();
      return;
    }
    skipFailedTrack(job.element);
  }, RECOVERY_WINDOW);
}

function pauseProgram() {
  cancelPostBulletin();
  cancelRecovery();
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
  if (syncSchedule()) return;
  if (current.ended) { advanceProgram(); return; }
  playCurrent();
}

$('play').addEventListener('click', () => {
  if (wanted || announcement) pauseProgram();
  else startProgram();
});
$('next').addEventListener('click', advanceProgram);
$('prev').addEventListener('click', previousProgram);

for (const element of [current, standby]) {
  element.addEventListener('ended', () => {
    if (element === current && wanted && !announcement) advanceProgram();
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
    if (element === current && element.paused && wanted && !announcement && postBulletin) {
      window.RadioDiagnostics?.record('resume-paused', {position:current.currentTime});
      retryPostBulletin();
      return;
    }
    if (element === current && element.paused && wanted && !announcement && !pendingPlay && !element.ended && element.readyState >= 2) {
      if (isMobile && document.visibilityState === 'hidden') {
        // Pausas explícitas passam por pauseProgram(), que já remove wanted.
        // Uma pausa inesperada do navegador não deve apagar essa intenção.
        failTrack(element);
        return;
      }
      wanted = false;
      controls();
      status('Programação pausada. Toque em Ouvir para continuar.');
    }
  });
  element.addEventListener('waiting', () => {
    if (element === current && wanted && !announcement) status('Carregando o áudio…');
  });
  element.addEventListener('loadedmetadata', () => {
    if (element !== current) return;
    const offset = Number(element.dataset.startOffset || 0);
    if (offset > 0) element.currentTime = Math.min(offset, Math.max(0, element.duration - 0.1));
    element.dataset.startOffset = '0';
    progress();
  });
  element.addEventListener('timeupdate', () => {
    if (element !== current) return;
    window.RadioDiagnostics?.progress({position:current.currentTime, paused:current.paused});
    observePlayback();
    progress();
  });
}

setInterval(() => {
  announcement?.audioCheck?.();
  if (!wanted || announcement) return;
  observePlayback();
  if (!current.ended && !recovery && Date.now() - lastProgress > 12000) failTrack(current);
}, 1000);

function nativeTTSAvailable() {
  return 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

function canSpeak() {
  return true;
}

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

let weatherVoiceName = '';
try { weatherVoiceName = localStorage.getItem('radio_weather_voice') || ''; } catch (_) {}

function portugueseVoices() {
  if (!nativeTTSAvailable()) return [];
  const all = window.speechSynthesis.getVoices() || [];
  return all.filter(v => {
    const lang = (v.lang || '').replace('_', '-').toLowerCase();
    return lang.startsWith('pt-br') || lang === 'pt' || /portugu[eê]s|brasil|brazil/i.test(v.name || '');
  });
}

function preferredWeatherVoice(voices) {
  const male = v => /Ant[oô]nio|Daniel|Felipe|Ricardo|Bruno|Fabr[ií]cio|Thiago|Paulo|Alex/i.test(v.name);
  return voices.find(v => male(v) && /Natural|Neural/i.test(v.name)) || voices.find(male) ||
    voices.find(v => /Natural|Neural/i.test(v.name)) || voices.find(v => !/Google/i.test(v.name)) || voices[0];
}

function selectedVoice(kind) {
  const voices = portugueseVoices();
  if (kind !== 'weather') return voices[0];
  return voices.find(v => v.name === weatherVoiceName) || preferredWeatherVoice(voices);
}

function paintVoices() {
  const selector = $('weather-voice');
  if (!selector) return;
  const voices = portugueseVoices(), preferred = preferredWeatherVoice(voices);
  selector.replaceChildren();
  const automatic = document.createElement('option');
  automatic.value = '';
  automatic.textContent = preferred ? `Automática — ${preferred.name}` : 'Voz padrão do dispositivo';
  selector.append(automatic);
  for (const voice of voices) {
    const option = document.createElement('option');
    option.value = voice.name;
    option.textContent = voice.name;
    selector.append(option);
  }
  selector.value = voices.some(v => v.name === weatherVoiceName) ? weatherVoiceName : '';
}

if ($('weather-voice')) {$('weather-voice').addEventListener('change', event => {
    weatherVoiceName = event.target.value;
    try { localStorage.setItem('radio_weather_voice', weatherVoiceName); } catch (_) {}
  });
  if (nativeTTSAvailable()) {
    try { window.speechSynthesis.onvoiceschanged = paintVoices; } catch (_) {}
    window.speechSynthesis.addEventListener?.('voiceschanged', paintVoices);
    paintVoices();
  }
}

function beginAnnouncement(kind) {
  window.RadioDiagnostics?.record('announcement-request', {kind, busy:!!announcement});
  if (announcement) return null;
  cancelPostBulletin();
  clearTimeout(failureTimer);
  failureTimer = null;
  cancelRecovery();
  const job = { kind, cancelled: false, cleanups: new Set() };
  announcement = job;
  ++playSequence;
  pendingPlay = false;
  current.pause();
  controls();
  status(kind === 'time' ? 'NO AR • hora certa' : kind === 'weather' ? 'NO AR • previsão do tempo' : kind === 'news' ? 'NO AR • notícias' : 'NO AR • boletim de trânsito');
  return job;
}

// Mantém a música carregada e pausada: o aviso usa seu próprio elemento.
function announcementAudio(job) {
  if (isMobile && document.visibilityState === 'hidden') job.backgroundAudio = true;
  return bulletinAudio;
}

function cancelAnnouncement() {
  const job = announcement;
  if (!job) return;
  job.cancelled = true;
  for (const cleanup of [...job.cleanups]) cleanup();
  if (job.backgroundAudio) releaseBulletinAudio();
  else bulletinAudio.pause();
  announcement = null;
  if (nativeTTSAvailable()) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }
}

function finishAnnouncement(job) {
  if (announcement !== job || job.cancelled) return;
  for (const cleanup of [...job.cleanups]) cleanup();
  if (job.backgroundAudio) releaseBulletinAudio();
  else bulletinAudio.pause();
  announcement = null;
  if (wanted) {
    if (current.ended) advanceProgram();
    else {
      if (job.backgroundAudio) protectBulletinReturn();
      window.RadioDiagnostics?.record('music-resume-request', {position:current.currentTime, paused:current.paused});
      playCurrent();
    }
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

function splitIntoChunks(text, maxLen = 165) {
  const chunks = [];
  let currentChunk = '';
  for (const word of text.trim().split(/\s+/)) {
    if (!word) continue;
    if ((currentChunk + ' ' + word).trim().length <= maxLen) {
      currentChunk = (currentChunk + ' ' + word).trim();
    } else {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = word;
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

// Reproduz a voz pelo elemento <audio id="bulletin-audio"> com no-referrer (evita bloqueio 403 no telemóvel)
async function speakViaAudioFallback(text, job) {
  const audio = announcementAudio(job);
  const chunks = splitIntoChunks(text, 165);
  const endpoints = job.backgroundAudio ? [
    q => `https://radio-transito-sp.lazarowww86.workers.dev/voz?q=${encodeURIComponent(q)}`
  ] : [
    q => `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=pt-BR&q=${encodeURIComponent(q)}`,
    q => `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=pt-BR&q=${encodeURIComponent(q)}`
  ];
  for (const chunk of chunks) {
    if (job.cancelled || announcement !== job) return false;
    let chunkSpoken = false;
    for (const makeUrl of endpoints) {
      if (job.cancelled || announcement !== job) return false;
      const ok = await new Promise(resolve => {
        let settled = false, timer, started = false, retryTimer = null, resumeAttempts = 0;
        let deadline = Date.now() + (job.backgroundAudio ? 10000 : 6000);
        let lastAudioPosition = 0, lastAudioProgress = Date.now();
        const resumeVoice = () => {
          if (settled || !started || !audio.paused || audio.ended || job.cancelled || announcement !== job || retryTimer !== null || resumeAttempts >= 2) return;
          retryTimer = setTimeout(() => {
            retryTimer = null;
            if (settled || job.cancelled || announcement !== job || !audio.paused || audio.ended) return;
            resumeAttempts++;
            window.RadioDiagnostics?.record('voice-resume-attempt', {kind:job.kind, attempt:resumeAttempts, position:audio.currentTime});
            Promise.resolve(audio.play()).catch(error => {
              if (settled) return;
              window.RadioDiagnostics?.record('voice-resume-error', {kind:job.kind, error:error?.name});
              finish(false);
            });
          }, 250);
        };
        const check = () => {
          if (settled) return;
          const now = Date.now(), position = audio.currentTime;
          if (started && audio.ended) { finish(true); return; }
          if (started && audio.paused) resumeVoice();
          if (started && Number.isFinite(position) && position > lastAudioPosition + 0.05) {
            lastAudioPosition = position;
            lastAudioProgress = now;
          }
          if (now >= deadline || (started && now - lastAudioProgress >= 10000)) {
            window.RadioDiagnostics?.record('voice-stalled', {kind:job.kind, position, paused:audio.paused, ready:audio.readyState});
            finish(false);
          }
        };
        job.audioCheck = check;
        const finish = result => {
          if (settled) return;
          window.RadioDiagnostics?.record('fallback-finish', {kind:job.kind, ok:result, mainPlayer:audio === current});
          settled = true;
          clearTimeout(timer);
          clearTimeout(retryTimer);
          if (job.audioCheck === check) delete job.audioCheck;
          audio.onended = audio.onerror = audio.onplaying = audio.onpause = null;
          audio.pause();
          job.cleanups.delete(cancel);
          resolve(result);
        };
        const cancel = () => finish(false);
        job.cleanups.add(cancel);
        audio.onended = () => finish(true);
        audio.onpause = () => {
          if (!settled && started && !audio.ended) {
            window.RadioDiagnostics?.record('voice-paused', {kind:job.kind, position:audio.currentTime});
            resumeVoice();
          }
        };
        audio.onerror = () => { window.RadioDiagnostics?.record('fallback-error', {kind:job.kind, code:audio.error?.code}); cancel(); };
        audio.onplaying = () => {
          window.RadioDiagnostics?.record('fallback-playing', {kind:job.kind, mainPlayer:audio === current});
          if (!started) {
            started = true;
            deadline = Date.now() + 30000;
            lastAudioProgress = Date.now();
            clearTimeout(timer);
            timer = setTimeout(check, 30000);
          }
        };
        timer = setTimeout(cancel, job.backgroundAudio ? 10000 : 6000);
        audio.muted = false;
        audio.referrerPolicy = 'no-referrer';
        audio.setAttribute('referrerpolicy', 'no-referrer');
        audio.removeAttribute('crossorigin');
        audio.src = makeUrl(chunk);
        audio.load();
        Promise.resolve(audio.play()).catch(error => { window.RadioDiagnostics?.record('fallback-rejected', {kind:job.kind, error:error?.name}); cancel(); });
      });
      if (ok) {
        chunkSpoken = true;
        break;
      }
    }
    if (!chunkSpoken) return false;
  }
  return true;
}

function speakNative(clean, job) {
  if (!nativeTTSAvailable() || job.useAudioFallback) return Promise.resolve(false);
  return new Promise(resolve => {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(clean);
    let settled = false, started = false, timer, poll;
    const finish = ok => {
      if (settled) return;
      window.RadioDiagnostics?.record('native-finish', {kind:job.kind, ok, started});
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      utterance.onstart = utterance.onend = utterance.onerror = null;
      job.cleanups.delete(cancel);
      if (!ok) {
        try { synth.cancel(); } catch (_) {}
      }
      resolve(ok);
    };
    const cancel = () => finish(false);
    job.cleanups.add(cancel);
    job.utterance = utterance;
    utterance.lang = 'pt-BR';
    utterance.rate = 1;
    utterance.volume = radioVolume.get();

    if (!isMobile || (job.kind === 'weather' && weatherVoiceName)) {
      const voice = selectedVoice(job.kind);
      if (voice) utterance.voice = voice;
    }

    const markStarted = () => {
      if (started) return;
      started = true;
      window.RadioDiagnostics?.record('native-start', {kind:job.kind});
      clearTimeout(timer);
      timer = setTimeout(cancel, Math.min(180000, Math.max(15000, clean.length / 7 * 1000 + 6000)));
    };

    utterance.onstart = markStarted;
    utterance.onend = () => finish(true);
    utterance.onerror = event => {
      window.RadioDiagnostics?.record('native-error', {kind:job.kind, error:event?.error});
      if (event && (event.error === 'interrupted' || event.error === 'canceled')) {
        if (started) { finish(true); return; }
      }
      cancel();
    };
    poll = setInterval(() => {
      if (synth.speaking) markStarted();
      else if (started && !synth.pending) finish(true);
    }, 200);

    timer = setTimeout(cancel, isMobile ? 2500 : 3000);
    try {
      if (!isMobile) {
        synth.cancel();
        synth.resume();
        synth.speak(utterance);
      } else {
        if (synth.paused) synth.resume();
        synth.speak(utterance);
      }
    } catch (_) { cancel(); }
  });
}

async function speakText(text, job) {
  const clean = typeof text === 'string' ? text.trim() : '';
  if (!clean) return true;
  if (job.cancelled || announcement !== job) return false;

  window.RadioDiagnostics?.record('voice-request', {kind:job.kind});
  // O diagnóstico real confirmou falha da voz nativa com a tela apagada.
  // Em primeiro plano, preserva o mecanismo que já funciona.
  if (isMobile && (document.visibilityState === 'hidden' || job.backgroundAudio)) {
    window.RadioDiagnostics?.record('background-audio', {kind:job.kind});
    return speakViaAudioFallback(clean, job);
  }
  const nativeOk = await speakNative(clean, job);
  if (nativeOk) return true;
  if (job.cancelled || announcement !== job) return false;

  job.useAudioFallback = true;
  window.RadioDiagnostics?.record('audio-fallback', {kind:job.kind});
  return speakViaAudioFallback(clean, job);
}

// Dicionário de rodovias da ARTESP para converter códigos técnicos (ex: 0021SP, SPD 006/021) em nomes claros.
const RODOVIAS_ARTESP = {
  '015': 'Marginal Tietê / Pinheiros (SP-015)',
  '021': 'Rodoanel Mário Covas (SP-021)',
  '050': 'Rodovia Monteiro Lobato (SP-050)',
  '055': 'Rodovia Padre Manoel da Nóbrega / Rio-Santos (SP-055)',
  '060': 'Via Dutra (SP-060)',
  '063': 'Rodovia Luciano Consoline (SP-063)',
  '065': 'Rodovia Dom Pedro I (SP-065)',
  '068': 'Rodovia dos Tropeiros (SP-068)',
  '070': 'Rodovia Ayrton Senna / Carvalho Pinto (SP-070)',
  '075': 'Rodovia Santos Dumont (SP-075)',
  '079': 'Rodovia Waldomiro Corrêa de Camargo (SP-079)',
  '083': 'Anel Viário José Roberto Magalhães Teixeira (SP-083)',
  '088': 'Rodovia Mogi-Dutra (SP-088)',
  '098': 'Rodovia Mogi-Bertioga (SP-098)',
  '099': 'Rodovia dos Tamoios (SP-099)',
  '101': 'Rodovia Jornalista Francisco Aguirre Proença (SP-101)',
  '116': 'Rodovia Presidente Dutra / Régis Bittencourt (BR-116)',
  '123': 'Rodovia Floriano Rodrigues Pinheiro (SP-123)',
  '125': 'Rodovia Oswaldo Cruz (SP-125)',
  '127': 'Rodovia Cornélio Pires / Antônio Romano Schincariol (SP-127)',
  '135': 'Rodovia Margarida da Graça Martins (SP-135)',
  '147': 'Rodovia Engenheiro João Tosello / Monsenhor Clodoaldo de Paiva (SP-147)',
  '148': 'Rodovia Caminho do Mar (SP-148)',
  '150': 'Via Anchieta (SP-150)',
  '160': 'Rodovia dos Imigrantes (SP-160)',
  '171': 'Rodovia Paulo Virgínio (SP-171)',
  '191': 'Rodovia Wilson Finardi (SP-191)',
  '215': 'Rodovia Vicente Botta / Luís Augusto de Oliveira (SP-215)',
  '225': 'Rodovia Engenheiro Paulo Nilo Romano (SP-225)',
  '250': 'Rodovia Bunjiro Nakao / José de Carvalho (SP-250)',
  '255': 'Rodovia Antônio Machado Sant’Anna / Otávio Pacheco de Almeida Prado (SP-255)',
  '270': 'Rodovia Raposo Tavares (SP-270)',
  '280': 'Rodovia Castello Branco (SP-280)',
  '294': 'Rodovia Comandante João Ribeiro de Barros (SP-294)',
  '300': 'Rodovia Marechal Rondon (SP-300)',
  '304': 'Rodovia Luiz de Queiroz (SP-304)',
  '310': 'Rodovia Washington Luís (SP-310)',
  '318': 'Rodovia Engenheiro Thales de Lorena Peixoto Júnior (SP-318)',
  '320': 'Rodovia Euclides da Cunha (SP-320)',
  '321': 'Rodovia Cezário José de Castilho (SP-321)',
  '322': 'Rodovia Prefeito Antônio Duarte Nogueira (SP-322)',
  '324': 'Anel Viário Magalhães Teixeira (SP-324)',
  '326': 'Rodovia Brigadeiro Faria Lima (SP-326)',
  '330': 'Via Anhanguera (SP-330)',
  '333': 'Rodovia Abrão Assed / Carlos Tonanni / Rachid Rayes (SP-333)',
  '334': 'Rodovia Cândido Portinari (SP-334)',
  '340': 'Rodovia Adhemar de Barros (SP-340)',
  '342': 'Rodovia Governador Doutor Adhemar Pereira de Barros (SP-342)',
  '344': 'Rodovia Dom Tomás Vaquero (SP-344)',
  '348': 'Rodovia dos Bandeirantes (SP-348)',
  '350': 'Rodovia Deputado Eduardo Vicente Nasser (SP-350)',
  '360': 'Rodovia Engenheiro Constâncio Cintra (SP-360)',
  '374': 'Rodovia Prefeito Quintino de Lima (SP-374)',
  '381': 'Rodovia Fernão Dias (BR-381)',
  '425': 'Rodovia Assis Chateaubriand (SP-425)',
  '463': 'Rodovia Elyeser Montenegro Magalhães (SP-463)',
  '501': 'Rodovia Júlio Budiski (SP-501)'
};

function nomeDaRodovia(digits) {
  const code = String(digits).padStart(3, '0');
  const num = parseInt(digits, 10);
  return RODOVIAS_ARTESP[code] || `Rodovia SP-${num}`;
}

function preposicaoRodovia(nome) {
  return /^(Rodoanel|Anel\s+Vi[aá]rio)/i.test(nome) ? 'do' : 'da';
}

function formatTrafficItem(raw) {
  if (typeof raw !== 'string') return '';
  let text = raw.trim();

  text = text.replace(
    /\b(?:rodovia\s+)?(?:(sp[daic]|acesso|dispositivo|interliga[cç][aã]o)[\s\-:/]*)?0*(\d{1,4})\s*\/+\s*0*(\d{2,3})(?:[\s\-/]*sp)?\b/gi,
    (_, prefix, branchDigits, mainDigits) => {
      const branchNum = parseInt(branchDigits, 10);
      const mainName = nomeDaRodovia(mainDigits);
      const prep = preposicaoRodovia(mainName);
      const p = (prefix || '').toUpperCase();
      const tipo = p === 'SPA' ? 'Acesso' : p === 'SPI' ? 'Interligação' : 'Dispositivo e acesso';
      return `${tipo} ${branchNum} ${prep} ${mainName}`;
    }
  );

  text = text.replace(/\b(?:rodovia\s+)?(?:sp[\s\-/]*)?0*(\d{2,3})[\s\-/]*sp\b/gi, (_, digits) => {
    return nomeDaRodovia(digits);
  });

  text = text.replace(/\brodovia\s+sp[daic]?[\s\-/]*0*(\d{2,3})\b/gi, (_, digits) => {
    return nomeDaRodovia(digits);
  });

  text = text.replace(
    /\b(?:no\s+|em\s+)?sentido\s+(?:n[aã]o\s+se\s+aplica|n\/a|n\.a\.|n[aã]o\s+informado|indefinido|nenhum|-)\b/gi,
    'sentido não informado'
  );

  const sentidos = {
    'n': 'Norte', 's': 'Sul', 'l': 'Leste', 'o': 'Oeste', 'w': 'Oeste',
    'cap': 'Capital', 'int': 'Interior', 'lit': 'Litoral',
    'ambos': 'ambos os sentidos'
  };
  text = text.replace(/\bsentido\s+(n|s|l|o|w|cap|int|lit|ambos)\b(?![a-zà-ú])/gi, (_, sigla) => {
    const expandido = sentidos[sigla.toLowerCase()];
    return expandido === 'ambos os sentidos' ? 'em ambos os sentidos' : `sentido ${expandido}`;
  });

  text = text
    .replace(/\s+,/g, ',')
    .replace(/,{2,}/g, ',')
    .replace(/\.\s*,/g, '.')
    .replace(/:\s*,/g, ':')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;-]+|[\s,;-]+$/g, '')
    .trim();

  return text;
}

function prepareTrafficSpeech(text) {
  return text
    .replace(/\(SP-0*(\d+)\)/gi, ', S P $1,')
    .replace(/\(BR-0*(\d+)\)/gi, ', B R $1,')
    .replace(/\bSP-0*(\d+)\b/gi, 'S P $1')
    .replace(/\bBR-0*(\d+)\b/gi, 'B R $1')
    .replace(/\bDom Pedro I\b/g, 'Dom Pedro Primeiro')
    .replace(/\bkm\s*0*(\d+(?:[.,]\d+)?)/gi, 'quilômetro $1')
    .replace(/\s+,/g, ',')
    .replace(/,{2,}/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

let items = [], updated = null, timestampVerified = true;
const DEFAULT_FEED_URL = 'https://radio-transito-sp.lazarowww86.workers.dev/boletins';
const feedURL = DEFAULT_FEED_URL;
let feedRequest = 0, feedController = null;
let feedLoading = false, feedError = '', timestampKind = '';

function feedFresh() {
  const age = Date.now() - Date.parse(updated);
  return items.length > 0 && timestampVerified && Number.isFinite(age) && age >= -60000 && age <= 30 * 60000;
}

function report() {
  const official = feedURL === DEFAULT_FEED_URL;
  const credits = $('traffic-source');
  if (credits) credits.hidden = !official;
  if (!items.length) {
    $('traffic-status').textContent = feedLoading ? 'Consultando a fonte de trânsito…' : feedError ? 'Boletim temporariamente indisponível' : 'Aguardando a próxima consulta à fonte de trânsito';
    $('traffic').textContent = feedError ? 'A fonte de trânsito está indisponível no momento.' : 'Consultando os boletins de trânsito.';
  } else if (!timestampVerified) {
    $('traffic-status').textContent = 'Horário dos dados não confirmado — boletim automático suspenso';
    $('traffic').textContent = 'A fonte não confirma o horário dos dados de trânsito.';
  } else if (!feedFresh()) {
    $('traffic-status').textContent = 'Boletim desatualizado — não transmitir';
    $('traffic').textContent = 'A fonte não apresenta atualização recente.';
  } else {
    const label = official ? timestampKind === 'resposta_oficial_http' ? 'Resposta oficial da ARTESP: ' : 'Consulta oficial da ARTESP: ' : 'Atualizado: ';
    $('traffic-status').textContent = label + new Date(updated).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });$('traffic').textContent = items.slice(0, 6).join(' • ');
  }
}

async function refresh() {
  const sequence = ++feedRequest, url = feedURL;
  if (feedController) feedController.abort();
  if (!url) { items = []; updated = null; report(); return false; }
  const controller = new AbortController();
  feedController = controller;
  feedLoading = true; feedError = ''; report();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (!Array.isArray(data.items) || typeof data.updated_at !== 'string' || !Number.isFinite(Date.parse(data.updated_at))) throw new Error('JSON inválido');
    if (sequence !== feedRequest) return false;
    items = data.items
      .filter(x => typeof x === 'string' && x.trim().length > 0 && x.length < 350)
      .map(x => formatTrafficItem(x))
      .filter(x => x.length > 0)
      .slice(0, 10);
    updated = data.updated_at;
    timestampVerified = data.data_timestamp_verified !== false;
    timestampKind = typeof data.timestamp_kind === 'string' ? data.timestamp_kind : '';
    feedLoading = false;
    report();
    return feedFresh();
  } catch (error) {
    if (sequence !== feedRequest) return false;
    items = []; updated = null;
    feedError = 'Fonte indisponível'; feedLoading = false; timestampKind = '';
    report();
    return false;
  } finally {
    clearTimeout(timer);
    if (feedController === controller) feedController = null;
  }
}

async function trafficBulletin() {
  unlockAuxiliaryAudio();
  if (!feedFresh()) { report(); return; }
  const text = prepareTrafficSpeech(items.slice(0, 6).join('. '));
  const job = beginAnnouncement('traffic');
  if (!job) {
    if (!canSpeak()) $('traffic-status').textContent = 'A leitura por voz não está disponível neste navegador.';
    return;
  }
  try {
    if (!isMobile) {
      await playSting('media/vinheta-transito-mix.mp3', job);
      const spoken = await speakText(text, job);
      if (spoken) await playSting('media/vinheta-retorno-mix.mp3', job);
    } else {
      const spoken = await speakText(text, job);
      if (spoken) await playSting('media/vinheta-retorno-mix.mp3', job);
    }
  } finally { finishAnnouncement(job); }
}

$('speak').addEventListener('click', trafficBulletin);$('refresh').addEventListener('click', refresh);
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
  announcement?.audioCheck?.();
  window.RadioDiagnostics?.record('scheduler', {wanted, paused:current.paused, pendingPlay, ready:current.readyState, announcement:announcement?.kind || null, position:current.currentTime});
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
  syncSchedule();
  const parts = radioTime();
  $('clock').textContent = `${parts.hour}:${parts.minute}`;
}
tick();
setInterval(tick, 1000);
setInterval(checkTimeAnnouncement, 5000);

if ('mediaSession' in navigator) {
  for (const [action, handler] of Object.entries({ play: startProgram, pause: pauseProgram, nexttrack: advanceProgram, previoustrack: previousProgram })) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) {}
  }
}

function advanceProgram() { activate(programming.next()); }
function previousProgram() {
  activate(programming.previous(['podcast', 'audiobook'].includes(playlist[idx].type)));
}
function syncSchedule() {
  const daily = programming.daily();
  if ($('daily-podcast'))$('daily-podcast').textContent = playlist[daily.index].title;
  const upcoming = programming.upcoming();
  if (upcoming && upcoming.inSeconds <= 120) warmMedia(playlist[upcoming.index].src);
  if (!wanted) return false;
  const slot = programming.slot();
  if (!programming.claim(slot)) return false;
  activate(slot.index, null, slot.offset);
  return true;
}

idx = programming.next();
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
      unlockVoice: unlockAuxiliaryAudio,
      canAnnounce: manual => !announcement && !pendingPlay && (manual || (wanted && !current.paused && current.readyState >= 2)),
      announce: async (text, snapshot, stillValid = () => true) => {
        if (!stillValid() || announcement || pendingPlay) return false;
        const job = beginAnnouncement('weather');
        if (!job) return false;
        try {
          if (!isMobile) {
            const phrases = text.match(/[^.!?]+[.!?]?/g) || [text];
            for (const phrase of phrases) {
              if (!stillValid() || !await speakText(phrase.trim(), job)) return false;
            }
            return true;
          }
          return await speakText(text, job);
        }
        finally { finishAnnouncement(job); }
      }
    });
  } catch (_) {
    if ($('weather-status'))$('weather-status').textContent = 'Previsão temporariamente indisponível.';
  }
}

// As notícias compartilham a retomada de áudio já usada pelos demais boletins.
if (window.RadioNews && typeof window.RadioNews.create === 'function') {
  try {
    window.RadioNews.create({
      isListening: () => wanted,
      unlockVoice: unlockAuxiliaryAudio,
      canAnnounce: manual => !announcement && !pendingPlay && (manual || (wanted && !current.paused && current.readyState >= 2)),
      announce: async (phrases, stillValid = () => true) => {
        if (!stillValid() || announcement || pendingPlay) return false;
        const job = beginAnnouncement('news');
        if (!job) { if ($('news-status'))$('news-status').textContent = 'A leitura de notícias não está disponível neste dispositivo.'; return false; }
        try {
          if (!isMobile) {
            for (const phrase of phrases) if (!stillValid() || !await speakText(phrase, job)) return false;
            return true;
          }
          return await speakText(phrases.join(' '), job);
        } finally { finishAnnouncement(job); }
      }
    });
  } catch (_) { if ($('news-status'))$('news-status').textContent = 'Notícias temporariamente indisponíveis.'; }
}

// As fontes rodoviárias usam a mesma fila exclusiva de avisos da rádio.
if (window.RadioRoads) {
  try { window.RadioRoads.create({
    isListening: () => wanted,
    unlockVoice: unlockAuxiliaryAudio,
    canAnnounce: manual => !announcement && !pendingPlay && (manual || (wanted && !current.paused && current.readyState >= 2)),
    announce: async (phrases, stillValid) => {
      if (!stillValid() || announcement || pendingPlay) return false;
      const job = beginAnnouncement('roads');
      if (!job) return false;
      try {
        if (isMobile) return await speakText(phrases.join(' '), job);
        for (const phrase of phrases) if (!stillValid() || !await speakText(phrase, job)) return false;
        return true;
      } finally { finishAnnouncement(job); }
    }
  }); } catch (_) { if ($('roads-status')) $('roads-status').textContent = 'Informações das rodovias temporariamente indisponíveis.'; }
}

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    for (const src of mediaCache.keys()) fetch(mediaURL(src), { cache: 'force-cache' }).catch(() => {});
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(registration => {
    registration.update().catch(() => {});
  }).catch(() => {});
}

})();













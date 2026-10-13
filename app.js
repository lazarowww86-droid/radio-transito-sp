(() => {
'use strict';
const $ = id => document.getElementById(id);

// Um podcast por dia, repetido nos horários fixos; música aleatória no restante do dia.
const podcasts = [
 {type:'podcast',title:'Maníaco do Parque: era psicopata ou doente?',artist:'Histórias que Marcaram',src:'media/maniaco-do-parque.mp3',duration:1192.882},
 {type:'podcast',title:'Carandiru: do massacre ao indulto',artist:'Histórias que Marcaram',src:'media/carandiru.mp3',duration:793.182},
 {type:'podcast',title:'Caso Isabella Nardoni: mídia e perícia',artist:'Histórias que Marcaram',src:'media/isabella-nardoni.mp3',duration:695.144},
 {type:'podcast',title:'Chico Picadinho: por que continua preso?',artist:'Histórias que Marcaram',src:'media/chico-picadinho.mp3',duration:601.783}
];
const musicTracks = window.RadioMusicTracks;
const playlist = [...musicTracks, ...podcasts];
const programming = window.RadioProgramming.create(
  musicTracks.map((_, i) => i),
  podcasts.map((track, i) => ({index: musicTracks.length + i, duration: track.duration}))
);

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
  const track = playlist[idx], next = playlist[programming.peek()];
  $('track').textContent = track.title;
  $('artist').textContent = track.artist;
  $('next-title').textContent = next.title;
  $('next-type').textContent = next.type === 'podcast' ? 'Podcast • Histórias que Marcaram' : next.type === 'music' ? 'Música • seleção musical' : 'Identificação da Rádio Trânsito SP';
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
  current.dataset.startOffset = String(seek);
  if (current.readyState >= 1) current.currentTime = seek;
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
    if (element === current && element.paused && wanted && !announcement && !pendingPlay && !element.ended && element.readyState >= 2) {
      wanted = false; // Pausa solicitada pelo sistema ou por controles externos.
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

let weatherVoiceName = '';
try { weatherVoiceName = localStorage.getItem('radio_weather_voice') || ''; } catch (_) {}
function portugueseVoices() {
  return canSpeak() ? window.speechSynthesis.getVoices().filter(v => v.lang.replace('_', '-').toLowerCase() === 'pt-br') : [];
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
  if (!selector || !canSpeak()) return;
  const voices = portugueseVoices(), preferred = preferredWeatherVoice(voices);
  selector.replaceChildren();
  const automatic = document.createElement('option');
  automatic.value = ''; automatic.textContent = preferred ? `Automática — ${preferred.name}` : 'Voz padrão do dispositivo';
  selector.append(automatic);
  for (const voice of voices) {
    const option = document.createElement('option'); option.value = voice.name; option.textContent = voice.name; selector.append(option);
  }
  selector.value = voices.some(v => v.name === weatherVoiceName) ? weatherVoiceName : '';
}
if ($('weather-voice')) {
  $('weather-voice').addEventListener('change', event => {
    weatherVoiceName = event.target.value;
    try { localStorage.setItem('radio_weather_voice', weatherVoiceName); } catch (_) {}
  });
  if (canSpeak()) {
    window.speechSynthesis.addEventListener?.('voiceschanged', paintVoices);
    paintVoices();
  }
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
    if (current.ended) advanceProgram();
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
    const voice = selectedVoice(job.kind);
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

// Dicionário de rodovias da ARTESP para converter códigos técnicos em nomes claros.
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
  if (/^(Rodoanel|Anel\s+Vi[aá]rio)/i.test(nome)) return 'do';
  return 'da';
}

function formatTrafficItem(raw) {
  if (typeof raw !== 'string') return '';
  let text = raw.trim();

  // 1. Reconhece dispositivos, acessos e interligações como "SPD 006/021", "SPA 006/021", "SPI 006/021", "0006/021SP"
  text = text.replace(
    /\b(?:rodovia\s+|acesso\s+|dispositivo\s+|interliga[cç][aã]o\s+)?(?:(sp[dai]|acesso|dispositivo)\s*[-:/]?\s*)?0*(\d{1,4})\s*\/\s*0*(\d{2,3})(?:[\s\-/]*sp)?\b/gi,
    (_, prefix, dispDigits, rodDigits) => {
      const kmDisp = parseInt(dispDigits, 10);
      const nomeRod = nomeDaRodovia(rodDigits);
      const prep = preposicaoRodovia(nomeRod);
      const tipo = prefix && /^spi$/i.test(prefix) ? 'Interligação' : 'Acesso';
      return `${tipo} no km ${kmDisp} ${prep} ${nomeRod}`;
    }
  );

  // 2. Substitui códigos de rodovias como "Rodovia 0021SP", "0021SP", "SP-021" pelo nome conhecido da via
  text = text.replace(/\b(?:rodovia\s+)?(?:sp[\s\-/]*)?0*(\d{2,3})[\s\-/]*sp\b/gi, (_, digits) => {
    return nomeDaRodovia(digits);
  });

  // Caso venha no formato "Rodovia SP 0021" ou "SP 021" (sem alterar o que já está entre parênteses)
  text = text.replace(/(?<!\()\b(?:rodovia\s+)sp[\s\-/]*0*(\d{2,3})\b/gi, (_, digits) => {
    return nomeDaRodovia(digits);
  });

  // 3. Converte "sentido não se aplica", "sentido N/A", "sentido indefinido" para "sentido não informado",
  // mantendo a informação clara para o ouvinte de que o sentido não foi divulgado pela ARTESP.
  text = text.replace(
    /\b(no\s+)?sentido\s+(?:n[aã]o\s+se\s+aplica|n\/a|n\.a\.|n[aã]o\s+informado|indefinido|nenhum|-)\b/gi,
    'sem sentido informado'
  );

  // 4. Expande siglas de sentido isoladas caso existam (ex: "sentido L", "sentido Cap")
  const sentidos = {
    'n': 'Norte', 's': 'Sul', 'l': 'Leste', 'o': 'Oeste', 'w': 'Oeste',
    'cap': 'Capital', 'int': 'Interior', 'lit': 'Litoral',
    'ambos': 'ambos os sentidos'
  };
  text = text.replace(/\bsentido\s+(n|s|l|o|w|cap|int|lit|ambos)\b(?![a-zà-ú])/gi, (_, sigla) => {
    const expandido = sentidos[sigla.toLowerCase()];
    return expandido === 'ambos os sentidos' ? 'em ambos os sentidos' : `sentido ${expandido}`;
  });

  // 5. Limpa pontuações ou espaços duplicados
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
  // Ajusta siglas e números para que o sintetizador de voz leia com clareza total
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
    $('traffic-status').textContent = label + new Date(updated).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    $('traffic').textContent = items.slice(0, 6).join(' • ');
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
  if (!feedFresh()) { report(); return; }
  const text = prepareTrafficSpeech(items.slice(0, 6).join('. '));
  const job = beginAnnouncement('traffic');
  if (!job) {
    if (!canSpeak()) $('traffic-status').textContent = 'A leitura por voz não está disponível neste navegador.';
    return;
  }
  try {
    await playSting('media/vinheta-transito-mix.mp3', job);
    const spoken = await speakText(text, job);
    if (spoken) await playSting('media/vinheta-retornoA versão ajustada abaixo corrige exatamente esses dois pontos na função `formatTrafficItem` dentro do `app.js`[cite: 2]:

1. **Reconhecimento de rodovias de acesso/interligação (`SPD` e `SPA`):** A ARTESP utiliza o padrão `SPD XXX/YYY` (Rodovia de Desenvolvimento/Interligação) e `SPA XXX/YYY` (Rodovia de Acesso), onde os últimos dígitos após a barra indicam a rodovia tronco principal (ex: `SPD 006/021` é a interligação no **Rodoanel Mário Covas - SP-021**). A expressão regular foi atualizada para capturar códigos compostos com barra (`/`) ou hífen (`-`) e identificar a rodovia principal correspondente.
2. **Manutenção clara da informação de sentido ausente:** Em vez de apagar o trecho ou deixar a leitura robótica *"sentido não se aplica"*, o código agora converte `"sentido não se aplica"`, `"sentido N/A"` ou `"sentido não informado"` para **"com sentido não informado"**, garantindo que o ouvinte saiba explicitamente que a direção da ocorrência não foi detalhada pela concessionária/ARTESP.

---

### Arquivo `app.js` completo e corrigido

Copie o código abaixo e substitua no seu `app.js` lá no GitHub (todas as demais funções do player, programação e voz permanecem 100% intactas)[cite: 2]:

```javascript
(() => {
'use strict';
const $ = id => document.getElementById(id);

// Um podcast por dia, repetido nos horários fixos; música aleatória no restante do dia.
const podcasts = [
 {type:'podcast',title:'Maníaco do Parque: era psicopata ou doente?',artist:'Histórias que Marcaram',src:'media/maniaco-do-parque.mp3',duration:1192.882},
 {type:'podcast',title:'Carandiru: do massacre ao indulto',artist:'Histórias que Marcaram',src:'media/carandiru.mp3',duration:793.182},
 {type:'podcast',title:'Caso Isabella Nardoni: mídia e perícia',artist:'Histórias que Marcaram',src:'media/isabella-nardoni.mp3',duration:695.144},
 {type:'podcast',title:'Chico Picadinho: por que continua preso?',artist:'Histórias que Marcaram',src:'media/chico-picadinho.mp3',duration:601.783}
];
const musicTracks = window.RadioMusicTracks;
const playlist = [...musicTracks, ...podcasts];
const programming = window.RadioProgramming.create(
  musicTracks.map((_, i) => i),
  podcasts.map((track, i) => ({index: musicTracks.length + i, duration: track.duration}))
);

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
  const track = playlist[idx], next = playlist[programming.peek()];
  $('track').textContent = track.title;
  $('artist').textContent = track.artist;
  $('next-title').textContent = next.title;
  $('next-type').textContent = next.type === 'podcast' ? 'Podcast • Histórias que Marcaram' : next.type === 'music' ? 'Música • seleção musical' : 'Identificação da Rádio Trânsito SP';
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
  current.dataset.startOffset = String(seek);
  if (current.readyState >= 1) current.currentTime = seek;
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
    if (element === current && element.paused && wanted && !announcement && !pendingPlay && !element.ended && element.readyState >= 2) {
      wanted = false; // Pausa solicitada pelo sistema ou por controles externos.
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

let weatherVoiceName = '';
try { weatherVoiceName = localStorage.getItem('radio_weather_voice') || ''; } catch (_) {}
function portugueseVoices() {
  return canSpeak() ? window.speechSynthesis.getVoices().filter(v => v.lang.replace('_', '-').toLowerCase() === 'pt-br') : [];
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
  if (!selector || !canSpeak()) return;
  const voices = portugueseVoices(), preferred = preferredWeatherVoice(voices);
  selector.replaceChildren();
  const automatic = document.createElement('option');
  automatic.value = ''; automatic.textContent = preferred ? `Automática — ${preferred.name}` : 'Voz padrão do dispositivo';
  selector.append(automatic);
  for (const voice of voices) {
    const option = document.createElement('option'); option.value = voice.name; option.textContent = voice.name; selector.append(option);
  }
  selector.value = voices.some(v => v.name === weatherVoiceName) ? weatherVoiceName : '';
}
if ($('weather-voice')) {$('weather-voice').addEventListener('change', event => {
    weatherVoiceName = event.target.value;
    try { localStorage.setItem('radio_weather_voice', weatherVoiceName); } catch (_) {}
  });
  if (canSpeak()) {
    window.speechSynthesis.addEventListener?.('voiceschanged', paintVoices);
    paintVoices();
  }
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
    if (current.ended) advanceProgram();
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
    const voice = selectedVoice(job.kind);
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

// Dicionário de rodovias da ARTESP para converter códigos (ex: 0021SP, SPD 006/021) em nomes claros.
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

function formatTrafficItem(raw) {
  if (typeof raw !== 'string') return '';
  let text = raw.trim();

  // 1. Reconhece interligações e acessos como "SPD 006/021", "SPA 115/330", "SPI 102/300"
  text = text.replace(/\b(?:rodovia\s+)?(sp[daic])[\s\-]*0*(\d{1,3})\s*\/+\s*0*(\d{2,3})(?:[\s\-/]*sp)?\b/gi, (_, prefix, branch, mainDigits) => {
    const mainCode = mainDigits.padStart(3, '0');
    const mainNum = parseInt(mainDigits, 10);
    const branchNum = parseInt(branch, 10);
    const mainName = RODOVIAS_ARTESP[mainCode];
    const tipo = prefix.toUpperCase() === 'SPA' ? 'Acesso' : 'Interligação';
    if (mainName) {
      return `${tipo} ${branchNum} da ${mainName}`;
    }
    return `${tipo} ${branchNum} da Rodovia SP-${mainNum}`;
  });

  // 2. Substitui códigos como "Rodovia 0021SP", "0021SP", "006/021SP" pelo nome conhecido da via
  text = text.replace(/\b(?:rodovia\s+)?(?:sp[daic]?[\s\-/]*)?(?:0*\d{1,3}\s*\/+\s*)?0*(\d{2,3})[\s\-/]*sp\b/gi, (_, digits) => {
    const code = digits.padStart(3, '0');
    const num = parseInt(digits, 10);
    return RODOVIAS_ARTESP[code] || `Rodovia SP-${num}`;
  });

  // 3. Caso venha no formato "Rodovia SP 0021", "SP-021", "SPD 021"
  text = text.replace(/\b(?:rodovia\s+)?sp[daic]?[\s\-/]+0*(\d{2,3})\b/gi, (_, digits) => {
    const code = digits.padStart(3, '0');
    const num = parseInt(digits, 10);
    return RODOVIAS_ARTESP[code] || `Rodovia SP-${num}`;
  });

  // 4. Converte "sentido não se aplica", "sentido N/A", etc. para "sentido não informado" (mantendo a informação clara para o ouvinte)
  text = text.replace(/\b(?:no\s+|em\s+)?sentido\s+(?:n[aã]o\s+se\s+aplica|n\/a|n\.a\.|n[aã]o\s+informado|indefinido|nenhum|-)\b/gi, 'sentido não informado');

  // 5. Expande siglas de sentido isoladas caso existam (ex: "sentido L", "sentido Cap")
  const sentidos = {
    'n': 'Norte', 's': 'Sul', 'l': 'Leste', 'o': 'Oeste', 'w': 'Oeste',
    'cap': 'Capital', 'int': 'Interior', 'lit': 'Litoral',
    'ambos': 'ambos os sentidos'
  };
  text = text.replace(/\bsentido\s+(n|s|l|o|w|cap|int|lit|ambos)\b(?![a-zà-ú])/gi, (_, sigla) => {
    const expandido = sentidos[sigla.toLowerCase()];
    return expandido === 'ambos os sentidos' ? 'em ambos os sentidos' : `sentido ${expandido}`;
  });

  // 6. Limpa pontuações ou espaços duplicados
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
  // Ajusta siglas e abreviações para que o sintetizador de voz leia naturalmente
  return text
    .replace(/\(SP-0*(\d+)\)/gi, ', S P $1,')
    .replace(/\(BR-0*(\d+)\)/gi, ', B R $1,')
    .replace(/\bSP-0*(\d+)\b/gi, 'S P $1')
    .replace(/\bBR-0*(\d+)\b/gi, 'B R $1')
    .replace(/\bSPD[\s\-]*0*(\d+)\/0*(\d+)\b/gi, 'acesso $1 da S P $2')
    .replace(/\bSPA[\s\-]*0*(\d+)\/0*(\d+)\b/gi, 'acesso $1 da S P $2')
    .replace(/\bDom Pedro I\b/g, 'Dom Pedro Primeiro')
    .replace(/\bkm\s*(\d+)/gi, 'quilômetro $1')
    .replace(/\s+,/g, ',')
    .replace(/,{2,}/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

let items = [], updated = null, timestampVerified = true;
const DEFAULT_FEED_URL = '[https://radio-transito-sp.lazarowww86.workers.dev/boletins](https://radio-transito-sp.lazarowww86.workers.dev/boletins)';
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
  if (!feedFresh()) { report(); return; }
  const text = prepareTrafficSpeech(items.slice(0, 6).join('. '));
  const job = beginAnnouncement('traffic');
  if (!job) {
    if (!canSpeak()) $('traffic-status').textContent = 'A leitura por voz não está disponível neste navegador.';
    return;
  }
  try {
    await playSting('media/vinheta-transito-mix.mp3', job);
    const spoken = await speakText(text, job);
    if (spoken) await playSting('media/vinheta-retorno-mix.mp3', job);
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
  activate(programming.previous(playlist[idx].type === 'podcast'));
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
    if ($('weather-status'))$('weather-status').textContent = 'Previsão temporariamente indisponível.';
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

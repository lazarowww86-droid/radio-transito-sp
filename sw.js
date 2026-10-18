const BUILD = '20261018-r46-mix1987-estereo';
const MEDIA_BUILD = '20261013-r2-light';
const PREFIX = 'radio-transito-sp-';
const SCOPE = encodeURIComponent(new URL(self.registration.scope).pathname);
const SHELL = `${PREFIX}${SCOPE}-shell-${BUILD}`;
const MEDIA = `${PREFIX}${SCOPE}-media-${MEDIA_BUILD}`;
const CORE = [
  './', './index.html', `./styles.css?v=${BUILD}`, `./music-tracks.js?v=${BUILD}`, `./programming.js?v=${BUILD}`, `./weather.js?v=${BUILD}`, `./news.js?v=${BUILD}`, `./roads.js?v=${BUILD}`, `./app.js?v=${BUILD}`, `./diagnostics.js?v=${BUILD}`,
  './manifest.json', `./icon.svg?v=${BUILD}`, `./icon-192.png?v=${BUILD}`, `./icon-512.png?v=${BUILD}`, `./icon-maskable-512.png?v=${BUILD}`, `./apple-touch-icon.png?v=${BUILD}`
];
const urlFor = path => new URL(path, self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key !== SHELL && key !== MEDIA &&
      (key.startsWith(`${PREFIX}${SCOPE}-`) || /^radio-transito-sp-v\d/.test(key)))
    .map(key => caches.delete(key))))
    .then(async () => {
      const cache = await caches.open(MEDIA);
      const obsolete = ['instrumental-retro-80.mp3', 'instrumental-pop-90.mp3']
        .map(file => new URL(`./media/${file}`, self.registration.scope).pathname);
      for (const request of await cache.keys()) {
        if (obsolete.includes(new URL(request.url).pathname)) await cache.delete(request);
      }
      return self.clients.claim();
    }));
});

// Áudios pedem intervalos de bytes. O arquivo completo em cache precisa
// virar uma resposta 206, inclusive quando o ouvinte estiver offline.
async function mediaRange(response, range) {
  if (!range) return response;
  const blob = await response.blob(), size = blob.size;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] ? (match[2] ? Number(match[2]) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start < 0 || end < start) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  end = Math.min(end, size - 1);
  const headers = new Headers(response.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');
  headers.delete('Content-Encoding');
  return new Response(blob.slice(start, end + 1, headers.get('Content-Type') || 'audio/mpeg'), { status: 206, headers });
}

async function serveMedia(request) {
  const cache = await caches.open(MEDIA);
  const cached = await cache.match(request.url);
  if (cached && cached.status === 200) return mediaRange(cached, request.headers.get('Range'));
  const response = await fetch(request);
  // Respostas parciais nunca substituem o arquivo completo no cache.
  if (response.status === 200 && !request.headers.has('Range')) {
    try { await cache.put(request.url, response.clone()); } catch (_) {}
  }
  return response;
}

async function serveShell(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    try { await cache.put(request, response.clone()); } catch (_) {}
    return response;
  } catch (error) {
    const cached = await cache.match(request) || await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const index = await cache.match(urlFor('./index.html'));
      if (index) return index;
    }
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url), scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (url.pathname.startsWith(new URL('./media/', scope).pathname)) {
    event.respondWith(serveMedia(request));
  } else if (request.mode === 'navigate' || CORE.some(path => new URL(path, scope).pathname === url.pathname)) {
    event.respondWith(serveShell(request));
  }
});







const MAX_BYTES = 262144;
const headersFor = origin => ({'Access-Control-Allow-Origin':origin, 'Vary':'Origin', 'X-Content-Type-Options':'nosniff'});
const fail = (status, error, origin) => new Response(JSON.stringify({error}), {status, headers:{...headersFor(origin),'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export async function voiceResponse(request, origin, fetcher = fetch) {
  const url = new URL(request.url), text = url.searchParams.get('q')?.trim();
  if ([...url.searchParams.keys()].some(k => k !== 'q') || url.searchParams.getAll('q').length !== 1 || !text || text.length > 165 || /[\x00-\x1f]/.test(text)) return fail(400,'Texto inválido: use até 165 caracteres.',origin);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  try {
    const endpoint = new URL('https://translate.googleapis.com/translate_tts');
    endpoint.search = new URLSearchParams({ie:'UTF-8',client:'gtx',tl:'pt-BR',q:text}).toString();
    const response = await fetcher(endpoint.href, {headers:{Accept:'audio/mpeg','User-Agent':'RadioTransitoSP/1.0'},redirect:'manual',signal:controller.signal});
    if (!response.ok || !/^audio\/(mpeg|mp3)(;|$)/i.test(response.headers.get('Content-Type') || '')) { await response.body?.cancel(); return fail(502,'O serviço de voz não forneceu um MP3.',origin); }
    const reader = response.body?.getReader();
    if (!reader) return fail(502,'Áudio vazio.',origin);
    const chunks = []; let length = 0;
    try {
      while (true) {
        const {done,value} = await reader.read(); if (done) break;
        length += value.length;
        if (length > MAX_BYTES) { await reader.cancel(); return fail(502,'Áudio excedeu o limite.',origin); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
    const id3 = bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51;
    const frame = bytes[0] === 255 && (bytes[1] & 224) === 224;
    if (length < 16 || (!id3 && !frame)) return fail(502,'Resposta não reconhecida como MP3.',origin);
    return new Response(bytes, {headers:{...headersFor(origin),'Content-Type':'audio/mpeg','Content-Length':String(length),'Cache-Control':'public, max-age=3600'}});
  } catch (_) { return fail(503,'Voz temporariamente indisponível.',origin); }
  finally { clearTimeout(timer); }
}

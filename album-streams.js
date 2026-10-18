/* Arquivos de envio menores, uma seleção contínua para o player. */
(() => {
'use strict';
const ALBUMS = [{"src":"media/selecoes/alanis-completo.m4a","size":110935648,"parts":[{"src":"media/selecoes/alanis-01.bin","size":23000000},{"src":"media/selecoes/alanis-02.bin","size":23000000},{"src":"media/selecoes/alanis-03.bin","size":23000000},{"src":"media/selecoes/alanis-04.bin","size":23000000},{"src":"media/selecoes/alanis-05.bin","size":18935648}],"duration":6859.522902},{"src":"media/selecoes/emocionar1987-completo.m4a","size":73256451,"parts":[{"src":"media/selecoes/emocionar1987-01.bin","size":23000000},{"src":"media/selecoes/emocionar1987-02.bin","size":23000000},{"src":"media/selecoes/emocionar1987-03.bin","size":23000000},{"src":"media/selecoes/emocionar1987-04.bin","size":4256451}],"duration":4529.679093},{"src":"media/selecoes/selecao89-completo.m4a","size":75894209,"parts":[{"src":"media/selecoes/selecao89-01.bin","size":23000000},{"src":"media/selecoes/selecao89-02.bin","size":23000000},{"src":"media/selecoes/selecao89-03.bin","size":23000000},{"src":"media/selecoes/selecao89-04.bin","size":6894209}],"duration":4692.822109}];
function find(pathname, scope) {
  return ALBUMS.find(album => new URL(album.src, scope).pathname === pathname);
}
function interval(range, size) {
  if (!range) return {start:0, end:size - 1, partial:false};
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  return {start,end,partial:true};
}
async function serve(request, scope) {
  const album = find(new URL(request.url).pathname, scope);
  if (!album) return new Response(null, {status:404});
  const span = interval(request.headers.get('Range'), album.size);
  if (!span) return new Response(null, {status:416, headers:{'Content-Range':`bytes */${album.size}`}});
  let offset = 0;
  const pieces = [];
  for (const part of album.parts) {
    const start = Math.max(span.start, offset), end = Math.min(span.end, offset + part.size - 1);
    if (start <= end) pieces.push({part, start:start-offset, end:end-offset});
    offset += part.size;
  }
  const abort = new AbortController();
  let reader = null, currentPiece = 0, skip = 0, remaining = 0, cancelled = false;
  const cancel = () => { cancelled = true; abort.abort(); if (reader) reader.cancel().catch(() => {}); };
  if (request.signal.aborted) return new Response(null, {status:499});
  request.signal.addEventListener('abort', cancel, {once:true});
  const detach = () => request.signal.removeEventListener('abort', cancel);
  async function open() {
    if (cancelled) throw new Error('Reprodução cancelada');
    const piece = pieces[currentPiece++];
    const url = new URL(piece.part.src, scope).href;
    const response = await fetch(url, {headers:{Range:`bytes=${piece.start}-${piece.end}`}, signal:abort.signal});
    if (!response.ok || !response.body) throw new Error('Arquivo de áudio indisponível');
    if (response.status === 206) {
      const expected = `bytes ${piece.start}-${piece.end}/${piece.part.size}`;
      if (response.headers.get('Content-Range') !== expected) throw new Error('Intervalo de áudio inválido');
      skip = 0;
    } else if (response.status === 200) {
      // Servidores que ignoram Range: descarta apenas o prefixo, sem carregar o álbum inteiro.
      skip = piece.start;
    } else throw new Error('Resposta de áudio inválida');
    remaining = piece.end - piece.start + 1;
    reader = response.body.getReader();
  }
  // Verifica a primeira parte antes de entregar uma resposta de sucesso ao player.
  try { await open(); } catch (_) { cancel(); detach(); return new Response(null, {status:502}); }
  const body = new ReadableStream({
    async pull(controller) {
      try {
        for (;;) {
          if (cancelled) { controller.error(new Error('Reprodução cancelada')); detach(); return; }
          if (remaining === 0) {
            if (reader) { await reader.cancel(); reader = null; }
            if (currentPiece >= pieces.length) { controller.close(); detach(); return; }
            await open();
          }
          const data = await reader.read();
          if (data.done) throw new Error('Arquivo de áudio incompleto');
          let chunk = data.value;
          if (skip) { const n = Math.min(skip,chunk.byteLength); skip -= n; chunk = chunk.subarray(n); }
          if (!chunk.byteLength) continue;
          const n = Math.min(remaining,chunk.byteLength);
          remaining -= n;
          controller.enqueue(chunk.subarray(0,n));
          return;
        }
      } catch (error) { cancel(); detach(); controller.error(error); }
    },
    cancel() { cancel(); detach(); }
  });
  const headers = {'Content-Type':'audio/mp4', 'Accept-Ranges':'bytes', 'Content-Length':String(span.end-span.start+1), 'Cache-Control':'no-store'};
  if (span.partial) headers['Content-Range'] = `bytes ${span.start}-${span.end}/${album.size}`;
  return new Response(body, {status:span.partial?206:200,headers});
}
self.RadioAlbumStreams = {find,serve,interval};
})();

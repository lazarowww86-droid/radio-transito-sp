(() => {
  'use strict';
  const key = 'radio-background-diagnostics-v1';
  let entries = [], lastProgress = 0;
  try { const saved = JSON.parse(localStorage.getItem(key) || '[]'); if (Array.isArray(saved)) entries = saved.slice(-599); } catch (_) {}
  function record(event, data = {}) {
    try {
      entries.push({at:new Date().toISOString(), event, visibility:document.visibilityState, ...data});
      if (entries.length > 600) entries.splice(0, entries.length - 600);
      localStorage.setItem(key, JSON.stringify(entries));
    } catch (_) {}
  }
  window.RadioDiagnostics = {
    record,
    progress(data) { if (Date.now() - lastProgress >= 30000) { lastProgress = Date.now(); record('audio-progress', data); } }
  };
  record('page-open');
  document.addEventListener('visibilitychange', () => record('visibility-change'));
  document.addEventListener('freeze', () => record('freeze'));
  document.addEventListener('resume', () => record('resume'));
  if (new URL(location.href).searchParams.get('diagnostico') !== '1') return;
  const button = document.createElement('button');
  button.textContent = 'Baixar diagnóstico';
  button.type = 'button';
  button.style.cssText = 'display:block;margin:20px auto;padding:14px;border-radius:10px;background:#0dd5c2;color:#07101d;font-weight:bold';
  button.addEventListener('click', () => {
    record('export');
    const url = URL.createObjectURL(new Blob([JSON.stringify({build:'20261014-r41-voice-watch', entries}, null, 2)], {type:'application/json'}));
    const link = document.createElement('a');
    link.href = url; link.download = 'diagnostico-radio.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  document.body.append(button);
})();

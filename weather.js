(function (global) {
'use strict';
const INTERVAL = 30 * 60 * 1000, RETRY = 5 * 60 * 1000, MAX_AGE = 45 * 60 * 1000;
const CITIES = [
  { id: 'sp', name: 'São Paulo', latitude: -23.5475, longitude: -46.63611 },
  { id: 'gru', name: 'Guarulhos', latitude: -23.46278, longitude: -46.53333 }
];
const CONDITIONS = {
  0: 'Céu limpo', 1: 'Predominantemente limpo', 2: 'Parcialmente nublado', 3: 'Céu encoberto',
  45: 'Nevoeiro', 48: 'Nevoeiro com formação de gelo',
  51: 'Garoa leve', 53: 'Garoa moderada', 55: 'Garoa intensa',
  56: 'Garoa congelante leve', 57: 'Garoa congelante intensa',
  61: 'Chuva leve', 63: 'Chuva moderada', 65: 'Chuva forte', 66: 'Chuva congelante leve', 67: 'Chuva congelante forte',
  71: 'Neve leve', 73: 'Neve moderada', 75: 'Neve intensa', 77: 'Grãos de neve',
  80: 'Pancadas de chuva leves', 81: 'Pancadas de chuva moderadas', 82: 'Pancadas de chuva fortes',
  85: 'Pancadas de neve leves', 86: 'Pancadas de neve fortes',
  95: 'Trovoadas', 96: 'Trovoadas com granizo', 97: 'Trovoadas fortes', 99: 'Trovoadas com granizo forte'
};
const localFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const numberFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const number = value => typeof value === 'number' && Number.isFinite(value);
const temperature = value => number(value) && value >= -50 && value <= 60;
function localParts(time) { return Object.fromEntries(localFormatter.formatToParts(new Date(time)).map(p => [p.type, p.value])); }
function dateKey(time) { const p = localParts(time); return `${p.year}-${p.month}-${p.day}`; }
function hourText(time) { const p = localParts(time); return `${p.hour}:${p.minute}`; }
function sourceTime(value, offset) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value || '');
  if (!m || !number(offset) || Math.abs(offset) > 14 * 3600) return NaN;
  const parts = m.slice(1).map(x => Number(x || 0));
  if (parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[2] > 31 || parts[3] > 23 || parts[4] > 59 || parts[5] > 59) return NaN;
  const utc = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  return utc - offset * 1000;
}
function apiURL() {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: CITIES.map(c => c.latitude).join(','), longitude: CITIES.map(c => c.longitude).join(','),
    current: 'temperature_2m,apparent_temperature,weather_code', hourly: 'precipitation_probability',
    daily: 'temperature_2m_max,temperature_2m_min', forecast_days: '2',
    timezone: 'America/Sao_Paulo', temperature_unit: 'celsius'
  }).toString();
  return url.href;
}
function parse(data, now = Date.now()) {
  if (!Array.isArray(data) || data.length !== CITIES.length) throw new Error('Resposta incompleta');
  const today = dateKey(now), tomorrow = dateKey(now + 24 * 3600 * 1000);
  const useTomorrow = Number(localParts(now).hour) >= 18;
  const day = useTomorrow ? tomorrow : today;
  const cities = data.map((d, index) => {
    const city = CITIES[index], current = d.current, daily = d.daily, hourly = d.hourly;
    if (d.timezone !== 'America/Sao_Paulo' || !number(d.latitude) || !number(d.longitude) ||
        Math.abs(d.latitude - city.latitude) > 0.25 || Math.abs(d.longitude - city.longitude) > 0.25 ||
        d.current_units?.temperature_2m !== '°C' || d.current_units?.apparent_temperature !== '°C' ||
        d.daily_units?.temperature_2m_min !== '°C' || d.daily_units?.temperature_2m_max !== '°C' ||
        !current || !temperature(current.temperature_2m) || !temperature(current.apparent_temperature)) throw new Error('Dados inválidos');
    const at = sourceTime(current.time, d.utc_offset_seconds), age = now - at;
    if (!Number.isFinite(at) || age < -15 * 60000 || age > 75 * 60000) throw new Error('Dados desatualizados');
    const dayIndex = Array.isArray(daily?.time) ? daily.time.indexOf(day) : -1;
    const min = daily?.temperature_2m_min?.[dayIndex], max = daily?.temperature_2m_max?.[dayIndex];
    if (dayIndex < 0 || !temperature(min) || !temperature(max) || min > max) throw new Error('Previsão diária indisponível');
    let rain = null;
    if (Array.isArray(hourly?.time) && Array.isArray(hourly.precipitation_probability) && d.hourly_units?.precipitation_probability === '%') {
      const upcoming = hourly.time.map((value, i) => ({ at: sourceTime(value, d.utc_offset_seconds), chance: hourly.precipitation_probability[i] }))
        .filter(h => h.at > now && h.at <= now + 3 * 3600 * 1000 && number(h.chance) && h.chance >= 0 && h.chance <= 100);
      if (upcoming.length) rain = Math.max(...upcoming.map(h => h.chance));
    }
    const code = current.weather_code;
    const condition = Number.isInteger(code) ? CONDITIONS[code] : null;
    const symbol = !condition ? '◌' : code <= 1 ? '☀' : code <= 3 ? '☁' : code >= 95 ? 'ϟ' : code >= 51 && code <= 82 ? '☂' : '☁';
    return { ...city, at, temperature: current.temperature_2m, feels: current.apparent_temperature, min, max, rain,
      weatherCode: Number.isInteger(code) ? code : null, condition: condition || 'Condição não informada', hasCondition: Boolean(condition), symbol };
  });
  return { cities, fetchedAt: now, forecastDate: day, dayLabel: useTomorrow ? 'amanhã' : 'hoje' };
}
function fresh(snapshot, now = Date.now()) {
  return Boolean(snapshot && now >= snapshot.fetchedAt - 60000 && now - snapshot.fetchedAt <= MAX_AGE &&
    (snapshot.forecastDate === dateKey(now) || snapshot.forecastDate === dateKey(now + 24 * 3600 * 1000)) &&
    snapshot.cities.every(city => now - city.at <= 75 * 60000 && now - city.at >= -15 * 60000));
}
function spokenNumber(value) { const rounded = Math.round(value); return rounded < 0 ? 'menos ' + Math.abs(rounded) : String(rounded); }
function text(snapshot, now = Date.now()) {
  const dayLabel = snapshot.forecastDate === dateKey(now) ? 'hoje' : 'amanhã';
  return 'Rádio Trânsito SP. Previsão do tempo, segundo a Open Meteo. ' + snapshot.cities.map(city => {
    const degrees = Math.abs(Math.round(city.temperature)) === 1 ? 'grau' : 'graus';
    return `Em ${city.name}, ${spokenNumber(city.temperature)} ${degrees}` +
      (city.hasCondition ? ` e ${city.condition.toLocaleLowerCase('pt-BR')}` : '') +
      `. Sensação de ${spokenNumber(city.feels)}. Para ${dayLabel}, mínima de ${spokenNumber(city.min)} e máxima de ${spokenNumber(city.max)} graus.` +
      (city.rain === null ? '' : ` Chance de chuva nas próximas horas de até ${Math.round(city.rain)} por cento.`);
  }).join(' ');
}

function create(hooks) {
  const $ = id => document.getElementById(id);
  if (!$('weather-status') || !$('weather-speak') || !$('weather-refresh')) throw new Error('Painel de previsão ausente');
  let snapshot = null, inFlight = null, bulletinRunning = false, nextAt = null, interaction = 0;
  let lastError = false, lastPaint = '';
  const timers = [];
  function message(value) { $('weather-status').textContent = value; }
  function buttons(busy) {
    $('weather-speak').disabled = busy;
    $('weather-refresh').disabled = busy;
    $('weather-panel').setAttribute('aria-busy', String(busy));
  }
  function paint() {
    const available = fresh(snapshot);
    const dayLabel = snapshot?.forecastDate === dateKey(Date.now()) ? 'hoje' : 'amanhã';
    const paintKey = `${available}:${snapshot?.fetchedAt}:${lastError}:${dayLabel}`;
    if (paintKey === lastPaint) return;
    lastPaint = paintKey;
    for (const city of CITIES) {
      const value = available ? snapshot.cities.find(c => c.id === city.id) : null;
      $(`weather-${city.id}-symbol`).textContent = value?.symbol || '◌';
      $(`weather-${city.id}-temp`).textContent = value ? numberFormatter.format(value.temperature) : '--';
      $(`weather-${city.id}-condition`).textContent = value?.condition || 'Previsão indisponível';
      $(`weather-${city.id}-feels`).textContent = value ? numberFormatter.format(value.feels) + '°C' : '--';
      $(`weather-${city.id}-range`).textContent = value ? `${numberFormatter.format(value.min)}° / ${numberFormatter.format(value.max)}°` : '--';
      $(`weather-${city.id}-day`).textContent = available ? `Mín. / máx. ${dayLabel}` : 'Mín. / máx.';
      $(`weather-${city.id}-rain`).textContent = value && value.rain !== null ? `Chance de chuva nas próximas horas: até ${Math.round(value.rain)}%` : 'Chance de chuva não informada';
    }
    if (available) {
      message((lastError ? 'Consulta indisponível; últimas estimativas: ' : 'Estimativas válidas às ') +
        snapshot.cities.map(city => `${city.name} ${hourText(city.at)}`).join(' • ') + '.');
    } else message(snapshot ? 'Previsão desatualizada. Aguardando dados recentes.' : 'Previsão temporariamente indisponível. Tente atualizar.');
  }
  function refresh() {
    if (inFlight) return inFlight;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
    buttons(true);
    message('Consultando a previsão de São Paulo e Guarulhos…');
    inFlight = (async () => {
      try {
        const response = await fetch(apiURL(), { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Fonte indisponível');
        snapshot = parse(await response.json());
        lastError = false;
        lastPaint = '';
        paint();
        return true;
      } catch (_) {
        lastError = true;
        lastPaint = '';
        paint();
        return false;
      } finally {
        clearTimeout(timeout);
        inFlight = null;
        if (!bulletinRunning) buttons(false);
      }
    })();
    return inFlight;
  }
  async function bulletin(manual = true) {
    if (bulletinRunning) return;
    if (!hooks.canAnnounce(manual)) {
      if (manual) message('Outro aviso está no ar. Aguarde para ouvir a previsão.');
      return;
    }
    const revision = interaction, wasListening = hooks.isListening();
    bulletinRunning = true;
    buttons(true);
    try {
      // Na leitura manual, usa a previsão válida sem perder o toque em uma consulta.
      const readyAtClick = manual && fresh(snapshot);
      const loaded = readyAtClick || await refresh(); // A programação continua durante a consulta.
      if (manual && !readyAtClick && loaded && fresh(snapshot)) {
        message('Previsão atualizada. Toque novamente em OUVIR BOLETIM para iniciar a voz.');
        return;
      }
      if (revision !== interaction || (wasListening && !hooks.isListening())) return;
      if (!loaded || !fresh(snapshot)) { if (!manual) nextAt = Date.now() + RETRY; return; }
      if (!hooks.canAnnounce(manual)) { if (!manual) nextAt = Date.now() + 5000; return; }
      const said = await hooks.announce(text(snapshot), snapshot, () => revision === interaction && (!wasListening || hooks.isListening()) && fresh(snapshot));
      if (revision !== interaction) return;
      nextAt = Date.now() + (said ? INTERVAL : RETRY);
      if (!said) message(hooks.voiceFailure?.() || 'A leitura por voz não está disponível no momento. Consulte a previsão no painel.');
    } catch (_) {
      if (revision === interaction) message('Não foi possível ler o boletim. Consulte a previsão no painel.');
      if (!manual) nextAt = Date.now() + RETRY;
    } finally { bulletinRunning = false; buttons(Boolean(inFlight)); }
  }
  function schedule() {
    if (!inFlight) paint();
    if (!hooks.isListening()) return;
    if (nextAt === null) nextAt = Date.now() + INTERVAL;
    if (Date.now() >= nextAt && !bulletinRunning && hooks.canAnnounce(false)) bulletin(false);
  }
  function cancelPending() { interaction++; }
  for (const id of ['play', 'next', 'prev']) $(id)?.addEventListener('click', cancelPending);
  $('weather-speak').addEventListener('click', () => { hooks.unlockVoice?.(); bulletin(true); });
  $('weather-refresh').addEventListener('click', refresh);
  timers.push(setInterval(refresh, INTERVAL), setInterval(schedule, 1000));
  refresh();
  return { refresh, bulletin, schedule };
}
const api = { create, parse, fresh, text, sourceTime, apiURL, CITIES, INTERVAL };
if (typeof module === 'object' && module.exports) module.exports = api;
else global.RadioWeather = api;
})(typeof window === 'object' ? window : globalThis);

import http from 'node:http';
import { Agent, EnvHttpProxyAgent, fetch as fetchWeather } from 'undici';

const MAX_PROVIDER_BYTES = 1024 * 1024;

export function createWeatherTransport() {
  // Distant IPv4 providers can need more than Node's 250ms before an unreachable IPv6 attempt.
  const connect = { autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 2000 };
  // Node has already resolved startup flags, NODE_OPTIONS, and NODE_USE_ENV_PROXY.
  const dispatcher = http.globalAgent.options?.proxyEnv
    ? new EnvHttpProxyAgent({ connect, proxyTls: connect, requestTls: connect })
    : new Agent({ connect });
  return {
    fetch: (url, options) => fetchWeather(url, { ...options, dispatcher }),
    stop: () => dispatcher.destroy()
  };
}

export function weatherUrls(location, timezone = 'UTC') {
  const common = { latitude: location.latitude, longitude: location.longitude, timezone, timeformat: 'unixtime' };
  const forecast = new URL('https://api.open-meteo.com/v1/forecast');
  forecast.search = new URLSearchParams({ ...common, temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm', forecast_days: 7, current: 'temperature_2m,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m', hourly: 'temperature_2m,weather_code,is_day', daily: 'weather_code,temperature_2m_max,temperature_2m_min' });
  const air = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  air.search = new URLSearchParams({ ...common, timezone: 'UTC', current: 'us_aqi' });
  return { forecast, air };
}

export async function providerJson(url, signal, fetchImpl) {
  const response = await fetchImpl(url, { signal, redirect: 'error' });
  if (signal.aborted || !response.ok || Number(response.headers.get('content-length')) > MAX_PROVIDER_BYTES) { void response.body?.cancel().catch(() => {}); throw new Error('Weather provider unavailable'); }
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (signal.aborted) throw new Error('Weather request canceled'); if (done) break;
      length += value.byteLength; if (length > MAX_PROVIDER_BYTES) throw new Error('Weather response exceeds limits'); if (value.byteLength) chunks.push(Buffer.from(value));
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) throw new Error('Invalid weather provider response');
  return data;
}

export async function retrieve(url, controller, options) {
  let timer; let abort;
  const interrupted = new Promise((_resolve, reject) => {
    abort = () => reject(new Error('Weather request canceled'));
    controller.signal.addEventListener('abort', abort, { once: true });
    timer = options.schedule(() => controller.abort(), options.timeoutMs);
  });
  try { return await Promise.race([providerJson(url, controller.signal, options.fetchImpl), interrupted]); }
  finally { options.cancel(timer); controller.signal.removeEventListener('abort', abort); }
}

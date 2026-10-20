export const location = { latitude: 51, longitude: 0, label: 'London' };
export const epoch = Date.parse('2026-10-11T12:00:00Z');
// Shape captured from the current Open-Meteo Seoul air-quality response.
export function rawAir(aqi = 91) {
  return { latitude: 37.6, longitude: 127, generationtime_ms: 0.3279, utc_offset_seconds: 0, timezone: 'GMT', timezone_abbreviation: 'GMT', elevation: 27, current_units: { time: 'unixtime', interval: 'seconds', us_aqi: 'USAQI' }, current: { time: epoch / 1000, interval: 3600, us_aqi: aqi } };
}
export function rawForecast(temperature = 12) {
  const time = epoch / 1000;
  return {
    current: { time, temperature_2m: temperature, weather_code: 0, is_day: 1, wind_speed_10m: 8, relative_humidity_2m: 50, precipitation: 25.4 },
    current_units: { temperature_2m: '°C', wind_speed_10m: 'km/h', relative_humidity_2m: '%', precipitation: 'mm', is_day: '', weather_code: '' },
    hourly: { time: Array.from({ length: 25 }, (_, i) => time + i * 3600), temperature_2m: Array(25).fill(13), weather_code: Array(25).fill(2), is_day: Array(25).fill(1) },
    hourly_units: { temperature_2m: '°C' },
    daily: { time: Array.from({ length: 7 }, (_, i) => time + i * 86400), temperature_2m_min: Array(7).fill(8), temperature_2m_max: Array(7).fill(15), weather_code: Array(7).fill(2) },
    daily_units: { temperature_2m_max: '°C' }, utc_offset_seconds: 0
  };
}

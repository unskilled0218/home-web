import { validateWeatherLocation, weatherTimezone, validateWeatherSnapshot } from './weather-data.js';
export const MAX_LOCAL_WEATHER_BYTES = 262144;
export const localWeatherSource = (location, timezone) => JSON.stringify([location.latitude, location.longitude, weatherTimezone(timezone)]);
export function validateLocalWeatherSnapshot(value, location, timezone) {
  const expected = validateWeatherLocation(location); const zone = weatherTimezone(timezone);
  if (value?.scope !== 'local' || value.sourceId !== localWeatherSource(expected, zone) || value.location?.latitude !== expected.latitude || value.location?.longitude !== expected.longitude || value.timezone !== zone) throw new Error('Local weather source changed.');
  return { ...validateWeatherSnapshot(value), location: expected };
}

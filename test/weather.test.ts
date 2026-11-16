import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forecastUrl, geocodeUrl, parseForecast, parsePlace, weatherMessage } from '../src/main/weather';

test('lugar y pronóstico a partir de las respuestas de Open-Meteo', () => {
  const place = parsePlace({ results: [{ name: 'Concepción', latitude: -36.827, longitude: -73.05, admin1: 'Biobío', country: 'Chile' }] });
  assert.deepEqual(place, { name: 'Concepción, Biobío, Chile', lat: -36.827, lon: -73.05 });
  assert.equal(parsePlace({ results: [] }), null);
  assert.equal(parsePlace({}), null);
  assert.match(geocodeUrl(' Concepción '), /name=Concepci%C3%B3n$/);
  assert.match(forecastUrl(place!), /latitude=-36\.827&longitude=-73\.050/);

  const f = parseForecast({ daily: { weather_code: [63], temperature_2m_max: [14.4], temperature_2m_min: [8.6], precipitation_probability_max: [90] } });
  assert.deepEqual(f, { min: 8.6, max: 14.4, code: 63, rain: 90 });
  assert.equal(parseForecast({ daily: {} }), null);
  assert.equal(weatherMessage(place!.name, f!), '🌧️ Hoy en Concepción: con lluvia, entre 9° y 14°. Lleva paraguas ☔');
});

test('consejos según el día', () => {
  assert.equal(weatherMessage('Santiago, Chile', { min: 18, max: 32, rain: 0, code: 0 }), '☀️ Hoy en Santiago: despejado, entre 18° y 32°. Toma harta agua 💧');
  assert.equal(weatherMessage('Punta Arenas', { min: -2, max: 4, rain: 10, code: 3 }), '☁️ Hoy en Punta Arenas: nublado, entre -2° y 4°. Abrígate bien 🧣');
  assert.equal(weatherMessage('Lima', { min: 17, max: 22, rain: 5, code: 2 }), '🌤️ Hoy en Lima: parcialmente nublado, entre 17° y 22°.');
});

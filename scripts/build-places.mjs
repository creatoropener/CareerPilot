// Regenerates src/data/places.json from GeoNames data (CC BY 4.0, https://www.geonames.org).
// Not part of the normal build. To refresh the data:
//   npm install --no-save all-the-cities country-list
//   node scripts/build-places.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const cities = require('all-the-cities');
const { getData } = require('country-list');

const MIN_POPULATION = 15000; // about 24,000 places; smaller towns can be typed in as custom entries
const countryCodes = getData().map((country) => country.code).sort();
const countryIndex = new Map(countryCodes.map((code, index) => [code, index]));

const seen = new Set();
const rows = cities
  .filter((city) => city.population >= MIN_POPULATION && countryIndex.has(city.country))
  .sort((a, b) => b.population - a.population)
  .filter((city) => {
    const key = `${city.name}|${city.country}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

// Columns, ordered by population (largest first) so ranking needs no extra field.
const output = {
  source: 'GeoNames (CC BY 4.0)',
  countries: countryCodes,
  names: rows.map((city) => city.name),
  country: rows.map((city) => countryIndex.get(city.country)),
};
writeFileSync(new URL('../src/data/places.json', import.meta.url), JSON.stringify(output));
console.log(`wrote ${rows.length} places in ${countryCodes.length} countries`);

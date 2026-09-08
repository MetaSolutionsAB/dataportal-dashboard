import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULTS = {
  entrystore: {
    baseURI: 'https://admin.dataportal.se/store/',
    timeoutMs: 30000,
  },
  datasets: {
    rdfType: 'dcat:Dataset',
    recentHours: 24,
  },
  harvest: {
    maxAgeHours: 26,
    statusUrl: null,
    statusMaxAgeMinutes: 90,
    catalogs: [],
  },
  exports: {
    maxAgeHours: 26,
    files: [],
  },
  statistics: {
    files: [],
  },
  output: 'public/status.json',
};

function merge(base, extra) {
  if (Array.isArray(base) || Array.isArray(extra)) return extra ?? base;
  if (typeof base !== 'object' || base === null) return extra ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra ?? {})) {
    out[k] = typeof v === 'object' && v !== null && !Array.isArray(v) ? merge(base[k] ?? {}, v) : v;
  }
  return out;
}

function validate(config) {
  const problems = [];
  if (!config.entrystore?.baseURI) problems.push('entrystore.baseURI saknas');
  for (const [i, c] of (config.harvest.catalogs ?? []).entries()) {
    if (!c.contextId) problems.push(`harvest.catalogs[${i}].contextId saknas`);
  }
  for (const [i, f] of (config.exports.files ?? []).entries()) {
    if (!f.name) problems.push(`exports.files[${i}].name saknas`);
    if (!f.path) problems.push(`exports.files[${i}].path saknas`);
  }
  if (problems.length) {
    throw new Error(`Ogiltig konfiguration:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * Läser konfigurationsfilen och fyller på med standardvärden. Relativa
 * sökvägar i konfigurationen tolkas relativt konfigurationsfilens katalog.
 */
export async function loadConfig(configPath) {
  const absolute = path.resolve(configPath);
  const raw = JSON.parse(await readFile(absolute, 'utf8'));
  const config = merge(DEFAULTS, raw);
  config.baseDir = path.dirname(absolute);
  config.resolvePath = (p) => (path.isAbsolute(p) ? p : path.resolve(config.baseDir, p));
  validate(config);
  return config;
}

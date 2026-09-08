#!/usr/bin/env node
/**
 * Genererar status.json för dashboarden. Körs t.ex. varje timme via crontab:
 *   0 * * * *  cd /opt/dataportal-dashboard && node bin/generate.js >> logs/generate.log 2>&1
 *
 * Flaggor:
 *   --config <fil>   Konfigurationsfil (standard: config.json)
 *   --output <fil>   Skriv resultatet hit i stället för config.output
 *   --pretty         Indenterad JSON
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.js';
import { DataportalApi, describeError } from '../src/api.js';
import { collectHarvest } from '../src/harvest.js';
import { collectExports } from '../src/exports.js';
import { collectStatistics } from '../src/statistics.js';

const { values: args } = parseArgs({
  options: {
    config: { type: 'string', short: 'c', default: 'config.json' },
    output: { type: 'string', short: 'o' },
    pretty: { type: 'boolean', default: false },
  },
});

const startedAt = Date.now();
const errors = [];

async function guarded(where, fn) {
  try {
    return await fn();
  } catch (err) {
    errors.push({ where, message: describeError(err) });
    return null;
  }
}

const config = await loadConfig(args.config);
const api = new DataportalApi(config.entrystore);

const [harvest, exports_, statistics] = await Promise.all([
  guarded('harvest', () => collectHarvest(api, config, errors)),
  guarded('exports', () => collectExports(config, errors)),
  guarded('statistics', () => collectStatistics(config, errors)),
]);

const status = {
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  source: { entrystore: config.entrystore.baseURI },
  // Harvesterns egen statusfil läses i realtid av webbsidan; här skickas bara var den finns.
  harvester: config.harvest.statusUrl
    ? { statusUrl: config.harvest.statusUrl, maxAgeMinutes: config.harvest.statusMaxAgeMinutes }
    : null,
  harvest,
  exports: exports_,
  statistics,
  errors,
};

const outputPath = config.resolvePath(args.output ?? config.output);
await mkdir(path.dirname(outputPath), { recursive: true });
const tmpPath = `${outputPath}.tmp`;
await writeFile(tmpPath, JSON.stringify(status, null, args.pretty ? 2 : 0));
await rename(tmpPath, outputPath); // atomiskt byte så webbsidan aldrig läser en halv fil

const summary = [
  `kataloger=${JSON.stringify(harvest?.summary ?? {})}`,
  `exporter=${JSON.stringify(exports_?.summary ?? {})}`,
  `fel=${errors.length}`,
].join(' ');
console.log(`${status.generatedAt} skrev ${outputPath} (${status.durationMs} ms) ${summary}`);
for (const e of errors) console.error(`  fel i ${e.where}: ${e.message}`);
process.exitCode = errors.length > 0 ? 1 : 0;

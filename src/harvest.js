import { describeError } from './api.js';

const HOUR = 3600 * 1000;

function ageHours(iso) {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / HOUR;
}

/**
 * Härleder en samlad status för en katalog utifrån senaste pipelineResult.
 *   failed  - senaste körningen misslyckades
 *   stale   - senaste lyckade körning är äldre än maxAgeHours
 *   ok      - senaste körning lyckades nyligen
 *   unknown - ingen information alls
 */
export function deriveStatus({ pipelineResult, maxAgeHours }) {
  const reasons = [];
  let status = 'unknown';
  let lastRun = null;

  if (pipelineResult) {
    lastRun = pipelineResult.finished ?? pipelineResult.started;
    if (pipelineResult.status === 'Failed' || pipelineResult.allSucceeded === false) {
      status = 'failed';
      reasons.push('Senaste pipelineResult har status Failed');
    } else if (pipelineResult.status === 'Success') {
      status = 'ok';
    }
    if (pipelineResult.validateErrors > 0) {
      reasons.push(`${pipelineResult.validateErrors} valideringsfel`);
    }
  }

  const age = ageHours(lastRun);
  if (status === 'ok' && age != null && age > maxAgeHours) {
    status = 'stale';
    reasons.push(`Senaste körning för ${Math.round(age)} h sedan (gräns ${maxAgeHours} h)`);
  }

  return { status, lastRun, ageHours: age == null ? null : Math.round(age * 10) / 10, reasons };
}

/**
 * Samlar in status för en katalog: pipelineResult från API:et och antal
 * datamängder i kontexten.
 */
export async function collectCatalog(api, catalog, config, errors) {
  const { harvest, datasets } = config;
  const contextId = String(catalog.contextId);
  const maxAgeHours = catalog.maxAgeHours ?? harvest.maxAgeHours;
  const result = {
    id: catalog.id ?? contextId,
    name: catalog.name ?? null,
    contextId,
    maxAgeHours,
  };

  const attempt = async (label, fn) => {
    try {
      return await fn();
    } catch (err) {
      errors.push({ where: `harvest.${result.id}.${label}`, message: describeError(err) });
      return null;
    }
  };

  const [context, catalogEntry, counts, pipelineResult] = await Promise.all([
    attempt('context', () => api.contextInfo(contextId)),
    attempt('catalog', () => api.catalogInfo(contextId)),
    attempt('datasets', () => api.datasetsInContext(contextId, datasets.rdfType, datasets.recentHours)),
    attempt('pipelineResult', () => api.latestPipelineResult(contextId)),
  ]);

  result.name = result.name ?? catalogEntry?.title ?? context?.title ?? pipelineResult?.title ?? contextId;
  result.contextTitle = context?.title ?? null;
  result.catalog = catalogEntry;
  result.datasets = counts;
  result.pipelineResult = pipelineResult;
  Object.assign(result, deriveStatus({ pipelineResult, maxAgeHours }));
  return result;
}

export async function collectHarvest(api, config, errors) {
  const catalogs = await Promise.all(
    (config.harvest.catalogs ?? []).map((c) => collectCatalog(api, c, config, errors)),
  );
  const summary = { ok: 0, stale: 0, failed: 0, unknown: 0 };
  for (const c of catalogs) summary[c.status] = (summary[c.status] ?? 0) + 1;
  return { summary, catalogs };
}

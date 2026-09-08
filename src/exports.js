import { stat } from 'node:fs/promises';

const HOUR = 3600 * 1000;

/**
 * Status för en exportfil (t.ex. all.rdf, nsip.rdf): finns den, när skapades den,
 * hur stor är den och är den för gammal?
 */
export async function collectExport(file, config, errors) {
  const maxAgeHours = file.maxAgeHours ?? config.exports.maxAgeHours;
  const filePath = config.resolvePath(file.path);
  const result = {
    name: file.name,
    path: filePath,
    url: file.url ?? null,
    maxAgeHours,
    exists: false,
    generated: null,
    size: null,
    ageHours: null,
    status: 'missing',
    reasons: [],
  };

  try {
    const s = await stat(filePath);
    result.exists = true;
    result.generated = s.mtime.toISOString();
    result.size = s.size;
    result.ageHours = Math.round(((Date.now() - s.mtimeMs) / HOUR) * 10) / 10;
    if (s.size === 0) {
      result.status = 'failed';
      result.reasons.push('Filen är tom');
    } else if (file.minSizeBytes && s.size < file.minSizeBytes) {
      result.status = 'failed';
      result.reasons.push(`Filen är mindre än ${file.minSizeBytes} byte`);
    } else if (result.ageHours > maxAgeHours) {
      result.status = 'stale';
      result.reasons.push(`Genererad för ${Math.round(result.ageHours)} h sedan (gräns ${maxAgeHours} h)`);
    } else {
      result.status = 'ok';
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      result.reasons.push('Filen saknas');
    } else {
      result.status = 'unknown';
      errors.push({ where: `exports.${file.name}`, message: err.message });
    }
  }

  return result;
}

export async function collectExports(config, errors) {
  const files = await Promise.all((config.exports.files ?? []).map((f) => collectExport(f, config, errors)));
  const summary = { ok: 0, stale: 0, failed: 0, missing: 0, unknown: 0 };
  for (const f of files) summary[f.status] = (summary[f.status] ?? 0) + 1;
  return { summary, files };
}

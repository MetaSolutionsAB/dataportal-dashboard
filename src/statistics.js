import { readFile, stat } from 'node:fs/promises';

/**
 * Läser in valfria statistikfiler från disk. JSON-filer tolkas, övriga läses
 * som text (begränsat antal rader). Resultatet visas rakt av i dashboarden.
 */
export async function collectStatistics(config, errors) {
  const files = await Promise.all(
    (config.statistics.files ?? []).map(async (f) => {
      const filePath = config.resolvePath(f.path);
      const item = { name: f.name, path: filePath, type: f.type ?? (filePath.endsWith('.json') ? 'json' : 'text'), modified: null, data: null };
      try {
        const s = await stat(filePath);
        item.modified = s.mtime.toISOString();
        const text = await readFile(filePath, 'utf8');
        item.data = item.type === 'json' ? JSON.parse(text) : text.split('\n').slice(0, f.maxLines ?? 50).join('\n');
      } catch (err) {
        item.error = err.message;
        errors.push({ where: `statistics.${f.name}`, message: err.message });
      }
      return item;
    }),
  );
  return { files };
}

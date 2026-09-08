import dns from 'node:dns';
import net from 'node:net';
import { EntryStore, types } from '@entryscape/entrystore-js';

// Nodes fetch provar adresser med 250 ms gräns per anslutningsförsök (Happy Eyeballs).
// Tar TLS-handskakningen längre, eller saknas IPv6 lokalt, slutar det i en tom
// AggregateError. Föredra IPv4 och ge varje försök rimlig tid.
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamilyAttemptTimeout(5000);

/** Gör om nätverksfel (ofta tomma AggregateError) till ett läsbart meddelande. */
export function describeError(err) {
  const parts = [];
  const visit = (e, depth = 0) => {
    if (!e || depth > 4) return;
    if (e.message) parts.push(e.message);
    if (Array.isArray(e.errors)) e.errors.forEach((x) => visit(x, depth + 1));
    if (e.cause) visit(e.cause, depth + 1);
  };
  visit(err);
  const unique = [...new Set(parts.filter(Boolean))];
  return unique.length ? unique.join(' | ') : (err?.constructor?.name ?? String(err));
}

const RETRIES = 2;
const RETRY_DELAY_MS = 1500;

const NS_ES = 'http://entrystore.org/terms/';
const NS_PR = 'http://entrystore.org/terms/pipelineresult#';

/**
 * Tunn klient runt @entryscape/entrystore-js med de frågor dashboarden behöver.
 * Alla anrop går oautentiserade, dvs. mot det publika API:et.
 */
export class DataportalApi {
  constructor({ baseURI, timeoutMs = 30000 }) {
    this.es = new EntryStore(baseURI);
    this.es.setRequestCachePrevention(true);
    this.timeoutMs = timeoutMs;
  }

  /**
   * Kör ett anrop med tidsgräns och omförsök. `fn` måste vara en funktion som
   * startar anropet, så att ett omförsök verkligen gör ett nytt anrop.
   */
  async withTimeout(fn, label) {
    const start = typeof fn === 'function' ? fn : () => fn;
    let lastError;
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout efter ${this.timeoutMs} ms`)), this.timeoutMs);
      });
      try {
        return await Promise.race([start(), timeout]);
      } catch (err) {
        lastError = err;
        if (attempt < RETRIES) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`${label}: ${describeError(lastError)} (efter ${RETRIES + 1} försök)`);
  }

  /**
   * Antal träffar för en fråga. Servern svarar med results=0 vid limit=0, så
   * bibliotekets size() kan inte användas; vi hämtar en post och läser storleken.
   */
  async count(query, label = 'count') {
    const list = query.limit(1).list();
    await this.withTimeout(() => list.getEntries(0), label);
    return list.getSize();
  }

  datasetQuery(rdfType) {
    return this.es.newSolrQuery().rdfType(rdfType).publicRead();
  }

  async contextInfo(contextId) {
    const entry = await this.withTimeout(() => this.es.getContextById(String(contextId)).getEntry(), `kontext ${contextId}`);
    return { title: entry.getMetadata().findFirstValue(null, 'dcterms:title') || null };
  }

  async catalogInfo(contextId) {
    const query = this.es.newSolrQuery().rdfType('dcat:Catalog').context(String(contextId)).limit(1);
    const [entry] = await this.withTimeout(() => query.getEntries(0), `katalog ${contextId}`);
    if (!entry) return null;
    return {
      title: entry.getMetadata().findFirstValue(null, 'dcterms:title') || null,
      modified: entry.getEntryInfo().getModificationDate(),
      uri: entry.getURI(),
    };
  }

  async datasetsInContext(contextId, rdfType, recentHours) {
    const since = new Date(Date.now() - recentHours * 3600 * 1000);
    const [total, recent] = await Promise.all([
      this.count(this.datasetQuery(rdfType).context(String(contextId)), `datamängder i ${contextId}`),
      this.count(this.datasetQuery(rdfType).context(String(contextId)).modifiedRange(since, null), `nya i ${contextId}`),
    ]);
    return { total, recent };
  }

  /**
   * Senaste pipelineResult i en kontext. Innehåller status för den senaste
   * skördningen (Success/Failed) samt statistik över sammanslagningen.
   */
  async latestPipelineResult(contextId) {
    const query = this.es
      .newSolrQuery()
      .context(String(contextId))
      .graphType(types.GT_PIPELINERESULT)
      .sort('created+desc')
      .limit(1);
    const [entry] = await this.withTimeout(() => query.getEntries(0), `pipelineResult ${contextId}`);
    if (!entry) return null;

    const info = entry.getEntryInfo();
    const infoGraph = info.getGraph();
    const md = entry.getMetadata();
    const resourceURI = entry.getResourceURI();
    const statusURI = infoGraph.findFirstValue(entry.getURI(), `${NS_ES}status`);
    const num = (prop) => {
      const v = md.findFirstValue(resourceURI, `${NS_PR}${prop}`);
      return v == null ? null : Number(v);
    };
    const bool = (prop) => {
      const v = md.findFirstValue(resourceURI, `${NS_PR}${prop}`);
      return v == null ? null : v === 'true';
    };

    const byEntityType = md.find(resourceURI, `${NS_PR}mergeEntityType`).map((stmt) => {
      const node = stmt.getValue();
      return {
        type: md.findFirstValue(node, `${NS_PR}entityType`),
        added: Number(md.findFirstValue(node, `${NS_PR}mergeAdded`) ?? 0),
        updated: Number(md.findFirstValue(node, `${NS_PR}mergeUpdated`) ?? 0),
        removed: Number(md.findFirstValue(node, `${NS_PR}mergeRemoved`) ?? 0),
        unchanged: Number(md.findFirstValue(node, `${NS_PR}mergeUnchanged`) ?? 0),
      };
    });

    return {
      uri: entry.getURI(),
      title: md.findFirstValue(resourceURI, 'dcterms:title') || null,
      status: statusURI ? statusURI.replace(NS_ES, '') : null,
      started: info.getCreationDate()?.toISOString?.() ?? info.getCreationDate(),
      finished: info.getModificationDate()?.toISOString?.() ?? info.getModificationDate(),
      allSucceeded: bool('allSucceeded'),
      oneSucceeded: bool('oneSucceeded'),
      successCount: num('successCount'),
      validateErrors: num('validateErrors'),
      validateWarnings: num('validateWarnings'),
      resourceCount: num('mergeMainResourceCount'),
      merge: {
        added: num('mergeAdded'),
        updated: num('mergeUpdated'),
        removed: num('mergeRemoved'),
        unchanged: num('mergeUnchanged'),
      },
      byEntityType,
    };
  }
}

/* Dashboard för Sveriges dataportal. Läser status.json (genererad av bin/generate.js). */
(() => {
  const REFRESH_MS = 5 * 60 * 1000;
  const STALE_STATUS_HOURS = 2; // varna om status.json inte förnyats på så här länge

  // Harvesterns egen statusfil läses i realtid, inte via generate.js.
  // Var den finns (harvest.statusUrl i config.json) följer med i status.json.
  const HARVESTER_REFRESH_MS = 60 * 1000;
  let harvesterConfig = null; // { statusUrl, maxAgeMinutes }
  let lastData = null; // senaste status.json
  let lastHarvester = null; // senaste härledda harvesterstatus

  const STATUS_LABEL = {
    ok: 'OK',
    stale: 'Föråldrad',
    failed: 'Misslyckad',
    missing: 'Saknas',
    stopped: 'Stoppad',
    unknown: 'Okänd',
  };
  const STATUS_ICON = { ok: '✓', stale: '⏱', failed: '✕', missing: '✕', stopped: '■', unknown: '?' };

  const nf = new Intl.NumberFormat('sv-SE');
  const df = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
  const rtf = new Intl.RelativeTimeFormat('sv', { numeric: 'auto' });

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (v != null) node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c != null) node.append(c);
    return node;
  };

  const num = (n) => (n == null ? '–' : nf.format(n));
  const fmtDate = (iso) => (iso ? df.format(new Date(iso)) : '–');
  const relative = (iso) => {
    if (!iso) return '';
    const diffMin = Math.round((new Date(iso) - Date.now()) / 60000);
    if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
    const diffH = Math.round(diffMin / 60);
    if (Math.abs(diffH) < 48) return rtf.format(diffH, 'hour');
    return rtf.format(Math.round(diffH / 24), 'day');
  };
  const fmtBytes = (b) => {
    if (b == null) return '–';
    const units = ['B', 'kB', 'MB', 'GB'];
    let i = 0;
    let v = b;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  };
  const shortType = (uri) => (uri ? uri.split(/[#/]/).pop() : '');

  const badge = (status, extraText) =>
    el('span', { class: `badge badge-${status}`, role: 'status' }, [
      `${STATUS_ICON[status] ?? ''} ${STATUS_LABEL[status] ?? status}`,
      extraText ? el('span', { class: 'n', text: ` ${extraText}` }) : null,
    ]);

  const timeCell = (iso) =>
    el('td', { class: 'time' }, [fmtDate(iso), el('span', { class: 'rel', text: relative(iso) })]);

  const numCell = (n) => el('td', { class: `num${n === 0 ? ' zero' : ''}`, text: num(n) });

  const summaryBadges = (summary) =>
    Object.entries(summary ?? {})
      .filter(([, n]) => n > 0)
      .map(([status, n]) => badge(status, nf.format(n)));

  /**
   * Samlar alla kontroller till en lista av { name, ok } så att den samlade
   * indikatorn kan säga "allt ok" eller "N av M kontroller har problem".
   */
  function collectChecks(data, harvester) {
    const checks = [];
    if (!data) return checks;
    for (const c of data.harvest?.catalogs ?? []) checks.push({ name: `Skördning ${c.name}`, ok: c.status === 'ok' });
    for (const f of data.exports?.files ?? []) checks.push({ name: `Export ${f.name}`, ok: f.status === 'ok' });
    if (data.harvester?.statusUrl) checks.push({ name: 'Skördarprocessen', ok: harvester ? harvester.status === 'ok' : null });
    checks.push({ name: 'Insamlingen (generate.js)', ok: !(data.errors?.length) });
    checks.push({ name: 'Statusfilens ålder', ok: (Date.now() - new Date(data.generatedAt)) / 3600000 <= STALE_STATUS_HOURS });
    return checks;
  }

  function renderOverall() {
    const node = $('#overall');
    const checks = collectChecks(lastData, lastHarvester);
    const decided = checks.filter((c) => c.ok !== null);
    const problems = decided.filter((c) => !c.ok);
    const pending = checks.length - decided.length;
    node.classList.remove('overall-ok', 'overall-problem', 'overall-loading');
    let icon;
    let text;
    let sub;
    if (checks.length === 0) {
      node.classList.add('overall-loading');
      icon = '…';
      text = 'Laddar …';
    } else if (problems.length > 0) {
      node.classList.add('overall-problem');
      icon = '✕';
      text = `${problems.length} av ${checks.length} kontroller har problem`;
      sub = problems.map((p) => p.name).join(', ');
    } else {
      node.classList.add('overall-ok');
      icon = '✓';
      text = 'Allt är OK';
      sub = `${decided.length} kontroller utan problem${pending ? `, ${pending} väntar` : ''}`;
    }
    node.title = checks.map((c) => `${c.ok === null ? '…' : c.ok ? '✓' : '✕'} ${c.name}`).join('\n');
    node.replaceChildren(
      el('span', { class: 'overall-icon', 'aria-hidden': 'true', text: icon }),
      el('span', { class: 'overall-text' }, [text, sub ? el('small', { text: sub }) : null].filter((c) => c != null)),
    );
  }

  function renderGenerated(data) {
    const age = (Date.now() - new Date(data.generatedAt)) / 3600000;
    const node = $('#generated');
    node.replaceChildren(
      'Genererad ',
      el('strong', { text: fmtDate(data.generatedAt) }),
      ` (${relative(data.generatedAt)})`,
    );
    const existing = $('#stale-banner');
    if (age > STALE_STATUS_HOURS) {
      const banner = existing ?? el('section', { id: 'stale-banner', class: 'banner banner-warning' });
      banner.replaceChildren(
        el('h2', { text: '⏱ Statusfilen är gammal' }),
        el('p', { text: `status.json genererades ${relative(data.generatedAt)}. Kontrollera att cron-jobbet körs.` }),
      );
      if (!existing) $('main').prepend(banner);
    } else if (existing) {
      existing.remove();
    }
  }

  function renderErrors(errors) {
    const node = $('#errors');
    if (!errors?.length) { node.hidden = true; return; }
    node.hidden = false;
    node.replaceChildren(
      el('h2', { text: `✕ ${errors.length} fel vid insamlingen` }),
      el('ul', {}, errors.map((e) => el('li', {}, [el('code', { text: e.where }), ` – ${e.message}`]))),
    );
  }

  /** Härleder status ur harvesterns status.json: { date, startedAt, latestHarvestCount, stopSignalRecieved } */
  function deriveHarvester(raw) {
    const lastSeen = raw.date ?? null;
    const ageMinutes = lastSeen ? Math.round((Date.now() - new Date(lastSeen)) / 60000) : null;
    const stopped = raw.stopSignalRecieved ?? raw.stopSignalReceived ?? false;
    const reasons = [];
    let status = 'ok';
    if (stopped === true) {
      status = 'stopped';
      reasons.push('Processen har tagit emot stoppsignal');
    } else if (ageMinutes != null && ageMinutes > harvesterConfig.maxAgeMinutes) {
      status = 'stale';
      reasons.push(`Inget livstecken på ${ageMinutes} min (gräns ${harvesterConfig.maxAgeMinutes} min)`);
    }
    return { status, lastSeen, ageMinutes, startedAt: raw.startedAt ?? null, latestHarvestCount: raw.latestHarvestCount ?? null, reasons };
  }

  function renderHarvester(h) {
    lastHarvester = h;
    renderOverall();
    const node = $('#harvester');
    $('#harvester-section').hidden = false;
    const label = { ok: 'Igång', stale: 'Inget livstecken', stopped: 'Stoppad', missing: 'Statusfil saknas', unknown: 'Kunde inte läsas' }[h.status] ?? h.status;
    const fact = (k, v) => el('span', { class: 'fact' }, [`${k} `, el('strong', { text: v })]);
    node.replaceChildren(...[
      el('div', { class: 'who' }, [badge(h.status), label]),
      h.lastSeen ? fact('Senaste livstecken', `${fmtDate(h.lastSeen)} (${relative(h.lastSeen)})`) : null,
      h.startedAt ? fact('Startad', `${fmtDate(h.startedAt)} (${relative(h.startedAt)})`) : null,
      h.latestHarvestCount != null ? fact('Senaste omgången', `${nf.format(h.latestHarvestCount)} skördade`) : null,
      h.reasons?.length ? el('ul', { class: 'reasons' }, h.reasons.map((r) => el('li', { text: r }))) : null,
    ].filter((c) => c != null));
  }

  async function loadHarvester() {
    if (!harvesterConfig?.statusUrl) {
      $('#harvester-section').hidden = true;
      lastHarvester = null;
      renderOverall();
      return;
    }
    try {
      const url = new URL(harvesterConfig.statusUrl, location.href);
      url.searchParams.set('t', Date.now());
      const res = await fetch(url, { cache: 'no-store' });
      if (res.status === 404) {
        renderHarvester({ status: 'missing', reasons: [`${harvesterConfig.statusUrl} svarade 404`] });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      renderHarvester(deriveHarvester(await res.json()));
    } catch (err) {
      renderHarvester({ status: 'unknown', reasons: [`${harvesterConfig.statusUrl}: ${err.message}`] });
    }
  }

  function renderHarvest(harvest) {
    $('#harvest-summary').replaceChildren(...summaryBadges(harvest?.summary));
    const tbody = $('#harvest tbody');
    tbody.replaceChildren();
    if (!harvest?.catalogs?.length) {
      tbody.append(el('tr', {}, el('td', { colspan: 10, text: 'Inga kataloger konfigurerade.' })));
      return;
    }
    for (const c of harvest.catalogs) {
      const pr = c.pipelineResult;
      const details = [...(c.reasons ?? [])];
      if (pr?.byEntityType?.length) {
        const parts = pr.byEntityType
          .filter((t) => t.added || t.updated || t.removed || t.unchanged)
          .map((t) => `${shortType(t.type)}: ${nf.format(t.unchanged + t.added + t.updated)}`);
        if (parts.length) details.push(parts.join(', '));
      }
      tbody.append(
        el('tr', {}, [
          el('td', {}, [
            el('span', { class: 'name', text: c.name }),
            el('span', { class: 'sub', text: `kontext ${c.contextId}${c.contextTitle && c.contextTitle !== c.name ? ` · ${c.contextTitle}` : ''}` }),
          ]),
          el('td', {}, badge(c.status)),
          timeCell(c.lastRun),
          numCell(c.datasets?.total),
          numCell(c.datasets?.recent),
          numCell(pr?.merge?.added),
          numCell(pr?.merge?.updated),
          numCell(pr?.merge?.removed),
          numCell(pr?.validateErrors),
          el('td', { class: 'details' }, details.length ? el('ul', {}, details.map((t) => el('li', { text: t }))) : '–'),
        ]),
      );
    }
  }

  function renderExports(exportsData) {
    $('#exports-summary').replaceChildren(...summaryBadges(exportsData?.summary));
    const wrap = $('#exports');
    wrap.replaceChildren();
    if (!exportsData?.files?.length) {
      wrap.append(el('p', { class: 'subtitle', text: 'Inga exporter konfigurerade.' }));
      return;
    }
    for (const f of exportsData.files) {
      const rows = [
        ['Genererad', f.generated ? `${fmtDate(f.generated)} (${relative(f.generated)})` : '–'],
        ['Storlek', fmtBytes(f.size)],
        ['Max ålder', `${f.maxAgeHours} h`],
        ['Fil', f.path],
      ];
      wrap.append(
        el('div', { class: 'card' }, [
          el('div', { class: 'card-head' }, [
            el('h3', {}, f.url ? el('a', { href: f.url, text: f.name }) : f.name),
            badge(f.status),
          ]),
          el('dl', {}, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', {}, k === 'Fil' ? el('code', { text: v }) : v)])),
          f.reasons?.length ? el('ul', { class: 'reasons' }, f.reasons.map((r) => el('li', { text: r }))) : null,
        ]),
      );
    }
  }

  function renderStatistics(stats) {
    const section = $('#stats-section');
    const files = stats?.files ?? [];
    section.hidden = files.length === 0;
    $('#stats').replaceChildren(
      ...files.map((f) => {
        let body;
        if (f.error) body = el('p', { class: 'subtitle', text: `Kunde inte läsas: ${f.error}` });
        else if (f.type === 'json' && f.data && typeof f.data === 'object' && !Array.isArray(f.data)) {
          body = el('dl', {}, Object.entries(f.data).flatMap(([k, v]) => [
            el('dt', { text: k }),
            el('dd', { text: typeof v === 'object' ? JSON.stringify(v) : typeof v === 'number' ? nf.format(v) : String(v) }),
          ]));
        } else body = el('pre', { text: typeof f.data === 'string' ? f.data : JSON.stringify(f.data, null, 2) });
        return el('div', { class: 'card' }, [
          el('div', { class: 'card-head' }, [el('h3', { text: f.name }), el('span', { class: 'subtitle', text: f.modified ? fmtDate(f.modified) : '' })]),
          body,
        ]);
      }),
    );
  }

  function render(data) {
    lastData = data;
    renderOverall();
    renderGenerated(data);
    renderErrors(data.errors);
    renderHarvest(data.harvest);
    renderExports(data.exports);
    renderStatistics(data.statistics);
    $('#source').textContent = data.source?.entrystore ? `Källa: ${data.source.entrystore}` : '';
    document.title = `${collectChecks(data, lastHarvester).some((c) => c.ok === false) ? '✕ ' : '✓ '}Sveriges dataportal – driftstatus`;
  }

  async function load() {
    try {
      const res = await fetch(`status.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const previousUrl = harvesterConfig?.statusUrl;
      harvesterConfig = data.harvester ?? null;
      render(data);
      if (harvesterConfig?.statusUrl !== previousUrl) loadHarvester();
    } catch (err) {
      $('#generated').textContent = `Kunde inte läsa status.json: ${err.message}`;
    }
  }

  load();
  setInterval(load, REFRESH_MS);
  setInterval(loadHarvester, HARVESTER_REFRESH_MS);
})();

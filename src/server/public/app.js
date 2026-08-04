// Interface web de PoE Build Architect.
// Aucun texte d'interface n'est écrit ici : tout vient de /api/messages,
// alimenté par les mêmes fichiers de locale que la ligne de commande.

const $ = (id) => document.getElementById(id);
let M = {};

/** Traduit une clé pointée, avec interpolation {nom}. */
function t(key, params = {}) {
  const raw = key.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), M);
  if (typeof raw !== 'string') return key;
  return raw.replace(/\{(\w+)\}/g, (_, n) => (n in params ? params[n] : `{${n}}`));
}

function fmt(n) {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + ' M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + ' k';
  return Math.round(n).toString();
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// --- Traductions ---------------------------------------------------------

async function loadLocale(locale) {
  M = await (await fetch(`/api/messages?locale=${locale}`)).json();
  localStorage.setItem('pba.locale', locale);
  document.documentElement.lang = locale;

  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  $('tabOptimize').textContent = t('report.title');
  $('tabImport').textContent = t('import.current');
  $('run').textContent = t('report.title');
  $('runImport').textContent = t('import.analysing');
  $('slowNote').textContent = t('web.slowNote');
  $('emptyState').textContent = t('web.empty');
}

// --- Rendu des résultats -------------------------------------------------

function resBlock(snap) {
  const cell = (key, value, cap = 75) => {
    const cls = value >= cap ? 'ok' : value >= 0 ? 'warn' : 'bad';
    return `<div><div class="v ${cls}">${Math.round(value)}%</div><div class="k">${key}</div></div>`;
  };
  return `<div class="res">
    ${cell(t('stat.FireResist'), snap.fireResist)}
    ${cell(t('stat.ColdResist'), snap.coldResist)}
    ${cell(t('stat.LightningResist'), snap.lightningResist)}
    ${cell(t('stat.ChaosResist'), snap.chaosResist, 0)}
  </div>`;
}

function statsTable(before, after) {
  const rows = [
    [t('stat.CombinedDPS'), before.dps, after.dps],
    [t('stat.TotalEHP'), before.ehp, after.ehp],
    [t('stat.Life'), before.lifePool, after.lifePool],
  ];
  return `<table>
    <thead><tr><th></th><th class="num">${t('report.statsStart')}</th><th class="num">${t('report.statsOptimised')}</th></tr></thead>
    <tbody>${rows
      .map(
        ([k, b, a]) =>
          `<tr><td>${esc(k)}</td><td class="num">${fmt(b)}</td><td class="num ${a > b ? 'up' : ''}">${fmt(a)}</td></tr>`,
      )
      .join('')}</tbody></table>`;
}

function findingsBlock(findings) {
  if (!findings || findings.length === 0) return '';
  return findings
    .map((f) => {
      const ic = f.severity === 'critical' ? '✗' : f.severity === 'warning' ? '!' : '✓';
      return `<div class="finding ${f.severity}"><span class="ic">${ic}</span><span>${esc(t(f.key, f.params || {}))}</span></div>`;
    })
    .join('');
}

function renderSupports(d) {
  const p = el('div', 'panel');
  p.append(el('h2', null, esc(t('report.skillSetup'))));
  p.append(
    el('div', 'meta', `${esc(t('report.linkCount', { n: d.links }))} — ${esc(t('report.inSlot', { slot: d.slot }))}`),
  );

  const list = el('div');
  list.style.marginTop = '12px';
  list.innerHTML =
    `<div class="gem main"><span class="dot"></span><span class="name">${esc(d.main.name)}</span>` +
    `<span class="lvl">${d.main.level}/${d.main.quality}%</span></div>` +
    d.chosen
      .map(
        (s) =>
          `<div class="gem support"><span class="dot"></span><span class="name">${esc(s.name)}</span>` +
          `<span class="gain">+${s.gainPercent}%</span></div>`,
      )
      .join('');
  p.append(list);
  p.append(el('p', 'note', esc(t('report.socketNote'))));
  return p;
}

function renderTree(d) {
  const p = el('div', 'panel');
  p.append(el('h2', null, esc(t('report.tree'))));
  p.append(
    el(
      'div',
      'meta',
      esc(t('report.treePoints', { used: d.pointsUsed, budget: d.budget, asc: d.ascPointsUsed })),
    ),
  );

  const list = el('div');
  list.style.marginTop = '12px';
  list.innerHTML = d.nodes
    .map((n) => {
      const cls = n.type === 'Keystone' ? 'keystone' : n.type === 'Mastery' ? 'mastery' : '';
      const asc = n.ascendancy ? `<div class="asc">${esc(n.ascendancy)}</div>` : '';
      return `<div class="node ${cls}">${asc}<div class="top">
        <span class="nm">${esc(n.name)}</span>
        <span class="cost">${esc(t('report.treeCost', { n: n.cost }))}</span>
        <span class="gain">+${n.gainPercent}%</span>
      </div>${n.stats.map((s) => `<div class="sd">${esc(s)}</div>`).join('')}</div>`;
    })
    .join('');
  p.append(list);

  p.append(el('h2', null, esc(t('report.treeUrl'))));
  const a = el('a', 'treelink', esc(d.url));
  a.href = d.url;
  a.target = '_blank';
  a.rel = 'noopener';
  p.append(a);
  return p;
}

function renderStats(before, after, findings) {
  const p = el('div', 'panel');
  p.append(el('h2', null, esc(t('report.stats'))));
  p.insertAdjacentHTML('beforeend', resBlock(after));
  p.insertAdjacentHTML('beforeend', `<div style="margin-top:14px">${statsTable(before, after)}</div>`);
  if (findings && findings.length) {
    p.append(el('h2', null, esc(t('audit.title'))));
    p.insertAdjacentHTML('beforeend', findingsBlock(findings));
  }
  return p;
}

// --- Optimisation (Server-Sent Events) ----------------------------------

function runOptimize() {
  const results = $('results');
  results.innerHTML = '';
  $('run').disabled = true;
  $('progress').classList.add('on');

  const q = new URLSearchParams({
    skill: $('skill').value,
    goal: $('goal').value,
    class: $('class').value,
    ascendancy: $('ascendancy').value,
    level: $('level').value,
    links: $('links').value,
    gemLevel: $('gemLevel').value,
    gemQuality: '20',
    treeBudget: $('treeBudget').value,
    tree: Number($('treeBudget').value) > 0 ? 'true' : 'false',
  });

  const es = new EventSource(`/api/optimize?${q}`);
  let supportsData = null;

  es.addEventListener('progress', (e) => {
    const d = JSON.parse(e.data);
    $('progressLabel').textContent = t('optimize.progress', d);
    $('progressBar').style.width = `${(d.done / d.total) * 100}%`;
  });

  es.addEventListener('supports', (e) => {
    supportsData = JSON.parse(e.data);
    results.append(renderSupports(supportsData));
    // Tant que l'arbre n'est pas calculé, on montre déjà l'effet des gemmes
    // plutôt que de laisser l'écran vide.
    results.append(renderStats(supportsData.before, supportsData.after, null));
  });

  es.addEventListener('tree', (e) => {
    const d = JSON.parse(e.data);
    results.append(renderTree(d));
    // Bilan de bout en bout : départ avant supports, arrivée après arbre.
    const start = supportsData ? supportsData.before : d.before;
    results.append(renderStats(start, d.after, d.findings));
  });

  es.addEventListener('error', (e) => {
    let msg = t('error.generic', { message: '…' });
    try {
      const d = JSON.parse(e.data);
      msg = d.key ? t(d.key, d.params || {}) : t('error.generic', { message: d.message });
    } catch {
      /* coupure de flux : on garde le message générique */
    }
    results.append(el('div', 'err', esc(msg)));
    stop();
  });

  es.addEventListener('done', stop);
  es.onerror = () => stop();

  function stop() {
    es.close();
    $('run').disabled = false;
    $('progress').classList.remove('on');
  }
}

async function runImport() {
  const results = $('results');
  results.innerHTML = '';
  $('runImport').disabled = true;
  $('importProgress').classList.add('on');
  try {
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: $('importSource').value }),
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error);

    const p = el('div', 'panel');
    p.append(el('h2', null, esc(t('import.current'))));
    p.append(
      el('div', 'meta', `${esc(d.summary.className)} / ${esc(d.summary.ascendancy)} — ${d.summary.level}`),
    );
    p.insertAdjacentHTML('beforeend', `<div style="margin-top:12px">${resBlock(d.snapshot)}</div>`);
    p.insertAdjacentHTML(
      'beforeend',
      `<div style="margin-top:14px">${statsTable(d.snapshot, d.snapshot)}</div>`,
    );
    results.append(p);

    const groups = el('div', 'panel');
    groups.append(el('h2', null, esc(t('report.skillSetup'))));
    groups.innerHTML += d.summary.groups
      .map(
        (g) =>
          `<div class="gem"><span class="name">${esc(g.gems.map((x) => x.name).join(' + '))}</span>` +
          `<span class="lvl">${esc(g.slot)}</span></div>`,
      )
      .join('');
    results.append(groups);

    const audit = el('div', 'panel');
    audit.append(el('h2', null, esc(t('audit.title'))));
    audit.insertAdjacentHTML('beforeend', findingsBlock(d.findings));
    results.append(audit);
  } catch (err) {
    results.append(el('div', 'err', esc(t('error.generic', { message: err.message }))));
  } finally {
    $('runImport').disabled = false;
    $('importProgress').classList.remove('on');
  }
}

// --- Démarrage -----------------------------------------------------------

(async function init() {
  const meta = await (await fetch('/api/meta')).json();
  $('engineMeta').textContent = t('engine.ready', {
    pobVersion: meta.version.pobVersion,
    treeVersion: meta.version.treeVersion,
  });
  $('skills').innerHTML = meta.skills.map((s) => `<option value="${esc(s)}">`).join('');

  const sel = $('locale');
  sel.innerHTML = meta.locales.map((l) => `<option value="${l}">${l.toUpperCase()}</option>`).join('');
  const saved = localStorage.getItem('pba.locale') || 'fr';
  sel.value = meta.locales.includes(saved) ? saved : 'fr';
  await loadLocale(sel.value);
  $('engineMeta').textContent = t('engine.ready', {
    pobVersion: meta.version.pobVersion,
    treeVersion: meta.version.treeVersion,
  });

  sel.onchange = () => loadLocale(sel.value);
  $('run').onclick = runOptimize;
  $('runImport').onclick = runImport;

  for (const b of document.querySelectorAll('.tabs button')) {
    b.onclick = () => {
      for (const x of document.querySelectorAll('.tabs button')) x.classList.remove('active');
      b.classList.add('active');
      const opt = b.dataset.tab === 'optimize';
      $('panelOptimize').style.display = opt ? '' : 'none';
      $('panelImport').style.display = opt ? 'none' : '';
    };
  }
})();

// Token Radar — the page. Reads window.TOKEN_RADAR_DATA (written by
// main.ts from the sealed snapshot) and renders the board, the filters
// and one detail view per protocol. No network: every byte it shows
// comes from the data file beside it.
//
// A row is [rank, slug, name, category, chains, tvl, change7d,
// ageDays, implied, difficulty, watchlist, farmSteps, comp, growth,
// ageFactor, breadthFactor]. The detail view shows the same four
// factors the model multiplied, so any implied value on the page can
// be checked against its own inputs.

(function () {
  'use strict';
  var DATA = window.TOKEN_RADAR_DATA || { meta: {}, rows: [] };
  var META = DATA.meta || {};
  var ROWS = DATA.rows || [];

  var R = {
    rank: 0, slug: 1, name: 2, cat: 3, chains: 4, tvl: 5, chg: 6, age: 7,
    implied: 8, diff: 9, wl: 10, steps: 11, comp: 12, growth: 13, ageF: 14, breadthF: 15,
  };

  function $(id) { return document.getElementById(id); }

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function ageText(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- stats -------------------------------------------------------
  function renderStats() {
    var wl = ROWS.filter(function (r) { return r[R.wl] === 1; }).length;
    $('stats').innerHTML =
      stat(money(META.totalImpliedUsd || 0), 'total implied value, all rows') +
      stat(String(ROWS.length), 'protocols ranked') +
      stat(String(wl), 'of them on the snapshot watchlist') +
      stat(String(META.globalComp || ''), 'global comp multiple (mcap / TVL)');
    $('asOf').textContent = META.asOf || '—';
    function stat(b, label) { return '<div class="stat"><b>' + esc(b) + '</b><span>' + esc(label) + '</span></div>'; }
  }

  // ---- filter controls ----------------------------------------------
  function fillSelects() {
    var cats = {};
    var chains = {};
    ROWS.forEach(function (r) {
      cats[r[R.cat]] = true;
      r[R.chains].forEach(function (c) { chains[c] = true; });
    });
    fill('cat', Object.keys(cats).sort());
    fill('chain', Object.keys(chains).sort());
    function fill(id, values) {
      var sel = $(id);
      values.forEach(function (v) {
        var o = document.createElement('option');
        o.value = v; o.textContent = v;
        sel.appendChild(o);
      });
    }
  }

  function currentFilter() {
    return {
      q: $('q').value.trim().toLowerCase(),
      cat: $('cat').value,
      chain: $('chain').value,
      band: $('band').value,
      diff: $('diff').value,
      wlOnly: $('wlOnly').checked,
      sort: $('sort').value,
    };
  }

  function filteredRows() {
    var f = currentFilter();
    var out = ROWS.filter(function (r) {
      if (f.q && (r[R.name].toLowerCase().indexOf(f.q) < 0 && r[R.slug].indexOf(f.q) < 0)) return false;
      if (f.cat && r[R.cat] !== f.cat) return false;
      if (f.chain && r[R.chains].indexOf(f.chain) < 0) return false;
      if (f.diff && r[R.diff] !== f.diff) return false;
      if (f.wlOnly && r[R.wl] !== 1) return false;
      if (f.band === '100m' && r[R.implied] <= 1e8) return false;
      if (f.band === '10m' && (r[R.implied] <= 1e7 || r[R.implied] > 1e8)) return false;
      if (f.band === '1m' && (r[R.implied] <= 1e6 || r[R.implied] > 1e7)) return false;
      if (f.band === 'under1m' && r[R.implied] > 1e6) return false;
      return true;
    });
    var key = { rank: R.rank, implied: R.implied, tvl: R.tvl, growth: R.chg, age: R.age }[f.sort] || R.rank;
    out.sort(function (a, b) {
      if (f.sort === 'rank') return a[R.rank] - b[R.rank];
      if (f.sort === 'age') return (b[R.age] || 0) - (a[R.age] || 0);
      if (f.sort === 'growth') return (b[R.chg] || 0) - (a[R.chg] || 0);
      return b[key] - a[key];
    });
    return out;
  }

  // ---- board ---------------------------------------------------------
  function renderBoard() {
    var list = filteredRows();
    $('count').textContent = list.length + ' of ' + ROWS.length + ' protocols — click a row or “Plan” for its detail view and farm steps.';
    $('rows').innerHTML = list.map(function (r) {
      var chg = r[R.chg];
      var chgCls = chg === null ? '' : (chg >= 0 ? 'pos' : 'neg');
      return '<tr data-slug="' + esc(r[R.slug]) + '">' +
        '<td class="rank">' + r[R.rank] + '</td>' +
        '<td><strong>' + esc(r[R.name]) + '</strong><br><span class="slug">' + esc(r[R.slug]) + '</span>' +
        (r[R.wl] === 1 ? ' <span class="wl">WATCHLIST</span>' : '') + '</td>' +
        '<td>' + esc(r[R.cat]) + '</td>' +
        '<td class="chains">' + esc(r[R.chains].slice(0, 3).join(', ')) + (r[R.chains].length > 3 ? ' +' + (r[R.chains].length - 3) : '') + '</td>' +
        '<td class="num">' + money(r[R.tvl]) + '</td>' +
        '<td class="num ' + chgCls + '">' + pct(chg) + '</td>' +
        '<td class="num">' + ageText(r[R.age]) + '</td>' +
        '<td class="num implied">' + money(r[R.implied]) + '</td>' +
        '<td><span class="diff ' + esc(r[R.diff]) + '">' + esc(r[R.diff]) + '</span></td>' +
        '<td><button class="plan-btn" data-slug="' + esc(r[R.slug]) + '">Plan</button></td>' +
        '</tr>';
    }).join('');
  }

  // ---- detail view ----------------------------------------------------
  function findRow(slug) {
    for (var i = 0; i < ROWS.length; i++) if (ROWS[i][R.slug] === slug) return ROWS[i];
    return null;
  }

  function renderDetail(slug) {
    var r = findRow(slug);
    var detail = $('detail');
    var wrap = $('boardWrap');
    if (!r) { detail.hidden = true; wrap.hidden = false; return; }
    wrap.hidden = true;
    detail.hidden = false;
    var formula =
      moneyFull(r[R.tvl]) + ' TVL\n' +
      'x ' + r[R.comp].toFixed(3) + ' comp (' + esc(r[R.cat]) + ' multiple)\n' +
      'x ' + r[R.growth].toFixed(3) + ' growth (7d ' + pct(r[R.chg]) + ')\n' +
      'x ' + r[R.ageF].toFixed(3) + ' age (' + ageText(r[R.age]) + ' with no token recorded)\n' +
      'x ' + r[R.breadthF].toFixed(2) + ' breadth (' + r[R.chains].length + ' chain' + (r[R.chains].length === 1 ? '' : 's') + ')\n' +
      '= ' + moneyFull(r[R.implied]) + ' implied value';
    detail.innerHTML =
      '<button class="back" id="backBtn">&larr; Back to the board</button>' +
      '<h2>' + esc(r[R.name]) + ' <span class="slug">#' + r[R.rank] + ' &middot; ' + esc(r[R.slug]) + '</span></h2>' +
      '<p class="sub">' + esc(r[R.cat]) + ' &middot; ' + esc(r[R.chains].join(', ')) +
      (r[R.wl] === 1 ? ' &middot; <span class="wl">ON THE SNAPSHOT WATCHLIST</span>' : ' &middot; below the watchlist floor') + '</p>' +
      '<div class="metrics">' +
      metric(moneyFull(r[R.implied]), 'implied value', true) +
      metric(moneyFull(r[R.tvl]), 'total value locked') +
      metric(pct(r[R.chg]), 'TVL change, 7 days') +
      metric(ageText(r[R.age]), 'running with no token recorded') +
      '</div>' +
      '<h3>How its implied value is made</h3>' +
      '<pre class="formula-box">' + esc(formula) + '</pre>' +
      '<h3>Farm plan — what to do, what it costs, how long it takes</h3>' +
      '<ol class="steps">' + r[R.steps].map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="why">Difficulty: <strong>' + esc(r[R.diff]) + '</strong>. ' +
      'This protocol records no token in the DefiLlama snapshot of ' + esc(META.asOf || '') + '; ' +
      'the plan above is the board&rsquo;s own suggestion, not a promise of a reward and not financial advice.</p>';
    $('backBtn').addEventListener('click', function () { location.hash = '#/'; });
    detail.scrollIntoView();
    function metric(b, label, big) {
      return '<div class="metric"><b class="' + (big ? 'big' : '') + '">' + esc(b) + '</b><span>' + esc(label) + '</span></div>';
    }
  }

  // ---- comp table ------------------------------------------------------
  function renderComps() {
    var rows = [['— all other sectors (global median) —', META.globalComp, 'all']];
    Object.keys(META.compByCategory || {}).sort().forEach(function (cat) {
      rows.push([cat, META.compByCategory[cat], META.compsPerCategory[cat]]);
    });
    var body = document.querySelector('#compTable tbody');
    body.innerHTML = rows.map(function (row) {
      return '<tr><td>' + esc(row[0]) + '</td><td class="num">' + Number(row[1]).toFixed(3) + '</td><td class="num">' + esc(String(row[2])) + '</td></tr>';
    }).join('');
  }

  // ---- routing -----------------------------------------------------------
  function route() {
    var hash = location.hash || '#/';
    var m = hash.match(/^#\/p\/([a-z0-9-]+)$/);
    if (m) renderDetail(m[1]);
    else { $('detail').hidden = true; $('boardWrap').hidden = false; }
  }

  function bind() {
    ['q', 'cat', 'chain', 'band', 'diff', 'wlOnly', 'sort'].forEach(function (id) {
      $(id).addEventListener('input', renderBoard);
      $(id).addEventListener('change', renderBoard);
    });
    $('rows').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-slug]') : null;
      if (btn) location.hash = '#/p/' + btn.getAttribute('data-slug');
    });
    window.addEventListener('hashchange', route);
  }

  renderStats();
  fillSelects();
  renderBoard();
  renderComps();
  bind();
  route();
})();

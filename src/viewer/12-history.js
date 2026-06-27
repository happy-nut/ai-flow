// ===== Git history view (Cmd+9): commit list with graph lanes + per-commit diff. =====
// Data comes from the main process (window.monacoriGit.log / .commitDiff); the lane layout is computed
// here from each commit's parents. Read-only — the per-commit diff is static diff2html HTML.

var HISTORY_LANE_W = 14, HISTORY_DOT_R = 3.5, HISTORY_ROW_H = 24;
var HISTORY_COLORS = ['#6c9fd4', '#7faf6b', '#d4a857', '#c77dd4', '#d36c6c', '#5bb6b6', '#b0884f', '#8d8df0'];
var historyCommits = [];
var historyGraph = [];
var historyMaxLane = 0;
var historyActiveSha = '';
var historyLoading = false;

// Lane layout. Walks commits newest-first, tracking open edges (lanes) by the hash each expects next.
// Returns per-row { hash, myLane, color, topEdges, bottomEdges } using LANE INDICES + COLOR INDICES (px-free,
// so it's unit-testable). First parent inherits the commit's color so a branch keeps one hue down its line.
function computeHistoryGraph(commits) {
  var lanes = [];           // lane index -> hash the lane is waiting to reach (open edge from above)
  var colorOf = {};         // hash -> color index
  var next = 0;
  function colorFor(h) { if (colorOf[h] == null) colorOf[h] = next++; return colorOf[h]; }
  function freeLane() { for (var i = 0; i < lanes.length; i++) if (lanes[i] == null) return i; lanes.push(null); return lanes.length - 1; }
  var rows = [];
  var maxLane = 0;
  for (var ci = 0; ci < commits.length; ci++) {
    var c = commits[ci];
    var incoming = lanes.slice();
    var myLane = lanes.indexOf(c.hash);
    if (myLane === -1) myLane = freeLane();
    var myColor = colorFor(c.hash);
    lanes[myLane] = c.hash;
    for (var i = 0; i < lanes.length; i++) if (i !== myLane && lanes[i] === c.hash) lanes[i] = null; // merge other edges in
    var parents = c.parents || [];
    var parentLanes = {};
    if (parents.length === 0) {
      lanes[myLane] = null; // root commit — the lane ends here
    } else {
      lanes[myLane] = parents[0];
      if (colorOf[parents[0]] == null) colorOf[parents[0]] = myColor; // first parent keeps the hue
      parentLanes[myLane] = true;
      for (var p = 1; p < parents.length; p++) {
        var ex = lanes.indexOf(parents[p]);
        var l = ex !== -1 ? ex : freeLane();
        lanes[l] = parents[p];
        colorFor(parents[p]);
        parentLanes[l] = true;
      }
    }
    var outgoing = lanes.slice();
    var topEdges = [];
    for (var a = 0; a < incoming.length; a++) {
      if (incoming[a] == null) continue;
      topEdges.push({ from: a, to: incoming[a] === c.hash ? myLane : a, color: colorOf[incoming[a]] });
    }
    var bottomEdges = [];
    for (var b = 0; b < outgoing.length; b++) {
      if (outgoing[b] == null) continue;
      bottomEdges.push({ from: parentLanes[b] ? myLane : b, to: b, color: colorOf[outgoing[b]] });
    }
    for (var m = 0; m < Math.max(incoming.length, outgoing.length); m++) {
      if (incoming[m] != null || outgoing[m] != null) maxLane = Math.max(maxLane, m);
    }
    maxLane = Math.max(maxLane, myLane);
    rows.push({ hash: c.hash, myLane: myLane, color: myColor, topEdges: topEdges, bottomEdges: bottomEdges });
  }
  rows.maxLane = maxLane;
  return rows;
}
if (typeof window !== 'undefined') window.computeHistoryGraph = computeHistoryGraph; // exposed for tests

function historyLaneX(l) { return 9 + l * HISTORY_LANE_W; }
function historyColor(i) { return HISTORY_COLORS[i % HISTORY_COLORS.length]; }
function historyRowSvg(row) {
  var w = historyLaneX(historyMaxLane) + 9, h = HISTORY_ROW_H, mid = h / 2;
  var s = '<svg class="hgraph" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">';
  var edge = function (e, y1, y2) {
    var x1 = historyLaneX(e.from), x2 = historyLaneX(e.to);
    var c1 = (y1 + y2) / 2;
    return '<path d="M' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + c1 + ', ' + x2 + ' ' + c1 + ', ' + x2 + ' ' + y2 + '" stroke="' + historyColor(e.color) + '" fill="none" stroke-width="1.6"/>';
  };
  row.topEdges.forEach(function (e) { s += edge(e, 0, mid); });
  row.bottomEdges.forEach(function (e) { s += edge(e, mid, h); });
  s += '<circle cx="' + historyLaneX(row.myLane) + '" cy="' + mid + '" r="' + HISTORY_DOT_R + '" fill="' + historyColor(row.color) + '"/></svg>';
  return s;
}

// "HEAD -> main, origin/main, tag: v1" -> small badges (HEAD/branch/tag styled distinctly).
function historyRefBadges(refs) {
  if (!refs || !refs.trim()) return '';
  return refs.split(',').map(function (r) {
    r = r.trim();
    if (!r) return '';
    var cls = 'href-branch', label = r;
    if (r.indexOf('tag:') === 0) { cls = 'href-tag'; label = r.replace('tag:', '').trim(); }
    else if (r.indexOf('HEAD') === 0) { cls = 'href-head'; }
    else if (r.indexOf('origin/') === 0 || r.indexOf('/') !== -1) { cls = 'href-remote'; }
    return '<span class="href ' + cls + '">' + escapeHtml(label) + '</span>';
  }).join('');
}

function historyShortDate(iso) {
  if (!iso) return '';
  // 2026-06-20T21:03:11+09:00 -> "2026-06-20 21:03"
  var m = String(iso).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? m[1] + ' ' + m[2] : String(iso).slice(0, 16);
}

function renderHistoryList() {
  var list = document.getElementById('history-list');
  if (!list) return;
  if (!historyCommits.length) {
    list.innerHTML = '<div class="quick-open-empty">' + escapeHtml(t(historyLoading ? 'history.loading' : 'history.empty')) + '</div>';
    return;
  }
  list.style.setProperty('--hgraph-w', (historyLaneX(historyMaxLane) + 9) + 'px');
  list.innerHTML = historyCommits.map(function (c, i) {
    return '<button type="button" class="hrow' + (c.hash === historyActiveSha ? ' active' : '') + '" data-sha="' + escapeHtml(c.hash) + '">'
      + '<span class="hgraph-cell">' + historyRowSvg(historyGraph[i]) + '</span>'
      + '<span class="hmsg">' + historyRefBadges(c.refs) + escapeHtml(c.subject) + '</span>'
      + '<span class="hauthor">' + escapeHtml(c.author) + '</span>'
      + '<span class="hdate">' + escapeHtml(historyShortDate(c.date)) + '</span>'
      + '</button>';
  }).join('');
}

// Text filter (subject / author). The graph only reads right on the full contiguous history, so filtering
// hides the graph column (IntelliJ does the same) and just shows matching rows.
function applyHistoryFilter() {
  var input = document.getElementById('history-search');
  var list = document.getElementById('history-list');
  if (!list) return;
  var q = (input && input.value || '').trim().toLowerCase();
  list.classList.toggle('filtering', q.length > 0);
  var rows = list.querySelectorAll('.hrow');
  for (var i = 0; i < rows.length; i++) {
    var c = historyCommits[i];
    var hit = !q || (c.subject + '\n' + c.author + '\n' + c.hash).toLowerCase().indexOf(q) !== -1;
    rows[i].classList.toggle('hidden', !hit);
  }
}

function openHistoryCommit(sha) {
  if (!sha || !window.monacoriGit) return;
  historyActiveSha = sha;
  var list = document.getElementById('history-list');
  if (list) list.querySelectorAll('.hrow').forEach(function (r) { r.classList.toggle('active', r.dataset.sha === sha); });
  var detail = document.getElementById('history-detail');
  if (detail) detail.innerHTML = '<div class="quick-open-empty">' + escapeHtml(t('history.loading')) + '</div>';
  Promise.resolve(window.monacoriGit.commitDiff(sha)).then(function (d) {
    if (!d || historyActiveSha !== sha) return; // selection moved on while loading
    renderHistoryDetail(d);
  }, function () {});
}

function renderHistoryDetail(d) {
  var detail = document.getElementById('history-detail');
  if (!detail) return;
  var head = '<div class="history-detail-head">'
    + '<div class="hd-msg">' + escapeHtml(d.message || '').replace(/\n/g, '<br>') + '</div>'
    + '<div class="hd-meta"><span class="hd-hash">' + escapeHtml((d.hash || '').slice(0, 10)) + '</span>'
    + '<span class="hd-author">' + escapeHtml(d.author) + (d.email ? ' &lt;' + escapeHtml(d.email) + '&gt;' : '') + '</span>'
    + '<span class="hd-date">' + escapeHtml(historyShortDate(d.date)) + '</span>'
    + historyRefBadges(d.refs) + '</div></div>';
  var body = (d.diffHtml && d.diffHtml.trim())
    ? '<div class="history-diff diff2html-container">' + d.diffHtml + '</div>'
    : '<div class="quick-open-empty">' + escapeHtml(t(d.isMerge ? 'history.merge' : 'history.noDiff')) + '</div>';
  detail.innerHTML = head + body;
}

function isHistoryOpen() {
  var v = document.getElementById('history-view');
  return !!(v && !v.classList.contains('hidden'));
}
function closeHistory() {
  var v = document.getElementById('history-view');
  if (v) v.classList.add('hidden');
  if (typeof syncRail === 'function') syncRail();
}
function openHistory() {
  var v = document.getElementById('history-view');
  if (!v) return;
  if (!window.monacoriGit) return; // browser/serve mode: no git bridge
  v.classList.remove('hidden');
  if (typeof syncRail === 'function') syncRail();
  var search = document.getElementById('history-search');
  if (search) { search.value = ''; }
  applyHistoryFilter();
  historyLoading = true;
  renderHistoryList();
  Promise.resolve(window.monacoriGit.log({ limit: 300 })).then(function (commits) {
    historyLoading = false;
    historyCommits = Array.isArray(commits) ? commits : [];
    historyGraph = computeHistoryGraph(historyCommits);
    historyMaxLane = historyGraph.maxLane || 0;
    renderHistoryList();
    var detail = document.getElementById('history-detail');
    if (detail) detail.innerHTML = '<div class="quick-open-empty">' + escapeHtml(t('history.selectCommit')) + '</div>';
    if (historyCommits[0]) openHistoryCommit(historyCommits[0].hash); // preview the newest commit
    if (search) setTimeout(function () { try { search.focus(); } catch (e) {} }, 0);
  }, function () { historyLoading = false; renderHistoryList(); });
}
function toggleHistory() { if (isHistoryOpen()) closeHistory(); else openHistory(); }
if (typeof window !== 'undefined') window.__monacoriHistory = { open: openHistory, close: closeHistory, toggle: toggleHistory, isOpen: isHistoryOpen };

(function wireHistory() {
  var list = document.getElementById('history-list');
  if (list) list.addEventListener('click', function (e) {
    var row = e.target.closest && e.target.closest('.hrow[data-sha]');
    if (row) openHistoryCommit(row.dataset.sha);
  });
  var search = document.getElementById('history-search');
  if (search) search.addEventListener('input', applyHistoryFilter);
  var closeBtn = document.getElementById('history-close');
  if (closeBtn) closeBtn.addEventListener('click', closeHistory);
  var view = document.getElementById('history-view');
  if (view) view.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeHistory(); }
  });
})();

/* ================================================================
   RebalanceIQ – app.js
   Vanilla JS: fetches precomputed JSON, renders Chart.js charts,
   powers the What-if simulator via nearest-bin lookup.
================================================================ */

/* ── Global state ─────────────────────────────────────────────── */
let METRICS   = null;
let FORECAST  = null;
let ERR_HOUR  = null;
let DRIVERS   = null;
let WHATIF    = null;
let CHENNAI_STATIONS = null;  // synthetic station simulation data

let forecastChart   = null;
let errorHourChart  = null;
let dayProfileChart = null;
let radarChart      = null;

let workingDay  = 1;  // 0 = weekend, 1 = working day
let workingDayB = 0;  // Scenario B default: weekend
let scenarioBVisible = false;
let radarDayType = 1;

/* ── Theme system ───────────────────────────────────── */
function initTheme() {
  const saved = localStorage.getItem('riq-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = saved === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('riq-theme', next);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = next === 'dark' ? '☀️' : '🌙';
  // Rebuild charts so they pick up new CSS variable colours
  rebuildCharts();
}

function getCSSVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getChartColors() {
  return {
    c1:   getCSSVar('--c1'),
    c2:   getCSSVar('--c2'),
    c3:   getCSSVar('--c3'),
    c4:   getCSSVar('--c4'),
    c5:   getCSSVar('--c5'),
    grid: getCSSVar('--chart-grid'),
    tick: getCSSVar('--chart-tick'),
  };
}

function rebuildCharts() {
  if (forecastChart)   { forecastChart.destroy();   forecastChart   = null; renderForecastChart(); }
  if (errorHourChart)  { errorHourChart.destroy();  errorHourChart  = null; renderErrorHourChart(); }
  if (dayProfileChart) { dayProfileChart.destroy(); dayProfileChart = null; }
  if (radarChart)      { radarChart.destroy();      radarChart      = null; renderRadar(); }
}

/* ── Chart.js global defaults ────────────────────────────── */
Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.plugins.legend.labels.boxWidth = 12;
Chart.defaults.plugins.legend.labels.usePointStyle = true;

/* ── Utility: fetch JSON ──────────────────────────────────────── */
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

/* ── Tab navigation ───────────────────────────────────────────── */
function showTab(name) {
  document.querySelectorAll('.tab-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('nav a').forEach(el => el.classList.remove('active'));

  document.getElementById(`section-${name}`).classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');
  const navEl = document.getElementById(`nav-${name}`);
  if (navEl) navEl.classList.add('active');

  // Lazy-render charts when their tab first becomes visible
  if (name === 'results' && FORECAST && !forecastChart) renderForecastChart();
  if (name === 'results' && ERR_HOUR && !errorHourChart) renderErrorHourChart();
  if (name === 'radar'   && WHATIF && ERR_HOUR && !radarChart) renderRadar();
  if (name === 'spatial' && CHENNAI_STATIONS) initSpatialRadar();
}

/* ── Groq API key (localStorage, never in source) ─────────────── */
function saveGroqKey(val) {
  const trimmed = val.trim();
  if (trimmed.length > 10) {
    localStorage.setItem('riq_groq_key', trimmed);
    const ok = document.getElementById('groq-key-ok');
    if (ok) ok.style.display = 'inline';
  } else {
    localStorage.removeItem('riq_groq_key');
    const ok = document.getElementById('groq-key-ok');
    if (ok) ok.style.display = 'none';
  }
}

function restoreGroqKeyUI() {
  const key = localStorage.getItem('riq_groq_key') || '';
  const inp = document.getElementById('groq-key-input');
  const ok  = document.getElementById('groq-key-ok');
  if (inp && key) { inp.value = key; }
  if (ok)  ok.style.display = key.length > 10 ? 'inline' : 'none';
}

/* ── Load all data on page load ───────────────────────────────── */
async function init() {
  try {
    [METRICS, FORECAST, ERR_HOUR, DRIVERS, WHATIF, CHENNAI_STATIONS] = await Promise.all([
      fetchJSON('data/metrics.json'),
      fetchJSON('data/forecast_week.json'),
      fetchJSON('data/error_by_hour.json'),
      fetchJSON('data/drivers.json'),
      fetchJSON('data/whatif_lookup.json'),
      fetchJSON('data/chennai_stations.json'),
    ]);

    // Expose to upload.js (let vars are NOT on window automatically)
    window.METRICS          = METRICS;
    window.FORECAST         = FORECAST;
    window.ERR_HOUR         = ERR_HOUR;
    window.DRIVERS          = DRIVERS;
    window.WHATIF           = WHATIF;
    window.CHENNAI_STATIONS = CHENNAI_STATIONS;

    renderHeroStats();
    renderSidebarKPIs();
    renderMetricCards();
    renderMetricsTable();
    renderForecastChart();
    renderErrorHourChart();
    initWhatif();
    initScenarioB();

  } catch (err) {
    console.error('Data load error:', err);
    document.querySelectorAll('.loading').forEach(el => {
      el.innerHTML = `<p style="color:var(--red)">⚠️ Could not load data files.<br>
        Run the notebook first to generate <code>public/data/*.json</code>.<br>
        <small>${err.message}</small></p>`;
    });
  }
}


/* ═══════════════════════════════════════════════════════════════
   OVERVIEW TAB
════════════════════════════════════════════════════════════════ */
function renderHeroStats() {
  const best = getBestModel();
  document.getElementById('stat-mae').textContent    = best.mae;
  document.getElementById('stat-rmse').textContent   = best.rmse;
  document.getElementById('stat-improve').textContent = `${METRICS.improvement_vs_naive_mae_pct}%`;
  document.getElementById('overview-improve').textContent = `${METRICS.improvement_vs_naive_mae_pct}%`;
  document.getElementById('ov-mae').textContent  = best.mae;
  document.getElementById('ov-rmse').textContent = best.rmse;
}

function getBestModel() {
  return METRICS.models.reduce((a, b) => a.mae < b.mae ? a : b);
}

/* ═══════════════════════════════════════════════════════════════
   RESULTS TAB
════════════════════════════════════════════════════════════════ */
function renderMetricCards() {
  const borderColors = ['var(--danger)', 'var(--teal,#0d9488)', 'var(--indigo)'];
  const valueColors  = ['var(--red)', 'var(--teal,#0d9488)', 'var(--indigo)'];
  const icons  = ['📏', '📐', '⭐'];
  const names  = [m => 'Naive baseline', m => 'Ridge regression', m => m.name || 'Best model'];

  const html = METRICS.models.map((m, i) => `
    <div class="metric-card" style="border-top:3px solid ${borderColors[i]}">
      <div class="metric-card-label">${icons[i]} ${names[i](m)}</div>
      <div class="metric-card-val" style="color:${valueColors[i]}">${m.mae}</div>
      <div class="metric-card-sub">MAE · rides/hour</div>
      <div class="metric-card-sub" style="margin-top:0.3rem">RMSE: <strong style="color:var(--fg)">${m.rmse}</strong></div>
    </div>
  `).join('');

  document.getElementById('metric-cards').innerHTML = html;
}

function renderMetricsTable() {
  const notes = [
    'No model training; uses same-hour 7 days ago',
    'Linear model with L2 regularisation',
    'Gradient boosted trees; best performer',
  ];

  const rows = METRICS.models.map((m, i) => {
    const isMain = i === METRICS.models.length - 1;
    return `<tr class="${isMain ? 'td-best' : ''}">
      <td class="td-model">${m.name}</td>
      <td class="${isMain ? 'td-best' : ''}">${m.mae}</td>
      <td>${m.rmse}</td>
      <td style="color:var(--text-muted);font-size:0.82rem">${notes[i]}</td>
    </tr>`;
  }).join('');

  document.querySelector('#metrics-table tbody').innerHTML = rows;
}

function renderForecastChart() {
  if (!FORECAST) return;
  // Format timestamps for display
  const labels = FORECAST.timestamps.map(t => {
    const d = new Date(t);
    return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${d.getHours()}:00`;
  });

  const cc = getChartColors();
  const ctx = document.getElementById('forecastChart').getContext('2d');
  forecastChart = window.forecastChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Actual',
          data: FORECAST.actual,
          borderColor: cc.c1,
          backgroundColor: cc.c1.replace(')', ',0.06)').replace('rgb', 'rgba'),
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.3,
        },
        {
          label: `${METRICS.best_model} forecast`,
          data: FORECAST.predicted,
          borderColor: cc.c3,
          borderWidth: 2,
          borderDash: [6, 3],
          pointRadius: 0,
          fill: false,
          tension: 0.3,
        },
        {
          label: 'Ridge forecast',
          data: FORECAST.ridge,
          borderColor: cc.c2,
          borderWidth: 1.5,
          borderDash: [3, 3],
          pointRadius: 0,
          fill: false,
          tension: 0.3,
        },
        {
          label: 'Naive forecast',
          data: FORECAST.naive,
          borderColor: cc.c4,
          borderWidth: 1,
          borderDash: [2, 4],
          pointRadius: 0,
          fill: false,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { padding: 16, font: { size: 12 }, color: cc.tick } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${Math.round(ctx.parsed.y)} rides`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 12,
            maxRotation: 45,
            font: { size: 10 },
            color: cc.tick,
            callback: function(val, i) {
              return i % 12 === 0 ? this.getLabelForValue(val).split(' ').slice(0, 2).join(' ') : '';
            },
          },
          grid: { color: cc.grid },
        },
        y: {
          title: { display: true, text: 'rides / hr', font: { size: 10 }, color: cc.tick },
          ticks: { color: cc.tick },
          grid: { color: cc.grid },
          min: 0,
        },
      },
    },
  });
}

function renderErrorHourChart() {
  if (!ERR_HOUR) return;
  const cc = getChartColors();
  const ctx = document.getElementById('errorHourChart').getContext('2d');
  const rushColor = cc.c3;
  const normalColor = cc.c3.replace(/[^,]+\)$/, '0.28)');
  const barColors = ERR_HOUR.hours.map(h =>
    ((7 <= h && h <= 9) || (17 <= h && h <= 19)) ? rushColor : normalColor
  );

  errorHourChart = window.errorHourChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ERR_HOUR.hours.map(h => `${h}:00`),
      datasets: [
        {
          label: 'Mean Absolute Error',
          data: ERR_HOUR.mae,
          backgroundColor: barColors,
          borderRadius: 4,
          order: 2,
        },
        {
          label: 'Heuristic buffer (+20% MAE)',
          data: ERR_HOUR.buffer,
          type: 'line',
          borderColor: cc.c4,
          borderWidth: 1.5,
          pointBackgroundColor: cc.c4,
          pointRadius: 2,
          fill: false,
          tension: 0.3,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { padding: 16, font: { size: 12 }, color: cc.tick } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} rides`,
          },
        },
      },
      scales: {
        x: { grid: { color: cc.grid }, ticks: { color: cc.tick } },
        y: {
          title: { display: true, text: 'error · rides/hr', font: { size: 10 }, color: cc.tick },
          ticks: { color: cc.tick },
          grid: { color: cc.grid },
          min: 0,
        },
      },
    },
  });
}

/* ═══════════════════════════════════════════════════════════════
   DRIVERS TAB
════════════════════════════════════════════════════════════════ */
function renderDrivers() {
  // Find max importance for bar normalisation
  const maxImp = Math.max(...DRIVERS.top_features.map(f => f.importance));

  const rankEmojis  = ['🥇', '🥈', '🥉'];

  const cards = DRIVERS.ops_guidance.map((g, i) => `
    <div class="card driver-card" style="margin-bottom:1rem">
      <div class="driver-name" style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
        <span>${rankEmojis[i] || ''}</span>
        <span>${g.label}</span>
      </div>
      <p class="driver-ops" style="margin-bottom:0.75rem">${g.insight}</p>
      <div class="demand-action"><strong>Suggested action</strong>${g.action}</div>
      ${renderImportanceBar(g.feature, maxImp)}
    </div>
  `).join('');

  document.getElementById('drivers-container').innerHTML = cards;

  // Animate bars after render
  setTimeout(() => {
    document.querySelectorAll('.driver-bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.width;
    });
  }, 100);
}

function renderImportanceBar(feature, maxImp) {
  const feat = DRIVERS.top_features.find(f => f.feature === feature);
  if (!feat) return '';
  const pct = Math.round((feat.importance / maxImp) * 100);
  return `
    <div style="margin-top:0.75rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem">
        <span style="font-size:0.7rem;font-family:var(--mono);color:var(--fg-muted);letter-spacing:0.06em">${feature}</span>
        <span style="font-size:0.7rem;font-family:var(--mono);color:var(--indigo)">imp: ${feat.importance.toFixed(2)}</span>
      </div>
      <div class="driver-bar-track">
        <div class="driver-bar-fill" data-width="${pct}%" style="width:0%"></div>
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════
   WHAT-IF TAB
════════════════════════════════════════════════════════════════ */
function initWhatif() {
  if (!WHATIF) return;
  updateHourLabel(document.getElementById('ctrl-hr').value);
  updateTempLabel(document.getElementById('ctrl-temp').value);
  updateHumLabel(document.getElementById('ctrl-hum').value);
  updateWindLabel(document.getElementById('ctrl-wind').value);
  updateDemand();
  renderDayProfile();
}

function updateHourLabel(val) {
  const h = parseInt(val);
  let display;
  if (h === 0)       display = '12:00 AM';
  else if (h < 12)   display = `${h}:00 AM`;
  else if (h === 12) display = '12:00 PM';
  else               display = `${h - 12}:00 PM`;
  document.getElementById('lbl-hr').textContent = display;
}

function updateTempLabel(val) {
  const labels = WHATIF ? WHATIF.temp_labels : [];
  document.getElementById('lbl-temp').textContent = labels[parseInt(val)] || val;
}

function updateHumLabel(val) {
  const labels = WHATIF ? WHATIF.hum_labels : [];
  document.getElementById('lbl-hum').textContent = labels[parseInt(val)] || val;
}

function updateWindLabel(val) {
  const labels = WHATIF ? WHATIF.wind_labels : [];
  document.getElementById('lbl-wind').textContent = labels[parseInt(val)] || val;
}

function setWorkingDay(val) {
  workingDay = val;
  document.getElementById('btn-wd-0').classList.toggle('active', val === 0);
  document.getElementById('btn-wd-1').classList.toggle('active', val === 1);
  updateDemand();
  renderDayProfile();
}

/* Nearest-bin lookup in JS – no server needed */
function lookupDemand(hr, wd, weather, tempBin, humBin, windBin) {
  if (!WHATIF) return null;
  const key = `${hr}_${wd}_${weather}_${tempBin}_${humBin}_${windBin}`;
  return WHATIF.lookup[key] ?? null;
}

function getCurrentInputs() {
  const hr      = parseInt(document.getElementById('ctrl-hr').value);
  const weather = parseInt(document.getElementById('ctrl-weather').value);
  const tempBin = parseInt(document.getElementById('ctrl-temp').value);
  const humBin  = parseInt(document.getElementById('ctrl-hum').value);
  const windBin = parseInt(document.getElementById('ctrl-wind').value);
  return { hr, weather, tempBin, humBin, windBin };
}

function updateDemand() {
  if (!WHATIF) return;
  const { hr, weather, tempBin, humBin, windBin } = getCurrentInputs();
  const pred = lookupDemand(hr, workingDay, weather, tempBin, humBin, windBin);

  if (pred === null) {
    document.getElementById('demand-val').textContent = '—';
    document.getElementById('demand-level').textContent = 'No prediction';
    document.getElementById('demand-level').className = 'demand-level';
    document.getElementById('demand-desc').textContent = 'This combination is not available in the lookup table.';
    document.getElementById('demand-action').innerHTML = '<strong>⚠️ Note</strong> Re-run the pipeline to regenerate the lookup table for all combinations.';
    document.getElementById('demand-gauge').className = 'demand-gauge';
    return;
  }

  const rounded = Math.round(pred);
  document.getElementById('demand-val').textContent = rounded;

  // Demand level thresholds (these are reasonable for bike-share)
  let level, levelClass, gaugeClass, desc, action;
  if (rounded < 50) {
    level = '🟢 Low Demand';
    levelClass = 'color-low'; gaugeClass = 'gauge-low';
    desc = 'Quiet period. Minimal rebalancing needed.';
    action = '<strong>🔧 Action</strong> No urgent rebalancing. Run scheduled overnight maintenance. Reduce truck frequency to cut costs.';
  } else if (rounded < 200) {
    level = '🟡 Medium Demand';
    levelClass = 'color-medium'; gaugeClass = 'gauge-medium';
    desc = 'Moderate activity. Monitor station fill levels.';
    action = '<strong>🔧 Action</strong> Standard operations. Check fill levels every 2 hours. One rebalancing run per zone per shift.';
  } else {
    level = '🔴 High Demand';
    levelClass = 'color-high'; gaugeClass = 'gauge-high';
    desc = 'Peak period. Act before docks empty or fill.';
    action = '<strong>🔧 Action</strong> Deploy all trucks. Pre-fill residential docks before 7 AM; empty downtown docks before 5 PM. Double staff at high-traffic stations.';
  }

  const gauge = document.getElementById('demand-gauge');
  if (gauge) gauge.className = `demand-gauge ${gaugeClass}`;
  document.getElementById('demand-val').style.color =
    gaugeClass === 'gauge-low' ? 'var(--green)' :
    gaugeClass === 'gauge-medium' ? 'var(--yellow)' : 'var(--red)';
  document.getElementById('demand-level').textContent = level;
  document.getElementById('demand-level').className = `demand-level ${levelClass}`;
  document.getElementById('demand-desc').textContent = desc;
  document.getElementById('demand-action').innerHTML = action;

  // Prediction explanation panel
  renderPredictionExplanation(pred, hr, workingDay, weather, tempBin, humBin, windBin);

  // Update comparison if Scenario B is visible
  if (scenarioBVisible) updateScenarioB();

  // Also update day profile chart
  renderDayProfile();
}

function renderDayProfile() {
  if (!WHATIF) return;
  const { weather, tempBin, humBin, windBin } = getCurrentInputs();

  const predictions = Array.from({ length: 24 }, (_, h) =>
    Math.round(lookupDemand(h, workingDay, weather, tempBin, humBin, windBin) ?? 0)
  );

  const currentHr = parseInt(document.getElementById('ctrl-hr').value);
  const cc = getChartColors();
  const barColors = predictions.map((_, h) =>
    h === currentHr ? cc.c3 : ((7 <= h && h <= 9) || (17 <= h && h <= 19)) ? cc.c2 : cc.grid
  );

  const data = {
    labels: Array.from({ length: 24 }, (_, h) => `${h}:00`),
    datasets: [{
      label: 'Predicted Demand',
      data: predictions,
      backgroundColor: barColors,
      borderRadius: 3,
    }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: { label: ctx => ` ${ctx.parsed.y} rides/hr` },
      },
    },
    scales: {
      x: { grid: { color: cc.grid }, ticks: { font: { size: 10 }, color: cc.tick } },
      y: { grid: { color: cc.grid }, ticks: { color: cc.tick }, min: 0 },
    },
  };

  if (dayProfileChart) {
    dayProfileChart.data.datasets[0].backgroundColor = barColors;
    dayProfileChart.data.datasets[0].data = predictions;
    dayProfileChart.update('active');
  } else {
    const ctx = document.getElementById('dayProfileChart').getContext('2d');
    dayProfileChart = window.dayProfileChart = new Chart(ctx, { type: 'bar', data, options });
  }
}

/* ── Sidebar KPI mini-cards ──────────────────────────────────── */
function renderSidebarKPIs() {
  if (!METRICS) return;
  const best = getBestModel();
  const naive = METRICS.models.find(m => m.name && m.name.toLowerCase().includes('naive'));
  const imp   = METRICS.improvement_vs_naive_mae_pct;

  const sbMae  = document.getElementById('sb-mae');
  const sbRmse = document.getElementById('sb-rmse');
  const sbImp  = document.getElementById('sb-improve');
  if (sbMae)  sbMae.textContent  = best.mae;
  if (sbRmse) sbRmse.textContent = best.rmse;
  if (sbImp)  sbImp.textContent  = imp + '%';
}

/* ── Kick off ─────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => { initTheme(); restoreGroqKeyUI(); init(); });

/* ═══════════════════════════════════════════════════════════════
   DRIVERS TAB — GROUPED IMPORTANCE
════════════════════════════════════════════════════════════════ */
function renderGroupedImportance() {
  if (!DRIVERS) return;

  // Feature-to-group mapping
  const GROUPS = {
    'Time of Day':   { features: ['hr','sin_hour','cos_hour','rush_hour'], cls: 'group-bar-tod' },
    'Calendar':      { features: ['workingday','weekday','holiday'],        cls: 'group-bar-calendar' },
    'Weather':       { features: ['temp','atemp','hum','windspeed','weathersit'], cls: 'group-bar-weather' },
    'Season / Trend':{ features: ['season','mnth','yr'],                   cls: 'group-bar-season' },
  };

  // Aggregate importance from top_features (only those with reported values)
  const importanceMap = {};
  DRIVERS.top_features.forEach(f => { importanceMap[f.feature] = f.importance; });

  const groupTotals = {};
  let allGroupSum = 0;
  for (const [gName, gDef] of Object.entries(GROUPS)) {
    const total = gDef.features.reduce((sum, f) => sum + (importanceMap[f] || 0), 0);
    groupTotals[gName] = { total, cls: gDef.cls };
    allGroupSum += total;
  }

  if (allGroupSum === 0) {
    document.getElementById('grouped-importance-container').innerHTML =
      '<p style="color:var(--text-muted);font-size:0.85rem">Grouped importance not available.</p>';
    return;
  }

  const rows = Object.entries(groupTotals)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, { total, cls }]) => {
      const pct = ((total / allGroupSum) * 100).toFixed(1);
      const barPct = ((total / groupTotals[Object.keys(groupTotals)[0]].total) * 100).toFixed(1);
      return `
        <div class="group-bar-row">
          <div class="group-label">${name}</div>
          <div class="group-bar-outer">
            <div class="group-bar-inner ${cls}" style="width:${pct}%"></div>
          </div>
          <div class="group-pct">${pct}%</div>
        </div>
      `;
    }).join('');

  document.getElementById('grouped-importance-container').innerHTML =
    `<div style="padding:0.25rem 0">${rows}</div>
     <div style="font-size:0.78rem;color:var(--fg-dim);margin-top:0.75rem;font-weight:300">
       Based on top-${DRIVERS.top_features.length} features from permutation importance.
     </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   WHAT-IF — PREDICTION EXPLANATION
════════════════════════════════════════════════════════════════ */
function renderPredictionExplanation(pred, hr, wd, weather, tempBin, humBin, windBin) {
  const body = document.getElementById('pred-explain-body');
  if (!body || !DRIVERS) return;

  if (pred === null) {
    body.innerHTML = '<span style="color:var(--text-muted)">No prediction available for this combination.</span>';
    return;
  }

  const tempLabels = WHATIF.temp_labels || [];
  const humLabels  = WHATIF.hum_labels  || [];
  const windLabels = WHATIF.wind_labels || [];

  // Describe each input factor with its approximate contribution
  // Using heuristic: multiply SHAP importance × factor deviation from typical
  const factors = [
    {
      name: 'Hour of Day',
      value: (() => {
        if (hr === 0) return '12:00 AM';
        if (hr < 12)  return `${hr}:00 AM`;
        if (hr === 12) return '12:00 PM';
        return `${hr - 12}:00 PM`;
      })(),
      level: ((7 <= hr && hr <= 9) || (17 <= hr && hr <= 19)) ? 'high'
           : (hr >= 10 && hr <= 16) ? 'med' : 'low',
      note: ((7 <= hr && hr <= 9) || (17 <= hr && hr <= 19)) ? 'Rush hour — highest demand window'
          : (hr >= 10 && hr <= 16) ? 'Midday — moderate activity'
          : 'Off-peak — low demand window',
    },
    {
      name: 'Day Type',
      value: wd === 1 ? 'Working Day' : 'Weekend',
      level: wd === 1 ? ((7 <= hr && hr <= 9) || (17 <= hr && hr <= 19)) ? 'high' : 'med' : 'low',
      note: wd === 1 ? 'Working days amplify rush-hour peaks' : 'Leisure pattern — no commute peaks',
    },
    {
      name: 'Weather',
      value: weather === 1 ? 'Clear / Partly Cloudy' : weather === 2 ? 'Mist / Cloudy' : 'Light Rain',
      level: weather === 1 ? 'high' : weather === 2 ? 'med' : 'low',
      note: weather === 1 ? 'Clear weather boosts ridership' : weather === 2 ? 'Mist reduces demand slightly' : 'Rain significantly reduces demand',
    },
    {
      name: 'Temperature',
      value: tempLabels[tempBin] || `Bin ${tempBin}`,
      level: (tempBin >= 3 && tempBin <= 6) ? 'high' : tempBin >= 2 ? 'med' : 'low',
      note: (tempBin >= 3 && tempBin <= 6) ? 'Comfortable temperature — favours cycling'
          : tempBin < 2 ? 'Cold — reduces demand'
          : 'Mild — moderate cycling conditions',
    },
  ];

  const tagHtml = (level) => {
    if (level === 'high') return '<span class="explain-factor-tag explain-high">↑ High</span>';
    if (level === 'med')  return '<span class="explain-factor-tag explain-med">→ Mid</span>';
    return '<span class="explain-factor-tag explain-low">↓ Low</span>';
  };

  const html = factors.map(f => `
    <div class="explain-factor">
      <div>
        <span class="explain-factor-name">${f.name}</span>${tagHtml(f.level)}
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.2rem">${f.note}</div>
      </div>
      <div class="explain-factor-val">${f.value}</div>
    </div>
  `).join('');

  body.innerHTML = html +
    `<div style="font-size:0.75rem;color:var(--text-dim);margin-top:0.75rem;line-height:1.5">
      This explanation uses feature-level heuristics based on known demand patterns
      (not exact Shapley values for this specific prediction). Treat as directional context.
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   WHAT-IF — SCENARIO B
════════════════════════════════════════════════════════════════ */
function initScenarioB() {
  if (!WHATIF) return;
  updateHourLabelB(document.getElementById('ctrl-hr-b').value);
  updateTempLabelB(document.getElementById('ctrl-temp-b').value);
  updateHumLabelB(document.getElementById('ctrl-hum-b').value);
  updateWindLabelB(document.getElementById('ctrl-wind-b').value);
}

function toggleScenarioB() {
  scenarioBVisible = !scenarioBVisible;
  const section = document.getElementById('scenario-b-section');
  const btn     = document.getElementById('compare-toggle');
  section.style.display = scenarioBVisible ? 'block' : 'none';
  btn.textContent = scenarioBVisible ? '✕ Close Scenario B' : '+ Compare Scenario B';
  btn.classList.toggle('active', scenarioBVisible);
  if (scenarioBVisible) updateScenarioB();
}

function updateHourLabelB(val) {
  const h = parseInt(val);
  let display;
  if (h === 0)       display = '12:00 AM';
  else if (h < 12)   display = `${h}:00 AM`;
  else if (h === 12) display = '12:00 PM';
  else               display = `${h - 12}:00 PM`;
  document.getElementById('lbl-hr-b').textContent = display;
}

function updateTempLabelB(val) {
  const labels = WHATIF ? WHATIF.temp_labels : [];
  document.getElementById('lbl-temp-b').textContent = labels[parseInt(val)] || val;
}

function updateHumLabelB(val) {
  const labels = WHATIF ? WHATIF.hum_labels : [];
  document.getElementById('lbl-hum-b').textContent = labels[parseInt(val)] || val;
}

function updateWindLabelB(val) {
  const labels = WHATIF ? WHATIF.wind_labels : [];
  document.getElementById('lbl-wind-b').textContent = labels[parseInt(val)] || val;
}

function setWorkingDayB(val) {
  workingDayB = val;
  document.getElementById('btn-wd-0-b').classList.toggle('active', val === 0);
  document.getElementById('btn-wd-1-b').classList.toggle('active', val === 1);
  updateScenarioB();
}

function getDemandLabel(rounded) {
  if (rounded < 50)  return { label: 'Low demand',    cls: 'color-low',    gauge: 'gauge-low' };
  if (rounded < 200) return { label: 'Medium demand', cls: 'color-medium', gauge: 'gauge-medium' };
  return               { label: 'High demand',   cls: 'color-high',   gauge: 'gauge-high' };
}

function updateScenarioB() {
  if (!WHATIF || !scenarioBVisible) return;
  const hr      = parseInt(document.getElementById('ctrl-hr-b').value);
  const weather = parseInt(document.getElementById('ctrl-weather-b').value);
  const tempBin = parseInt(document.getElementById('ctrl-temp-b').value);
  const humBin  = parseInt(document.getElementById('ctrl-hum-b').value);
  const windBin = parseInt(document.getElementById('ctrl-wind-b').value);

  const pred = lookupDemand(hr, workingDayB, weather, tempBin, humBin, windBin);

  const valEl   = document.getElementById('demand-val-b');
  const levelEl = document.getElementById('demand-level-b');
  const descEl  = document.getElementById('demand-desc-b');
  const gaugeEl = document.getElementById('demand-gauge-b');

  if (pred === null) {
    valEl.textContent   = '—';
    levelEl.textContent = 'No prediction';
    levelEl.className   = 'demand-level';
    descEl.textContent  = 'Combination not in lookup table.';
    gaugeEl.className   = 'demand-gauge';
    renderComparison(null);
    return;
  }

  const rounded = Math.round(pred);
  valEl.textContent = rounded;
  const { label, cls, gauge } = getDemandLabel(rounded);
  levelEl.textContent = label;
  levelEl.className   = `demand-level ${cls}`;
  const gaugeEl2 = document.getElementById('demand-gauge-b');
  if (gaugeEl2) gaugeEl2.className = `demand-gauge ${gauge}`;
  valEl.style.color = gauge === 'gauge-low' ? 'var(--green)' : gauge === 'gauge-medium' ? 'var(--yellow)' : 'var(--red)';
  descEl.textContent  = rounded < 50 ? 'Low demand period.' : rounded < 200 ? 'Moderate activity.' : 'Peak period.';

  renderComparison(rounded);
}

function renderComparison(predB) {
  const body = document.getElementById('comparison-body');
  if (!body) return;

  const predA = WHATIF ? (() => {
    const { hr, weather, tempBin, humBin, windBin } = getCurrentInputs();
    const p = lookupDemand(hr, workingDay, weather, tempBin, humBin, windBin);
    return p !== null ? Math.round(p) : null;
  })() : null;

  if (predA === null || predB === null) {
    body.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem">Set valid conditions for both scenarios.</div>';
    return;
  }

  const diff    = predB - predA;
  const pctDiff = predA === 0 ? 0 : ((diff / predA) * 100).toFixed(1);
  const diffCls = diff > 0 ? 'comp-diff-pos' : diff < 0 ? 'comp-diff-neg' : '';
  const diffSign = diff > 0 ? '+' : '';
  const { label: labelA } = getDemandLabel(predA);
  const { label: labelB } = getDemandLabel(predB);

  // What changed?
  const hrA  = parseInt(document.getElementById('ctrl-hr').value);
  const hrB  = parseInt(document.getElementById('ctrl-hr-b').value);
  const wdA  = workingDay;
  const wdB  = workingDayB;
  const wtA  = parseInt(document.getElementById('ctrl-weather').value);
  const wtB  = parseInt(document.getElementById('ctrl-weather-b').value);

  const changes = [];
  if (hrA !== hrB)  changes.push(`hour (${hrA}:00 → ${hrB}:00)`);
  if (wdA !== wdB)  changes.push(`day type (${wdA === 1 ? 'Working' : 'Weekend'} → ${wdB === 1 ? 'Working' : 'Weekend'})`);
  if (wtA !== wtB)  changes.push(`weather (${wtA === 1 ? 'Clear' : wtA === 2 ? 'Mist' : 'Rain'} → ${wtB === 1 ? 'Clear' : wtB === 2 ? 'Mist' : 'Rain'})`);

  const changeNote = changes.length
    ? `Key difference${changes.length > 1 ? 's' : ''}: ${changes.join(', ')}.`
    : 'All conditions identical.';

  body.innerHTML = `
    <div class="comparison-row header">
      <div>Metric</div><div style="color:var(--accent)">Scenario A</div><div style="color:var(--purple)">Scenario B</div>
    </div>
    <div class="comparison-row">
      <div style="color:var(--text-muted)">Predicted Demand</div>
      <div class="comp-val-a">${predA} rides/hr</div>
      <div class="comp-val-b">${predB} rides/hr</div>
    </div>
    <div class="comparison-row">
      <div style="color:var(--text-muted)">Demand Level</div>
      <div class="comp-val-a">${labelA}</div>
      <div class="comp-val-b">${labelB}</div>
    </div>
    <div class="comparison-row">
      <div style="color:var(--text-muted)">Difference (B − A)</div>
      <div class="comp-diff ${diffCls}" style="grid-column:2/4">${diffSign}${diff} rides/hr (${diffSign}${pctDiff}%)</div>
    </div>
    <div class="comparison-note">
      ${changeNote}
      These are model estimates from the precomputed lookup table. Differences reflect the
      model's learned associations — they are correlational, not causal.
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════
   RISK RADAR TAB
════════════════════════════════════════════════════════════════ */
function setRadarDayType(val) {
  radarDayType = val;
  document.getElementById('radar-wd-0').classList.toggle('active', val === 0);
  document.getElementById('radar-wd-1').classList.toggle('active', val === 1);
  renderRadar();
}

function renderRadar() {
  if (!WHATIF || !ERR_HOUR) return;

  const wd      = radarDayType;
  const weather = parseInt(document.getElementById('radar-weather').value);
  const tempBin = parseInt(document.getElementById('radar-temp').value);
  const humBin  = 1; // medium
  const windBin = 0; // calm

  // Build 24h demand and MAE arrays
  const demands = Array.from({ length: 24 }, (_, h) =>
    Math.round(lookupDemand(h, wd, weather, tempBin, humBin, windBin) ?? 0)
  );
  const maes = ERR_HOUR.mae;

  const maxDemand = Math.max(...demands);
  const maxMAE    = Math.max(...maes);

  // Compute risk score per hour
  const riskScores = demands.map((d, h) => {
    const demandScore = maxDemand > 0 ? d / maxDemand : 0;
    const errorScore  = maxMAE   > 0 ? maes[h] / maxMAE : 0;
    return parseFloat((0.6 * demandScore + 0.4 * errorScore).toFixed(3));
  });

  // Render chart
  renderRadarChart(demands, maes, riskScores);

  // Render table
  renderRadarTable(demands, maes, riskScores, wd);
}

function renderRadarChart(demands, maes, riskScores) {
  const labels = Array.from({ length: 24 }, (_, h) => `${h}:00`);

  const cc = getChartColors();
  const barColors = riskScores.map(r =>
    r > 0.66 ? 'rgba(220,38,38,0.82)' : r > 0.33 ? 'rgba(217,119,6,0.75)' : 'rgba(5,150,105,0.65)'
  );

  const data = {
    labels,
    datasets: [
      {
        type: 'bar',
        label: 'Predicted demand (rides/hr)',
        data: demands,
        backgroundColor: barColors,
        borderRadius: 3,
        yAxisID: 'y',
        order: 2,
      },
      {
        type: 'line',
        label: 'Historical MAE (rides/hr)',
        data: maes,
        borderColor: cc.c2,
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 2,
        pointBackgroundColor: cc.c2,
        tension: 0.35,
        yAxisID: 'y2',
        order: 1,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', labels: { padding: 14, font: { size: 12 }, color: cc.tick } },
      tooltip: {
        callbacks: {
          afterBody: (items) => {
            const h = items[0].dataIndex;
            return [`Risk Score: ${riskScores[h]}`];
          },
        },
      },
    },
    scales: {
      x: { grid: { color: cc.grid }, ticks: { font: { size: 10 }, color: cc.tick } },
      y: {
        position: 'left',
        title: { display: true, text: 'predicted demand', font: { size: 10 }, color: cc.tick },
        ticks: { color: cc.tick },
        grid: { color: cc.grid },
        min: 0,
      },
      y2: {
        position: 'right',
        title: { display: true, text: 'historical MAE', font: { size: 10 }, color: cc.tick },
        ticks: { color: cc.tick },
        grid: { drawOnChartArea: false },
        min: 0,
      },
    },
  };

  if (radarChart) {
    radarChart.data = data;
    radarChart.update('active');
  } else {
    const ctx = document.getElementById('radarProfileChart').getContext('2d');
    radarChart = window.radarChart = new Chart(ctx, { type: 'bar', data, options });
  }
}

function renderRadarTable(demands, maes, riskScores, wd) {
  const hourFmt = h => {
    if (h === 0)  return '12:00 AM';
    if (h < 12)   return `${h}:00 AM`;
    if (h === 12) return '12:00 PM';
    return `${h - 12}:00 PM`;
  };

  const getAction = (h, risk, demand, wd) => {
    const isRush = (7 <= h && h <= 9) || (17 <= h && h <= 19);
    if (risk > 0.66) {
      if (isRush && wd === 1)
        return h <= 9 ? 'Pre-position bikes at transit hubs by 6:30 AM. Verify dock fill before the peak.'
                      : 'Reverse rebalance: clear downtown docks before 5 PM. Staff outbound stations.';
      return 'Elevated demand and/or historically high model error. Review forecast vs. current operational data before committing resources.';
    }
    if (risk > 0.33)
      return demand > 100
        ? 'Moderate demand expected. One rebalancing run per zone. Check fill levels hourly.'
        : 'Moderate demand period. Monitor station inventory. Standard operations apply.';
    return demand < 30
      ? 'Quiet period. No rebalancing required. Schedule overnight maintenance if applicable.'
      : 'Low risk. Standard monitoring interval. No urgent action required.';
  };

  const getBadge = (risk) => {
    if (risk > 0.66) return '<span class="risk-badge risk-high">High</span>';
    if (risk > 0.33) return '<span class="risk-badge risk-medium">Medium</span>';
    return '<span class="risk-badge risk-low">Low</span>';
  };

  const getRowClass = (risk) => {
    if (risk > 0.66) return 'risk-row-high';
    if (risk > 0.33) return 'risk-row-medium';
    return '';
  };

  const rows = Array.from({ length: 24 }, (_, h) => {
    const risk    = riskScores[h];
    const demand  = demands[h];
    const mae     = maes[h];
    return `
      <tr class="${getRowClass(risk)}">
        <td><strong>${hourFmt(h)}</strong></td>
        <td><strong>${demand}</strong> rides</td>
        <td>${mae.toFixed(1)} rides</td>
        <td>${risk.toFixed(2)}</td>
        <td>${getBadge(risk)}</td>
        <td class="radar-action">${getAction(h, risk, demand, wd)}</td>
      </tr>
    `;
  }).join('');

  document.getElementById('radar-tbody').innerHTML = rows;
}


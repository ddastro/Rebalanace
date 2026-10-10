/* ================================================================
   RebalanceIQ — upload.js  (v3 — full cross-tab update + Groq AI)
================================================================ */

const GROQ_MODEL = 'llama-3.1-8b-instant';
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';

// API key stored in localStorage — never in source code
function getGroqKey() {
  return localStorage.getItem('riq_groq_key') || '';
}

/* ── Upload state ─────────────────────────────────────────────── */
let UPLOADED_DATA    = null;
let UPLOADED_PRED    = null;
let UPLOAD_FILENAME  = '';
let uploadPredChart  = null;
let uploadHourlyChart = null;

/* ── Drag-and-drop wiring ─────────────────────────────────────── */
(function () {
  const zone = document.getElementById('upload-zone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFileUpload(f);
  });
})();

/* ── Entry point ─────────────────────────────────────────────── */
function handleFileUpload(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.csv')) { showUploadError('Only .csv files are supported.'); return; }
  UPLOAD_FILENAME = file.name;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const rows = parseCSV(e.target.result);
      const v = validateUpload(rows);
      if (!v.ok) { showUploadError(v.error); return; }
      UPLOADED_DATA = rows;

      const tryProcess = (attempts = 0) => {
        if (window.WHATIF && window.WHATIF.lookup) {
          processUpload(rows);
        } else if (attempts < 12) {
          setTimeout(() => tryProcess(attempts + 1), 250);
        } else {
          processUpload(rows); // proceed without predictions
        }
      };
      tryProcess();
    } catch (err) { showUploadError('Parse error: ' + err.message); }
  };
  reader.onerror = () => showUploadError('Could not read file.');
  reader.readAsText(file);
}

/* ── Main processor ──────────────────────────────────────────── */
function processUpload(rows) {
  const stats       = computeStats(rows);
  const predResults = runPredictions(rows);
  UPLOADED_PRED     = predResults;

  // ① Update hero strip
  updateHero(stats, predResults);

  // ② Show upload banner
  renderUploadBanner(stats, predResults);

  // ③ Update sidebar status
  renderUploadStatus(stats, predResults);

  // ④ Overview tab — summary card + charts
  renderUploadSummary(stats, predResults);

  // ⑤ Results tab — overlay on forecast + error charts
  updateForecastChartWithUpload(rows, predResults);
  updateErrorChartWithUpload(rows);

  // ⑥ What-if tab — update day profile using uploaded hourly pattern
  updateDayProfileWithUpload(predResults);

  // ⑦ Risk Radar — recompute from uploaded hourly demand
  updateRiskRadarWithUpload(predResults);

  // ⑧ Groq AI insights (async — card shows immediately with spinner)
  const aiCard = document.getElementById('ai-insights-card');
  if (aiCard) aiCard.style.display = 'block';
  callGroqAPI(stats, predResults);
}

/* ═══════════════════════════════════════════════════════════════
   HERO UPDATE
════════════════════════════════════════════════════════════════ */
function updateHero(stats, pred) {
  const section = document.getElementById('hero-section');
  if (section) section.classList.add('upload-mode');

  // Headline: uploaded mean demand
  const maeEl = document.getElementById('stat-mae');
  if (maeEl) maeEl.textContent = stats.mean;

  // Sub-line
  const subEl = document.querySelector('.hero-sub');
  if (subEl) {
    subEl.innerHTML =
      `<span class="hero-upload-tag">📂 Uploaded</span> ` +
      `<strong>${stats.rows.toLocaleString()} rows</strong> · ${stats.dateRange} · ${stats.filename}` +
      (pred.available
        ? ` · Model MAE on upload: <strong>${pred.mae}</strong> rides/hr`
        : '');
  }

  // Right metric cards
  const rmseEl = document.getElementById('stat-rmse');
  if (rmseEl) rmseEl.textContent = pred.available ? pred.rmse : stats.max;
  const impEl  = document.getElementById('stat-improve');
  if (impEl)  impEl.textContent  = pred.available ? pred.r2 : '—';

  // Overview key-result card
  const ovImp  = document.getElementById('overview-improve');
  const ovMae  = document.getElementById('ov-mae');
  const ovRmse = document.getElementById('ov-rmse');
  if (ovImp)  ovImp.textContent  = pred.available ? pred.r2 + ' R²'    : stats.mean + ' avg';
  if (ovMae)  ovMae.textContent  = pred.available ? pred.mae           : stats.mean;
  if (ovRmse) ovRmse.textContent = pred.available ? pred.rmse          : stats.max;

  // Sidebar KPIs
  const sbMae  = document.getElementById('sb-mae');
  const sbRmse = document.getElementById('sb-rmse');
  const sbImp  = document.getElementById('sb-improve');
  if (sbMae)  sbMae.textContent  = pred.available ? pred.mae  : stats.mean;
  if (sbRmse) sbRmse.textContent = pred.available ? pred.rmse : stats.max;
  if (sbImp)  sbImp.textContent  = pred.available ? pred.r2   : '—';
}

/* ═══════════════════════════════════════════════════════════════
   CSV PARSE + VALIDATE
════════════════════════════════════════════════════════════════ */
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('File has fewer than 2 lines.');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitCSVLine(lines[i].trim());
    if (!vals.length) continue;
    const row = {};
    headers.forEach((h, j) => { row[h] = (vals[j] || '').replace(/^"|"$/g, '').trim(); });
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line) {
  const result = []; let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
    else cur += ch;
  }
  result.push(cur);
  return result;
}

function validateUpload(rows) {
  if (!rows || rows.length === 0) return { ok: false, error: 'CSV is empty.' };
  const h = Object.keys(rows[0]);
  if (!h.includes('cnt')) return { ok: false, error: 'Missing column "cnt". Need UCI hour.csv format.' };
  return { ok: true };
}

/* ═══════════════════════════════════════════════════════════════
   PREDICTION ENGINE
════════════════════════════════════════════════════════════════ */
function assignBin(value, boundaries) {
  for (let i = 0; i < boundaries.length; i++) if (value <= boundaries[i]) return i;
  return boundaries.length;
}

function predictRow(row) {
  if (!window.WHATIF?.lookup) return null;
  const W = window.WHATIF;
  const hr         = parseInt(row.hr)         || 0;
  const workingday = parseInt(row.workingday) ?? 1;
  const weathersit = parseInt(row.weathersit) || 1;
  const temp       = parseFloat(row.temp)     ?? 0.5;
  const hum        = parseFloat(row.hum)      ?? 0.5;
  const windspeed  = parseFloat(row.windspeed)?? 0.1;

  const tempBin = Math.min(assignBin(temp, W.temp_bins), 7);
  const humBin  = Math.min(assignBin(hum,  W.hum_bins),  2);
  const windBin = Math.min(assignBin(windspeed, W.wind_bins), 2);
  const key = `${hr}_${workingday}_${weathersit}_${tempBin}_${humBin}_${windBin}`;
  const val = W.lookup[key];
  return val !== undefined ? val : null;
}

/* Expose for other scripts */
window.riqPredictRow = predictRow;

function runPredictions(rows) {
  if (!window.WHATIF) {
    return { available: false, mae: '—', rmse: '—', r2: '—', coverage: 0,
             n: 0, actual: [], predicted: [], timestamps: [],
             hourlyActual: Array(24).fill(0), hourlyPredicted: Array(24).fill(0) };
  }

  const actual = [], predicted = [], timestamps = [], errors = [], sqErrors = [];
  const hourActSum  = Array(24).fill(0), hourActN   = Array(24).fill(0);
  const hourPredSum = Array(24).fill(0), hourPredN  = Array(24).fill(0);
  let covered = 0;

  rows.forEach((row, i) => {
    const cnt  = parseFloat(row.cnt);
    const pred = predictRow(row);
    const hr   = Math.max(0, Math.min(23, parseInt(row.hr) || 0));
    const ts   = row.dteday ? row.dteday + ' ' + String(hr).padStart(2,'0') + ':00' : `Row ${i+1}`;

    if (!isNaN(cnt)) { hourActSum[hr] += cnt; hourActN[hr]++; }
    if (pred !== null) covered++;

    if (!isNaN(cnt) && pred !== null) {
      actual.push(cnt); predicted.push(pred); timestamps.push(ts);
      errors.push(Math.abs(cnt - pred));
      sqErrors.push((cnt - pred) ** 2);
      hourPredSum[hr] += pred; hourPredN[hr]++;
    }
  });

  const n    = errors.length;
  const mae  = n ? errors.reduce((a,b)=>a+b,0)/n : null;
  const rmse = n ? Math.sqrt(sqErrors.reduce((a,b)=>a+b,0)/n) : null;
  let r2     = null;
  if (n > 1) {
    const m   = actual.reduce((a,b)=>a+b,0)/n;
    const ss  = actual.reduce((s,v)=>s+(v-m)**2,0);
    r2 = ss>0 ? 1 - sqErrors.reduce((a,b)=>a+b,0)/ss : 0;
  }

  return {
    available: true,
    mae:   mae  !== null ? mae.toFixed(2)  : '—',
    rmse:  rmse !== null ? rmse.toFixed(2) : '—',
    r2:    r2   !== null ? r2.toFixed(3)   : '—',
    coverage: rows.length ? Math.round((covered/rows.length)*100) : 0,
    n, actual, predicted, timestamps,
    hourlyActual:    hourActN.map((c,i)  => c>0 ? hourActSum[i]/c  : 0),
    hourlyPredicted: hourPredN.map((c,i) => c>0 ? hourPredSum[i]/c : 0),
  };
}

/* ═══════════════════════════════════════════════════════════════
   STATS
════════════════════════════════════════════════════════════════ */
function computeStats(rows) {
  const h    = Object.keys(rows[0]);
  const cnt  = rows.map(r=>parseFloat(r.cnt)).filter(v=>!isNaN(v));
  const dates = h.includes('dteday')
    ? [...new Set(rows.map(r=>r.dteday).filter(Boolean))].sort() : [];
  const mean   = cnt.length ? cnt.reduce((a,b)=>a+b,0)/cnt.length : 0;
  const sorted = [...cnt].sort((a,b)=>a-b);
  return {
    rows: rows.length, cntRows: cnt.length,
    mean: mean.toFixed(1), min: cnt.length ? Math.min(...cnt) : 0,
    max:  cnt.length ? Math.max(...cnt) : 0,
    median: sorted.length ? sorted[Math.floor(sorted.length/2)].toFixed(1) : '—',
    dateRange: dates.length > 1 ? dates[0]+' – '+dates[dates.length-1] : dates[0]||'unknown',
    filename: UPLOAD_FILENAME, headers: h,
    totalDemand: cnt.reduce((a,b)=>a+b,0).toFixed(0),
    peakHour: (() => {
      const hs = Array(24).fill(0), hn = Array(24).fill(0);
      rows.forEach(r => {
        const hr = parseInt(r.hr); const v = parseFloat(r.cnt);
        if (!isNaN(hr) && !isNaN(v)) { hs[hr]+=v; hn[hr]++; }
      });
      const avgs = hn.map((n,i)=>n>0?hs[i]/n:0);
      return avgs.indexOf(Math.max(...avgs));
    })(),
  };
}

/* ═══════════════════════════════════════════════════════════════
   CROSS-TAB CHART UPDATES
════════════════════════════════════════════════════════════════ */

/* RESULTS tab — overlay on forecast chart */
function updateForecastChartWithUpload(rows, pred) {
  if (!window.forecastChart) return;
  const fc = window.forecastChart;
  fc.data.datasets = fc.data.datasets.filter(d => !d._upload);
  if (pred.available && pred.n > 0) {
    const N = Math.min(fc.data.labels.length, pred.actual.length);
    fc.data.datasets.push({
      label: '⬆ Uploaded actual',
      data: pred.actual.slice(0,N),
      borderColor: 'rgba(192,132,252,0.9)',
      borderWidth: 2,
      pointRadius: 0,
      fill: false, tension: 0.3, _upload: true,
    });
    fc.data.datasets.push({
      label: '⬆ Model pred (upload)',
      data: pred.predicted.slice(0,N),
      borderColor: 'rgba(34,211,238,0.8)',
      borderWidth: 2,
      borderDash: [5,3],
      pointRadius: 0,
      fill: false, tension: 0.3, _upload: true,
    });
    fc.update('none');
  }
}

/* RESULTS tab — recompute error-by-hour from uploaded data */
function updateErrorChartWithUpload(rows) {
  if (!window.errorHourChart || !window.WHATIF) return;
  const maeSum = Array(24).fill(0), maeN = Array(24).fill(0);
  rows.forEach(row => {
    const hr  = Math.max(0,Math.min(23,parseInt(row.hr)||0));
    const cnt = parseFloat(row.cnt);
    if (isNaN(cnt)) return;
    const pred = predictRow(row);
    if (pred===null) return;
    maeSum[hr] += Math.abs(cnt-pred); maeN[hr]++;
  });
  const uploadMae = maeN.map((n,i) => n>0 ? parseFloat((maeSum[i]/n).toFixed(2)) : 0);

  const ec = window.errorHourChart;
  ec.data.datasets = ec.data.datasets.filter(d => !d._upload);
  ec.data.datasets.push({
    type: 'line',
    label: '⬆ Uploaded MAE',
    data: uploadMae,
    borderColor: '#c084fc',
    borderWidth: 2,
    pointRadius: 3,
    pointBackgroundColor: '#c084fc',
    fill: false, tension: 0.4,
    _upload: true,
  });
  ec.update('active');
}

/* WHAT-IF tab — update day profile with uploaded hourly average */
function updateDayProfileWithUpload(pred) {
  if (!window.dayProfileChart) return;
  const dc = window.dayProfileChart;
  // Remove old upload dataset
  dc.data.datasets = dc.data.datasets.filter(d => !d._upload);
  if (pred.available && pred.hourlyActual.some(v=>v>0)) {
    dc.data.datasets.push({
      label: '⬆ Uploaded avg',
      data: pred.hourlyActual,
      type: 'line',
      borderColor: '#22d3ee',
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: '#22d3ee',
      fill: false, tension: 0.4,
      _upload: true,
    });
    dc.update('active');
  }
}

/* RISK RADAR tab — recompute risk from uploaded hourly demand */
function updateRiskRadarWithUpload(pred) {
  if (!window.radarChart || !pred.available) return;
  const demands = pred.hourlyPredicted.map(v => Math.round(v));
  const maes    = (window.ERR_HOUR && window.ERR_HOUR.mae)
    ? window.ERR_HOUR.mae
    : Array(24).fill(20);

  const maxD = Math.max(...demands) || 1;
  const maxM = Math.max(...maes)    || 1;
  const riskScores = demands.map((d,i) =>
    parseFloat((0.6*(d/maxD) + 0.4*(maes[i]/maxM)).toFixed(3))
  );

  const cc = typeof getChartColors === 'function' ? getChartColors() : { c2:'#22d3ee', grid:'#1a1f38', tick:'#3d4a72' };
  const barColors = riskScores.map(r =>
    r>0.66 ? 'rgba(220,38,38,0.82)' : r>0.33 ? 'rgba(217,119,6,0.75)' : 'rgba(5,150,105,0.65)'
  );

  const rc = window.radarChart;
  rc.data.datasets[0].data = demands;
  rc.data.datasets[0].backgroundColor = barColors;
  if (rc.data.datasets[1]) rc.data.datasets[1].data = maes;
  rc.update('active');
}

/* ═══════════════════════════════════════════════════════════════
   OVERVIEW — SUMMARY CARD + MINI CHARTS
════════════════════════════════════════════════════════════════ */
function renderUploadSummary(stats, pred) {
  const card = document.getElementById('upload-summary-card');
  const body = document.getElementById('upload-summary-body');
  if (!card || !body) return;

  const predHtml = pred.available ? `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.75rem;margin-bottom:1rem">
      ${mkSumCard('Model MAE', pred.mae+' rides/hr', 'var(--indigo)')}
      ${mkSumCard('Model RMSE', pred.rmse+' rides/hr', 'var(--teal,#0d9488)')}
      ${mkSumCard('R² Score', pred.r2, 'var(--green,#059669)')}
      ${mkSumCard('Lookup coverage', pred.coverage+'%', 'var(--amber,#d97706)')}
    </div>
    <div class="info-box" style="margin-bottom:0.5rem">
      <span class="icon">⚡</span>
      <span>
        <strong>${pred.n.toLocaleString()} rows</strong> matched the precomputed lookup.
        MAE/RMSE show how the D.C.-trained model generalises to this uploaded data.
        Predictions use HistGradientBoosting bins — no retraining.
      </span>
    </div>` :
    `<div class="info-box"><span class="icon">⚑</span>
     <span>Prediction lookup not ready. Check the What-if tab to initialise it, then re-upload.</span></div>`;

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.75rem;margin-bottom:1rem">
      ${mkSumCard('Total rows', stats.rows.toLocaleString(), 'var(--fg)')}
      ${mkSumCard('Mean demand', stats.mean+' rides/hr', 'var(--teal,#0d9488)')}
      ${mkSumCard('Peak hour', stats.peakHour+':00', 'var(--amber,#d97706)')}
      ${mkSumCard('Max / Min', stats.max+' / '+stats.min, 'var(--indigo)')}
    </div>
    ${predHtml}`;

  card.style.display = 'block';

  if (pred.available && pred.n > 0) {
    const chartDiv = document.getElementById('upload-pred-charts');
    if (chartDiv) chartDiv.style.display = 'block';
    setTimeout(() => { renderUploadPredChart(pred); renderUploadHourlyChart(pred); }, 50);
  }
}

function mkSumCard(label, val, color) {
  return `<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.85rem 1rem">
    <div style="font-family:var(--mono);font-size:1.05rem;color:${color};line-height:1;margin-bottom:0.2rem">${val}</div>
    <div style="font-size:0.68rem;color:var(--fg-muted);font-weight:300">${label}</div>
  </div>`;
}

/* ── Overview mini charts ──────────────────────────────────────── */
function renderUploadPredChart(pred) {
  const canvas = document.getElementById('uploadPredChart');
  if (!canvas) return;
  if (uploadPredChart) { uploadPredChart.destroy(); uploadPredChart = null; }
  const N  = Math.min(pred.actual.length, 168);
  const cc = typeof getChartColors==='function' ? getChartColors() : { c1:'#a78bfa', c2:'#22d3ee', grid:'#1a1f38', tick:'#3d4a72' };
  uploadPredChart = new Chart(canvas.getContext('2d'), {
    type:'line',
    data:{
      labels: pred.timestamps.slice(0,N),
      datasets:[
        { label:'Actual', data:pred.actual.slice(0,N), borderColor:cc.c1, borderWidth:1.5, pointRadius:0, fill:false, tension:0.3 },
        { label:'Model prediction', data:pred.predicted.slice(0,N), borderColor:cc.c2, borderWidth:1.5, borderDash:[5,3], pointRadius:0, fill:false, tension:0.3 },
      ],
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'top',labels:{padding:12,font:{size:11},color:cc.tick}},
        tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${Math.round(c.parsed.y)} rides`}},
      },
      scales:{
        x:{ticks:{maxTicksLimit:10,maxRotation:30,font:{size:9},color:cc.tick,
          callback:function(v,i){return i%24===0?this.getLabelForValue(v).split(' ')[0]:''}},
          grid:{color:cc.grid}},
        y:{title:{display:true,text:'rides/hr',font:{size:10},color:cc.tick},ticks:{color:cc.tick},grid:{color:cc.grid},min:0},
      },
    },
  });
}

function renderUploadHourlyChart(pred) {
  const canvas = document.getElementById('uploadHourlyChart');
  if (!canvas) return;
  if (uploadHourlyChart) { uploadHourlyChart.destroy(); uploadHourlyChart = null; }
  const cc = typeof getChartColors==='function' ? getChartColors() : { c1:'#a78bfa', c2:'#22d3ee', grid:'#1a1f38', tick:'#3d4a72' };
  uploadHourlyChart = new Chart(canvas.getContext('2d'), {
    type:'bar',
    data:{
      labels: Array.from({length:24},(_,h)=>`${h}:00`),
      datasets:[
        { label:'Actual avg', data:pred.hourlyActual, backgroundColor:'rgba(167,139,250,0.65)', borderRadius:3, order:2 },
        { label:'Predicted avg', data:pred.hourlyPredicted, type:'line', borderColor:cc.c2, borderWidth:2, pointRadius:3, pointBackgroundColor:cc.c2, fill:false, tension:0.4, order:1 },
      ],
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'top',labels:{padding:12,font:{size:11},color:cc.tick}},
        tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${Math.round(c.parsed.y)} rides/hr`}},
      },
      scales:{
        x:{ticks:{font:{size:9},color:cc.tick},grid:{color:cc.grid}},
        y:{title:{display:true,text:'avg rides/hr',font:{size:10},color:cc.tick},ticks:{color:cc.tick},grid:{color:cc.grid},min:0},
      },
    },
  });
}

/* ═══════════════════════════════════════════════════════════════
   GROQ AI INSIGHTS
════════════════════════════════════════════════════════════════ */
async function callGroqAPI(stats, pred) {
  const bodyEl = document.getElementById('ai-insights-body');
  if (!bodyEl) return;

  const apiKey = getGroqKey();
  if (!apiKey) {
    bodyEl.innerHTML = `<div style="font-size:0.82rem;color:var(--fg-muted);line-height:1.7">
      <strong style="color:var(--fg)">🔑 Groq API key not set.</strong><br/>
      Paste your key in the sidebar to enable AI analysis.<br/>
      Get a free key at <a href="https://console.groq.com" target="_blank" 
        style="color:#a78bfa">console.groq.com</a>
    </div>`;
    return;
  }

  const prompt = `You are a bike-share operations analyst. A user uploaded a dataset to a demand forecasting dashboard.

Dataset summary:
- File: ${stats.filename}
- Rows: ${stats.rows} hourly records
- Date range: ${stats.dateRange}
- Mean demand: ${stats.mean} rides/hr
- Min / Max: ${stats.min} / ${stats.max} rides/hr
- Peak hour: ${stats.peakHour}:00
${pred.available ? `
Model performance on this data:
- MAE: ${pred.mae} rides/hr (model was trained on Washington D.C. 2011-2012 UCI data)
- RMSE: ${pred.rmse} rides/hr
- R²: ${pred.r2}
- Lookup coverage: ${pred.coverage}% of rows matched precomputed predictions
` : '- Model predictions not available for this upload.'}

Give exactly 4 short operational insights as bullet points. Each bullet should be:
- Under 25 words
- Actionable and specific to this data
- In plain language (no jargon)
- Focused on: demand patterns, model accuracy, operational implications, or anomalies

Format: just the 4 bullet points, nothing else.`;

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 350,
        temperature: 0.4,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    const data    = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';

    if (!content) throw new Error('Empty response from Groq');

    // Parse bullet points
    const lines = content
      .split('\n')
      .map(l => l.replace(/^[-•*\d.]+\s*/, '').trim())
      .filter(l => l.length > 5);

    const html = `<div class="ai-insights-content">
      <ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>
    </div>`;

    bodyEl.innerHTML = html;

  } catch (err) {
    console.warn('Groq API error:', err);
    bodyEl.innerHTML = `<div class="ai-error-msg">
      ⚠ AI analysis unavailable: ${err.message}.
      <span style="display:block;margin-top:0.25rem;color:var(--fg-muted)">
        Check console for details. All other dashboard data is unaffected.
      </span>
    </div>`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   SIDEBAR / BANNER
════════════════════════════════════════════════════════════════ */
function renderUploadStatus(stats, pred) {
  const el = document.getElementById('upload-status');
  if (!el) return;
  el.className = 'upload-status active';
  const rows = [
    ['File', stats.filename.length>16 ? stats.filename.slice(0,14)+'…' : stats.filename, 'var(--fg)'],
    ['Rows', stats.rows.toLocaleString(), '#fbbf24'],
    ['Mean', stats.mean+'/hr', '#22d3ee'],
    pred.available ? ['MAE', pred.mae, '#a78bfa'] : null,
    pred.available ? ['R²', pred.r2, '#34d399'] : null,
  ].filter(Boolean);
  el.innerHTML =
    rows.map(([k,v,c]) =>
      `<div class="upload-status-row"><span style="color:var(--sb-fg)">${k}</span><span style="font-family:var(--mono);font-size:0.72rem;color:${c}">${v}</span></div>`
    ).join('') +
    `<button class="upload-clear-btn" onclick="clearUpload()">✕ Clear</button>`;
}

function renderUploadBanner(stats, pred) {
  const banner = document.getElementById('upload-banner');
  if (!banner) return;
  const nameEl  = document.getElementById('upload-banner-name');
  const rowsEl  = document.getElementById('upload-banner-rows');
  const rangeEl = document.getElementById('upload-banner-range');
  if (nameEl)  nameEl.textContent  = stats.filename;
  if (rowsEl)  rowsEl.textContent  = stats.rows.toLocaleString() + ' rows';
  if (rangeEl) rangeEl.textContent = stats.dateRange
    + (pred.available ? ` · MAE ${pred.mae} · R² ${pred.r2}` : '');
  banner.classList.add('active');
}

function showUploadError(msg) {
  const el = document.getElementById('upload-status');
  if (el) { el.className='upload-status active'; el.innerHTML=`<div style="color:#f87171;font-size:0.72rem;padding:0.35rem 0">⚠ ${msg}</div>`; }
}

/* ═══════════════════════════════════════════════════════════════
   CLEAR — restore everything
════════════════════════════════════════════════════════════════ */
function clearUpload() {
  UPLOADED_DATA = null; UPLOADED_PRED = null; UPLOAD_FILENAME = '';
  const inp = document.getElementById('csv-upload');
  if (inp) inp.value = '';

  // Restore hero
  const section = document.getElementById('hero-section');
  if (section) section.classList.remove('upload-mode');
  const maeEl = document.getElementById('stat-mae');
  if (maeEl && window.METRICS) {
    const best = window.METRICS.models?.reduce((a,b)=>a.mae<b.mae?a:b);
    if (maeEl && best)  maeEl.textContent = best.mae;
  }
  const subEl = document.querySelector('.hero-sub');
  if (subEl) {
    subEl.innerHTML = `mean absolute error — <span id="stat-improve">${window.METRICS?.improvement_vs_naive_mae_pct||'40.9'}%</span> below the naive same-hour-last-week baseline. HistGradientBoosting trained on 17,379 hourly records from Washington D.C., 2011–2012.`;
  }

  // Restore sidebar + banner
  const st = document.getElementById('upload-status');
  if (st) { st.className='upload-status'; st.innerHTML=''; }
  const banner = document.getElementById('upload-banner');
  if (banner) banner.classList.remove('active');

  // Hide cards
  const card    = document.getElementById('upload-summary-card');
  const aiCard  = document.getElementById('ai-insights-card');
  const charts  = document.getElementById('upload-pred-charts');
  if (card)   card.style.display   = 'none';
  if (aiCard) aiCard.style.display = 'none';
  if (charts) charts.style.display = 'none';

  // Destroy overview mini-charts
  if (uploadPredChart)   { uploadPredChart.destroy();   uploadPredChart   = null; }
  if (uploadHourlyChart) { uploadHourlyChart.destroy(); uploadHourlyChart = null; }

  // Remove upload datasets from main charts
  ['forecastChart','errorHourChart','dayProfileChart','radarChart'].forEach(name => {
    const c = window[name];
    if (!c) return;
    c.data.datasets = c.data.datasets.filter(d => !d._upload);
    c.update('none');
  });

  // Restore original sidebar KPIs
  if (typeof renderSidebarKPIs === 'function') renderSidebarKPIs();
  if (typeof renderHeroStats   === 'function') renderHeroStats();
}

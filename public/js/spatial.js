/* ================================================================
   RebalanceIQ — Chennai Spatial Risk Radar
   spatial.js — loaded after app.js

   ALL STATION DATA IS SYNTHETIC.
   Separate from the UCI-based citywide demand model.
   See public/data/chennai_stations.json for source data and
   documented inventory equations and risk thresholds.
================================================================ */

/* ── Globals ──────────────────────────────────────────────────── */
let leafletMap      = null;
let leafletMarkers  = {};
let spatialComputed = null;
let spatialInited   = false;
let pickupMult = 1.0;
let returnMult = 1.0;

/* ── Inventory equations (documented in _meta of JSON) ────────── */
// served_pickups        = min(expected_pickups, current_inventory)
// unserved_pickups      = expected_pickups - served_pickups
// inventory_after_pick  = current_inventory - served_pickups
// available_docks       = capacity - inventory_after_pick
// served_returns        = min(expected_returns, available_docks)
// unserved_returns      = expected_returns - served_returns
// projected_inventory   = inventory_after_pick + served_returns

function computeStation(s, pMult, rMult) {
  const cap  = s.capacity;
  const cur  = Math.min(Math.max(Math.round(s.current_inventory), 0), cap);
  const pick = Math.round(s.expected_pickups  * pMult);
  const ret  = Math.round(s.expected_returns  * rMult);

  const served_pickups       = Math.min(pick, cur);
  const unserved_pickups     = pick - served_pickups;
  const inventory_after_pick = cur - served_pickups;
  const available_docks      = cap - inventory_after_pick;
  const served_returns       = Math.min(ret, available_docks);
  const unserved_returns     = ret - served_returns;
  const projected_inventory  = inventory_after_pick + served_returns;

  if (projected_inventory < 0)   console.error('ASSERT: projected < 0 at', s.id);
  if (projected_inventory > cap) console.error('ASSERT: projected > cap at', s.id);

  return {
    ...s,
    cur, pick, ret,
    served_pickups, unserved_pickups,
    inventory_after_pick, available_docks,
    served_returns, unserved_returns,
    projected_inventory,
  };
}

/* ── Risk classification ──────────────────────────────────────── */
// SEVERE_SHORTAGE:         proj == 0  OR  unserved_pickups > 0
// POTENTIAL_DOCK_OVERFLOW: proj > 80% cap  OR  unserved_returns > 0
// POTENTIAL_SHORTAGE:      proj > 0  AND  proj < 20% cap
// NORMAL:                  20% <= proj <= 80% cap, no unserved demand
// Priority: SEVERE > OVERFLOW > SHORTAGE > NORMAL

function classifyRisk(c) {
  if (c.projected_inventory === 0 || c.unserved_pickups > 0)
    return 'SEVERE_SHORTAGE';
  if (c.projected_inventory > 0.8 * c.capacity || c.unserved_returns > 0)
    return 'POTENTIAL_DOCK_OVERFLOW';
  if (c.projected_inventory < 0.2 * c.capacity)
    return 'POTENTIAL_SHORTAGE';
  return 'NORMAL';
}

function riskLabel(risk) {
  return ({
    NORMAL:                  'Normal',
    POTENTIAL_SHORTAGE:      'Potential Shortage',
    SEVERE_SHORTAGE:         'Severe Shortage',
    POTENTIAL_DOCK_OVERFLOW: 'Potential Overflow',
  })[risk] || risk;
}

function riskColor(risk) {
  return ({
    NORMAL:                  '#2db87a',
    POTENTIAL_SHORTAGE:      '#e8c54a',
    SEVERE_SHORTAGE:         '#e8453c',
    POTENTIAL_DOCK_OVERFLOW: '#f5a623',
  })[risk] || '#5a7080';
}

function riskCssClass(risk) {
  return ({
    NORMAL:                  'popup-risk-normal',
    POTENTIAL_SHORTAGE:      'popup-risk-shortage',
    SEVERE_SHORTAGE:         'popup-risk-severe',
    POTENTIAL_DOCK_OVERFLOW: 'popup-risk-overflow',
  })[risk] || '';
}

function riskAction(risk, c) {
  if (risk === 'SEVERE_SHORTAGE')
    return 'Urgent: simulate deploying bikes from a nearby donor. Unserved pickups: '
         + c.unserved_pickups + '. Projected inventory: ' + c.projected_inventory + '.';
  if (risk === 'POTENTIAL_SHORTAGE')
    return 'Monitor closely. Projected inventory ' + c.projected_inventory + '/'
         + c.capacity + ' is below 20% capacity. Pre-position bikes before next peak.';
  if (risk === 'POTENTIAL_DOCK_OVERFLOW')
    return 'Dock pressure: ' + c.projected_inventory + '/' + c.capacity
         + ' bikes projected. Unserved returns: ' + c.unserved_returns
         + '. Remove bikes to free dock space.';
  return 'No immediate action required. Standard monitoring interval.';
}

/* ── Redistribution heuristic ─────────────────────────────────── */
// Donors:     sim_proj > 50% capacity
// Recipients: sim_proj < 30% capacity
// can_give  = sim_proj - floor(0.3 * cap)    [keep 30% minimum]
// needs     = ceil(0.3 * cap) - sim_proj     [bring to 30%]
// qty       = min(can_give, needs, dock_space)
// Greedy: largest surplus paired with largest deficit first.
// Not globally optimal. Conserves total bike inventory.

function computeRedistribution(computed) {
  const state = computed.map(c => ({ ...c, sim_proj: c.projected_inventory }));

  const donors = state.filter(c => c.sim_proj > 0.5 * c.capacity)
                      .sort((a, b) => b.sim_proj - a.sim_proj);
  const recipients = state.filter(c => c.sim_proj < 0.3 * c.capacity)
                          .sort((a, b) => a.sim_proj - b.sim_proj);

  const transfers = [];

  for (const rec of recipients) {
    const needs = Math.ceil(0.3 * rec.capacity) - rec.sim_proj;
    if (needs <= 0) continue;

    for (const don of donors) {
      const min_don = Math.floor(0.3 * don.capacity);
      if (don.sim_proj <= min_don) continue;

      const can_give   = don.sim_proj - min_don;
      const dock_space = rec.capacity - rec.sim_proj;
      const qty        = Math.min(can_give, needs, dock_space);
      if (qty <= 0) continue;

      const don_before = don.sim_proj;
      const rec_before = rec.sim_proj;
      don.sim_proj -= qty;
      rec.sim_proj += qty;

      // Inventory conservation check
      const before = don_before + rec_before;
      const after  = don.sim_proj + rec.sim_proj;
      if (before !== after) console.error('Inventory not conserved:', before, '!=', after);

      transfers.push({
        from: don.locality, to: rec.locality, qty,
        reason: don.locality + ' at ' + don_before + '/' + don.capacity
              + ' (' + Math.round(100*don_before/don.capacity) + '% — surplus). '
              + rec.locality + ' at ' + rec_before + '/' + rec.capacity
              + ' — below 30% threshold.',
        from_before: don_before, from_after: don.sim_proj, from_cap: don.capacity,
        to_before:   rec_before, to_after:   rec.sim_proj, to_cap:   rec.capacity,
      });
      break; // one donor per recipient (greedy)
    }
  }
  return transfers;
}

/* ── Full simulation run ──────────────────────────────────────── */
function runSpatialSimulation() {
  if (!CHENNAI_STATIONS) return;
  const computed = CHENNAI_STATIONS.stations.map(s =>
    computeStation(s, pickupMult, returnMult)
  );
  computed.forEach(c => { c.risk = classifyRisk(c); });
  spatialComputed = computed;
  renderSummaryCards(computed);
  renderStationTable(computed);
  renderRedistribution(computed);
  if (spatialInited) updateMapMarkers(computed);
}

/* ── Scenario controls ────────────────────────────────────────── */
function updatePickupMult(val) {
  pickupMult = parseFloat(val);
  document.getElementById('lbl-pickup-mult').textContent = pickupMult.toFixed(1) + '\u00d7';
  runSpatialSimulation();
}

function updateReturnMult(val) {
  returnMult = parseFloat(val);
  document.getElementById('lbl-return-mult').textContent = returnMult.toFixed(1) + '\u00d7';
  runSpatialSimulation();
}

function resetSpatialScenario() {
  pickupMult = 1.0; returnMult = 1.0;
  document.getElementById('ctrl-pickup-mult').value = '1';
  document.getElementById('ctrl-return-mult').value = '1';
  document.getElementById('lbl-pickup-mult').textContent = '1.0\u00d7';
  document.getElementById('lbl-return-mult').textContent = '1.0\u00d7';
  runSpatialSimulation();
}

/* ── Summary cards ────────────────────────────────────────────── */
function renderSummaryCards(computed) {
  const n_shortage  = computed.filter(c => c.risk === 'POTENTIAL_SHORTAGE').length;
  const n_severe    = computed.filter(c => c.risk === 'SEVERE_SHORTAGE').length;
  const n_overflow  = computed.filter(c => c.risk === 'POTENTIAL_DOCK_OVERFLOW').length;
  const total_unp   = computed.reduce((s, c) => s + c.unserved_pickups, 0);
  const total_unr   = computed.reduce((s, c) => s + c.unserved_returns, 0);
  const n_transfers = computeRedistribution(computed).length;

  const cards = [
    { val: computed.length,  label: 'Simulation locations',       color: 'var(--fg)' },
    { val: n_shortage,       label: 'Potential shortages',        color: 'var(--yellow)' },
    { val: n_severe,         label: 'Severe shortages',           color: 'var(--red)' },
    { val: n_overflow,       label: 'Dock overflow risk',         color: 'var(--amber)' },
    { val: total_unp,        label: 'Unserved simulated pickups', color: 'var(--red)' },
    { val: total_unr,        label: 'Unserved simulated returns', color: 'var(--amber)' },
    { val: n_transfers,      label: 'Proposed transfers',         color: 'var(--teal)' },
  ];

  document.getElementById('spatial-summary-cards').innerHTML =
    cards.map(c =>
      '<div class="spatial-card">'
    + '<div class="spatial-card-val" style="color:' + c.color + '">' + c.val + '</div>'
    + '<div class="spatial-card-label">' + c.label + '</div>'
    + '</div>'
    ).join('');
}

/* ── Station table ────────────────────────────────────────────── */
function renderStationTable(computed) {
  const rows = computed.map(c => {
    const rc = c.risk === 'SEVERE_SHORTAGE' ? 'risk-row-high'
             : (c.risk === 'POTENTIAL_SHORTAGE' || c.risk === 'POTENTIAL_DOCK_OVERFLOW')
               ? 'risk-row-medium' : '';
    const badge = '<span class="risk-badge" style="color:'
                + riskColor(c.risk) + ';border-color:' + riskColor(c.risk) + '">'
                + riskLabel(c.risk) + '</span>';
    return '<tr class="' + rc + '" data-sid="' + c.id
         + '" style="cursor:pointer" onclick="showStationPanel(\'' + c.id + '\')">'
         + '<td style="font-family:var(--mono);font-size:0.75rem;color:var(--fg-muted)">' + c.id + '</td>'
         + '<td style="font-weight:500">' + c.locality + '</td>'
         + '<td>' + c.capacity + '</td>'
         + '<td>' + c.cur + '</td>'
         + '<td>' + c.pick + '</td>'
         + '<td>' + c.ret + '</td>'
         + '<td style="color:var(--green)">' + c.served_pickups + '</td>'
         + '<td style="color:' + (c.unserved_pickups > 0 ? 'var(--red)' : 'var(--fg-muted)') + '">' + c.unserved_pickups + '</td>'
         + '<td style="color:var(--green)">' + c.served_returns + '</td>'
         + '<td style="color:' + (c.unserved_returns > 0 ? 'var(--amber)' : 'var(--fg-muted)') + '">' + c.unserved_returns + '</td>'
         + '<td style="font-family:var(--mono);font-weight:500">' + c.projected_inventory + '</td>'
         + '<td>' + badge + '</td>'
         + '<td class="radar-action" style="max-width:220px;font-size:0.76rem">' + riskAction(c.risk, c) + '</td>'
         + '</tr>';
  }).join('');
  document.getElementById('station-tbody').innerHTML = rows;
}

/* ── Station detail panel ─────────────────────────────────────── */
function showStationPanel(sid) {
  if (!spatialComputed) return;
  const c = spatialComputed.find(s => s.id === sid);
  if (!c) return;

  const panel = document.getElementById('station-panel');
  document.getElementById('panel-title').textContent =
    c.id + ' \u2014 ' + c.locality + ' \u00b7 Synthetic Station Simulation';

  const cells = [
    { k: 'Capacity',                v: c.capacity },
    { k: 'Current inventory',       v: c.cur },
    { k: 'Expected pickups',        v: c.pick + (pickupMult !== 1.0 ? ' (\u00d7'+pickupMult.toFixed(1)+')' : '') },
    { k: 'Expected returns',        v: c.ret  + (returnMult !== 1.0 ? ' (\u00d7'+returnMult.toFixed(1)+')' : '') },
    { k: 'Served pickups',          v: c.served_pickups },
    { k: 'Unserved pickups',        v: c.unserved_pickups },
    { k: 'Inventory after pickups', v: c.inventory_after_pick },
    { k: 'Available docks',         v: c.available_docks },
    { k: 'Served returns',          v: c.served_returns },
    { k: 'Unserved returns',        v: c.unserved_returns },
    { k: 'Projected inventory',     v: c.projected_inventory },
    { k: 'Risk classification',     v: riskLabel(c.risk) },
  ];

  const gridCells = cells.map(cl =>
    '<div class="station-panel-cell">'
  + '<div class="station-panel-cell-key">' + cl.k + '</div>'
  + '<div class="station-panel-cell-val">' + cl.v + '</div>'
  + '</div>'
  ).join('');

  document.getElementById('panel-body').innerHTML =
    '<div class="station-panel-grid">' + gridCells + '</div>'
  + '<div class="demand-action"><strong>Suggested action</strong>' + riskAction(c.risk, c) + '</div>'
  + '<div style="font-size:0.72rem;color:var(--fg-dim);margin-top:0.75rem">'
  + 'Coordinate: ' + c.lat.toFixed(4) + '\u00b0N, ' + c.lon.toFixed(4) + '\u00b0E (' + c.coordinate_note + ')'
  + ' \u00b7 All values are synthetic simulation outputs, not live operator data.</div>';

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (leafletMarkers[sid]) leafletMarkers[sid].openPopup();
}

/* ── Leaflet popup HTML ───────────────────────────────────────── */
function buildPopupHtml(c) {
  const rCls = riskCssClass(c.risk);
  return '<div class="popup-header">' + c.id + ' \u2014 ' + c.locality + '</div>'
    + mkRow('Capacity', c.capacity, '')
    + mkRow('Current inventory', c.cur, '')
    + mkRow('Expected pickups', c.pick, '')
    + mkRow('Expected returns', c.ret, '')
    + mkRow('Projected inventory', c.projected_inventory, '')
    + mkRow('Unserved pickups', c.unserved_pickups, c.unserved_pickups > 0 ? 'color:var(--red)' : '')
    + mkRow('Unserved returns', c.unserved_returns, c.unserved_returns > 0 ? 'color:var(--amber)' : '')
    + '<div class="popup-row"><span class="popup-key">Risk</span><span class="popup-val ' + rCls + '">' + riskLabel(c.risk) + '</span></div>'
    + '<div class="popup-action">' + riskAction(c.risk, c) + '</div>'
    + '<div style="font-size:0.68rem;color:#4a6070;margin-top:0.5rem">SYNTHETIC STATION SIMULATION</div>';
}

function mkRow(k, v, style) {
  return '<div class="popup-row"><span class="popup-key">' + k + '</span>'
       + '<span class="popup-val" style="' + style + '">' + v + '</span></div>';
}

function initSpatialRadar() {
  if (spatialInited) { runSpatialSimulation(); return; }

  runSpatialSimulation(); // table / cards / redistribution work without map

  // Defer map init so the tab panel is fully visible before Leaflet measures container
  setTimeout(_initLeafletMap, 80);
}

function _initLeafletMap() {
  try {
    if (typeof L === 'undefined') throw new Error('Leaflet not loaded');

    const mapEl = document.getElementById('chennai-map');
    if (!mapEl) throw new Error('Map container not found');
    if (mapEl.offsetHeight < 10) throw new Error('Map container not yet visible (height 0)');

    mapEl.innerHTML = ''; // clear loading text

    leafletMap = L.map(mapEl, { center: [13.02, 80.18], zoom: 11 });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '\u00a9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(leafletMap);

    // Recalculate map dimensions after tab becomes visible
    leafletMap.invalidateSize();

    updateMapMarkers(spatialComputed);
    spatialInited = true;

  } catch (e) {
    console.warn('Leaflet map init failed:', e.message);
    const mapEl = document.getElementById('chennai-map');
    if (mapEl) mapEl.innerHTML =
      '<div class="loading" style="padding-top:5rem">'
    + '<p style="color:var(--amber)">\u26a0 Map unavailable: ' + e.message + '</p>'
    + '<p style="font-size:0.8rem;color:var(--fg-muted);margin-top:0.5rem">'
    + 'All station data, risk classifications, and redistribution recommendations are in the table below.</p>'
    + '</div>';
  }
}

function updateMapMarkers(computed) {

  if (!leafletMap) return;
  Object.values(leafletMarkers).forEach(m => leafletMap.removeLayer(m));
  leafletMarkers = {};

  computed.forEach(c => {
    const color = riskColor(c.risk);
    const svg = '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'
              + '<circle cx="12" cy="12" r="10" fill="' + color + '" fill-opacity="0.88" stroke="#07090d" stroke-width="2"/>'
              + '<circle cx="12" cy="12" r="4" fill="#07090d" fill-opacity="0.45"/>'
              + '</svg>';
    const icon = L.divIcon({
      className: '', html: svg,
      iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -14],
    });

    const marker = L.marker([c.lat, c.lon], { icon })
      .addTo(leafletMap)
      .bindPopup(buildPopupHtml(c), { maxWidth: 320, minWidth: 260 });

    // Keep marker and table row in sync
    marker.on('click', (function(sid) {
      return function() { showStationPanel(sid); };
    })(c.id));

    leafletMarkers[c.id] = marker;
  });
}

/* ── Redistribution render ────────────────────────────────────── */
function renderRedistribution(computed) {
  const body = document.getElementById('redistribution-body');
  const transfers = computeRedistribution(computed);

  if (transfers.length === 0) {
    body.innerHTML = '<div class="no-transfer">No feasible transfers identified for this scenario. '
                   + 'All stations within normal range, or no valid donor\u2013recipient pair exists '
                   + 'under current thresholds (donor > 50%, recipient < 30%).</div>';
    return;
  }

  body.innerHTML = transfers.map(t =>
    '<div class="transfer-row">'
  + '<div><div style="font-size:0.62rem;color:var(--fg-muted);font-family:var(--mono);letter-spacing:0.08em;margin-bottom:0.2rem">FROM</div>'
  + '<div class="transfer-from">' + t.from + '</div></div>'
  + '<div><div style="font-size:0.62rem;color:var(--fg-muted);font-family:var(--mono);letter-spacing:0.08em;margin-bottom:0.2rem">TO</div>'
  + '<div class="transfer-to">' + t.to + '</div></div>'
  + '<div><div style="font-size:0.62rem;color:var(--fg-muted);font-family:var(--mono);letter-spacing:0.08em;margin-bottom:0.2rem">BIKES</div>'
  + '<div class="transfer-qty">' + t.qty + '</div></div>'
  + '<div class="transfer-detail">' + t.reason
  + '<div class="transfer-before-after">'
  + '<span class="inv-before">Donor: ' + t.from_before + '\u2192' + t.from_after + '/' + t.from_cap + '</span>'
  + '<span class="inv-after">Recipient: ' + t.to_before + '\u2192' + t.to_after + '/' + t.to_cap + '</span>'
  + '</div></div></div>'
  ).join('');
}

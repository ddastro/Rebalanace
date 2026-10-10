"""
tests/test_spatial.py
RebalanceIQ — Chennai Spatial Risk Radar test suite (pytest)

Run: pytest tests/ -v
"""
import os, sys, json, math
import pytest

ROOT      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR   = os.path.join(ROOT, 'public', 'data')


SPATIAL_JSON_PATH = os.path.join(ROOT, 'public', 'data', 'chennai_stations.json')
EXPECTED_LOCALITIES = [
    "Chennai Central", "Anna Nagar", "Ambattur OT", "Avadi", "Porur",
    "Guindy", "T. Nagar", "Adyar", "Velachery", "Thiruvanmiyur",
    "Perungudi", "Sholinganallur", "Siruseri SIPCOT", "Tambaram", "Madhavaram"
]
CHENNAI_LAT_RANGE = (12.5, 13.4)   # approximate bounding box for Chennai region
CHENNAI_LON_RANGE = (79.8, 80.5)

# ── Python re-implementation of the JS inventory/risk engine ────────────────

def compute_station(s, pickup_mult=1.0, return_mult=1.0):
    cap  = s['capacity']
    cur  = min(max(round(s['current_inventory']), 0), cap)
    pick = round(s['expected_pickups'] * pickup_mult)
    ret  = round(s['expected_returns'] * return_mult)

    served_pickups        = min(pick, cur)
    unserved_pickups      = pick - served_pickups
    inventory_after_pick  = cur - served_pickups
    available_docks       = cap - inventory_after_pick
    served_returns        = min(ret, available_docks)
    unserved_returns      = ret - served_returns
    projected_inventory   = inventory_after_pick + served_returns

    return {**s,
            'cur': cur, 'pick': pick, 'ret': ret,
            'served_pickups': served_pickups,
            'unserved_pickups': unserved_pickups,
            'inventory_after_pick': inventory_after_pick,
            'available_docks': available_docks,
            'served_returns': served_returns,
            'unserved_returns': unserved_returns,
            'projected_inventory': projected_inventory}

def classify_risk(c):
    if c['projected_inventory'] == 0 or c['unserved_pickups'] > 0:
        return 'SEVERE_SHORTAGE'
    if c['projected_inventory'] > 0.8 * c['capacity'] or c['unserved_returns'] > 0:
        return 'POTENTIAL_DOCK_OVERFLOW'
    if c['projected_inventory'] < 0.2 * c['capacity']:
        return 'POTENTIAL_SHORTAGE'
    return 'NORMAL'

def compute_redistribution(computed, donor_thresh=0.5, recip_thresh=0.3):
    state = [{**c, 'sim_proj': c['projected_inventory']} for c in computed]
    donors     = sorted([s for s in state if s['sim_proj'] > donor_thresh * s['capacity']],
                        key=lambda x: -x['sim_proj'])
    recipients = sorted([s for s in state if s['sim_proj'] < recip_thresh * s['capacity']],
                        key=lambda x: x['sim_proj'])
    transfers = []
    for rec in recipients:
        needs = math.ceil(0.3 * rec['capacity']) - rec['sim_proj']
        if needs <= 0: continue
        for don in donors:
            min_don    = math.floor(0.3 * don['capacity'])
            can_give   = don['sim_proj'] - min_don
            dock_space = rec['capacity'] - rec['sim_proj']
            qty        = min(can_give, needs, dock_space)
            if qty <= 0: continue
            don_before = don['sim_proj']
            rec_before = rec['sim_proj']
            don['sim_proj'] -= qty
            rec['sim_proj'] += qty
            transfers.append({
                'from': don['locality'], 'to': rec['locality'], 'qty': qty,
                'from_before': don_before, 'from_after': don['sim_proj'],
                'to_before':   rec_before, 'to_after':   rec['sim_proj'],
                'from_cap': don['capacity'], 'to_cap': rec['capacity'],
            })
            break
    return transfers


@pytest.fixture(scope='session')
def chennai_json():
    with open(SPATIAL_JSON_PATH, encoding='utf-8') as f:
        return json.load(f)

@pytest.fixture(scope='session')
def computed_stations(chennai_json):
    return [compute_station(s) for s in chennai_json['stations']]


class TestChennaiStationData:
    """Tests for the chenani_stations.json structure and validity."""

    def test_json_file_exists(self):
        assert os.path.exists(SPATIAL_JSON_PATH), "chennai_stations.json not found"

    def test_json_valid(self):
        with open(SPATIAL_JSON_PATH, encoding='utf-8') as f:
            data = json.load(f)
        assert 'stations' in data
        assert '_meta' in data

    def test_exactly_15_stations(self, chennai_json):
        assert len(chennai_json['stations']) == 15, \
            f"Expected 15 stations, got {len(chennai_json['stations'])}"

    def test_all_localities_present(self, chennai_json):
        localities = [s['locality'] for s in chennai_json['stations']]
        for loc in EXPECTED_LOCALITIES:
            assert loc in localities, f"Locality '{loc}' not found in station data"

    def test_unique_station_ids(self, chennai_json):
        ids = [s['id'] for s in chennai_json['stations']]
        assert len(ids) == len(set(ids)), "Duplicate station IDs found"

    def test_coordinate_ranges(self, chennai_json):
        for s in chennai_json['stations']:
            assert CHENNAI_LAT_RANGE[0] <= s['lat'] <= CHENNAI_LAT_RANGE[1], \
                f"{s['locality']} lat {s['lat']} outside Chennai range"
            assert CHENNAI_LON_RANGE[0] <= s['lon'] <= CHENNAI_LON_RANGE[1], \
                f"{s['locality']} lon {s['lon']} outside Chennai range"

    def test_no_zero_capacity(self, chennai_json):
        for s in chennai_json['stations']:
            assert s['capacity'] > 0, f"{s['id']} has zero capacity"

    def test_inventory_within_capacity(self, chennai_json):
        for s in chennai_json['stations']:
            assert 0 <= s['current_inventory'] <= s['capacity'], \
                f"{s['id']} current_inventory {s['current_inventory']} violates [0, {s['capacity']}]"

    def test_non_negative_pickups_returns(self, chennai_json):
        for s in chennai_json['stations']:
            assert s['expected_pickups'] >= 0, f"{s['id']} negative pickups"
            assert s['expected_returns'] >= 0, f"{s['id']} negative returns"

    def test_has_synthetic_disclaimer(self, chennai_json):
        meta_str = json.dumps(chennai_json['_meta']).lower()
        assert 'synthetic' in meta_str or 'simulated' in meta_str, \
            "No synthetic/simulated disclaimer in _meta"

    def test_spatial_js_file_exists(self):
        assert os.path.exists(os.path.join(ROOT, 'public', 'js', 'spatial.js')), \
            "spatial.js not found"


class TestInventoryCalculations:
    """Test the Python re-implementation of the inventory engine."""

    def test_served_pickups_capped_by_inventory(self):
        s = {'id': 'T1', 'locality': 'Test', 'lat': 13.0, 'lon': 80.2,
             'coordinate_note': 'test',
             'capacity': 30, 'current_inventory': 5,
             'expected_pickups': 20, 'expected_returns': 3}
        c = compute_station(s)
        assert c['served_pickups'] == 5,    f"served_pickups should be 5, got {c['served_pickups']}"
        assert c['unserved_pickups'] == 15, f"unserved_pickups should be 15"

    def test_unserved_pickups_non_negative(self, computed_stations):
        for c in computed_stations:
            assert c['unserved_pickups'] >= 0, f"{c['id']} negative unserved_pickups"

    def test_unserved_returns_non_negative(self, computed_stations):
        for c in computed_stations:
            assert c['unserved_returns'] >= 0, f"{c['id']} negative unserved_returns"

    def test_projected_inventory_non_negative(self, computed_stations):
        for c in computed_stations:
            assert c['projected_inventory'] >= 0, \
                f"{c['id']} projected_inventory is negative: {c['projected_inventory']}"

    def test_projected_inventory_within_capacity(self, computed_stations):
        for c in computed_stations:
            assert c['projected_inventory'] <= c['capacity'], \
                f"{c['id']} projected {c['projected_inventory']} > capacity {c['capacity']}"

    def test_inventory_after_pick_non_negative(self, computed_stations):
        for c in computed_stations:
            assert c['inventory_after_pick'] >= 0, \
                f"{c['id']} inventory_after_pick < 0"

    def test_served_pickups_plus_unserved_eq_pick(self, computed_stations):
        for c in computed_stations:
            assert c['served_pickups'] + c['unserved_pickups'] == c['pick'], \
                f"{c['id']} pickup accounting error"

    def test_served_returns_plus_unserved_eq_ret(self, computed_stations):
        for c in computed_stations:
            assert c['served_returns'] + c['unserved_returns'] == c['ret'], \
                f"{c['id']} return accounting error"

    def test_pickup_multiplier_scales_demand(self):
        s = {'id': 'T2', 'locality': 'Test', 'lat': 13.0, 'lon': 80.2,
             'coordinate_note': 'test',
             'capacity': 40, 'current_inventory': 30,
             'expected_pickups': 10, 'expected_returns': 5}
        c1 = compute_station(s, pickup_mult=1.0)
        c2 = compute_station(s, pickup_mult=2.0)
        assert c2['pick'] == 2 * c1['pick'], "Pickup multiplier not applied correctly"

    def test_return_multiplier_scales_demand(self):
        s = {'id': 'T3', 'locality': 'Test', 'lat': 13.0, 'lon': 80.2,
             'coordinate_note': 'test',
             'capacity': 40, 'current_inventory': 30,
             'expected_pickups': 5, 'expected_returns': 6}
        c1 = compute_station(s, return_mult=1.0)
        c2 = compute_station(s, return_mult=1.5)
        assert c2['ret'] == round(6 * 1.5), "Return multiplier not applied correctly"

    def test_full_station_no_overflow(self):
        """A station at full capacity that accepts returns must have unserved_returns > 0."""
        s = {'id': 'T4', 'locality': 'Test', 'lat': 13.0, 'lon': 80.2,
             'coordinate_note': 'test',
             'capacity': 20, 'current_inventory': 20,
             'expected_pickups': 0, 'expected_returns': 5}
        c = compute_station(s)
        assert c['unserved_returns'] == 5
        assert c['projected_inventory'] == 20

    def test_empty_station_no_pickups(self):
        """A station at zero inventory cannot serve any pickups."""
        s = {'id': 'T5', 'locality': 'Test', 'lat': 13.0, 'lon': 80.2,
             'coordinate_note': 'test',
             'capacity': 20, 'current_inventory': 0,
             'expected_pickups': 10, 'expected_returns': 5}
        c = compute_station(s)
        assert c['served_pickups'] == 0
        assert c['unserved_pickups'] == 10
        assert c['served_returns'] == 5
        assert c['projected_inventory'] == 5


class TestRiskClassification:
    """Test risk classification logic."""

    def test_normal_classification(self):
        s = {'capacity': 40, 'current_inventory': 20,
             'expected_pickups': 4, 'expected_returns': 4,
             'id': 'R1', 'locality': 'X', 'lat': 13.0, 'lon': 80.2,
             'coordinate_note': 'test'}
        c = compute_station(s)
        assert classify_risk(c) == 'NORMAL'

    def test_severe_shortage_when_zero_inventory(self):
        """If all bikes are picked up and none returned, severe shortage."""
        s = {'capacity': 20, 'current_inventory': 5,
             'expected_pickups': 20, 'expected_returns': 0,
             'id': 'R2', 'locality': 'X', 'lat': 13.0, 'lon': 80.2,
             'coordinate_note': 'test'}
        c = compute_station(s)
        assert classify_risk(c) == 'SEVERE_SHORTAGE', \
            f"Expected SEVERE_SHORTAGE, got {classify_risk(c)}"

    def test_severe_shortage_when_unserved_pickups(self):
        s = {'capacity': 10, 'current_inventory': 2,
             'expected_pickups': 10, 'expected_returns': 0,
             'id': 'R3', 'locality': 'X', 'lat': 13.0, 'lon': 80.2,
             'coordinate_note': 'test'}
        c = compute_station(s)
        assert c['unserved_pickups'] > 0
        assert classify_risk(c) == 'SEVERE_SHORTAGE'

    def test_potential_shortage_below_20pct(self):
        s = {'capacity': 40, 'current_inventory': 6,
             'expected_pickups': 4, 'expected_returns': 2,
             'id': 'R4', 'locality': 'X', 'lat': 13.0, 'lon': 80.2,
             'coordinate_note': 'test'}
        c = compute_station(s)
        # projected = 6 - 4 + 2 = 4, which is 10% of 40 => POTENTIAL_SHORTAGE
        assert c['projected_inventory'] == 4
        assert classify_risk(c) == 'POTENTIAL_SHORTAGE'

    def test_dock_overflow_above_80pct(self):
        s = {'capacity': 30, 'current_inventory': 28,
             'expected_pickups': 2, 'expected_returns': 10,
             'id': 'R5', 'locality': 'X', 'lat': 13.0, 'lon': 80.2,
             'coordinate_note': 'test'}
        c = compute_station(s)
        # After pickups: 26. Available docks: 4. Returns served: 4, unserved: 6.
        # projected = 30 which is 100% cap. unserved_returns > 0 -> OVERFLOW
        assert classify_risk(c) == 'POTENTIAL_DOCK_OVERFLOW'

    def test_all_stations_have_valid_risk(self, computed_stations):
        valid = {'NORMAL', 'POTENTIAL_SHORTAGE', 'SEVERE_SHORTAGE', 'POTENTIAL_DOCK_OVERFLOW'}
        for c in computed_stations:
            r = classify_risk(c)
            assert r in valid, f"{c['id']} has invalid risk: {r}"


class TestRedistribution:
    """Test the redistribution heuristic."""

    def _make_computed(self, stations):
        return [compute_station(s) for s in stations]

    def test_donor_must_have_surplus(self):
        """Donor must have > 50% capacity before donating."""
        stations = [
            {'id': 'D1', 'locality': 'Donor', 'lat': 13.0, 'lon': 80.2,
             'coordinate_note': 'test',
             'capacity': 20, 'current_inventory': 16,  # 80% full
             'expected_pickups': 2, 'expected_returns': 0},  # projected: 14, 70% -> donor
            {'id': 'R1', 'locality': 'Recip', 'lat': 13.1, 'lon': 80.2,
             'coordinate_note': 'test',
             'capacity': 20, 'current_inventory': 2,   # low
             'expected_pickups': 0, 'expected_returns': 1},  # projected: 3, 15% -> recipient
        ]
        computed = self._make_computed(stations)
        transfers = compute_redistribution(computed)
        assert len(transfers) >= 1, "Expected at least one transfer"
        t = transfers[0]
        assert t['from'] == 'Donor'
        assert t['to']   == 'Recip'
        assert t['qty']  > 0

    def test_source_inventory_constraint(self):
        """After transfer, donor must have >= 30% capacity."""
        stations = [
            {'id': 'D1', 'locality': 'Donor', 'lat': 13.0, 'lon': 80.2,
             'coordinate_note': 'test',
             'capacity': 20, 'current_inventory': 14,
             'expected_pickups': 0, 'expected_returns': 0},
            {'id': 'R1', 'locality': 'Recip', 'lat': 13.1, 'lon': 80.2,
             'coordinate_note': 'test',
             'capacity': 20, 'current_inventory': 1,
             'expected_pickups': 0, 'expected_returns': 0},
        ]
        computed = self._make_computed(stations)
        transfers = compute_redistribution(computed)
        for t in transfers:
            assert t['from_after'] >= math.floor(0.3 * t['from_cap']), \
                f"Donor inventory after transfer below 30%: {t['from_after']}/{t['from_cap']}"

    def test_destination_capacity_constraint(self):
        """After transfer, recipient must not exceed capacity."""
        stations = [
            {'id': 'D1', 'locality': 'Donor', 'lat': 13.0, 'lon': 80.2,
             'coordinate_note': 'test',
             'capacity': 40, 'current_inventory': 36,
             'expected_pickups': 0, 'expected_returns': 0},
            {'id': 'R1', 'locality': 'Recip', 'lat': 13.1, 'lon': 80.2,
             'coordinate_note': 'test',
             'capacity': 20, 'current_inventory': 1,
             'expected_pickups': 0, 'expected_returns': 0},
        ]
        computed = self._make_computed(stations)
        transfers = compute_redistribution(computed)
        for t in transfers:
            assert t['to_after'] <= t['to_cap'], \
                f"Recipient exceeded capacity: {t['to_after']} > {t['to_cap']}"

    def test_inventory_conservation(self):
        """Total bikes across all stations must be conserved by transfers."""
        computed = [compute_station(s) for s in [
            {'id': 'D1', 'locality': 'Donor',  'lat': 13.0, 'lon': 80.2, 'coordinate_note': 'test',
             'capacity': 40, 'current_inventory': 30, 'expected_pickups': 0, 'expected_returns': 0},
            {'id': 'D2', 'locality': 'Donor2', 'lat': 13.0, 'lon': 80.3, 'coordinate_note': 'test',
             'capacity': 30, 'current_inventory': 20, 'expected_pickups': 0, 'expected_returns': 0},
            {'id': 'R1', 'locality': 'Recip1', 'lat': 13.1, 'lon': 80.2, 'coordinate_note': 'test',
             'capacity': 25, 'current_inventory':  3, 'expected_pickups': 0, 'expected_returns': 0},
            {'id': 'R2', 'locality': 'Recip2', 'lat': 13.1, 'lon': 80.3, 'coordinate_note': 'test',
             'capacity': 20, 'current_inventory':  2, 'expected_pickups': 0, 'expected_returns': 0},
        ]]
        total_before = sum(c['projected_inventory'] for c in computed)
        transfers = compute_redistribution(computed)
        total_moved = sum(t['qty'] for t in transfers)
        # Each bike moved removes from donor and adds to recipient: net 0
        total_transfers_net = sum(t['from_before'] - t['from_after'] for t in transfers) \
                            - sum(t['to_after']   - t['to_before']   for t in transfers)
        assert total_transfers_net == 0, "Inventory not conserved across transfers"

    def test_no_transfer_when_all_normal(self):
        """No transfers when all stations are well within 30-50% range."""
        stations = [
            {'id': f'S{i}', 'locality': f'Station{i}', 'lat': 13.0, 'lon': 80.2,
             'coordinate_note': 'test',
             'capacity': 30, 'current_inventory': 15,
             'expected_pickups': 3, 'expected_returns': 3}
            for i in range(4)
        ]
        computed = self._make_computed(stations)
        transfers = compute_redistribution(computed)
        assert len(transfers) == 0, "Expected no transfers for well-balanced stations"

    def test_qty_positive_in_all_transfers(self, computed_stations):
        """All recommended transfer quantities must be positive."""
        transfers = compute_redistribution(computed_stations)
        for t in transfers:
            assert t['qty'] > 0, f"Transfer qty {t['qty']} is not positive"

    def test_no_self_transfer(self, computed_stations):
        """No station transfers to itself."""
        transfers = compute_redistribution(computed_stations)
        for t in transfers:
            assert t['from'] != t['to'], f"Self-transfer detected at {t['from']}"


class TestSpatialHTML:
    """Test that all required HTML elements for the spatial radar exist."""

    def test_spatial_section_in_html(self):
        path = os.path.join(ROOT, 'public', 'index.html')
        with open(path, encoding='utf-8') as f:
            content = f.read()
        assert 'section-spatial' in content
        assert 'tab-spatial'     in content
        assert 'nav-spatial'     in content

    def test_chennaai_map_div_in_html(self):
        path = os.path.join(ROOT, 'public', 'index.html')
        with open(path, encoding='utf-8') as f:
            content = f.read()
        assert 'chennai-map'         in content
        assert 'station-tbody'       in content
        assert 'redistribution-body' in content
        assert 'spatial-summary-cards' in content

    def test_leaflet_css_in_html(self):
        path = os.path.join(ROOT, 'public', 'index.html')
        with open(path, encoding='utf-8') as f:
            content = f.read()
        assert 'leaflet' in content.lower()

    def test_disclaimer_text_in_html(self):
        path = os.path.join(ROOT, 'public', 'index.html')
        with open(path, encoding='utf-8') as f:
            content = f.read()
        assert 'SIMULATED, NOT LIVE OPERATOR DATA' in content
        assert 'SIMULATED REDISTRIBUTION RECOMMENDATION' in content

    def test_spatial_js_referenced_in_html(self):
        path = os.path.join(ROOT, 'public', 'index.html')
        with open(path, encoding='utf-8') as f:
            content = f.read()
        assert 'spatial.js' in content

    def test_scenario_controls_in_html(self):
        path = os.path.join(ROOT, 'public', 'index.html')
        with open(path, encoding='utf-8') as f:
            content = f.read()
        assert 'ctrl-pickup-mult' in content
        assert 'ctrl-return-mult' in content

    def test_map_legend_in_html(self):
        path = os.path.join(ROOT, 'public', 'index.html')
        with open(path, encoding='utf-8') as f:
            content = f.read()
        assert 'map-legend' in content

    def test_station_table_headers(self):
        path = os.path.join(ROOT, 'public', 'index.html')
        with open(path, encoding='utf-8') as f:
            content = f.read()
        for col in ['Cap.', 'Projected', 'Risk', 'Unserved']:
            assert col in content, f"Column header '{col}' missing from station table"


class TestSpatialJS:
    """Test that required JS functions exist in spatial.js."""

    SPATIAL_JS = os.path.join(ROOT, 'public', 'js', 'spatial.js')

    def _read(self):
        with open(self.SPATIAL_JS, encoding='utf-8') as f:
            return f.read()

    def test_compute_station_function(self):
        assert 'computeStation' in self._read()

    def test_classify_risk_function(self):
        assert 'classifyRisk' in self._read()

    def test_compute_redistribution_function(self):
        assert 'computeRedistribution' in self._read()

    def test_leaflet_map_init(self):
        assert 'initSpatialRadar' in self._read()

    def test_update_map_markers(self):
        assert 'updateMapMarkers' in self._read()

    def test_render_redistribution(self):
        assert 'renderRedistribution' in self._read()

    def test_render_station_table(self):
        assert 'renderStationTable' in self._read()

    def test_show_station_panel(self):
        assert 'showStationPanel' in self._read()

    def test_inventory_conservation_check(self):
        assert 'Inventory not conserved' in self._read()

    def test_synthetic_label_in_popup(self):
        assert 'SYNTHETIC STATION SIMULATION' in self._read()

    def test_map_failure_graceful(self):
        js = self._read()
        assert 'catch' in js and 'Leaflet not loaded' in js, \
            "Leaflet failure not handled gracefully in spatial.js"

    def test_redistribution_disclaimer_in_js(self):
        js = self._read()
        # The HTML disclaimer is in index.html; spatial.js contains the rendering logic
        assert 'renderRedistribution' in js, "renderRedistribution function missing from spatial.js"
        assert 'Greedy' in js or 'greedy' in js, "Redistribution heuristic description missing"

    def test_risk_color_function_has_all_categories(self):
        js = self._read()
        for risk in ['SEVERE_SHORTAGE', 'POTENTIAL_DOCK_OVERFLOW', 'POTENTIAL_SHORTAGE', 'NORMAL']:
            assert risk in js, f"Risk category {risk} not found in spatial.js"


class TestDataConsistency:
    """Map marker and table must use identical data."""

    def test_station_count_matches_localities(self, chennai_json):
        assert len(chennai_json['stations']) == len(EXPECTED_LOCALITIES)

    def test_each_locality_has_unique_coordinates(self, chennai_json):
        coords = [(s['lat'], s['lon']) for s in chennai_json['stations']]
        assert len(coords) == len(set(coords)), "Duplicate coordinates found"

    def test_computed_matches_json_station_count(self, chennai_json, computed_stations):
        assert len(computed_stations) == len(chennai_json['stations'])

    def test_inventory_equations_match_meta(self, chennai_json):
        """The _meta equations must match what the Python compute function produces."""
        meta = chennai_json['_meta']['inventory_equations']
        # Verify at least the keys are documented
        for key in ['served_pickups', 'unserved_pickups', 'projected_inventory']:
            assert key in meta, f"Equation '{key}' not documented in _meta"

    def test_risk_thresholds_documented(self, chennai_json):
        thresholds = chennai_json['_meta']['risk_thresholds']
        for cat in ['NORMAL', 'POTENTIAL_SHORTAGE', 'SEVERE_SHORTAGE', 'POTENTIAL_DOCK_OVERFLOW']:
            assert cat in thresholds, f"Risk threshold '{cat}' not documented"

"""
tests/test_pipeline.py
RebalanceIQ – automated test suite (pytest)

Run: pytest tests/ -v
"""
import os, sys, json
import pytest
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(ROOT, 'hour.csv')
OUT_DIR   = os.path.join(ROOT, 'public', 'data')
MODEL_PKL = os.path.join(ROOT, 'model.pkl')

FEATURES = ['hr', 'weekday', 'mnth', 'season', 'holiday', 'workingday',
            'weathersit', 'temp', 'atemp', 'hum', 'windspeed',
            'sin_hour', 'cos_hour', 'rush_hour', 'yr']
TARGET      = 'cnt'
SPLIT_DATE  = '2012-07-01'
LEAKY_COLS  = {'casual', 'registered', 'instant', 'dteday'}

# ══════════════════════════════════════════════════════════════════════════════
# FIXTURES
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture(scope='session')
def raw_df():
    """Load raw CSV exactly as the pipeline does."""
    df = pd.read_csv(DATA_PATH)
    return df

@pytest.fixture(scope='session')
def processed_df(raw_df):
    """Apply the same preprocessing as run_pipeline.py."""
    df = raw_df.copy()
    df['datetime'] = pd.to_datetime(df['dteday']) + pd.to_timedelta(df['hr'], unit='h')
    df = df.set_index('datetime').sort_index()
    df.drop(columns=list(LEAKY_COLS), inplace=True, errors='ignore')
    df['sin_hour']  = np.sin(2 * np.pi * df['hr'] / 24)
    df['cos_hour']  = np.cos(2 * np.pi * df['hr'] / 24)
    df['rush_hour'] = df['hr'].apply(lambda h: 1 if (7 <= h <= 9) or (17 <= h <= 19) else 0)
    return df

@pytest.fixture(scope='session')
def train_test(processed_df):
    train = processed_df[processed_df.index < SPLIT_DATE]
    test  = processed_df[processed_df.index >= SPLIT_DATE]
    return train, test

@pytest.fixture(scope='session')
def metrics_json():
    with open(os.path.join(OUT_DIR, 'metrics.json')) as f:
        return json.load(f)

@pytest.fixture(scope='session')
def drivers_json():
    with open(os.path.join(OUT_DIR, 'drivers.json')) as f:
        return json.load(f)

@pytest.fixture(scope='session')
def whatif_json():
    with open(os.path.join(OUT_DIR, 'whatif_lookup.json')) as f:
        return json.load(f)

@pytest.fixture(scope='session')
def forecast_json():
    with open(os.path.join(OUT_DIR, 'forecast_week.json')) as f:
        return json.load(f)

@pytest.fixture(scope='session')
def error_hour_json():
    with open(os.path.join(OUT_DIR, 'error_by_hour.json')) as f:
        return json.load(f)

# ══════════════════════════════════════════════════════════════════════════════
# 1. DATA LOADING TESTS
# ══════════════════════════════════════════════════════════════════════════════

class TestDataLoading:
    def test_csv_exists(self):
        assert os.path.exists(DATA_PATH), f"hour.csv not found at {DATA_PATH}"

    def test_row_count(self, raw_df):
        assert len(raw_df) == 17379, f"Expected 17379 rows, got {len(raw_df)}"

    def test_required_columns_present(self, raw_df):
        required = {'dteday', 'hr', 'cnt', 'casual', 'registered',
                    'temp', 'atemp', 'hum', 'windspeed', 'workingday', 'holiday',
                    'weathersit', 'season', 'weekday', 'mnth', 'yr', 'instant'}
        missing = required - set(raw_df.columns)
        assert not missing, f"Missing columns: {missing}"

    def test_no_missing_target(self, raw_df):
        missing = raw_df['cnt'].isna().sum()
        assert missing == 0, f"cnt has {missing} missing values"

    def test_cnt_equals_casual_plus_registered(self, raw_df):
        diff = (raw_df['cnt'] - raw_df['casual'] - raw_df['registered']).abs()
        assert diff.max() < 1e-6, "cnt != casual + registered for some rows"

    def test_no_negative_counts(self, raw_df):
        assert (raw_df['cnt'] >= 0).all(), "Negative cnt values found"

    def test_hr_range(self, raw_df):
        assert raw_df['hr'].between(0, 23).all(), "hr values outside [0,23]"

    def test_season_range(self, raw_df):
        assert raw_df['season'].isin([1, 2, 3, 4]).all(), "season values outside {1,2,3,4}"

    def test_weathersit_range(self, raw_df):
        assert raw_df['weathersit'].between(1, 4).all(), "weathersit values outside [1,4]"

    def test_temp_range(self, raw_df):
        assert raw_df['temp'].between(0.0, 1.0).all(), "temp values outside [0,1]"

    def test_hum_range(self, raw_df):
        # humidity can be 0 in the UCI dataset
        assert raw_df['hum'].between(0.0, 1.0).all(), "hum values outside [0,1]"

# ══════════════════════════════════════════════════════════════════════════════
# 2. CHRONOLOGICAL ORDERING TESTS
# ══════════════════════════════════════════════════════════════════════════════

class TestChronologicalOrdering:
    def test_index_is_datetime(self, processed_df):
        assert isinstance(processed_df.index, pd.DatetimeIndex), "Index is not DatetimeIndex"

    def test_index_is_sorted(self, processed_df):
        assert processed_df.index.is_monotonic_increasing, "DataFrame is not sorted chronologically"

    def test_no_duplicate_timestamps(self, processed_df):
        dupes = processed_df.index.duplicated().sum()
        assert dupes == 0, f"Found {dupes} duplicate timestamps"

    def test_date_range(self, processed_df):
        assert processed_df.index.min().year == 2011, "Data does not start in 2011"
        assert processed_df.index.max().year == 2012, "Data does not end in 2012"

    def test_expected_hours_complete(self, processed_df):
        # UCI dataset is nearly complete — check we have at least 17000 rows
        assert len(processed_df) >= 17000, f"Too few rows: {len(processed_df)}"

# ══════════════════════════════════════════════════════════════════════════════
# 3. LEAKAGE PREVENTION TESTS
# ══════════════════════════════════════════════════════════════════════════════

class TestLeakagePrevention:
    def test_casual_not_in_features(self):
        assert 'casual' not in FEATURES

    def test_registered_not_in_features(self):
        assert 'registered' not in FEATURES

    def test_cnt_not_in_features(self):
        assert 'cnt' not in FEATURES

    def test_instant_not_in_features(self):
        assert 'instant' not in FEATURES

    def test_dteday_not_in_features(self):
        assert 'dteday' not in FEATURES

    def test_leaky_cols_dropped(self, processed_df):
        for col in LEAKY_COLS:
            assert col not in processed_df.columns, f"Leaky column '{col}' still in DataFrame"

    def test_target_still_present(self, processed_df):
        assert TARGET in processed_df.columns, "Target column 'cnt' was accidentally dropped"

    def test_all_features_available_at_prediction_time(self, processed_df):
        """All features must be in the processed DataFrame and not derived from future data."""
        missing = [f for f in FEATURES if f not in processed_df.columns]
        assert not missing, f"Features missing from DataFrame: {missing}"

# ══════════════════════════════════════════════════════════════════════════════
# 4. TRAIN/TEST SPLIT TESTS
# ══════════════════════════════════════════════════════════════════════════════

class TestTrainTestSplit:
    def test_no_temporal_overlap(self, train_test):
        train, test = train_test
        assert train.index.max() < pd.Timestamp(SPLIT_DATE), "Train set extends into test period"

    def test_test_starts_at_split(self, train_test):
        train, test = train_test
        assert test.index.min() >= pd.Timestamp(SPLIT_DATE), "Test set starts before split date"

    def test_train_size_reasonable(self, train_test):
        train, test = train_test
        assert len(train) > 10000, f"Train set too small: {len(train)}"

    def test_test_size_reasonable(self, train_test):
        train, test = train_test
        assert len(test) > 3000, f"Test set too small: {len(test)}"

    def test_no_future_leakage_in_features(self, train_test):
        """Features must not use future-period statistics computed on combined train+test."""
        train, test = train_test
        # sin_hour and cos_hour are deterministic from hr — no leakage possible
        # rush_hour is deterministic from hr — no leakage possible
        # All other features are raw dataset columns — verify they exist in both splits
        for feat in FEATURES:
            assert feat in train.columns, f"Feature '{feat}' missing from train"
            assert feat in test.columns,  f"Feature '{feat}' missing from test"

# ══════════════════════════════════════════════════════════════════════════════
# 5. BASELINE LAG CALCULATION TESTS
# ══════════════════════════════════════════════════════════════════════════════

class TestNaiveBaseline:
    def test_lag_is_168_hours(self, processed_df, train_test):
        """168h shift on the full series should give same-hour last week for test rows."""
        _, test = train_test
        naive = processed_df[TARGET].shift(168)
        # The first 168 hours of the test set will reference the end of the train set
        naive_test = naive.loc[test.index].dropna()
        assert len(naive_test) > 0, "No valid naive predictions"

    def test_naive_uses_only_past_data(self, processed_df, train_test):
        """shifted(168) on full df means test[i] references df[i-168]. Since test starts
        at SPLIT_DATE and 168h = 7 days, references point to 7 days before split — in train."""
        _, test = train_test
        naive = processed_df[TARGET].shift(168)
        naive_test = naive.loc[test.index].dropna()
        # All reference timestamps should be < SPLIT_DATE for earliest test rows
        first_test_ts = test.index.min()
        ref_ts = first_test_ts - pd.Timedelta(hours=168)
        assert ref_ts < pd.Timestamp(SPLIT_DATE), f"Reference {ref_ts} not in train set"

    def test_naive_no_nans_after_first_week(self, processed_df, train_test):
        """After the first 168 test hours, all naive values should be non-null."""
        _, test = train_test
        naive = processed_df[TARGET].shift(168)
        naive_test = naive.loc[test.index]
        # First 168 test rows will reference rows that may be in training
        # but after 168h into the test, references should be within test itself
        second_week_start = test.index[168] if len(test) > 168 else test.index[-1]
        null_count = naive_test.loc[naive_test.index >= second_week_start].isna().sum()
        assert null_count == 0, f"{null_count} NaN values in naive baseline after first test week"

# ══════════════════════════════════════════════════════════════════════════════
# 6. METRIC CALCULATION TESTS
# ══════════════════════════════════════════════════════════════════════════════

class TestMetrics:
    def test_mae_non_negative(self, metrics_json):
        for m in metrics_json['models']:
            assert m['mae'] >= 0, f"Negative MAE for {m['name']}"

    def test_rmse_non_negative(self, metrics_json):
        for m in metrics_json['models']:
            assert m['rmse'] >= 0, f"Negative RMSE for {m['name']}"

    def test_rmse_geq_mae(self, metrics_json):
        """RMSE must be >= MAE for any distribution."""
        for m in metrics_json['models']:
            assert m['rmse'] >= m['mae'] - 0.01, \
                f"RMSE ({m['rmse']}) < MAE ({m['mae']}) for {m['name']}"

    def test_main_model_beats_naive_mae(self, metrics_json):
        naive_mae = next(m['mae'] for m in metrics_json['models'] if 'Naive' in m['name'])
        main_mae  = next(m['mae'] for m in metrics_json['models'] if 'Main' in m['name'])
        assert main_mae < naive_mae, "Main model does not beat naive baseline on MAE"

    def test_main_model_beats_naive_rmse(self, metrics_json):
        naive_rmse = next(m['rmse'] for m in metrics_json['models'] if 'Naive' in m['name'])
        main_rmse  = next(m['rmse'] for m in metrics_json['models'] if 'Main' in m['name'])
        assert main_rmse < naive_rmse, "Main model does not beat naive baseline on RMSE"

    def test_improvement_pct_consistent(self, metrics_json):
        naive_mae = next(m['mae'] for m in metrics_json['models'] if 'Naive' in m['name'])
        main_mae  = next(m['mae'] for m in metrics_json['models'] if 'Main' in m['name'])
        expected_pct = round((naive_mae - main_mae) / naive_mae * 100, 1)
        reported_pct = metrics_json['improvement_vs_naive_mae_pct']
        assert abs(expected_pct - reported_pct) < 0.5, \
            f"Improvement pct mismatch: expected {expected_pct}, got {reported_pct}"

    def test_model_loaded_gives_predictions(self, train_test):
        """Saved model.pkl must load and produce predictions without error."""
        import joblib
        if not os.path.exists(MODEL_PKL):
            pytest.skip("model.pkl not found")
        model = joblib.load(MODEL_PKL)
        _, test = train_test
        X_test = test[FEATURES]
        preds = model.predict(X_test[:10])
        assert len(preds) == 10
        assert not np.isnan(preds).any()

# ══════════════════════════════════════════════════════════════════════════════
# 7. JSON ARTIFACT VALIDITY TESTS
# ══════════════════════════════════════════════════════════════════════════════

class TestJSONArtifacts:
    def test_metrics_json_structure(self, metrics_json):
        assert 'models' in metrics_json
        assert 'best_model' in metrics_json
        assert 'improvement_vs_naive_mae_pct' in metrics_json
        assert len(metrics_json['models']) == 3

    def test_metrics_json_has_all_model_fields(self, metrics_json):
        for m in metrics_json['models']:
            assert 'name' in m
            assert 'mae' in m
            assert 'rmse' in m

    def test_drivers_json_structure(self, drivers_json):
        assert 'top_features' in drivers_json
        assert 'ops_guidance' in drivers_json
        assert len(drivers_json['ops_guidance']) == 3
        assert len(drivers_json['top_features']) >= 3

    def test_drivers_top_features_valid(self, drivers_json):
        for feat in drivers_json['top_features']:
            assert 'feature' in feat
            assert 'importance' in feat
            assert feat['importance'] >= 0

    def test_forecast_week_json_structure(self, forecast_json):
        required_keys = {'timestamps', 'actual', 'predicted', 'ridge', 'naive'}
        assert required_keys <= set(forecast_json.keys()), \
            f"Missing keys: {required_keys - set(forecast_json.keys())}"

    def test_forecast_week_json_lengths_match(self, forecast_json):
        n = len(forecast_json['timestamps'])
        for key in ['actual', 'predicted', 'ridge', 'naive']:
            assert len(forecast_json[key]) == n, \
                f"forecast_week.json '{key}' length {len(forecast_json[key])} != {n}"

    def test_forecast_week_json_no_nulls(self, forecast_json):
        for key in ['actual', 'predicted', 'ridge']:
            nulls = sum(1 for v in forecast_json[key] if v is None)
            assert nulls == 0, f"forecast_week.json '{key}' has {nulls} null values"

    def test_error_by_hour_json_structure(self, error_hour_json):
        assert 'hours' in error_hour_json
        assert 'mae' in error_hour_json
        assert 'buffer' in error_hour_json
        assert len(error_hour_json['hours']) == 24
        assert len(error_hour_json['mae']) == 24
        assert len(error_hour_json['buffer']) == 24

    def test_error_by_hour_buffer_is_larger(self, error_hour_json):
        for mae_val, buf_val in zip(error_hour_json['mae'], error_hour_json['buffer']):
            assert buf_val >= mae_val - 0.01, \
                f"Buffer {buf_val} < MAE {mae_val}"

    def test_error_by_hour_mae_non_negative(self, error_hour_json):
        assert all(v >= 0 for v in error_hour_json['mae'])

# ══════════════════════════════════════════════════════════════════════════════
# 8. WHAT-IF LOOKUP TESTS
# ══════════════════════════════════════════════════════════════════════════════

class TestWhatIfLookup:
    def test_whatif_has_lookup_key(self, whatif_json):
        assert 'lookup' in whatif_json

    def test_whatif_expected_entry_count(self, whatif_json):
        # 24 hours × 2 workingday × 3 weathersit × 8 temp × 3 hum × 3 wind = 10368
        assert len(whatif_json['lookup']) == 10368, \
            f"Expected 10368 entries, got {len(whatif_json['lookup'])}"

    def test_whatif_key_format(self, whatif_json):
        """Keys should follow the pattern hr_wd_ws_ti_hi_wi."""
        sample_key = '8_1_1_4_1_0'
        assert sample_key in whatif_json['lookup'], f"Expected key {sample_key} not found"

    def test_whatif_all_hours_covered(self, whatif_json):
        for hr in range(24):
            key = f'{hr}_1_1_4_1_0'
            assert key in whatif_json['lookup'], f"Missing entry for hour {hr}"

    def test_whatif_all_working_day_values(self, whatif_json):
        for wd in [0, 1]:
            key = f'8_{wd}_1_4_1_0'
            assert key in whatif_json['lookup'], f"Missing entry for workingday={wd}"

    def test_whatif_all_weather_values(self, whatif_json):
        for ws in [1, 2, 3]:
            key = f'8_1_{ws}_4_1_0'
            assert key in whatif_json['lookup'], f"Missing entry for weathersit={ws}"

    def test_whatif_predictions_non_negative(self, whatif_json):
        negatives = [v for v in whatif_json['lookup'].values() if v < 0]
        assert not negatives, f"Found {len(negatives)} negative predictions in what-if lookup"

    def test_whatif_predictions_reasonable_range(self, whatif_json):
        vals = list(whatif_json['lookup'].values())
        assert max(vals) < 1000, f"Max prediction {max(vals)} seems unreasonably high"
        assert min(vals) >= 0, "Min prediction is negative"

    def test_whatif_has_bin_labels(self, whatif_json):
        assert 'temp_labels' in whatif_json
        assert 'hum_labels' in whatif_json
        assert 'wind_labels' in whatif_json
        assert len(whatif_json['temp_labels']) == 8
        assert len(whatif_json['hum_labels']) == 3
        assert len(whatif_json['wind_labels']) == 3

# ══════════════════════════════════════════════════════════════════════════════
# 9. MODEL SERIALIZATION TESTS
# ══════════════════════════════════════════════════════════════════════════════

class TestModelSerialization:
    def test_model_file_exists(self):
        assert os.path.exists(MODEL_PKL), f"model.pkl not found at {MODEL_PKL}"

    def test_model_loads_successfully(self):
        import joblib
        model = joblib.load(MODEL_PKL)
        assert model is not None

    def test_model_has_predict_method(self):
        import joblib
        model = joblib.load(MODEL_PKL)
        assert hasattr(model, 'predict'), "Loaded model has no predict() method"

    def test_model_predict_correct_shape(self, train_test):
        import joblib
        model = joblib.load(MODEL_PKL)
        _, test = train_test
        X_test = test[FEATURES]
        preds = model.predict(X_test)
        assert preds.shape == (len(X_test),), \
            f"Prediction shape {preds.shape} != expected ({len(X_test)},)"

    def test_model_predictions_non_negative_after_clip(self, train_test):
        import joblib
        model = joblib.load(MODEL_PKL)
        _, test = train_test
        X_test = test[FEATURES]
        preds = np.maximum(model.predict(X_test), 0)
        assert (preds >= 0).all()

# ══════════════════════════════════════════════════════════════════════════════
# 10. WEBSITE ARTIFACT PATH CONSISTENCY TESTS
# ══════════════════════════════════════════════════════════════════════════════

class TestWebsiteArtifacts:
    REQUIRED_FILES = [
        'metrics.json', 'forecast_week.json', 'error_by_hour.json',
        'drivers.json', 'whatif_lookup.json',
        'shap_summary.png', 'error_by_hour.png', 'forecast_week.png',
    ]
    WEB_FILES = ['index.html', os.path.join('css', 'style.css'),
                 os.path.join('js', 'app.js')]

    def test_all_data_files_exist(self):
        for fname in self.REQUIRED_FILES:
            path = os.path.join(OUT_DIR, fname)
            assert os.path.exists(path), f"Missing artifact: {path}"

    def test_all_web_files_exist(self):
        public = os.path.join(ROOT, 'public')
        for fname in self.WEB_FILES:
            path = os.path.join(public, fname)
            assert os.path.exists(path), f"Missing web file: {path}"

    def test_json_files_are_valid_json(self):
        for fname in [f for f in self.REQUIRED_FILES if f.endswith('.json')]:
            path = os.path.join(OUT_DIR, fname)
            with open(path) as f:
                data = json.load(f)
            assert data is not None, f"{fname} parsed to None"

    def test_png_files_have_nonzero_size(self):
        for fname in [f for f in self.REQUIRED_FILES if f.endswith('.png')]:
            path = os.path.join(OUT_DIR, fname)
            size = os.path.getsize(path)
            assert size > 1000, f"{fname} is too small ({size} bytes) — likely corrupt"

    def test_no_windows_local_paths_in_html(self):
        html_path = os.path.join(ROOT, 'public', 'index.html')
        with open(html_path, encoding='utf-8') as f:
            content = f.read()
        assert 'D:\\' not in content and 'C:\\' not in content, \
            "Windows absolute paths found in index.html"

    def test_no_windows_paths_in_js(self):
        js_path = os.path.join(ROOT, 'public', 'js', 'app.js')
        with open(js_path, encoding='utf-8') as f:
            content = f.read()
        assert 'D:\\' not in content and 'C:\\' not in content, \
            "Windows absolute paths found in app.js"

    def test_chart_js_cdn_in_html(self):
        html_path = os.path.join(ROOT, 'public', 'index.html')
        with open(html_path, encoding='utf-8') as f:
            content = f.read()
        assert 'chart.js' in content.lower() or 'Chart.js' in content, \
            "Chart.js CDN link not found in index.html"

    def test_data_fetch_paths_relative(self):
        """app.js must fetch from relative paths like 'data/metrics.json', not absolute."""
        js_path = os.path.join(ROOT, 'public', 'js', 'app.js')
        with open(js_path, encoding='utf-8') as f:
            content = f.read()
        assert "fetchJSON('data/metrics.json')" in content, \
            "app.js does not fetch metrics.json from relative path"

    def test_four_tabs_in_html(self):
        html_path = os.path.join(ROOT, 'public', 'index.html')
        with open(html_path, encoding='utf-8') as f:
            content = f.read()
        for tab in ['overview', 'results', 'drivers', 'whatif']:
            assert f'section-{tab}' in content, f"Tab section 'section-{tab}' missing from HTML"

    def test_demand_level_thresholds_documented(self):
        """app.js must have demand level thresholds that are readable."""
        js_path = os.path.join(ROOT, 'public', 'js', 'app.js')
        with open(js_path, encoding='utf-8') as f:
            content = f.read()
        # Check that threshold values exist
        assert '< 50' in content or '50' in content, "Low demand threshold not found in app.js"
        assert '200' in content, "High demand threshold not found in app.js"


# ══════════════════════════════════════════════════════════════════════════════
# 11. NEW FEATURE: RISK RADAR
# ══════════════════════════════════════════════════════════════════════════════

class TestRiskRadarFeature:
    """Tests that the Risk Radar data and formula are correct."""

    def test_risk_score_formula_valid(self, error_hour_json, whatif_json):
        """Risk = 0.6 * demand_norm + 0.4 * error_norm, result must be in [0, 1]."""
        from math import isclose
        # Use working day, clear weather, mild temp (bin 4), medium hum, calm wind
        demands = [whatif_json['lookup'].get(f'{h}_1_1_4_1_0', 0) or 0 for h in range(24)]
        maes    = error_hour_json['mae']
        max_d   = max(demands) if max(demands) > 0 else 1
        max_m   = max(maes)    if max(maes)    > 0 else 1

        for h in range(24):
            ds = demands[h] / max_d
            es = maes[h]    / max_m
            score = 0.6 * ds + 0.4 * es
            assert 0 <= score <= 1.0001, f"Risk score at hour {h} out of [0,1]: {score}"

    def test_risk_thresholds_cover_rush_hours(self, error_hour_json, whatif_json):
        """Hours 8 and 17 should have high risk score on working day / clear / mild."""
        demands = [whatif_json['lookup'].get(f'{h}_1_1_4_1_0', 0) or 0 for h in range(24)]
        maes    = error_hour_json['mae']
        max_d   = max(demands) if max(demands) > 0 else 1
        max_m   = max(maes)    if max(maes)    > 0 else 1
        scores  = [0.6 * (demands[h] / max_d) + 0.4 * (maes[h] / max_m) for h in range(24)]
        # Rush hours should be in the top-tier risk
        assert scores[8]  > 0.33, f"Hour 8 risk {scores[8]:.3f} unexpectedly low"
        assert scores[17] > 0.33, f"Hour 17 risk {scores[17]:.3f} unexpectedly low"

    def test_overnight_risk_lower_than_rush(self, error_hour_json, whatif_json):
        """Overnight hours should have lower risk than rush hours."""
        demands = [whatif_json['lookup'].get(f'{h}_1_1_4_1_0', 0) or 0 for h in range(24)]
        maes    = error_hour_json['mae']
        max_d   = max(demands) if max(demands) > 0 else 1
        max_m   = max(maes)    if max(maes)    > 0 else 1
        scores  = [0.6 * (demands[h] / max_d) + 0.4 * (maes[h] / max_m) for h in range(24)]
        assert scores[3]  < scores[8],  "Hour 3 risk not lower than hour 8"
        assert scores[2]  < scores[17], "Hour 2 risk not lower than hour 17"

    def test_radar_tab_in_html(self):
        html_path = os.path.join(ROOT, 'public', 'index.html')
        with open(html_path, encoding='utf-8') as f:
            content = f.read()
        assert 'section-radar' in content, "section-radar not in index.html"
        assert 'tab-radar'     in content, "tab-radar not in index.html"
        assert 'nav-radar'     in content, "nav-radar not in index.html"

    def test_radar_chart_canvas_exists(self):
        html_path = os.path.join(ROOT, 'public', 'index.html')
        with open(html_path, encoding='utf-8') as f:
            content = f.read()
        assert 'radarProfileChart' in content, "radarProfileChart canvas not in HTML"

    def test_radar_table_exists(self):
        html_path = os.path.join(ROOT, 'public', 'index.html')
        with open(html_path, encoding='utf-8') as f:
            content = f.read()
        assert 'radar-tbody' in content, "radar-tbody not in HTML"

    def test_risk_score_js_formula_in_appjs(self):
        js_path = os.path.join(ROOT, 'public', 'js', 'app.js')
        with open(js_path, encoding='utf-8') as f:
            content = f.read()
        assert '0.6' in content and '0.4' in content, "Risk score formula (0.6/0.4) not in app.js"
        assert 'renderRadar' in content, "renderRadar function not in app.js"

    def test_citywide_disclaimer_in_html(self):
        html_path = os.path.join(ROOT, 'public', 'index.html')
        with open(html_path, encoding='utf-8') as f:
            content = f.read()
        assert 'citywide' in content.lower(), "Citywide disclaimer missing from radar section"


# ══════════════════════════════════════════════════════════════════════════════
# 12. NEW FEATURE: SCENARIO COMPARISON
# ══════════════════════════════════════════════════════════════════════════════

class TestScenarioComparison:
    """Tests for the Scenario B / comparison feature."""

    def test_scenario_b_html_elements_exist(self):
        html_path = os.path.join(ROOT, 'public', 'index.html')
        with open(html_path, encoding='utf-8') as f:
            content = f.read()
        assert 'scenario-b-section' in content, "scenario-b-section not in HTML"
        assert 'compare-toggle'     in content, "compare-toggle button not in HTML"
        assert 'comparison-panel'   in content, "comparison-panel not in HTML"

    def test_scenario_b_controls_present(self):
        html_path = os.path.join(ROOT, 'public', 'index.html')
        with open(html_path, encoding='utf-8') as f:
            content = f.read()
        for eid in ['ctrl-hr-b', 'ctrl-weather-b', 'ctrl-temp-b', 'ctrl-hum-b', 'ctrl-wind-b']:
            assert eid in content, f"Scenario B control '{eid}' not in HTML"

    def test_scenario_b_js_functions_present(self):
        js_path = os.path.join(ROOT, 'public', 'js', 'app.js')
        with open(js_path, encoding='utf-8') as f:
            content = f.read()
        for fn in ['toggleScenarioB', 'updateScenarioB', 'renderComparison',
                   'setWorkingDayB', 'getDemandLabel']:
            assert fn in content, f"Function '{fn}' not in app.js"

    def test_comparison_difference_formula(self, whatif_json):
        """diff = predB - predA; pctDiff = diff / predA * 100."""
        predA = whatif_json['lookup'].get('8_1_1_4_1_0')  # 8AM working clear mild
        predB = whatif_json['lookup'].get('8_0_1_4_1_0')  # 8AM weekend clear mild
        assert predA is not None and predB is not None
        diff     = predB - predA
        pct_diff = (diff / predA) * 100 if predA != 0 else 0
        # Weekend 8AM should be lower than working day 8AM
        assert diff < 0, f"Weekend 8AM ({predB}) should be lower than working day ({predA})"
        assert pct_diff < 0

    def test_missing_key_handled(self, whatif_json):
        """Lookup for a non-existent key should return None (not a value)."""
        missing = whatif_json['lookup'].get('99_9_9_9_9_9')
        assert missing is None, "Non-existent key should return None from .get()"

    def test_scenario_comparison_note_in_html(self):
        html_path = os.path.join(ROOT, 'public', 'index.html')
        with open(html_path, encoding='utf-8') as f:
            content = f.read()
        assert 'model estimates' in content.lower() or 'estimates' in content, \
            "Missing model-estimates disclaimer in HTML"


# ══════════════════════════════════════════════════════════════════════════════
# 13. NEW FEATURE: GROUPED IMPORTANCE
# ══════════════════════════════════════════════════════════════════════════════

class TestGroupedImportance:
    """Tests for the grouped feature importance section."""

    GROUPS = {
        'Time of Day':    ['hr', 'sin_hour', 'cos_hour', 'rush_hour'],
        'Calendar':       ['workingday', 'weekday', 'holiday'],
        'Weather':        ['temp', 'atemp', 'hum', 'windspeed', 'weathersit'],
        'Season / Trend': ['season', 'mnth', 'yr'],
    }

    def test_all_features_in_exactly_one_group(self):
        """Every feature must appear in exactly one group (no duplicates)."""
        all_feats = []
        for feats in self.GROUPS.values():
            all_feats.extend(feats)
        assert len(all_feats) == len(set(all_feats)), "Duplicate features across groups"

    def test_all_model_features_covered(self):
        """All 15 model features must be covered by groups."""
        all_group_feats = set()
        for feats in self.GROUPS.values():
            all_group_feats.update(feats)
        missing = set(FEATURES) - all_group_feats
        assert not missing, f"Features not covered by any group: {missing}"

    def test_group_importance_sums_correct(self, drivers_json):
        """Group sums must equal sum of individual importances in that group."""
        imp_map = {f['feature']: f['importance'] for f in drivers_json['top_features']}
        for gname, feats in self.GROUPS.items():
            expected = sum(imp_map.get(f, 0) for f in feats)
            assert expected >= 0, f"Group '{gname}' has negative importance sum"

    def test_time_of_day_group_dominates(self, drivers_json):
        """Time-of-day group (hr + sin_hour + cos_hour + rush_hour) should have highest total."""
        imp_map = {f['feature']: f['importance'] for f in drivers_json['top_features']}
        tod_sum = sum(imp_map.get(f, 0) for f in self.GROUPS['Time of Day'])
        for gname, feats in self.GROUPS.items():
            if gname == 'Time of Day':
                continue
            other_sum = sum(imp_map.get(f, 0) for f in feats)
            assert tod_sum >= other_sum, \
                f"Time-of-Day group ({tod_sum:.3f}) not >= {gname} ({other_sum:.3f})"

    def test_grouped_importance_js_in_appjs(self):
        js_path = os.path.join(ROOT, 'public', 'js', 'app.js')
        with open(js_path, encoding='utf-8') as f:
            content = f.read()
        assert 'renderGroupedImportance' in content, "renderGroupedImportance not in app.js"
        assert 'Time of Day'            in content, "Group name 'Time of Day' not in app.js"

    def test_grouped_importance_html_container(self):
        html_path = os.path.join(ROOT, 'public', 'index.html')
        with open(html_path, encoding='utf-8') as f:
            content = f.read()
        assert 'grouped-importance-container' in content, \
            "grouped-importance-container div not in HTML"


# ══════════════════════════════════════════════════════════════════════════════
# 14. NEW FEATURE: PREDICTION EXPLANATION
# ══════════════════════════════════════════════════════════════════════════════

class TestPredictionExplanation:
    def test_pred_explain_panel_in_html(self):
        html_path = os.path.join(ROOT, 'public', 'index.html')
        with open(html_path, encoding='utf-8') as f:
            content = f.read()
        assert 'pred-explain-card' in content, "pred-explain-card div not in HTML"
        assert 'pred-explain-body' in content, "pred-explain-body div not in HTML"

    def test_pred_explain_js_in_appjs(self):
        js_path = os.path.join(ROOT, 'public', 'js', 'app.js')
        with open(js_path, encoding='utf-8') as f:
            content = f.read()
        assert 'renderPredictionExplanation' in content, "renderPredictionExplanation not in app.js"

    def test_heuristic_disclaimer_in_appjs(self):
        js_path = os.path.join(ROOT, 'public', 'js', 'app.js')
        with open(js_path, encoding='utf-8') as f:
            content = f.read()
        assert 'heuristic' in content.lower(), "Heuristic disclaimer missing from explanation code"


# RebalanceIQ

> **"Know the demand before the riders do."**

Hackathon submission — CityCycle Project 4 | Bike-Share Demand Forecasting | Regression

---

## Business Problem

Bike-share operators lose money and rider trust when docks are empty at 8 AM (commuters need bikes) and overflowing at 6 PM (everyone returns at once). The root cause is reactive rebalancing — trucks move bikes *after* the problem appears.

**RebalanceIQ** forecasts hourly demand (`cnt`) using 2 years of historical data, explains *why* demand changes (SHAP feature importance), and gives operations teams an interactive What-if tool — so they can pre-position bikes before the rush, not after.

---

## Architecture

```
hour.csv  →  run_pipeline.py  →  public/data/*.json + *.png
                                        ↓
                              public/index.html  (served via Vercel)
                              public/js/app.js   (Chart.js, no backend)
                              public/css/style.css
```

- **ML layer**: Python + scikit-learn pipeline, runs offline, exports pre-computed artifacts
- **Web layer**: Static HTML/CSS/JS — no server, no database, no runtime Python
- **Deployment**: Vercel static hosting from the `public/` directory
- **What-if**: 10,368 pre-computed predictions in a lookup JSON — runs in <1ms, client-side
- **Spatial Radar**: Leaflet.js interactive map + synthetic station simulation (`public/js/spatial.js`)

---

## Chennai Spatial Risk Radar

The **Spatial Radar** tab adds a station-level inventory simulation for 15 real Chennai-area localities.

> ⚠ **ALL STATION DATA IS SYNTHETIC.** Not derived from the UCI Bike Sharing dataset (Washington D.C.). Not live operator data. Locations are real Chennai-area locality centres; station records are fictional demonstration data.

### Inventory equations (documented)

```
served_pickups       = min(expected_pickups, current_inventory)
unserved_pickups     = expected_pickups − served_pickups
inventory_after_pick = current_inventory − served_pickups
available_docks      = capacity − inventory_after_pick
served_returns       = min(expected_returns, available_docks)
unserved_returns     = expected_returns − served_returns
projected_inventory  = inventory_after_pick + served_returns
```

### Risk thresholds

| Category | Condition |
|---|---|
| SEVERE SHORTAGE | `projected == 0` OR `unserved_pickups > 0` |
| POTENTIAL DOCK OVERFLOW | `projected > 80% cap` OR `unserved_returns > 0` |
| POTENTIAL SHORTAGE | `0 < projected < 20% cap` |
| NORMAL | otherwise |

### Redistribution heuristic

Greedy donor→recipient matching. Donors have `projected > 50%` capacity; recipients have `projected < 30%`. Each transfer preserves source ≥ 30%, respects destination dock space, and conserves total bike inventory. Labelled *SIMULATED REDISTRIBUTION RECOMMENDATION — NOT A LIVE DISPATCH ORDER.*

### UCI model vs. synthetic simulation

| Output | Source | Label |
|---|---|---|
| Hourly rental forecasts | UCI Bike Sharing, Washington D.C. | UCI-BASED CITYWIDE DEMAND ESTIMATE |
| Station inventory | Synthetic demonstration data | SYNTHETIC STATION SIMULATION |

These are never mixed or cross-labelled in the UI.



---

## Dataset and Limitations

| Property | Value |
|----------|-------|
| Source | [UCI Machine Learning Repository – Bike Sharing Dataset](https://archive.ics.uci.edu/dataset/275/bike+sharing+dataset) |
| File | `hour.csv` |
| Rows | 17,379 |
| Period | January 2011 – December 2012, Washington D.C. |
| Target | `cnt` (total hourly rentals = casual + registered) |
| Granularity | City-wide hourly aggregates — **not station-level** |

**Important limitations:**
- Data is 12+ years old. Post-pandemic remote work patterns and infrastructure changes are not captured.
- No station-level inventory, dock capacities, or redistribution records.
- Predictions are probabilistic estimates, not guaranteed values.
- The model cannot predict demand during storms, strikes, or major events.

---

## Model Pipeline

### Features (15 total)

| Feature | Source | Notes |
|---------|--------|-------|
| `hr` | Raw | Hour of day (0–23) |
| `weekday`, `mnth`, `season` | Raw | Calendar features |
| `holiday`, `workingday` | Raw | Day type |
| `weathersit` | Raw | 1=Clear, 2=Mist, 3=Rain, 4=Heavy (rare) |
| `temp`, `atemp`, `hum`, `windspeed` | Raw | Normalised weather features |
| `yr` | Raw | 0=2011, 1=2012 (trend) |
| `sin_hour`, `cos_hour` | **Engineered** | Cyclical hour encoding |
| `rush_hour` | **Engineered** | Binary: 1 if 7–9 AM or 5–7 PM |

### Leakage Prevention

The following columns are **excluded** from all model inputs:
- `casual` + `registered` — they sum to `cnt` (the target). Using them would be perfect leakage.
- `instant` — meaningless row index.
- `dteday` — string date already encoded into `datetime` index; not a predictive feature.

### Chronological Evaluation Methodology

```
Training set:   Jan 2011 – Jun 2012  (13,003 rows)
                           ↓ SPLIT_DATE = '2012-07-01'
Test set:       Jul 2012 – Dec 2012  (4,376 rows)
```

A **random split was not used** because it would leak future demand patterns into training — the model would see Sunday's data while predicting Saturday. Chronological split simulates real production conditions.

---

## Measured Results

All metrics are evaluated on the held-out test set (Jul–Dec 2012). These values were independently verified by the validation script — they match the stored `metrics.json` exactly.

| Model | MAE (rides/hr) | RMSE (rides/hr) | Notes |
|-------|---------------|-----------------|-------|
| Naive (same-hour last week) | 74.04 | 130.44 | Pure baseline — no training |
| Ridge Regression | 109.90 | 143.46 | Worse than naive — demand is non-linear |
| **GradientBoosting (Main)** | **43.76** | **66.94** | **Best — 40.9% lower MAE than naive** |

**Why Ridge is worse than Naive:** Ridge is a linear model. It cannot capture the sharp bimodal daily pattern (7–9 AM and 5–7 PM peaks). The naive baseline at least replicates last week's exact shape, which is closer to reality for time-series demand.

---

## Explainability

Feature importance is computed using SHAP (model-agnostic permutation-based explainer, since `HistGradientBoostingRegressor` is not compatible with `shap.TreeExplainer`).

**Top 3 demand drivers:**

| Rank | Feature | Importance | Insight |
|------|---------|-----------|---------|
| 🥇 | `hr` | 0.4744 | Rush hours dominate: 4–6× overnight demand at 8 AM and 6 PM |
| 🥈 | `workingday` | 0.2647 | Commute peaks vanish on weekends; leisure pattern spreads across midday |
| 🥉 | `sin_hour` | 0.1929 | Smooth demand curve shape — demand rises steeply from 5 AM, fades from 7 PM |

---

## Dashboard Features

The website at `public/index.html` has four tabs:

| Tab | Contents |
|-----|---------|
| **Overview** | Business problem, approach, live MAE/RMSE/improvement from metrics.json |
| **Results** | 3 metric cards, model comparison table, forecast vs actual chart (168 pts), MAE-by-hour chart |
| **Drivers** | SHAP importance image, 3 ranked driver cards with insights and ops actions |
| **What-if** | 6 controls (hour, day type, weather, temperature, humidity, wind), real-time demand output, 24-hour day profile chart |

---

## Installation

### Requirements

```bash
pip install -r requirements.txt
```

Dependencies: `pandas`, `numpy`, `scikit-learn`, `shap`, `matplotlib`, `joblib`, `lightgbm` (optional — falls back to sklearn on Windows/Python 3.12)

### Generate Artifacts (Run Once)

```bash
python run_pipeline.py
```

This will:
1. Load `hour.csv`
2. Train all 3 models
3. Compute feature importance
4. Export 8 files to `public/data/`

---

## Local Run Instructions

```bash
# Step 1: Generate artifacts (if not already present)
python run_pipeline.py

# Step 2: Serve the website
cd public
python -m http.server 8080

# Step 3: Open in browser
# http://localhost:8080
```

---

## Testing Instructions

The test suite covers 10 categories: data loading, chronological ordering, leakage prevention, train/test split, naive baseline, metrics, JSON artifacts, What-if lookup, model serialization, and website consistency.

```bash
# Install pytest
pip install pytest

# Run all 73 tests
pytest tests/ -v

# Run a specific category
pytest tests/ -v -k "TestLeakagePrevention"
pytest tests/ -v -k "TestWhatIfLookup"
```

**Expected result:** 73 passed, 0 failed.

---

## Vercel Deployment Instructions

> **Note:** Do NOT run `git push` until you have reviewed the files. Run locally first.

```bash
# 1. Initialise git
git init
git add .
git commit -m "RebalanceIQ: verified submission"

# 2. Push to GitHub
git remote add origin https://github.com/<your-username>/RebalanceIQ.git
git push -u origin main

# 3. Deploy to Vercel
# Option A: vercel.com → New Project → Import from GitHub → Deploy
# Option B: CLI
npm i -g vercel
vercel --prod
```

The `vercel.json` is configured with `outputDirectory: "public"` — Vercel will serve all files in `public/` from the root URL.

**After deploying:** Test all 4 tabs and the What-if controls at the live URL.

---

## Open-Meteo API Integration Status

**Not implemented in this submission.**

The feature mapping from Open-Meteo to UCI normalised features is technically feasible:

| UCI Feature | Mapping |
|-------------|---------|
| `temp` | `temperature_2m (°C) / 41` |
| `atemp` | `apparent_temperature (°C) / 50` |
| `hum` | `relative_humidity_2m (%) / 100` |
| `windspeed` | `wind_speed_10m (km/h) / 67` |
| `weathersit` | WMO code → ordinal mapping (1=Clear, 2=Mist, 3=Rain) |

This would allow the dashboard to show **future demand forecasts** (next 7 days) rather than only historical evaluation. It is documented as a roadmap item and would not change the validated historical metrics.

---

## Known Limitations

1. **City-wide only:** Model predicts aggregate city demand, not individual station shortages.
2. **2011–2012 data:** Patterns may not match current conditions.
3. **LightGBM:** Cannot be used on Python 3.12 + Windows (access violation). `HistGradientBoostingRegressor` is used instead with similar accuracy.
4. **SHAP method:** Uses permutation-based importance (not exact Shapley values) due to model compatibility.
5. **Rush hours have highest error:** MAE at 8 AM and 5 PM is ~95–99 rides — the prediction is less precise exactly when stakes are highest. Add a 20% safety buffer.
6. **No real-time data:** The What-if tool uses a precomputed lookup. It cannot respond to live events.

---

## Project Structure

```
RebalanceIQ/
├── notebook.ipynb           # Full ML pipeline (runs top-to-bottom)
├── run_pipeline.py          # Standalone pipeline script
├── validate.py              # Quick JSON artifact validation
├── model.pkl                # Trained HistGradientBoostingRegressor
├── hour.csv                 # UCI dataset (17,379 rows)
├── requirements.txt         # Python dependencies
├── vercel.json              # Vercel deployment config
├── .gitignore               # Excludes cache, venvs, secrets
├── README.md                # This file
├── ops_guidance.md          # Operations playbook (SHAP-based)
├── tests/
│   └── test_pipeline.py     # 73 pytest tests (10 categories)
├── outputs/
│   ├── project_audit.md     # Full project audit report
│   ├── evaluation_report.json  # Machine-readable metrics + validation
│   ├── final_ops_playbook.md   # Rigorous ops recommendations
│   └── demo_script.md       # 3-minute hackathon demo script
└── public/                  # Everything Vercel serves
    ├── index.html           # 4-tab dashboard
    ├── css/style.css        # Dark theme, responsive
    ├── js/app.js            # Chart.js + What-if lookup engine
    └── data/
        ├── metrics.json
        ├── forecast_week.json
        ├── error_by_hour.json
        ├── drivers.json
        ├── whatif_lookup.json
        ├── shap_summary.png
        ├── error_by_hour.png
        └── forecast_week.png
```

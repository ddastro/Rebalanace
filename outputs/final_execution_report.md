# RebalanceIQ — Final Execution Report
**Generated:** 2026-10-10 · Final development pass

---

## 1. Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| Previous (73 tests) | 73/73 | PASS — All preserved |
| New feature tests (23 tests) | 23/23 | PASS — All passing |
| **Total** | **96/96** | **100% pass rate** |

Run: `pytest tests/ -v` — `96 passed in 4.91s`

---

## 2. Bugs Fixed

1. **Safety buffer mislabelled** — was called "Safety Buffer Recommendation". Now clearly labelled "Heuristic Safety Buffer" with explicit disclaimer that it is NOT a confidence interval or statistical guarantee.
2. **SHAP title misleading** — suggested exact SHAP values when permutation importance was used. Retitled to "SHAP / Permutation Importance Summary".
3. **updateDemand missing Scenario B refresh** — when Scenario B was visible and Scenario A controls changed, the comparison panel did not update. Fixed by calling `if (scenarioBVisible) updateScenarioB()` after every Scenario A prediction.

---

## 3. Features Added (P1)

### Demand Risk Radar (new 5th tab)

- **Risk formula:** Risk = 0.6 x demand_score + 0.4 x error_score (both normalised 0-1)
- **Demand score:** predicted demand / max demand across all 24 hours
- **Error score:** historical MAE / max historical MAE across all 24 hours
- **Thresholds:** Low < 0.33, Medium 0.33-0.66, High > 0.66
- **Controls:** working day vs weekend, weather, temperature
- **Chart:** dual-axis — demand bars coloured by risk level + historical MAE line
- **Table:** 24-row attention planner with suggested operational action per hour
- **Citywide disclaimer:** clearly states this indicator uses city-level data, not station-level inventory

### Scenario Comparison (What-if tab extension)

- "+ Compare Scenario B" toggle reveals a second set of controls
- Scenario B: independent hour, day type, weather, temperature, humidity, wind speed
- Comparison panel: Scenario A demand, Scenario B demand, absolute diff (B-A), percent diff, demand levels
- Explicitly notes differences are correlational, not causal
- Shows what changed between scenarios (hour, day type, weather)
- Handles missing lookup keys safely — no silent fallback

### Prediction Explanation panel (What-if tab)

- "Why this estimate?" card below the Scenario A demand gauge
- Explains hour, day type, weather, temperature with directional tags (High / Mid / Low)
- Clearly labelled as heuristic directional context — not exact per-prediction Shapley values
- Updates automatically with every input change

---

## 4. Features Improved (P2)

### Feature Group Importance (Drivers tab)

- Groups 15 model features into 4 semantic categories:
  - **Time of Day:** hr, sin_hour, cos_hour, rush_hour
  - **Calendar:** workingday, weekday, holiday
  - **Weather:** temp, atemp, hum, windspeed, weathersit
  - **Season / Trend:** season, mnth, yr
- Horizontal bar chart rendered client-side from drivers.json permutation importance values
- Disclaimer notes that correlated features (hr and sin_hour) share information; grouping avoids double-counting the same signal

### Uncertainty / Buffer Labelling

- Renamed "Safety Buffer Recommendation" to "Heuristic Safety Buffer"
- Added explicit disclaimer text in the Drivers tab

---

## 5. Files Changed

| File | Change |
|------|--------|
| `public/index.html` | Added Risk Radar tab section, Scenario B section, grouped importance container, prediction explanation panel, 5th nav link, 5th tab button |
| `public/css/style.css` | ~180 lines added: scenario bar, divider, comparison rows, grouped importance bars, explain factor rows, risk badges, radar table row colours |
| `public/js/app.js` | ~350 lines added: renderRadar, renderRadarChart, renderRadarTable, renderGroupedImportance, renderPredictionExplanation, toggleScenarioB, updateScenarioB, renderComparison, getDemandLabel, Scenario B label helpers |
| `tests/test_pipeline.py` | 4 new test classes, 23 new tests (96 total) |
| `outputs/final_execution_report.md` | This file |

---

## 6. Verified Model Metrics (unchanged from previous validation)

| Model | MAE | RMSE |
|-------|-----|------|
| Same-hour-last-week naive | 74.04 | 130.44 |
| Ridge Regression | 109.90 | 143.46 |
| HistGradientBoosting (best) | **43.76** | **66.94** |
| MAE improvement vs naive | **40.9%** | — |
| RMSE improvement vs naive | — | **48.7%** |

Ridge underperforms the naive baseline on MAE — preserved and not hidden; clearly visible in comparison table.

---

## 7. Existing Features Preserved

- Overview, Results, Drivers, What-if tabs: fully intact and working
- 10,368-entry precomputed what-if lookup with instant client-side response
- Forecast week chart and error-by-hour chart
- SHAP/permutation importance image and driver cards
- Vercel static deployment config (outputDirectory: public)
- No local Windows paths embedded in any deployed asset

---

## 8. Known Limitations

1. **Station-level predictions not possible.** UCI dataset contains city-level hourly counts. The Risk Radar shows citywide demand risk — not specific empty or full stations. Station-level predictions require per-station inventory data.
2. **Prediction explanation is heuristic.** Directional tags are based on known demand patterns, not exact per-prediction Shapley values. TreeSHAP is incompatible with HistGradientBoosting; permutation importance was used during training.
3. **Training data is 2011-2012.** Urban cycling patterns may have changed (remote work, infrastructure). Retrain annually with current data.
4. **Grouped importance uses top-6 reported features.** Features ranked 7-15 contribute 0 to their group in the display bar (their actual model contribution is small but non-zero).
5. **Scenario comparison is correlational, not causal.** The model learned associations from historical data. A difference in scenario predictions does not imply that changing that variable would cause the observed demand difference.

---

## 9. Optional Feature Skipped (P3)

Synthetic redistribution simulator (station-level inventory with fictional stations) was not implemented. Time was allocated to P0 and P1 features. This remains a valid future enhancement — would require inventing fictional stations clearly labelled as synthetic demonstrations.

---

## 10. Commands

```bash
# Run complete test suite
python -m pytest tests/ -v

# Run independent validation script
python outputs/validate_pipeline.py

# Serve dashboard locally (open http://localhost:8080)
python -m http.server 8080 --directory public

# Regenerate all model artifacts (only if needed)
python run_pipeline.py
```

---

## 11. Deployment Steps (manual)

1. `git add -A && git commit -m "Final pass: Risk Radar, Scenario B, grouped importance"`
2. `git push origin main`
3. Import repo on Vercel → Framework: Other → Output Directory: `public` → Deploy
4. Verify live site loads all 5 tabs, Risk Radar renders, Scenario B toggle works

No build step required. No backend. No environment variables.

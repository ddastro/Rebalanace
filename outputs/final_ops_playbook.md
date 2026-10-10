# outputs/final_ops_playbook.md
# RebalanceIQ – Final Operational Playbook

**Version:** Post-audit · October 2026  
**Based on:** UCI Bike Sharing Dataset (Washington D.C., 2011–2012, 17,379 hourly records)  
**Model:** HistGradientBoostingRegressor (sklearn), 300 estimators, trained on first 18 months  
**Importance method:** Permutation importance (SHAP model-agnostic explainer, HistGBM)

> **Important disclaimer:** All findings below are derived from city-level hourly rental totals.
> The dataset does NOT contain individual station inventory, dock capacities, truck routes, or
> redistribution records. Operational recommendations are directional signals, not measured outcomes.
> Claims about cost savings or shortage reductions have NOT been validated against operational data.

---

## Section A — Measured Demand Drivers

The following three features have the highest permutation importance scores, meaning removing them
from the model causes the largest increase in prediction error.

### Driver 1: Hour of Day (`hr`)
**Importance:** 0.47 (mean absolute permutation importance)  
**Evidence:** City-level hourly demand shows two clearly separated peaks when plotted:
- Morning peak: 7–9 AM (mean demand approximately 350–450 rides/hour at dataset scale)
- Evening peak: 5–7 PM (mean demand approximately 400–500 rides/hour at dataset scale)
- Overnight trough: 12–5 AM (mean demand approximately 5–30 rides/hour)

The model error (MAE) at hour 17 is ~99 rides and at hour 8 is ~96 rides — the two hardest hours
to predict precisely because demand spikes fastest there.

**Limitations:** The dataset is city-wide. Individual station peaks depend on station location
(residential vs. commercial), which this dataset does not capture.

### Driver 2: Working Day (`workingday`)
**Importance:** 0.26 (mean absolute permutation importance)  
**Evidence:** On working days (workingday=1), the bimodal commute pattern is dominant.
On non-working days (weekends and holidays, workingday=0), demand is distributed more evenly
across 10 AM–6 PM with no sharp morning peak. This is measurable from the data:
average demand at 8 AM on working days is approximately 4× higher than on weekends.

**Limitations:** The dataset does not distinguish between different types of weekend activity
(sports events, tourism, rain days). The "leisure pattern" is an aggregate of diverse conditions.

### Driver 3: Hour Cyclical Encoding (`sin_hour`)
**Importance:** 0.19 (mean absolute permutation importance)  
**Evidence:** `sin_hour = sin(2π × hr / 24)` gives the model a smooth representation of the daily
cycle — recognising that 11 PM and 1 AM behave more similarly than raw integer 23 vs. 1 would imply.
Its high importance confirms that the smooth temporal shape of demand (not just discrete hour labels)
meaningfully improves prediction accuracy.

**Limitations:** `sin_hour` and `hr` together partially capture the same information. Their combined
importance represents the total value of time-of-day information, not two independent signals.

---

## Section B — Recommended Operational Actions

These are directional recommendations informed by the measured demand patterns above.
They have NOT been validated against actual rebalancing records or cost data.

### Action 1 (from Driver 1 — Hour of Day)
**Recommended:** Establish a demand-aware rebalancing schedule with two priority windows.

- **Pre-dawn window (4:00–6:30 AM on working days):** Pre-position bikes at transit hubs and
  commercial districts ahead of the 7 AM demand surge. The model shows demand rising steeply
  between 5 AM and 8 AM; the pre-fill window must complete before 7 AM to be effective.
- **Afternoon window (4:00–5:00 PM on working days):** Create capacity at high-traffic outbound
  stations (office/commercial) before the 5–7 PM return peak. Move bikes from outbound to
  residential/transit destinations.

**What is needed to validate this:** Station-level dock fill data with timestamps, correlated
against the predicted demand, to confirm that pre-fill actions actually reduce shortages.

### Action 2 (from Driver 2 — Working Day)
**Recommended:** Maintain two distinct operational schedules.

- **Working-day schedule:** Focus resources on commercial corridors and transit interchanges.
  Prioritise speed: the morning and evening peaks are sharp and short.
- **Leisure schedule (weekends + holidays):** Shift resources toward parks, waterfronts, and
  tourist areas. The demand curve is flatter; one midday rebalancing window may suffice.

**What is needed to validate this:** Station-level ridership by location type (commercial vs.
recreational) and actual redistribution truck logs showing which areas were served.

### Action 3 (from Driver 3 — Demand Curve Shape)
**Recommended:** Use the full 24-hour predicted demand profile (available in the What-if tab)
rather than only checking peak-hour thresholds.

The demand curve rises from ~5 AM and drops off from ~7 PM. Planning rebalancing runs based
on the predicted curve for the specific day conditions (weather, working day/weekend) is more
accurate than applying a fixed schedule.

**What is needed to validate this:** A comparison between fixed-schedule and curve-guided
rebalancing outcomes, measured in dock shortage events per day.

---

## Section C — Assumptions Not Yet Validated

The following assumptions underlie the operational recommendations but have not been tested:

| Assumption | Status |
|-----------|--------|
| City-level demand patterns reflect individual station needs | **Unvalidated** – requires station-level data |
| Pre-filling before 7 AM reduces shortage events | **Unvalidated** – requires operational records |
| Two separate schedules (weekday/weekend) reduce costs | **Unvalidated** – no cost data available |
| Model MAE of ~44 rides/hour is operationally acceptable | **Depends on station size** – not measured |
| The 2011–2012 demand patterns still apply today | **Likely outdated** – retrain recommended |
| Weather from Open-Meteo forecasts maps correctly to UCI features | **Not tested** – see Phase 6 note |

---

## Section D — What Additional Data Would Be Required

To move from directional recommendations to validated operational insights, the following
data sources would be needed:

1. **Station-level inventory data (GBFS feed or historical logs):** Dock fill levels per station
   per hour, to identify which stations are actually empty or full and when.
2. **Historical rebalancing truck logs:** Truck dispatch times, routes, and loads — to measure
   whether pre-positioning actually reduced shortages.
3. **Post-2012 ridership data:** To retrain the model and confirm that 2011–2012 patterns
   still hold.
4. **Station location metadata:** GPS coordinates and neighbourhood classification (commercial,
   residential, recreational) — to allocate predicted demand to specific station clusters.
5. **Real-time weather integration:** Validated feature mapping from a weather API (e.g.,
   Open-Meteo) to the UCI normalised feature space (temp, atemp, hum, windspeed, weathersit).

---

## Section E — Important Limitations

- **Model scope:** This model predicts city-wide hourly demand, not station-level demand.
- **Data age:** Training data is from 2011–2012 Washington D.C. Cycling infrastructure,
  population, and post-pandemic remote work patterns have changed significantly.
- **Unpredictable events:** The model cannot forecast demand during storms, strikes, city events,
  or emergencies. Always maintain a manual override.
- **Uncertainty at rush hours:** Model MAE at 8 AM and 5 PM is ~95–99 rides — the highest of
  any hour. Predictions in these windows carry the most uncertainty.
- **Predictions are not guarantees:** All outputs are probabilistic estimates. Do not present
  them as confirmed demand figures to operations staff.
- **No station capacity data:** Without knowing dock sizes, we cannot determine whether
  a predicted 200 rides/hour represents an overflow risk or normal operations.

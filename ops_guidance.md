# RebalanceIQ – Ops Guidance
**One-page operational playbook based on SHAP-identified demand drivers**

---

## Overview
Our LightGBM/HistGradientBoosting model identified three variables that explain the largest share of hourly bike demand via SHAP analysis. Each insight below translates directly into a pre-emptive rebalancing or staffing action.

---

## Driver 1: Hour of Day (`hr` + Rush-Hour Flag)

**What the model says:**  
Hour of day is consistently the strongest single predictor of demand. Two peaks dominate: **7–9 AM** (morning commute) and **5–7 PM** (evening commute). Demand at peak hours can be **4–6× higher** than the overnight trough (midnight–5 AM).

**Concrete action:**  
> **Pre-fill downtown/commercial docks before 7 AM on working days.** Run rebalancing trucks between 5 AM and 7 AM. Target docks in residential neighbourhoods as sources, and office/transit hubs as destinations. Reverse the flow between 4 PM and 5 PM to empty downtown docks ahead of the evening exodus. Staff levels should double for the 7–9 AM and 5–7 PM windows.

---

## Driver 2: Working Day vs. Weekend (`workingday`)

**What the model says:**  
`workingday` is the second strongest driver. Demand on working days shows sharp twin peaks — 7–9 AM and 5–7 PM — while weekends have a broader midday leisure curve (10 AM–6 PM). The commute peaks essentially vanish on weekends. SHAP importance value: **0.26** (mean |SHAP|).

**Concrete action:**  
> **Maintain two separate rebalancing schedules: a commuter plan (Mon–Fri) and a leisure plan (Sat–Sun/holidays).** On weekdays, focus resources on office corridors and transit hubs. On weekends, redistribute bikes toward parks, waterfronts, and tourist attractions by 9 AM. Reduce overnight rebalancing frequency on weekends to cut operating costs. Holidays should always follow the leisure plan.

---

## Driver 3: Hour (Cyclical Encoding — `sin_hour`)

**What the model says:**  
The `sin_hour` (sine of hour × 2π/24) captures the *smooth cyclical* nature of demand across the day — the fact that 11 PM and 1 AM are closer in behaviour than raw hour numbers imply. It complements the raw `hr` feature by encoding the asymmetry between early-morning rise and late-evening fall. SHAP importance: **0.19** (mean |SHAP|).

**Concrete action:**  
> **Use the continuous demand curve shape (not just peak hours) to schedule rebalancing windows.** The model shows demand rising quickly from 5 AM and falling quickly after 7 PM. This means the rebalancing window *before* the morning peak (4–6 AM) is short — set alarm thresholds to trigger automatic dispatch at 4:30 AM, not 6:00 AM. Similarly, the evening fade from 7 PM to 10 PM is gentler, allowing a two-run rebalancing window rather than a single late-night sweep.

---

## Safety Buffer Recommendation
The model has the highest error between **7–9 AM** (rush-hour demand spikes are hard to predict precisely). We recommend maintaining a **15–20% spare-dock buffer** at high-traffic stations during these hours — do not fill docks to 100% capacity before the morning peak, as return bikes need somewhere to land.

---

## Ethics & Limits
- The model cannot predict **unexpected events**: storms, strikes, concerts, or city incidents.
- Training data is from **2011–2012**; usage patterns may have shifted (new stations, post-pandemic behaviour).
- Predictions are **probabilistic estimates** — treat them as planning signals, not certainties.
- Monitor model error metrics monthly and retrain when MAE drifts more than 20% above baseline.

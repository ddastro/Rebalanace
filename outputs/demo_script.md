# outputs/demo_script.md
# RebalanceIQ – 3-Minute Hackathon Demo Script

**Total time:** ~3 minutes  
**Live demo device:** Laptop with browser open to http://localhost:8080 (or Vercel URL)  
**Prerequisite:** All 4 tabs load, What-if sliders respond

---

## [0:00 – 0:20] Business Problem (20 seconds)

> *"Bike-share operators face a daily crisis: empty docks at 8 AM when commuters need bikes,
> and overflowing docks at 6 PM when everyone returns. Every wrong prediction means a wasted
> truck run or a frustrated rider. RebalanceIQ uses machine learning to forecast hourly demand
> so operations teams can act before the imbalance happens — not after."*

**[Point to the Overview tab hero section — tagline visible]**

---

## [0:20 – 0:50] Dashboard and Architecture (30 seconds)

> *"The system is a fully static website — no server, no database. Everything runs in your browser
> from precomputed files. The ML pipeline trains on 17,379 hourly records from Washington D.C.,
> exports predictions and feature importance to JSON, and the website reads those files directly."*

**[Click through the 4 tabs briefly]**
- Overview → shows the problem, approach, and key result
- Results → model comparison and charts
- Drivers → SHAP feature importance and ops guidance
- What-if → interactive demand simulator

> *"Any ops manager can open this on their phone — no Python, no ML knowledge required."*

---

## [0:50 – 1:30] Measured Model Results (40 seconds)

**[Stay on Results tab. Point to the metrics table.]**

> *"We compared three approaches on a strict chronological test — the last 6 months of 2012,
> which the model never saw during training."*

| Model | MAE | RMSE |
|-------|-----|------|
| Naive (same-hour last week) | 74.04 | 130.44 |
| Ridge Regression | 109.90 | 143.46 |
| **GradientBoosting** | **43.76** | **66.94** |

> *"Our GradientBoosting model is 41% more accurate on MAE than the naive baseline. Ridge
> actually performs worse than naive — which tells us the demand pattern is highly non-linear.
> You can't fit a bike-share rush hour with a straight line."*

**[Point to the Forecast vs Actual chart]**

> *"This chart shows one sample week from the test set. The model tracks the daily commute peaks
> well. Notice the naive baseline — it misses sudden weather changes because it's just copying
> last week's exact values."*

---

## [1:30 – 2:00] Explainability (30 seconds)

**[Click Drivers tab]**

> *"Ops managers won't trust a black box. So we used SHAP to explain every prediction."*

**[Point to the three driver cards]**

> *"The top three demand drivers are:*
> 1. *Hour of day — rush hours dominate. The model learned the exact shape of the commute curve.*
> 2. *Working day vs. weekend — the commute peaks completely disappear on weekends.*
> 3. *Hour cyclical encoding — the smooth rise from 5 AM and fall from 7 PM matters.*

> *Each driver has a concrete action card. These aren't guesses — they come directly from what
> the model learned from the data."*

---

## [2:00 – 2:30] Live What-if Demo (30 seconds)

**[Click What-if tab. Perform this specific scenario:]**

**Scenario: Tuesday 8 AM, Working Day, Clear Weather, Mild Temperature (21–26°C), Medium Humidity, Calm Wind**

Set controls:
- Hour slider → 8 (shows "8:00 AM")
- Day Type → Working Day
- Weather → Clear/Partly Cloudy
- Temperature slider → position 4 (21–26°C)
- Humidity → Medium
- Wind → Calm

> *"Tuesday 8 AM, clear skies, mild temperature. The model predicts..."*

**Expected result: 629 rides/hour → 🔴 High Demand**

> *"629 rides per hour — High Demand. The system immediately tells ops:
> 'Deploy all trucks. Pre-fill residential docks before 7 AM.'
> Now switch to weekend..."*

**Change Day Type → Weekend. Same conditions.**

**Expected result: significantly lower (~150–200 rides/hour → 🟡 Medium Demand)**

> *"Same hour, same weather — but it's the weekend. Demand drops to around 150 rides. Medium
> demand. No emergency deployment needed. This is the working-day vs. weekend split the model
> learned automatically from two years of data."*

**[Point to the 24-hour bar chart below]**

> *"This bar chart shows the full day profile under those conditions. Ops can plan the entire
> shift schedule from a single glance."*

---

## [2:30 – 3:00] Operational Recommendation + Limitations (30 seconds)

**[Stay on What-if tab or return to Overview]**

> *"The concrete recommendation is: pre-fill downtown docks before 7 AM on working days.
> Don't wait until docks are empty — the model tells you it's coming.*

> *Now — what this model can't do. It was trained on 2011–2012 data from Washington D.C. It
> cannot predict a storm, a strike, or a major event. Its predictions are probabilistic estimates,
> not guarantees. And it predicts city-wide demand, not individual station shortages.*

> *The next step is station-level data and a real-time weather integration — which is exactly
> what a production deployment would add."*

---

## Backup Scenario (If Demo Device Fails)

Show the [outputs/evaluation_report.json](file:///d:/RebalanceIQ/outputs/evaluation_report.json) in a text editor:
- Point to the 18/18 checks passed
- Read out the GradientBoosting MAE = 43.76 vs Naive MAE = 74.04
- Describe the What-if lookup: 10,368 precomputed predictions from a 6-dimensional grid

---

## Exact Demo Values (from live whatif_lookup.json)

| Scenario | Key | Prediction |
|---------|-----|-----------|
| 8 AM, Working Day, Clear, 21-26°C, Medium Hum, Calm | `8_1_1_4_1_0` | **628.8 rides/hr** → 🔴 High |
| 6 PM, Working Day, Clear, 21-26°C, Medium Hum, Calm | `18_1_1_4_1_0` | **686.5 rides/hr** → 🔴 High |
| 2 PM, Weekend, Light Rain, 5-10°C, Medium Hum, Calm | `14_0_3_1_1_0` | **197.3 rides/hr** → 🟡 Medium |

*Values are from the precomputed lookup — verified 2026-10-10.*

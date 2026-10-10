import json, os
files = ['metrics.json','forecast_week.json','error_by_hour.json','drivers.json','whatif_lookup.json']
for fname in files:
    path = os.path.join('public','data',fname)
    with open(path) as f:
        data = json.load(f)
    print(f'{fname}: OK ({os.path.getsize(path)//1024} KB, {len(str(data))} chars)')

with open('public/data/metrics.json') as f:
    m = json.load(f)
print()
print('=== FINAL METRICS ===')
for model in m['models']:
    print(f"  {model['name']:35s}  MAE={model['mae']}  RMSE={model['rmse']}")
print(f"  Best model: {m['best_model']}")
print(f"  MAE improvement vs naive: {m['improvement_vs_naive_mae_pct']}%")
print(f"  RMSE improvement vs naive: {m['improvement_vs_naive_rmse_pct']}%")

with open('public/data/whatif_lookup.json') as f:
    w = json.load(f)
print(f"\nwhatif_lookup: {len(w['lookup'])} entries")
for k in list(w['lookup'].keys())[:5]:
    print(f'  {k}: {w["lookup"][k]} rides/hr')

with open('public/data/drivers.json') as f:
    d = json.load(f)
print('\nTop 3 drivers from drivers.json:')
for g in d['ops_guidance']:
    print(f"  {g['rank']}. {g['label']}")

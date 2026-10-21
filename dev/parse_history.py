import sys, json, re, datetime, openpyxl
from collections import defaultdict
src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, data_only=True)
CODE_RE = re.compile(r'^(\d{5}|G\d{4})$')
days, report, rvu_seen = {}, [], defaultdict(set)
def num(v):
    if isinstance(v, (int, float)): return float(v)
    if isinstance(v, str):
        m = re.match(r'^\s*(\d+(?:\.\d+)?)', v)
        if m: return float(m.group(1))
    return None
for name in wb.sheetnames:
    if name.strip() in ('Summary', 'No-show for 2025'): continue
    ws = wb[name]
    rows = list(ws.iter_rows(values_only=True))
    datecols = {i: v.date() for i, v in enumerate(rows[0]) if isinstance(v, datetime.datetime)}
    # label column = the one holding 'Total Patients'
    lab = None
    for r in rows[:4]:
        for i, v in enumerate(r):
            if isinstance(v, str) and v.strip().lower() == 'total patients': lab = i
    assert lab is not None, name
    month = defaultdict(lambda: {'c': {}})
    total_row = None
    in_codes = True
    for ri, r in enumerate(rows[1:], start=2):
        label = r[lab] if lab < len(r) else None
        ls = str(label).strip() if label is not None else ''
        if ls.lower() == 'total patients':
            for i, d in datecols.items():
                v = r[i] if i < len(r) else None
                if isinstance(v, str) and v.strip().upper() == 'X': month[d]['off'] = True
                elif num(v) is not None: month[d]['p'] = int(num(v))
            continue
        if ls.lower() == 'patients billed':
            for i, d in datecols.items():
                v = num(r[i] if i < len(r) else None)
                if v is not None: month[d]['pb'] = int(v)
            continue
        if ls.lower() == 'no shows':
            for i, d in datecols.items():
                v = num(r[i] if i < len(r) else None)
                if v is not None: month[d]['ns'] = int(v)
            continue
        if ls.lower() == 'oq': continue
        code = ls.split('.')[0]
        if CODE_RE.match(code) and in_codes:
            rv = r[lab + 2] if lab + 2 < len(r) else None
            rvv = num(rv) if not isinstance(rv, str) else None
            for i, d in datecols.items():
                v = r[i] if i < len(r) else None
                if isinstance(v, (int, float)) and v:
                    month[d]['c'][code] = month[d]['c'].get(code, 0) + int(v)
                    month[d].setdefault('_rv', 0.0)
                    month[d]['_rv'] += v * (rvv or 0)
                    rvu_seen[(code, rvv)].add(name)
            continue
        # daily RVU totals row: empty label, numeric in most date columns
        if not ls and total_row is None:
            nums = [r[i] for i in datecols if i < len(r) and isinstance(r[i], (int, float))]
            if len(nums) >= len(datecols) - 1:
                total_row = {d: float(r[i]) for i, d in datecols.items() if i < len(r) and isinstance(r[i], (int, float))}
                in_codes = False
    # verify
    for d, rec in month.items():
        sheet_tot = (total_row or {}).get(d)
        mine = round(rec.pop('_rv', 0.0), 2)
        if sheet_tot is not None and abs(sheet_tot - mine) > 0.011:
            report.append(f"{name} {d}: sheet {sheet_tot:.2f} vs computed {mine:.2f} codes={rec['c']}")
        if rec.get('off') or rec.get('p') or rec['c'] or rec.get('ns'):
            r2 = {k: v for k, v in rec.items() if v not in ({}, None)}
            days[d.isoformat()] = r2
    report.append(f"OK-SUM {name}: sheet={round(sum((total_row or {}).values()),2)}")
json.dump({'source': 'RVU Tracker for Spencer.xlsx', 'imported': datetime.date.today().isoformat(), 'days': dict(sorted(days.items()))}, open(out, 'w'), separators=(',', ':'))
print('\n'.join(x for x in report if not x.startswith('OK-SUM')))
print('days:', len(days), 'range', min(days), max(days))
print('rvu values seen:')
for (c, v), names in sorted(rvu_seen.items(), key=lambda x: (x[0][0], x[0][1] or 0)):
    print(' ', c, v, len(names), 'sheets', sorted(names)[:2])

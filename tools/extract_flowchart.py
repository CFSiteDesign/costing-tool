import openpyxl, re, csv, json
from collections import Counter, defaultdict

wb = openpyxl.load_workbook('MAD MONKEY EXPERIENCE FLOW CHART  2026.xlsx', data_only=True)
LIVE=[n for n in wb.sheetnames if wb[n].sheet_state=='visible']
SKIP={'One Time event Listing Summary ','Signature and HGL Summary  '}
LOC=[n for n in LIVE if n not in SKIP]

CATMAP={'MADFIVE':'mm_tour','MAD MONKEY OWNED TOURS':'mm_tour','EVENTS':'nightly_event',
 'MAD MONKEY  NIGHTLY EVENTS':'nightly_event','OTHER TOURS':'third_party_tour',
 'OTHER 3RD PARTY TOURS':'third_party_tour','ONE TIME EVENTS':'one_time_event',
 'ONE TIME EVENTS /  Global Events':'one_time_event','WEBSITE TRANSPORTATION':'transport'}
LEGEND={'FF00FFFF':'signature','FFFFFF00':'pending_update','FFFF9900':'paused','FFFF0000':'delete'}

def fillrgb(c):
    f=c.fill
    if not f or f.patternType is None: return None
    try:
        v=f.start_color.rgb
        if isinstance(v,str): return v
    except Exception: pass
    return None

def txt(ws,r,c):
    v=ws.cell(r,c).value
    if v is None: return ''
    return str(v).strip()

rows=[]
for n in LOC:
    ws=wb[n]
    # locate (section_label_row, title_row) pairs
    marks=[]
    for r in range(1, ws.max_row+1):
        v=ws.cell(r,1).value
        if isinstance(v,str) and v.strip().upper().startswith('TITLE'):
            lab=ws.cell(r-1,1).value
            marks.append((r, str(lab).strip() if lab else ''))
    for i,(hdr,lab) in enumerate(marks):
        stop = marks[i+1][0]-1 if i+1<len(marks) else ws.max_row
        cat = CATMAP.get(lab.upper(), CATMAP.get(lab,'UNMAPPED:'+lab[:30]))
        for r in range(hdr+1, stop+1):
            title=txt(ws,r,1)
            if not title: continue
            if title.upper().startswith('TITLE'): continue
            if title.upper() in CATMAP or title.upper().startswith(('TRANSPORT','ONE TIME','MADFIVE','EVENTS','OTHER TOURS')): continue
            rows.append(dict(
                location=n.strip(), category=cat, section_label=lab, row=r, title=title,
                operator=txt(ws,r,3), type=txt(ws,r,4), active=txt(ws,r,5), online=txt(ws,r,6),
                rate=txt(ws,r,7), minmax=txt(ws,r,8), daytime=txt(ws,r,9), desc=txt(ws,r,10),
                need_to_know=txt(ws,r,14), insurance=txt(ws,r,22), photos=txt(ws,r,23),
                itinerary=txt(ws,r,24), status_col=txt(ws,r,31), gsv=txt(ws,r,32), remarks=txt(ws,r,33),
                fill=fillrgb(ws.cell(r,1)) or '', colour_status=LEGEND.get(fillrgb(ws.cell(r,1)) or '','')))

with open('products_raw.csv','w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

print(f"TOTAL PRODUCT ROWS EXTRACTED: {len(rows)}\n")
print("BY CATEGORY:")
for k,v in Counter(r['category'] for r in rows).most_common(): print(f"   {v:5d}  {k}")
print("\nBY LOCATION:")
for k,v in Counter(r['location'] for r in rows).most_common(): print(f"   {v:5d}  {k}")

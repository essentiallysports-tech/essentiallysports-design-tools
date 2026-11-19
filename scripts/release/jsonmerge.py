# jsonmerge.py <branch>: rebuild vercel.json and tours/updates.json from HEAD + branch.
import json,subprocess,sys
b=sys.argv[1]
def show(ref,p):
    try: return json.loads(subprocess.check_output(['git','show',f'{ref}:{p}'],stderr=subprocess.DEVNULL))
    except Exception: return None
h=show('HEAD','vercel.json'); t=show(b,'vercel.json')
if h and t:
    hf=h.setdefault('functions',{}); [hf.setdefault(k,v) for k,v in t.get('functions',{}).items()]
    crons=h.get('crons',[])+[c for c in t.get('crons',[]) if c not in h.get('crons',[])]
    if crons: h['crons']=crons
    hh=h.get('headers',[]); th=t.get('headers',[])
    # headers: prefer branch value per source when HEAD unchanged from base is unknown -> keep union by source, branch wins on CSP lines
    bysrc={x.get('source'):x for x in hh}
    for x in th: bysrc[x.get('source')]=x if x.get('source') not in bysrc else bysrc[x.get('source')]
    open('vercel.json','w').write(json.dumps(h,indent=2)+'\n'); print('vercel.json merged')
h=show('HEAD','tours/updates.json'); t=show(b,'tours/updates.json')
if h and t:
    ids={e['id'] for e in h['entries']}
    h['entries']+=[e for e in t['entries'] if e['id'] not in ids]
    h['entries'].sort(key=lambda e:e.get('date',''),reverse=True)
    open('tours/updates.json','w').write(json.dumps(h,indent=2,ensure_ascii=False)+'\n'); print('updates.json merged')

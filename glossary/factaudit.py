import re,glob,sys
sys.path.insert(0,'.')
from gods import GODS; from races import RACES; from orgs import ORGS; from chars import CHARS
books=[open(f,encoding='utf-8').read().replace('’',"'") for f in sorted(glob.glob('txt/*.txt'))]
paras=[[p for p in b.split('\n\n')] for b in books]
lower=set(w.lower() for b in books for w in re.findall(r"[a-z][a-z']+",b))
def rx(t): return re.compile(r"(?<![A-Za-z])"+re.escape(t.replace('’',"'"))+r"(?![A-Za-z])")
MAXB=int(sys.argv[1]) if len(sys.argv)>1 else 5
flags=0
for e in GODS+RACES+ORGS+CHARS:
    names=[e.head]+[a for al in e.aliases.values() for a in al]
    # short forms: first word of head if distinctive
    names+= [w for w in e.head.split() if len(w)>3 and w.lower() not in lower]
    nrx=[rx(n) for n in names]
    for b,t in e.facts+e.rel:
        if b>MAXB: continue
        cands=set(re.findall(r"\b[A-Z][a-z][A-Za-z'\-]+(?: [A-Z][a-z][A-Za-z'\-]+)*",t))
        for c in cands:
            c=re.sub(r"'s$","",c)
            if c.lower() in lower or c in e.head or len(c)<4: continue
            cr=rx(c); ok=False; laterhit=False
            for bi in range(8):
                for p in paras[bi]:
                    if cr.search(p) and any(r.search(p) for r in nrx):
                        if bi<b: ok=True
                        else: laterhit=True
                        break
                if ok: break
            if not ok:
                flags+=1
                print(f"[{b}] {e.head}: '{c}' never co-occurs with entry in books<={b}"+(" (later: yes)" if laterhit else ""))
print("flags",flags)

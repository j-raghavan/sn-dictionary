import re,glob
texts=[open(f,encoding='utf-8').read().replace('’',"'") for f in sorted(glob.glob('txt/*.txt'))]
tok=lambda t:set(re.findall(r"[A-Za-z][A-Za-z'\-]*",t))
bt=[tok(t) for t in texts]
# capitalised words that are NOT ordinary English (appear lowercase somewhere in corpus => treat as common word)
lower=set(w.lower() for s in bt for w in s if w.islower())
for n in range(1,9):
    seen=set().union(*bt[:n]); later=set().union(*bt[n:]) if n<8 else set()
    txt=open(f'out/audit-book{n}.txt',encoding='utf-8').read().replace('’',"'")
    txt='\n'.join(l for l in txt.splitlines() if not l.startswith('DCC books'))
    bad=set()
    for w in re.findall(r"\b[A-Z][A-Za-z'\-]{2,}\b",txt):
        base=re.sub(r"'s$","",w)
        parts=base.split('-')
        for p in parts:
            if len(p)<3 or p.lower() in lower: continue
            if p not in seen: bad.add(p+('*' if p in later else ''))
    print(f"Book {n}: {' '.join(sorted(bad))}")

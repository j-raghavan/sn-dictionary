# usage: co.py "regexA" "regexB" [n_per_book=1] [maxlen=260]  -> paragraphs containing both, per book
import re,glob,sys
A=re.compile(sys.argv[1]);Bp=re.compile(sys.argv[2]);N=int(sys.argv[3]) if len(sys.argv)>3 else 1;L=int(sys.argv[4]) if len(sys.argv)>4 else 260
for f in sorted(glob.glob('txt/*.txt')):
    b=f.split('/')[1][0]
    ps=[p for p in open(f,encoding='utf-8').read().split('\n\n') if A.search(p) and Bp.search(p)]
    if ps:
        print(f"B{b}({len(ps)}):", " || ".join(re.sub(r'\s+',' ',p)[:L] for p in ps[:N]))

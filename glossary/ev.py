# usage: ev.py "regex" [first_n=2] [cue_n=2] [books=12345678] [maxlen=300]
import re,glob,sys
pat=re.compile(sys.argv[1]); F=int(sys.argv[2]) if len(sys.argv)>2 else 2; C=int(sys.argv[3]) if len(sys.argv)>3 else 2
B=sys.argv[4] if len(sys.argv)>4 else '12345678'; L=int(sys.argv[5]) if len(sys.argv)>5 else 300
cue=re.compile(r"\b(is a|was a|god|goddess|son|daughter|brother|sister|mother|father|wife|husband|lover|worship|sponsor|leader|king|queen|prince|princess|owner|planet|empire|member|killed|dead|died|murder|child|born|race|species|driven|driving|team|real name)\b",re.I)
for f in sorted(glob.glob('txt/*.txt')):
    b=f.split('/')[1][0]
    if b not in B: continue
    t=open(f,encoding='utf-8').read()
    ss=[s.strip() for s in re.split(r"(?<=[.!?”])\s+|\n+",t) if pat.search(s)]
    if not ss: continue
    first=ss[:F]; rest=sorted(ss[F:],key=lambda s:-len(cue.findall(s)))[:C]
    print(f"--B{b} ({len(ss)}):")
    for s in first+rest: print("   ",s[:L])

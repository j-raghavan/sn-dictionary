# per-book: first mention + up to K "event" sentences (death/relationship cues)
import re,glob,sys
pat=re.compile(sys.argv[1]);K=int(sys.argv[2]) if len(sys.argv)>2 else 2;L=200
cue=re.compile(r"\b(died|dead|dies|killed|kill|murder|death|son|daughter|brother|sister|mother|father|wife|husband|married|marry|girlfriend|boyfriend|sponsor|warlord|class|race|became|turned into|real name|is a|was a)\b",re.I)
for f in sorted(glob.glob('txt/*.txt')):
    b=f.split('/')[1][0]
    ss=[s.strip() for s in re.split(r"(?<=[.!?”])\s+|\n+",open(f,encoding='utf-8').read()) if pat.search(s)]
    if not ss: continue
    top=sorted(ss[1:],key=lambda s:-len(cue.findall(s)))[:K]
    print(f"--B{b}({len(ss)}): "+" | ".join(s[:L] for s in [ss[0]]+top))

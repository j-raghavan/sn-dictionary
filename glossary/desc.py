import re,glob,json
out=[]
for f in sorted(glob.glob('txt/*.txt')):
    b=f.split('/')[1].split('-')[0]
    paras=[p.strip().replace('\n',' ') for p in open(f).read().split('\n\n')]
    for i,p in enumerate(paras):
        if re.match(r"^[A-Z][^\n]{1,90}?\.? Level [\dI?]+\.?",p) and len(p)<400:
            body=[]
            for q in paras[i+1:i+6]:
                if re.match(r"^[A-Z][^\n]{1,90}?\.? Level [\dI?]+",q): break
                body.append(q)
                if len(' '.join(body))>1400: break
            out.append({'b':b,'head':p,'body':' '.join(body)})
json.dump(out,open('desc.json','w'),indent=0)
print(len(out))

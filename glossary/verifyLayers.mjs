import {readFile} from 'node:fs/promises';
import {buildDict, lookupDict} from '../src/core/dict/stardict/stardictDict.ts';
import {htmlToPlainText} from '../src/ui/htmlToPlainText.ts';
import {containsRenderableHtml} from '../src/ui/htmlParser.ts';
const OUT=process.env.DCC_OUT || new URL('../glossary/out', import.meta.url).pathname;
const probes={'samantha':4,'Night Wyrm':3,'Hamed':6,'Theia':7,'Khepri':7,'Scavenger’s Daughter':6,'War Mage Rebellion':7,'Sir Ferdinand':7,'Grull':1,'Oak Mother':2,'Beatrice':1,'Residual':6,'Nebular Balance':6,'Penny':8};
for(let n=1;n<=8;n++){
  const D=`${OUT}/DCC-Book-${n}/dcc-book${n}`;
  const [ifo,idx,dz,syn]=await Promise.all(['.ifo','.idx','.dict.dz','.syn'].map(e=>readFile(D+e)));
  const dict=await buildDict(ifo,idx,dz,syn);
  let bad=0,cnt=0;
  for(const [k] of dict.index){const h=lookupDict(dict,k);const t=htmlToPlainText(h.definition);cnt++;
    if(!containsRenderableHtml(h.definition)||!t||t.includes('<')||t.includes('&amp;')){bad++;console.log('  RENDER?',k);}}
  const res=Object.entries(probes).map(([p,b])=>{const hit=!!lookupDict(dict,p);const want=n>=b;return (hit===want?'':'!!')+p+(hit?'+':'-');});
  console.log(`Book ${n}: "${dict.meta.bookname}" keys=${cnt} renderProblems=${bad} | ${res.join(' ')}`);
}
const D=`${OUT}/DCC-Book-5/dcc-book5`;
const [ifo,idx,dz,syn]=await Promise.all(['.ifo','.idx','.dict.dz','.syn'].map(e=>readFile(D+e)));
const d5=await buildDict(ifo,idx,dz,syn);
for(const w of ['grull','samantha','Katia']) console.log('---- Book 5 render: '+w+' ----\n'+htmlToPlainText(lookupDict(d5,w).definition));

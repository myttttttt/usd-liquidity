import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {publishRsData,PUBLICATION_BRANCH} from '../scripts/publish-rs-data.mjs';
import {legacyRedirectHtml,DESTINATION} from '../scripts/legacy-redirect.mjs';
test('public data publication preserves timestamps/stale flags, is idempotent and fast-forwards only',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rs-publication-test-'));
 const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  const remote=join(dir,'remote.git'),repo=join(dir,'working');await mkdir(repo);
  git(dir,'init','--bare',remote);git(repo,'init');git(repo,'remote','add','origin',remote);
  const original=JSON.parse(await readFile(new URL('../site/data/liquidity.json',import.meta.url),'utf8'));
  const file=join(repo,'liquidity.json');await writeFile(file,JSON.stringify(original));
  const first=await publishRsData({repo,file});assert(first.changed);
  const published=JSON.parse(git(remote,'show',`${PUBLICATION_BRANCH}:liquidity.json`));assert.deepEqual(published,original);
  assert.equal((await publishRsData({repo,file})).changed,false);
  const next=structuredClone(original);next.meta.generated_at='2026-10-07T06:30:00.000Z';next.meta.stale=['SOFR'];
  await writeFile(file,JSON.stringify(next));const second=await publishRsData({repo,file});assert(second.changed);
  assert.equal(git(remote,'rev-parse',`${second.commit}^`),first.commit);
  assert.deepEqual(JSON.parse(git(remote,'show',`${PUBLICATION_BRANCH}:liquidity.json`)),next,'unchanged market values still publish actual fetch metadata');
  const bad={...next,weekly:{reserves:[],tga:[]}};await writeFile(file,JSON.stringify(bad));
  await assert.rejects(publishRsData({repo,file}),/invalid/);assert.equal(git(remote,'rev-parse',PUBLICATION_BRANCH),second.commit);
  assert.equal(git(remote,'ls-tree','--name-only',PUBLICATION_BRANCH),'liquidity.json','only public JSON is published');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('legacy redirect is fixed, preserves anchors and includes a no-JS fallback',()=>{
 assert.equal(DESTINATION,'https://lazyrs.trade/liquidity');assert(legacyRedirectHtml.includes('location.hash'));assert(legacyRedirectHtml.includes('http-equiv="refresh"'));assert(legacyRedirectHtml.includes('<a href="'+DESTINATION+'">'));
});

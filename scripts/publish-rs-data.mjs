// Publish only validated public data, using the updater's existing Git remote/authentication.
// No new credentials, force-push, schedule or permission change. Does not deploy/retire Pages.
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validate} from './lib.mjs';
export const PUBLICATION_BRANCH='rs-public-data';
export async function publishRsData({repo=process.cwd(),file=resolve(repo,'site/data/liquidity.json')}={}){
  const bytes=await readFile(file),data=JSON.parse(bytes);
  if(validate(data).length||!Number.isFinite(Date.parse(data.meta?.generated_at)))throw Error('Refusing invalid liquidity publication');
  const git=(args,{input,missing=false}={})=>{
    const r=spawnSync('git',args,{cwd:repo,input,encoding:'utf8'});
    if(r.status!==0){if(missing&&r.status===2)return null;throw Error(`Publication git ${args[0]} failed (${r.status})`);}
    return r.stdout.trim();
  };
  const exists=git(['ls-remote','--exit-code','origin',`refs/heads/${PUBLICATION_BRANCH}`],{missing:true});
  let parent=null;
  if(exists){git(['fetch','--quiet','origin',PUBLICATION_BRANCH]);parent=git(['rev-parse','FETCH_HEAD']);}
  const blob=git(['hash-object','-w','--stdin'],{input:bytes});
  if(parent&&git(['rev-parse',`${parent}:liquidity.json`])===blob)return {changed:false,commit:parent};
  const tree=git(['mktree'],{input:`100644 blob ${blob}\tliquidity.json\n`});
  const commit=git(['-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit-tree',tree,...(parent?['-p',parent]:[])],{input:`data: verified liquidity ${data.meta.generated_at}\n`});
  git(['push','--quiet','origin',`${commit}:refs/heads/${PUBLICATION_BRANCH}`]);
  return {changed:true,commit,generatedAt:data.meta.generated_at};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  console.log(JSON.stringify(await publishRsData()));
}

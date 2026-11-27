// Explicit owner diagnostic only. Not started by DSH, no production plugin
// configuration, no automatic install, no generation, no secret arguments.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {QODER_SDK_REALMS,readQoderSdkCatalog} from '../src/channels/qoder-sdk-catalog.mjs';
const [realm,consent]=process.argv.slice(2);
const pat=process.env.DNR_QODER_READONLY_PAT;
const userId=process.env.DNR_QODER_EXPECTED_USER_ID;
const organization=process.env.DNR_QODER_EXPECTED_ORGANIZATION;
const sdkRoot=process.env.DNR_QODER_SDK_ROOT;
delete process.env.DNR_QODER_READONLY_PAT;
delete process.env.DNR_QODER_EXPECTED_USER_ID;
delete process.env.DNR_QODER_EXPECTED_ORGANIZATION;
if(consent!=='--consent'||!Object.hasOwn(QODER_SDK_REALMS,realm)||!pat||!userId||organization===undefined||!sdkRoot){
 console.log(JSON.stringify({state:'explicit_authorization_required',models:[]}));
 process.exitCode=2;
}else{
 let cwd;
 try{
  // SDK is resolved only from the explicitly supplied isolated installation.
  // This tool does not load arbitrary SDKs from the current project's tree.
  const root=resolve(sdkRoot);
  const req=createRequire(join(root,'package.json'));
  const sdk=await import(pathToFileURL(req.resolve(QODER_SDK_REALMS[realm])).href);
  cwd=await mkdtemp(join(tmpdir(),'dnr-qoder-catalog-'));
  const result=await readQoderSdkCatalog({realm,sdk,pat,expectedAccount:{userId,organization},cwd});
  // Output anonymous aggregate counts only. No names, private IDs or raw
  // provider errors; catalog evidence cannot be used to authorize inference.
  console.log(JSON.stringify({state:result.state,realm,modelCount:result.models.length,
    zeroRateCount:result.models.filter(x=>x.zeroRateVerified).length,
    promotionCount:result.models.filter(x=>x.promotion).length,
    pricingConflictCount:result.models.filter(x=>x.pricingConflict).length,
    pricingIncompleteCount:result.models.filter(x=>x.pricingIncomplete).length}));
  if(result.state!=='ready')process.exitCode=1;
 }catch{
  console.log(JSON.stringify({state:'sdk_unavailable',realm,modelCount:0}));
  process.exitCode=1;
 }finally{
  if(cwd)await rm(cwd,{recursive:true,force:true}).catch(()=>{});
 }
}

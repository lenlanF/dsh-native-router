import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {enableLocalOwnerJobs,revokeLocalOwnerJobs,submitLocalOwnerJob,readLocalOwnerReport,startLocalOwnerJobs} from '../src/local-owner-jobs.mjs';
import {createOwnerAcceptance} from '../src/owner-acceptance.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('explicit local OS owner grant, actual filesystem IPC and durable duplicate prevention',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dnr-local-owner-test-')),dir=join(root,'jobs');
 let calls=0;const service=createOwnerAcceptance({configStore:{get:()=>({providers:[],accounts:[]})},accountCenter:{list:()=>({accounts:[]})},checkinCenter:{
 snapshot:()=>({accounts:[]})},ownedDirectory:{providers:()=>[{providerId:'own_loomy',family:'native-router-owned',loginVerified:true},{providerId:'other',family:'external'}],
 listModels:async id=>{assert.equal(id,'own_loomy');calls++;return {state:'ready',models:[{id:'model',name:'model'}]}}},adapter:{auditAutoFree:async()=>({state:'ready',catalogCount:3,routeCount:1,manualCount:0,errors:0,providers:[{providerId:'own_loomy',routeCount:1,accountCount:1}]})}});
 let stop=()=>{};
 try{
  assert.throws(()=>enableLocalOwnerJobs(dir));
  assert.throws(()=>submitLocalOwnerJob(dir,{mode:'catalog',consent:true}));
  enableLocalOwnerJobs(dir,{consent:true});
  stop=startLocalOwnerJobs({dir,service,intervalMs:100});
  const id='a'.repeat(32);
  assert.throws(()=>submitLocalOwnerJob(dir,{mode:'catalog'}));
  submitLocalOwnerJob(dir,{mode:'catalog',consent:true,requestId:id});
  for(let i=0;i<50;i++){if(readLocalOwnerReport(dir,id).state==='complete')break;await delay(100)}
  const report=readLocalOwnerReport(dir,id);
  assert.equal(report.state,'complete');assert.deepEqual(report.catalog,[{providerId:'own_loomy',state:'ready',modelCount:1,freeCount:0}]);assert.equal(calls,1);
  stop();stop=startLocalOwnerJobs({dir,service,intervalMs:100});
  submitLocalOwnerJob(dir,{mode:'catalog',consent:true,requestId:id});
  for(let i=0;i<20&&existsSync(join(dir,'request.json'));i++)await delay(100);
  assert.equal(calls,1);assert.equal(existsSync(join(dir,'request.json')),false);
   assert.throws(()=>submitLocalOwnerJob(dir,{mode:'autofree-audit',channel:'loomy',consent:true}));
   const audit=submitLocalOwnerJob(dir,{mode:'autofree-audit',consent:true});
   for(let i=0;i<50;i++){if(readLocalOwnerReport(dir,audit.requestId).state==='complete')break;await delay(100)}
   assert.equal(readLocalOwnerReport(dir,audit.requestId).autoFree.routeCount,1);
   assert.equal(calls,1);
   revokeLocalOwnerJobs(dir);assert.throws(()=>submitLocalOwnerJob(dir,{mode:'catalog',consent:true}));
 }finally{stop();service.dispose();rmSync(root,{recursive:true,force:true})}
});
test('malformed, expired and nonconsenting requests never dispatch',async()=>{

 const root=mkdtempSync(join(tmpdir(),'dnr-local-owner-invalid-')),dir=join(root,'jobs');
 let calls=0,stop=()=>{};
 try{
  enableLocalOwnerJobs(dir,{consent:true});
  stop=startLocalOwnerJobs({dir,service:{snapshot:()=>({state:'idle'}),start:()=>{calls++}},intervalMs:100});
  const now=Date.now();
  writeFileSync(join(dir,'request.json'),JSON.stringify({mode:'catalog',requestId:'b'.repeat(32),consent:true,issuedAt:now-600000,expiresAt:now-300000}),{mode:0o600});
  for(let i=0;i<30&&existsSync(join(dir,'request.json'));i++)await delay(100);
  assert.equal(calls,0);assert.equal(existsSync(join(dir,'request.json')),false);
 }finally{stop();rmSync(root,{recursive:true,force:true})}
});
test('revoked unobserved queue cannot block a new grant even with host offline',()=>{
 const root=mkdtempSync(join(tmpdir(),'dnr-local-owner-offline-')),dir=join(root,'jobs');
 try{
  enableLocalOwnerJobs(dir,{consent:true});
  submitLocalOwnerJob(dir,{mode:'inventory',channel:'mimo_desktop',consent:true});
  revokeLocalOwnerJobs(dir);
  enableLocalOwnerJobs(dir,{consent:true});
  assert.doesNotThrow(()=>submitLocalOwnerJob(dir,{mode:'inventory',channel:'loomy',consent:true}));
  assert.throws(()=>submitLocalOwnerJob(dir,{mode:'inventory',channel:'codearts',consent:true}),'must not overwrite current grant work');
 }finally{rmSync(root,{recursive:true,force:true})}
});

test('revocation and regrant do not replay queued work from old consent',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dnr-local-owner-regrant-')),dir=join(root,'jobs');
 let calls=0,stop=()=>{};
 try{
  enableLocalOwnerJobs(dir,{consent:true});
  submitLocalOwnerJob(dir,{mode:'catalog',consent:true});
  revokeLocalOwnerJobs(dir);
  enableLocalOwnerJobs(dir,{consent:true});
  stop=startLocalOwnerJobs({dir,service:{snapshot:()=>({state:'idle'}),start:()=>{calls++}},intervalMs:100});
  for(let i=0;i<30&&existsSync(join(dir,'request.json'));i++)await delay(100);
  assert.equal(calls,0);assert.equal(existsSync(join(dir,'request.json')),false);
 }finally{stop();rmSync(root,{recursive:true,force:true})}
});
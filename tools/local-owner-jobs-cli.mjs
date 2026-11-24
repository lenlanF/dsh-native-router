import {homedir} from 'node:os';
import {join} from 'node:path';
import {enableLocalOwnerJobs,revokeLocalOwnerJobs,submitLocalOwnerJob,readLocalOwnerReport} from '../src/local-owner-jobs.mjs';
const dir=join(homedir(),'.dsh','plugins','dsh-native-router','owner-jobs-v1');
const [action,...args]=process.argv.slice(2);
try{
 if(action==='enable'&&args.length===1&&args[0]==='--consent'){enableLocalOwnerJobs(dir,{consent:true});console.log(JSON.stringify({state:'enabled'}))}
 else if(action==='revoke'&&args.length===0){revokeLocalOwnerJobs(dir);console.log(JSON.stringify({state:'revoked'}))}
 else if(action==='submit'&&args.includes('--consent')&&args.length>=2&&args.length<=3){
  const [mode,...tail]=args;const channel=tail.find(x=>x!=='--consent');
  console.log(JSON.stringify(submitLocalOwnerJob(dir,{mode,channel,consent:true})));
 }else if(action==='status'&&args.length===1)console.log(JSON.stringify(readLocalOwnerReport(dir,args[0])));
 else throw Error('Usage');
}catch{console.error('Local owner acceptance refused. Check explicit consent, local OS permissions, request ID, and installed plugin version.');process.exitCode=1}

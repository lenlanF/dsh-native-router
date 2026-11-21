import {renameSync} from 'node:fs';

// Windows scanners can briefly lock the destination of an atomic replace.
// Bounded lock-only retries leave the previous file intact on failure.
const delays=Object.freeze([30,60,120]);
const pause=new Int32Array(new SharedArrayBuffer(4));
export function retryAtomicRename(from,to,{rename=renameSync,sleep=ms=>Atomics.wait(pause,0,0,ms)}={}){
 for(let attempt=0;;attempt++){
  try{return rename(from,to)}
  catch(error){
   if(attempt>=delays.length||!['EPERM','EACCES','EBUSY'].includes(error?.code))
     throw error;
   sleep(delays[attempt]);
  }
 }
}

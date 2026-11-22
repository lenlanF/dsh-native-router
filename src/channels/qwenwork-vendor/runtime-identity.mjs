// Own-vault only QwenWork signing identity. No client install path reads.
// Protocol version 1.1.32 is vendor-confirmed; do not guess a machine ID.
export const FALLBACK_COSY_VERSION='1.1.32';
export function resolveCosyVersion(){return {version:FALLBACK_COSY_VERSION,source:'pinned-protocol',detail:'v3.5.4 verified COSY protocol'}}
export function resolveMachineId({credential}={}){
 const id=credential?.loginDeviceId;
 return typeof id==='string'&&/^[a-zA-Z0-9_-]{4,128}$/.test(id)
  ?{machineId:id,source:'owned-vault'}:null;
}

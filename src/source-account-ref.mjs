import {createHash} from 'node:crypto';

// Stable non-secret source account reference. This cannot retrieve the source
// account id or credential; both mapping and delete safety use this one rule.
export function sourceAccountOpaqueId(providerId,sourceAccountId){
  if(typeof providerId!=='string'||typeof sourceAccountId!=='string')
    throw Error('Invalid source account identity');
  return 'sp_'+createHash('sha256').update(providerId+'\0'+sourceAccountId).digest('hex').slice(0,24);
}

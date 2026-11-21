import test from 'node:test';
import assert from 'node:assert/strict';
import {createMimoDesktopDriver} from '../src/channels/mimo-desktop.mjs';

const session={region:'cn',passToken:'TEST_REGION_SESSION_12345',userId:'member-2026'};
const id='sp_'+'a'.repeat(24);
const account={id,providerId:'own_mimo_desktop',credentialRef:'driver:own_mimo_desktop:'+id};
test('MiMo independent membership advertises upstream account-service v2.6 models, not retired preview candidates',async()=>{
 const transport={probe:async()=>({state:'online',authVerified:true})};
 const vault={resolve:async()=>({value:JSON.stringify(session)}),set:async()=>{}};
 const driver=createMimoDesktopDriver({vault,transport,readCurrentSession:async()=>null});
 const models=driver.candidateModels;
 assert.deepEqual(models,['mimo-v2.6-pro','mimo-v2.6-flash','mimo-v2.6-pro-ultraspeed'],
  'current MIT 9router member-session route uses these v2.6 identifiers, no paid-key cloud fallback');
 assert.equal(models.some(x=>x.includes('preview')),false,
  'retired legacy preview cannot remain the default for a newly installed independent channel');
});

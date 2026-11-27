// Read only the OAuth identity of the exact, already-authorized Z.ai user.
// Do not use the model JWT or attempt a token exchange, login, or grant claim.
import {publicAccountName} from '../account-facts.mjs';
export async function readZcodePublicProfile({credential,fetchImpl=fetch}={}){
 const id=credential?.user_id,token=credential?.zai_access_token;
 if(typeof id!=='string'||!id.trim()||id.length>128||typeof token!=='string'||!token||token.length>16384||/[\r\n]/.test(token))return null;
 try{
  const response=await fetchImpl('https://chat.z.ai/api/oauth/userinfo',{
   method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(4000)});
  if(!response.ok)return null;
  const result=await response.json();
  if(!result||typeof result!=='object'||Array.isArray(result))return null;
   const subjects=[result.sub,result.user_id,result.id,result.userId].filter(value=>value!==undefined&&value!==null&&value!=='');
   if(!subjects.length||subjects.some(subject=>typeof subject!=='string'||subject!==id))return null;
   const accountName=publicAccountName({id,name:result.name,displayName:result.displayName,display_name:result.display_name,nickname:result.nickname,username:result.username??result.preferred_username,user_name:result.user_name,email:result.email});
  return accountName?{accountName}:null;
 }catch{return null}
}

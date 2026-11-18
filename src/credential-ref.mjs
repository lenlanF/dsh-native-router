// Runtime-local equivalent of @deepseek-ai/dsh-credentials credentialRef().
// DSH 0.2.2-rc.3: /^[A-Za-z_][A-Za-z0-9_]*$/ and brandString(value)
// returns the same string at runtime. Avoid dynamic package resolution in
// DSH plugin managers that flatten/strip nested node_modules.
const REF_PATTERN=/^[A-Za-z_][A-Za-z0-9_]*$/;
export function ownCredentialRef(value){
 if(typeof value!=='string'||!REF_PATTERN.test(value))
  throw new TypeError('Invalid DSH credential reference name');
 return value;
}

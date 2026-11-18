import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('published DSH browser client registers one native settings section and releases its ownership on plugin unload',()=>{
 const code=readFileSync(new URL('../client.js',import.meta.url),'utf8');
 const loaded=[];
 runInNewContext(code,{window:{__ModuleLoader__:{load:module=>loaded.push(module)}}},
  {filename:'dsh-native-router/client.js',timeout:2500});
 assert.equal(loaded.length,1);
 const registration=loaded[0];
 assert.equal(registration.id,'dsh-native-router');
 assert.equal(typeof registration.factory,'function');
 const calls=[];
 const module=registration.factory(name=>{
  assert.equal(name,'react','production browser plugin should only use its Host React dependency');
  return {createElement:()=>{},useState:()=>{},useEffect:()=>{},useCallback:()=>{}};
 });
 assert.deepEqual(Array.from(module.inject),['slots']);
 assert.equal(typeof module.apply,'function');
 let registrationDisposed=false,ownerDisposed;
 const ctx={
  slots:{
   inject(name,activate){
    calls.push('inject:'+name);
    assert.equal(name,'settings.section');
    activate();
    return ()=>{registrationDisposed=true};
   },
   register(metadata,component){
    calls.push('register:'+metadata.id);
    assert.equal(metadata.id,'dsh-native-router');
    assert.equal(metadata.name,'settings.section');
    assert.equal(metadata.order,62);
    assert.equal(metadata.label(),'原生多提供商路由');
    assert.equal(typeof component,'function');
   },
  },
  effect:factory=>{ownerDisposed=factory()},
 };
 module.apply(ctx);
 assert.deepEqual(calls,['inject:settings.section','register:dsh-native-router']);
 assert.equal(registrationDisposed,false);
 ownerDisposed();
 assert.equal(registrationDisposed,true,'unload must restore DSH settings UI slot');
});

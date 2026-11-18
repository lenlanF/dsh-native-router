export const sample={
 providers:[{id:'alpha',baseUrl:'https://api.example.invalid/v1',models:['gpt-like'],supportsTools:true},
   {id:'local',baseUrl:'http://127.0.0.1:9091/v1',models:['local-model'],supportsTools:false}],
 accounts:[{id:'a1',providerId:'alpha',credentialRef:'env:NATIVE_ROUTER_TEST_KEY'},
   {id:'a2',providerId:'alpha',credentialRef:'host:test-token'},
   {id:'l1',providerId:'local',credentialRef:'env:LOCAL_TEST_KEY'}],
 routes:[{id:'daily',name:'Daily route',mode:'priority',tiers:[
   {providerId:'alpha',model:'gpt-like',free:false},
   {providerId:'local',model:'local-model',free:true}],
   maxSwitches:3}],
 hostFailover:{enabled:false,mode:'off',priority:[]},
};

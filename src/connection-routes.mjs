import {Readable} from 'node:stream';
import {registerRouterRoutes} from './routes.mjs';

/**
 * Mount native-router administration exclusively below DSH Connection's
 * authenticated /api carrier. Never expose user configuration or account
 * mutations as unauthenticated WebServer routes, even on localhost.
 *
 * Reuse the established Node handlers through a bounded Fetch-to-Node shim.
 * The Connection owner Peer and Host/Origin checks run BEFORE fetch().
 */
export function registerAuthenticatedRouterRoutes(ctx, dependencies){
 const connection=ctx.get?.('connection')??ctx.connection;
 if(typeof connection?.fetch?.register!=='function')
  throw Error('DSH Connection authenticated Fetch registration is required');
 const collected=[];
 // These handlers have no chance to register on a real unauthenticated server.
 registerRouterRoutes({
  get:key=>key==='webServer'?{register:route=>{collected.push(route);return()=>{}}}:undefined,
 },dependencies);
 const disposers=[];
 try{
  for(const route of collected){
   if(route.kind!=='exact'||!route.path.startsWith('/plugins/dsh-native-router/'))
    throw Error('Unsafe native-router route declaration');
   const remove=connection.fetch.register({
    path:'/api'+route.path,methods:['GET','POST'],requestBody:'buffered',
    fetch:request=>invokeTrustedHandler(route.handler,request),
   });
   if(typeof remove!=='function')throw Error('DSH Connection failed to own native-router route');
   disposers.push(remove);
  }
 }catch(error){
  for(const dispose of disposers.reverse())void Promise.resolve(dispose()).catch(()=>{});
  throw error;
 }
 let disposed=false;
 return async()=>{
  if(disposed)return;
  disposed=true;
  await Promise.allSettled(disposers.reverse().map(remove=>Promise.resolve().then(remove)));
 };
}

export async function invokeTrustedHandler(handler,request){
  // The Connection owner was already admitted and authenticated. Keep a
  // second explicit size bound even though DSH supplies buffered requests.
  const declared=Number(request.headers.get('content-length'));
  if(request.method==='POST'&&Number.isFinite(declared)&&declared>1048576)
   return new Response(JSON.stringify({ok:false,error:'Request body exceeds 1 MiB'}),
     {status:413,headers:{'content-type':'application/json','cache-control':'no-store'}});
  const rawBody=request.method==='POST'?Buffer.from(await request.arrayBuffer()):Buffer.alloc(0);
  if(rawBody.length>1048576)
   return new Response(JSON.stringify({ok:false,error:'Request body exceeds 1 MiB'}),
     {status:413,headers:{'content-type':'application/json','cache-control':'no-store'}});
 const req=Readable.from(rawBody.length?[rawBody]:[]);
 req.method=request.method;
 req.headers=Object.fromEntries(request.headers);
 req.socket={remoteAddress:'127.0.0.1'};
 const headers={};
 let settled=false,finish;
 const completion=new Promise(resolve=>{finish=resolve});
 const res={
  statusCode:200,
  setHeader(name,value){headers[name.toLowerCase()]=String(value)},
  end(value=''){
   if(settled)return;
   settled=true;
   finish(new Response(value,{status:this.statusCode,headers}));
  },
 };
  // Never translate an asynchronous handler exception into a successful
  // HTTP 200. End exactly once, expose no exception text or account details.
  Promise.resolve().then(()=>handler(req,res)).catch(()=>{
    if(settled)return;
    res.statusCode=500;
    res.setHeader('content-type','application/json');
    res.setHeader('cache-control','no-store');
    res.end(JSON.stringify({ok:false,error:'Admin API operation failed'}));
  });
  return await completion;
}

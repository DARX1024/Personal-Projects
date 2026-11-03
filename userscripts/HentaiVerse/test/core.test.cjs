const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function aadCore(XHR, timer=setTimeout) {
 const context={window:{location:{protocol:'https:',pathname:'/'},XMLHttpRequest:XHR},console:{log(){},warn(){},error(){}},setTimeout:timer,clearTimeout,GM_getValue:()=>null,GM_setValue(){},GM_deleteValue(){}};
 vm.createContext(context);vm.runInContext(read('src/aadb/core.js')+'\nglobalThis.AADTest=AAD;',context);
 context.AADTest.Utils={DOM:{gE:()=>null},Common:{showStatus(){}}};return context.AADTest;
}
class XHR {
 static requests=[];
 open(method,url){this.method=method;this.url=url;}
 setRequestHeader(){}
 send(){XHR.requests.push(this);}
 abort(){this.onabort();}
}
test('AADB rejects a failed POST without replaying it',async()=>{
 XHR.requests=[];const aad=aadCore(XHR);const request=aad.Core.Network.postPromise('/fixture','buy=1');
 XHR.requests[0].onerror();await assert.rejects(request,/网络失败/);assert.equal(XHR.requests.length,1);assert.equal(aad.Core.Network.active.size,0);
});
test('AADB settles timeout, abort and HTTP failures',async()=>{
 for(const [event,pattern] of [['ontimeout',/超时/],['onabort',/取消/],['onload',/HTTP 503/]]) {
  XHR.requests=[];const aad=aadCore(XHR);const promise=aad.Core.Network.postPromise('/fixture','write=1');const xhr=XHR.requests[0];xhr.status=503;xhr[event]();await assert.rejects(promise,pattern);
 }
});
test('AADB GET retries are bounded',async()=>{
 XHR.requests=[];const delays=[];class FailingXHR extends XHR {send(){super.send();queueMicrotask(()=>this.onerror());}}
 const aad=aadCore(FailingXHR,(fn,ms)=>{delays.push(ms);queueMicrotask(fn);return 0;});
 await assert.rejects(aad.Core.Network.postPromise('/fixture'));assert.equal(XHR.requests.length,3);assert.deepEqual(delays,[500,1000]);
});
test('AADB callback failure pauses and does not call success',async()=>{
 XHR.requests=[];const aad=aadCore(XHR);let paused=false,called=false;
 aad.Core.Storage.setValue=(key,value)=>{paused=key==='disabled'&&value;};
 const promise=aad.Core.Network.postCallback('/fixture',()=>called=true,'buy=1');XHR.requests[0].onerror();await promise;assert.equal(paused,true);assert.equal(called,false);
});
test('AADB takes one config snapshot per turn and writes invalidate it',()=>{
 let reads=0,current={mode:1};const context={window:{location:{pathname:'/'},XMLHttpRequest:XHR},console,setTimeout,clearTimeout,GM_getValue:()=>{reads++;return current;},GM_setValue:(key,value)=>current=value,GM_deleteValue(){}};
 vm.createContext(context);vm.runInContext(read('src/aadb/core.js')+'\nglobalThis.store=AAD.Core.Storage;',context);const store=context.store;
 store.beginTurn();assert.equal(store.getValue('option').mode,1);store.getValue('option');assert.equal(reads,1);
 store.setValue('option',{mode:2});assert.equal(store.getValue('option').mode,2);store.endTurn();store.getValue('option');assert.equal(reads,2);
});
test('AADB compiled conditions retain AND/OR rules and reject invalid rules',()=>{
 const context={AAD:{Core:{State:{get:key=>({hp:35,mp:70}[key])}}},console};vm.createContext(context);
 vm.runInContext(read('src/aadb/utils.js'),context);const conditions=context.AAD.Utils.Condition;
 assert.equal(conditions.evaluateConditionGroups({0:['hp,4,40','mp,1,50']}),true);
 assert.equal(conditions.evaluateConditionGroups({0:['hp,1,40'],1:['mp,1,60']}),true);
 for(const rule of ['broken','hp,99,40','hp,1,missing','_unknown_,1,0'])assert.equal(conditions.evaluateConditionGroups({0:[rule]}),false);
 assert.throws(()=>conditions.validateConfig({itemCureCondition:{0:['broken']}}),/条件格式/);
});
function ponyContext() {
 const requests=[];const context={console,URL,Blob,DOMException,AbortController,setTimeout,clearTimeout,GM_getValue:(key,value)=>value,GM_setValue(){},GM_xmlhttpRequest:options=>{const h={options,abort(){options.onabort();}};requests.push(h);return h;}};
 vm.createContext(context);vm.runInContext(read('src/pony.js'),context);return {context,requests};
}
test('Pony concurrent status checks share the pending result',async()=>{
 const {context,requests}=ponyContext();const service=context.createPonyService(context.createPonyConfig());const a=service.check(),b=service.check();assert.equal(a,b);assert.equal(requests.length,1);
 requests[0].options.onload({status:200,response:'{"ready":true}'});assert.equal((await a).ready,true);assert.equal((await b).ready,true);
});
test('Pony different image requests never coalesce and cancellation settles',async()=>{
 const {context,requests}=ponyContext();const service=context.createPonyService(context.createPonyConfig());const controller=new AbortController();
 const a=service.detect(new Blob(['a']),controller.signal);const b=service.detect(new Blob(['b']));assert.equal(requests.length,2);
 controller.abort();await assert.rejects(a,/取消/);requests[1].options.onload({status:200,response:'{}'});await b;
});
test('Pony rejects malformed settings and retains five history entries',()=>{
 const {context}=ponyContext();assert.deepEqual(Array.from(context.delayRange('[5,1]',[100,1000])),[100,1000]);
 const config=context.createPonyConfig();assert.throws(()=>config.set('api_base','javascript:alert(1)'));
 let store='broken';context.localStorage={getItem:()=>store,setItem:(key,value)=>store=value};
 for(let i=0;i<9;i++)context.ponyHistory('main',{time:String(i)});
 assert.equal(context.ponyHistory('main').length,5);assert.equal(context.ponyHistory('main')[0].time,'8');
});
test('all four installable scripts have valid syntax and matching versions',()=>{
 for(const file of ['AADB.user.js','HV-Interface.user.js','HV-PonySolver.user.js','HV-Utils.user.js']) {
  const source=read(file);new vm.Script(source,{filename:file});
  assert.equal(source.match(/@version\s+(\S+)/)[1],source.match(/const VERSION = ["']([^"']+)/)[1]);
 }
});

const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
let browser;
before(async()=>{browser=await chromium.launch({headless:true,...(process.env.HV_BROWSER_CHANNEL?{channel:process.env.HV_BROWSER_CHANNEL}:{})});});
after(async()=>{await browser?.close();});
const root=path.join(__dirname,'..');
async function fixture(html,url='https://hentaiverse.org/equip/1/test') {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:html}):route.abort());
 await page.goto(url);await page.evaluate(()=>{
  const values=new Map();window.GM_getValue=(key,value)=>values.has(key)?values.get(key):value;window.GM_setValue=(key,value)=>values.set(key,value);
  window.GM_addStyle=css=>{const style=document.createElement('style');style.textContent=css;document.head.append(style);};
  window.GM_registerMenuCommand=()=>1;window.GM_unregisterMenuCommand=()=>{};
 });
 return {page,errors};
}
const equip=()=>'<div class="showequip"><div>Legendary Rapier of Slaughter</div><div class="eqt">Soulbound Tier 2 / 3 / 10</div><div class="eq"><div class="ep"><div title="Base: 185"><label>Attack Damage</label><span>100</span></div></div></div></div>';
test('interface parses before Chinese translation, toggles numeric modes and preserves form values',async()=>{
 const {page,errors}=await fixture(equip()+'<select id="fixture-select"><option value="Legendary">Legendary</option></select>');
 await page.addScriptTag({path:path.join(root,'HV-Interface.user.js')});
 await page.waitForFunction(()=>document.querySelector('.hv-lpr-avg'));
 assert.match(await page.locator('.showequip').innerText(),/传奇/);
 assert.equal(await page.locator('.ep span').first().textContent(),'50%');
 assert.equal(await page.locator('#fixture-select option').getAttribute('value'),'Legendary');
 assert.equal(await page.locator('.ep > div').getAttribute('title'),'Base: 185');
 await page.keyboard.press('f');assert.equal(await page.locator('.ep span').first().textContent(),'100');
 await page.keyboard.press('w');assert.match(await page.locator('.ep span').first().textContent(),/\+27\.27/);
 await page.keyboard.press('w');assert.equal(await page.locator('.ep span').first().textContent(),'100');
 assert.deepEqual(errors,[]);await page.close();
});

test('AADB settings panel retains legacy rules, skill ordering and disabled values',async()=>{
 const {page,errors}=await fixture('<div id="mainpane"></div>','https://hentaiverse.org/?s=Battle');
 await page.evaluate(()=>{
  window.unsafeWindow=window;
  window.fixtureConfig={attackStatus:'0',item:{Cure:true},itemOrder:['Cure'],itemCureCondition:{0:['hp,4,40']},idleArenaOrder:['35'],idleArena:false};
  window.GM_getValue=(key,value)=>key==='main_option'?fixtureConfig:value;
 });
 const parts=['constants','core','utils','battle','automation','data','ui'];
 await page.addScriptTag({content:'(function(){'+parts.map(n=>fs.readFileSync(path.join(root,'src/aadb/'+n+'.js'),'utf8')).join('\n')+'\nwindow.testAAD=AAD;AAD.UI.Theme.init();AAD.UI.Panel.createPanel();})();'});
 const config=await page.evaluate(()=>testAAD.UI.Panel.collectConfigFromPanel(document.getElementById('dbBox')));
 assert.equal(config.attackStatus,'0');assert.equal(config.item.Cure,true);assert.deepEqual(config.itemOrder,['Cure']);assert.deepEqual(config.itemCureCondition,{0:['hp,4,40']});assert.deepEqual(config.idleArenaOrder,['35']);assert.equal(!!config.idleArena,false);
 assert.deepEqual(errors,[]);await page.close();
});
test('dynamic equipment and reused text nodes are processed without duplicate controls',async()=>{
 const {page,errors}=await fixture('<div id="equipinfo"></div><p id="changing">Legendary</p>');
 await page.addScriptTag({path:path.join(root,'HV-Interface.user.js')});
 await page.evaluate(()=>document.getElementById('changing').firstChild.nodeValue='Peerless');
 await page.waitForFunction(()=>document.getElementById('changing').textContent.includes('无双'));
 await page.evaluate(html=>document.getElementById('equipinfo').innerHTML=html,equip());
 await page.waitForFunction(()=>document.querySelector('.hv-lpr-avg'));
 assert.equal(await page.locator('.ep span').first().textContent(),'50%');
 await page.addScriptTag({path:path.join(root,'HV-Interface.user.js')});
 assert.equal(await page.locator('#hv-interface-controls').count(),1);assert.deepEqual(errors,[]);await page.close();
});
test('interface preserves raw battle logs for AADB while translating visible text',async()=>{
 const {page,errors}=await fixture('<div id="pane_log"><table id="textlog"><tbody><tr><td>You gain 100 EXP!</td></tr></tbody></table></div>','https://hentaiverse.org/?s=Battle&ss=ar');
 await page.addScriptTag({path:path.join(root,'HV-Interface.user.js')});
 const raw=await page.locator('#textlog td').getAttribute('data-hv-original-text');assert.equal(raw,'You gain 100 EXP!');
 await page.evaluate(()=>{window.AAD={};});
 await page.addScriptTag({path:path.join(root,'src/aadb/utils.js')});
 assert.equal(await page.evaluate(()=>AAD.Utils.DOM.rawText(document.querySelector('#textlog td'))),'You gain 100 EXP!');
 assert.equal(await page.evaluate(()=>{const td=document.querySelector('#textlog td');td.textContent='You gain 200 EXP!';return AAD.Utils.DOM.rawText(td);}), 'You gain 200 EXP!');
 await page.waitForFunction(()=>document.querySelector('#textlog td').getAttribute('data-hv-original-text')==='You gain 200 EXP!');
 assert.deepEqual(errors,[]);await page.close();
});
test('Pony does no service requests on ordinary pages and cancels an obsolete result',async()=>{
 const {page,errors}=await fixture('<div id="mainpane"></div>','https://hentaiverse.org/?s=Battle');
 await page.evaluate(()=>{
  window.requests=[];window.submissions=0;
  window.GM_getValue=(key,value)=>key.endsWith('_delay')?[0,0]:value;
  window.GM_xmlhttpRequest=options=>{requests.push(options);if(options.url.endsWith('/status'))queueMicrotask(()=>options.onload({status:200,response:'{}'}));return {abort(){options.onabort();}};};
  window.fetch=async()=>({ok:true,blob:async()=>new Blob(['image'])});
 });
 await page.addScriptTag({path:path.join(root,'HV-PonySolver.user.js')});
 assert.equal(await page.evaluate(()=>requests.length),0);
 const challenge='<div id="riddlemaster"><form name="riddleform"><div id="riddleimage"><img src="https://hentaiverse.org/image-a"></div>'+Array.from({length:6},()=>'<input type="checkbox" name="riddleanswer[]">').join('')+'<button type="button" id="riddlesubmit" onclick="submissions++">Submit</button></form></div>';
 await page.evaluate(html=>document.getElementById('mainpane').innerHTML=html,challenge);
 await page.waitForFunction(()=>requests.some(r=>r.url.endsWith('/detect/bytes')));
 await page.evaluate(()=>document.querySelector('#riddleimage img').src='https://hentaiverse.org/image-b');
 await page.waitForFunction(()=>requests.filter(r=>r.url.endsWith('/detect/bytes')).length===2);
 await page.evaluate(()=>requests.find(r=>r.url.endsWith('/detect/bytes')).onload({status:200,response:'{"success":true,"ponies":["TS"]}'}));
 assert.equal(await page.evaluate(()=>submissions),0);
 await page.evaluate(()=>requests.filter(r=>r.url.endsWith('/detect/bytes'))[1].onload({status:200,response:'{"success":true,"ponies":["RA"]}'}));
 await page.waitForFunction(()=>submissions===1);
 assert.equal(await page.locator('input:checked').count(),1);assert.equal(await page.locator('input').nth(1).isChecked(),true);
 assert.deepEqual(errors,[]);await page.close();
});

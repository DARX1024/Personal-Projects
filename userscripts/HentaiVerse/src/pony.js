const PONY_DEFAULTS = Object.freeze({
  api_base: 'http://xm.ngnl.online:8000',
  submit_delay: [100, 1000], multi_click_delay: [100, 1000],
  show_answer_history: true
});
const PONY_LABELS = ['TS', 'RA', 'FS', 'RD', 'PP', 'AJ'];

function delayRange(value, fallback) {
  try { if(typeof value==='string')value=JSON.parse(value); } catch { return [...fallback]; }
  return Array.isArray(value)&&value.length===2&&value.every(v=>Number.isFinite(v)&&v>=0)&&value[0]<=value[1]
    ? [...value] : [...fallback];
}

function createPonyConfig() {
  const data={};
  for(const [key,value] of Object.entries(PONY_DEFAULTS))data[key]=GM_getValue(key,value);
  data.submit_delay=delayRange(data.submit_delay,PONY_DEFAULTS.submit_delay);
  data.multi_click_delay=delayRange(data.multi_click_delay,PONY_DEFAULTS.multi_click_delay);
  return {
    get:key=>data[key],
    set(key,value) {
      if(key==='api_base') {
        const url=new URL(value);
        if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('请输入 HTTP(S) 服务地址');
        value=url.href.replace(/\/$/,'');
      }
      if(key.endsWith('_delay'))value=delayRange(value,PONY_DEFAULTS[key]);
      GM_setValue(key,value);data[key]=value;
    }
  };
}

function createPonyService(config) {
  const requests=new Set();
  let statusPromise=null, statusBase='', online=false;
  function request(route, options={}, signal) {
    return new Promise((resolve,reject)=>{
      let handle, settled=false;
      const finish=(error,value)=>{
        if(settled)return;settled=true;
        requests.delete(handle);signal?.removeEventListener('abort',abort);
        error?reject(error):resolve(value);
      };
      const abort=()=>{handle?.abort();finish(new DOMException('已取消','AbortError'));};
      if(signal?.aborted){abort();return;}
      signal?.addEventListener('abort',abort,{once:true});
      try {
        handle=GM_xmlhttpRequest({url:config.get('api_base')+route,timeout:10000,...options,
          onload(response) {
            if(response.status<200||response.status>=300){finish(new Error('HTTP '+response.status));return;}
            try {finish(null,typeof response.response==='string'?JSON.parse(response.response):response.response);}
            catch {finish(new Error('服务返回了无效 JSON'));}
          },
          onerror:()=>finish(new Error('服务网络错误')),
          ontimeout:()=>finish(new Error('服务请求超时')),
          onabort:()=>finish(new DOMException('已取消','AbortError'))
        });
        if(!settled)requests.add(handle);
      } catch(error){finish(error);}
    });
  }
  return {
    get online(){return online;},
    check() {
      const base=config.get('api_base');
      if(statusPromise&&statusBase===base)return statusPromise;
      statusBase=base;
      const pending=request('/status',{method:'GET'}).then(status=>{
        if(config.get('api_base')===base)online=true;
        return status;
      }).catch(error=>{if(config.get('api_base')===base)online=false;throw error;})
        .finally(()=>{if(statusPromise===pending)statusPromise=null;});
      statusPromise=pending;
      return pending;
    },
    detect(blob,signal) {return request('/detect/bytes',{method:'POST',headers:{'Content-Type':'application/octet-stream'},data:blob},signal);},
    destroy() {for(const handle of [...requests])handle?.abort();requests.clear();}
  };
}

function ponyHistory(world, record) {
  let all={};
  try {all=JSON.parse(localStorage.getItem('answer_history')||'{}');if(!all||typeof all!=='object'||Array.isArray(all))all={};} catch {}
  const rows=Array.isArray(all[world])?all[world].slice(0,5):[];
  if(record) {
    rows.unshift(record);rows.length=Math.min(rows.length,5);all[world]=rows;
    try {localStorage.setItem('answer_history',JSON.stringify(all));} catch(error){console.warn('[PonySolver] 无法保存记录',error);}
  }
  return rows;
}

function ponyWait(ms,signal) {
  return new Promise((resolve,reject)=>{
    let timer;
    const abort=()=>{clearTimeout(timer);reject(new DOMException('已取消','AbortError'));};
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
  });
}

async function ponyImageBlob(image,signal) {
  if(image.complete&&image.naturalWidth>0) {
    try {
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      canvas.getContext('2d').drawImage(image,0,0);
      const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('图片转换失败')),'image/jpeg',0.85));
      if(signal.aborted)throw new DOMException('已取消','AbortError');
      return blob;
    } catch(error){if(signal.aborted)throw error;}
  }
  const response=await fetch(image.src,{cache:'force-cache',signal});
  if(!response.ok)throw new Error('图片读取失败：HTTP '+response.status);
  return response.blob();
}

function startPonySolver() {
  const config=createPonyConfig(), service=createPonyService(config);
  const world=/\/isekai(?:\/|$)/.test(location.pathname)?'isekai':'main';
  let task=null, completed=null, panel=null, healthTimer=null, failures=0, destroyed=false, observer;
  let scheduled=false;
  const menuIds=[];
  const randomWait=(key,signal)=>{const [a,b]=config.get(key);return ponyWait(a+Math.random()*(b-a),signal);};
  function riddle() {
    const form=document.querySelector('form[name="riddleform"]');
    const image=document.querySelector('#riddleimage img');
    return form&&image&&image.src?{form,image,src:image.src}:null;
  }
  const same=(a,b)=>a&&b&&a.form===b.form&&a.image===b.image&&a.src===b.src;
  function render() {
    if(!config.get('show_answer_history')){if(panel)panel.hidden=true;return;}
    if(!panel) {
      panel=document.createElement('div');panel.className='ponyLog';panel.dataset.hvUi='true';
      panel.style.cssText='position:fixed;right:12px;top:120px;max-width:300px;padding:8px;background:#edebdf;color:#5c0d11;border:1px solid #5c0d11;font:12px sans-serif;z-index:10000';
      document.body.append(panel);
    }
    panel.hidden=false;
    const lines=['HV-PonySolver '+VERSION,'服务器：'+(service.online?'在线':'未连接'),world==='main'?'主世界最近答题':'异世界最近答题'];
    for(const row of ponyHistory(world))lines.push(row.time+' '+(row.answers?'['+row.answers+'] '+row.elapsed+'ms':row.message||'未知错误'));
    panel.replaceChildren(...lines.map(text=>{const div=document.createElement('div');div.textContent=text;return div;}));
  }
  function record(start,answers,message='') {
    ponyHistory(world,{time:new Date().toLocaleTimeString('zh-CN',{hour12:false}),answers:answers?.join(',')||'',elapsed:Math.round(performance.now()-start),type:message?'error':'normal',message});render();
  }
  async function checkHealth() {
    try {await service.check();failures=0;} catch {failures=Math.min(failures+1,6);}
    if(destroyed)return;
    render();clearTimeout(healthTimer);
    // Active challenges only; back off from 10 seconds to 10 minutes after failures.
    if(riddle())healthTimer=setTimeout(()=>{checkHealth();schedule();},failures?Math.min(10000*2**(failures-1),600000):600000);
  }
  async function solve(job) {
    const start=performance.now(), signal=job.controller.signal;
    const current=()=>!destroyed&&!signal.aborted&&same(job,riddle());
    try {
      const status=await service.check();
      if(!current())return;
      const labels=Array.isArray(status?.model?.class_names)&&status.model.class_names.length===6?status.model.class_names:PONY_LABELS;
      const blob=await ponyImageBlob(job.image,signal);
      if(!current())return;
      const result=await service.detect(blob,signal);
      if(!current())return;
      const answers=Array.isArray(result?.ponies)?[...new Set(result.ponies)]:[];
      if(!result?.success||!answers.length||answers.some(name=>!labels.includes(name)))throw new Error('识别结果无效，未提交');
      const boxes=job.form.querySelectorAll('input[name="riddleanswer[]"]');
      if(boxes.length!==labels.length)throw new Error('答案框数量异常，未提交');
      for(const box of boxes){if(box.checked){box.checked=false;box.dispatchEvent(new Event('change',{bubbles:true}));}}
      for(let i=0;i<answers.length;i++) {
        if(!current())return;
        const box=boxes[labels.indexOf(answers[i])];box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}));
        if(i+1<answers.length)await randomWait('multi_click_delay',signal);
      }
      await randomWait('submit_delay',signal);
      if(!current())return;
      const submit=job.form.querySelector('#riddlesubmit')||document.querySelector('#riddlesubmit');
      if(!submit)throw new Error('未找到提交按钮');
      completed=job;record(start,answers);submit.click();
    } catch(error) {
      if(current()&&error.name!=='AbortError'){completed=job;record(start,null,error.message);}
    } finally {
      if(task===job)task=null;
      if(!destroyed){render();schedule();}
    }
  }
  function reconcile() {
    if(destroyed)return;
    const next=riddle();
    if(task&&!same(task,next)){task.controller.abort();task=null;}
    if(!next){clearTimeout(healthTimer);healthTimer=null;completed=null;return;}
    if(!panel)render();
    if(!task&&!same(completed,next)) {
      task={...next,controller:new AbortController()};solve(task);
      if(!healthTimer)checkHealth();
    }
  }
  function schedule() {
    if(scheduled||destroyed)return;scheduled=true;
    queueMicrotask(()=>{scheduled=false;reconcile();});
  }
  function menus() {
    menuIds.splice(0).forEach(id=>GM_unregisterMenuCommand(id));
    const add=(title,callback)=>menuIds.push(GM_registerMenuCommand(title,callback));
    add('答题记录：'+(config.get('show_answer_history')?'显示':'隐藏'),()=>{config.set('show_answer_history',!config.get('show_answer_history'));render();menus();});
    add('API 地址：'+config.get('api_base'),()=>{
      const value=prompt('请输入识别服务 API 地址',config.get('api_base'));if(value===null)return;
      try {config.set('api_base',value.trim());task?.controller.abort();task=null;completed=null;clearTimeout(healthTimer);healthTimer=null;menus();schedule();}
      catch(error){alert(error.message);}
    });
    for(const [key,title] of [['submit_delay','提交延迟'],['multi_click_delay','多选延迟']]) {
      add(title+'：'+config.get(key).join(','),()=>{
        const value=prompt(title+'（毫秒，格式 min,max）',config.get(key).join(','));if(value===null)return;
        const numbers=value.split(',').map(v=>v.trim()===''?NaN:Number(v));
        if(numbers.length!==2||numbers.some(n=>!Number.isFinite(n)||n<0)||numbers[0]>numbers[1]){alert('请输入两个有效的非负数字，且 min ≤ max');return;}
        config.set(key,numbers);menus();
      });
    }
    add('重新检查并处理当前验证码',()=>{if(task)return;completed=null;schedule();});
  }
  menus();
  // One cheap discovery observer; mutations in our own status panel are ignored.
  observer=new MutationObserver(records=>{
    if(records.some(record=>!record.target.closest?.('[data-hv-ui]')&&
      (record.type==='attributes'||Array.from(record.addedNodes).some(node=>node.nodeType===1&&(node.matches?.('#riddlemaster, #riddleimage, #riddleimage img, form[name="riddleform"]')||node.querySelector?.('#riddlemaster, #riddleimage, form[name="riddleform"]')))||
        Array.from(record.removedNodes).some(node=>node.nodeType===1&&(node.contains?.(task?.form)||node.contains?.(completed?.form)||node.contains?.(task?.image)||node.contains?.(completed?.image))))))schedule();
  });
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
  document.addEventListener('DOMContentLoaded',schedule);
  window.addEventListener('pagehide',()=>{destroyed=true;observer.disconnect();task?.controller.abort();service.destroy();clearTimeout(healthTimer);document.removeEventListener('DOMContentLoaded',schedule);},{once:true});
  schedule();
}

function startInterface() {
  if (document.getElementById('hv-interface-controls')) return;
  let saved=null;
  try { saved=JSON.parse(localStorage.getItem('hv-interface-settings') || 'null'); } catch {}
  const settings = Object.assign({
    translation: localStorage.getItem('myScriptEnabled') !== 'false',
    logs: localStorage.getItem('LogTransDisabled') !== 'true'
  }, saved || {});
  const sources = new WeakMap();
  const originalText = node => {
    if (!node) return '';
    const entry = sources.get(node);
    if (entry && node.textContent === entry.output) return entry.input;
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
    return Array.from(node.childNodes, originalText).join('');
  };
  const HV = {
    settings,
    originalText,
    remember(node, input, output = node.textContent) {
      sources.set(node, {input, output});
      this.markRendered(node);
    },
    markRendered(node) {
      const parent=node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;
      const owner=parent?.closest('td, #pane_magic [id], #pane_skill [id], #pane_item [id]');
      if(owner) {
        owner.setAttribute('data-hv-rendered-text',owner.textContent);
        if(parent!==owner)parent.setAttribute('data-hv-rendered-text',parent.textContent);
      }
    },
    preserve(node) {
      const parent = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      const owner = parent?.closest('td, #pane_magic [id], #pane_skill [id], #pane_item [id]');
      if (owner) {
        owner.setAttribute('data-hv-original-text', originalText(owner));
        if(parent!==owner)parent.setAttribute('data-hv-original-text', originalText(parent));
      }
    },
    save() {
      localStorage.setItem('hv-interface-settings', JSON.stringify(settings));
      localStorage.setItem('myScriptEnabled', String(settings.translation));
      localStorage.setItem('LogTransDisabled', String(!settings.logs));
    },
    modeChanged() {}
  };
  const equipment = createEquipment(HV);
  const translator = settings.translation ? createTranslation(HV) : null;
  const panel = document.createElement('details');
  panel.id = 'hv-interface-controls';
  panel.dataset.hvUi = 'true';
  panel.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:30000;background:#edebdf;color:#5c0d11;border:1px solid #5c0d11;padding:6px;font:12px sans-serif;box-shadow:0 2px 8px #0003';
  panel.innerHTML = '<summary style="cursor:pointer">HV 界面</summary><label><input type="checkbox" name="translation">游戏汉化</label><br><label><input type="checkbox" name="logs">战斗日志汉化</label><br><label>装备显示 <select name="equipment"><option value="value">原始数值</option><option value="percentage">百分比</option><option value="forge">满锻预览</option></select></label><br><small>F：百分比　W：满锻</small>';
  for (const key of ['translation','logs']) {
    const control = panel.querySelector(`[name="${key}"]`);
    control.checked = settings[key];
    control.addEventListener('change', () => { settings[key]=control.checked; HV.save(); location.reload(); });
  }
  const mode = panel.querySelector('[name="equipment"]');
  HV.modeChanged = () => {mode.value=equipment.mode();};
  mode.addEventListener('change', () => equipment.setMode(mode.value));
  HV.modeChanged();
  document.body.append(panel);
  const pending = new Set();
  let frame = 0;
  function process(root) {
    if (!root.isConnected || (root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement)?.closest('[data-hv-ui]')) return;
    equipment.prepare(root);
    translator?.apply(root);
  }
  function flush() {
    frame=0;
    const roots=Array.from(pending).filter(node => !Array.from(pending).some(other => other!==node && other.contains?.(node)));
    pending.clear();
    roots.forEach(process);
  }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type==='childList') {
        record.addedNodes.forEach(node=>{if(node.nodeType===1||node.nodeType===3)pending.add(node);});
      } else pending.add(record.target);
    }
    if (!frame && pending.size) frame=requestAnimationFrame(flush);
  });
  process(document.body);
  observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['title','placeholder','style']});
  window.addEventListener('pagehide',()=>{observer.disconnect();cancelAnimationFrame(frame);pending.clear();},{once:true});
}

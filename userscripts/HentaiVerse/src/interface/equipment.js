function createEquipment(HV) {


  const d=new Set;const importCSS = async e=>{d.has(e)||(d.add(e),(t=>{typeof GM_addStyle=="function"?GM_addStyle(t):(document.head||document.documentElement).appendChild(document.createElement("style")).append(t);})(e));};

  importCSS(' .flex-between{display:flex;align-items:center;justify-content:space-between}.flex-col{display:flex;flex-direction:column}.visible{visibility:visible}.absolute{position:absolute}.inset-x-0{left:0;right:0}.bottom-1{bottom:.25rem}.z-10000{z-index:10000}.ml-2{margin-left:.5rem}.ml-5px{margin-left:5px}.block{display:block}.max-h-80vh{max-height:80vh}.cursor-pointer{cursor:pointer}.cursor-move{cursor:move}.touch-none{touch-action:none}.select-none{-webkit-user-select:none;user-select:none}.overflow-auto{overflow:auto}.border-none{border-style:none}.bg-\\#5c0d11{--un-bg-opacity:1;background-color:rgb(92 13 17 / var(--un-bg-opacity))}.bg-transparent{background-color:transparent}.p-10px{padding:10px}.p-2px{padding:2px}.px,[px=""]{padding-left:1rem;padding-right:1rem}.px-6px{padding-left:6px;padding-right:6px}.py-3px{padding-top:3px;padding-bottom:3px}.pt-0\\!{padding-top:0!important}.text-center{text-align:center}.text-10px{font-size:10px}.text-12px{font-size:12px}.text-\\#0ab844{--un-text-opacity:1;color:rgb(10 184 68 / var(--un-text-opacity))}.text-\\#1d3271{--un-text-opacity:1;color:rgb(29 50 113 / var(--un-text-opacity))}.text-\\#edebdf{--un-text-opacity:1;color:rgb(237 235 223 / var(--un-text-opacity))}.text-\\#f03939{--un-text-opacity:1;color:rgb(240 57 57 / var(--un-text-opacity))}.hover\\:text-red:hover,.color-red{--un-text-opacity:1;color:rgb(248 113 113 / var(--un-text-opacity))}.color-inherit{color:inherit}.font-bold{font-weight:700}.font-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace}.decoration-none{text-decoration:none}.shadow{--un-shadow:var(--un-shadow-inset) 0 1px 3px 0 var(--un-shadow-color, rgb(0 0 0 / .1)),var(--un-shadow-inset) 0 1px 2px -1px var(--un-shadow-color, rgb(0 0 0 / .1));box-shadow:var(--un-ring-offset-shadow),var(--un-ring-shadow),var(--un-shadow)}.transition-color-200{transition-property:color;transition-timing-function:cubic-bezier(.4,0,.2,1);transition-duration:.2s} ');

  var p$1 = e2 => !!e2;

  var n = e2 => Array.from(new Set(e2));

  var Nr = (e2, o, ...s2) => {
    for (let i2 of s2) {
      let t2 = l(o, i2);
      if (t2) return t2;
    }
    return e2;
  }, l = (e2, o) => {
    let s2 = o().map(r => r.toLowerCase()), i2 = n(s2.flatMap(r => [ r, r.split('-')[0] ])), t2 = e2.map(r => r.toLowerCase());
    return i2.map(r => {
      let c = t2.findIndex(x => x === r);
      return c >= 0 && e2[c];
    }).find(p$1);
  };

  var e = () => (navigator == null ? void 0 : navigator.languages) || [];

  const removeEmptyValues = object => Object.fromEntries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Object.entries(object).map(([key, value]) => key !== 'i' && value && value != '0' && [ key, value ]).filter(Boolean));

  const trimAllValues = part => Object.fromEntries(Object.keys(part).map(key => {
    const val = part[key];
    return [ key, Array.isArray(val) ? val.map(v => v === null || v === void 0 ? void 0 : v.trim()) : val === !!val ? val : val === null || val === void 0 ? void 0 : val.trim() ];
  }));

  const parseArgumentPart = text => {
    const [keyPart = '', ...formatterKeys] = text.split('|');
    const [keyWithoutType = '', type] = keyPart.split(':');
    const [key, isOptional] = keyWithoutType.split('?');
    return {
      k: key,
      i: type,
      n: isOptional === '',
      f: formatterKeys
    };
  };

  const isBasicPluralPart = part => !!(part.o || part.r);

  const parsePluralPart = (content, lastAccessor) => {
    let [key, values] = content.split(':');
    if (!values) {
      values = key;
      key = lastAccessor;
    }
    const entries = values.split('|');
    const [zero, one, two, few, many, rest] = entries;
    const nrOfEntries = entries.filter(entry => entry !== void 0).length;
    if (nrOfEntries === 1) {
      return {
        k: key,
        r: zero
      };
    }
    if (nrOfEntries === 2) {
      return {
        k: key,
        o: zero,
        r: one
      };
    }
    if (nrOfEntries === 3) {
      return {
        k: key,
        z: zero,
        o: one,
        r: two
      };
    }
    return {
      k: key,
      z: zero,
      o: one,
      t: two,
      f: few,
      m: many,
      r: rest
    };
  };

  const REGEX_SWITCH_CASE = /^\{.*\}$/;

  const parseCases = text => Object.fromEntries(removeOuterBrackets(text).split(',').map(part => part.split(':')).reduce((accumulator, entry) => {
    if (entry.length === 2) {
      return [ ...accumulator, entry.map(entry2 => entry2.trim()) ];
    }
    accumulator[accumulator.length - 1][1] += ',' + entry[0];
    return accumulator;
  }, []));

  const REGEX_BRACKETS_SPLIT = /(\{(?:[^{}]+|\{(?:[^{}]+)*\})*\})/g;

  const removeOuterBrackets = text => text.substring(1, text.length - 1);

  const parseRawText = (rawText, optimize = true, firstKey = '', lastKey = '') => rawText.split(REGEX_BRACKETS_SPLIT).map(part => {
    if (!part.match(REGEX_BRACKETS_SPLIT)) {
      return part;
    }
    const content = removeOuterBrackets(part);
    if (content.startsWith('{')) {
      return parsePluralPart(removeOuterBrackets(content), lastKey);
    }
    const parsedPart = parseArgumentPart(content);
    lastKey = parsedPart.k || lastKey;
    !firstKey && (firstKey = lastKey);
    return parsedPart;
  }).map(part => {
    if (typeof part === 'string') return part;
    if (!part.k) part.k = firstKey || '0';
    const trimmed = trimAllValues(part);
    return optimize ? removeEmptyValues(trimmed) : trimmed;
  });

  const applyFormatters = (formatters, formatterKeys, initialValue) => formatterKeys.reduce((value, formatterKey) => {
    var _a, _b;
    return (_b = formatterKey.match(REGEX_SWITCH_CASE) ? (cases => {
      var _a2;
      return (_a2 = cases[value]) !== null && _a2 !== void 0 ? _a2 : cases['*'];
    })(parseCases(formatterKey)) : (_a = formatters[formatterKey]) === null || _a === void 0 ? void 0 : _a.call(formatters, value)) !== null && _b !== void 0 ? _b : value;
  }, initialValue);

  const getPlural = (pluralRules, {z: z, o: o, t: t2, f: f, m: m, r: r}, value) => {
    switch (z && value == 0 ? 'zero' : pluralRules.select(value)) {
     case 'zero':
      return z;

     case 'one':
      return o;

     case 'two':
      return t2;

     case 'few':
      return f !== null && f !== void 0 ? f : r;

     case 'many':
      return m !== null && m !== void 0 ? m : r;

     default:
      return r;
    }
  };

  const REGEX_PLURAL_VALUE_INJECTION = /\?\?/g;

  const applyArguments = (textParts, pluralRules, formatters, args) => textParts.map(part => {
    if (typeof part === 'string') {
      return part;
    }
    const {k: key = '0', f: formatterKeys = []} = part;
    const value = args[key];
    if (isBasicPluralPart(part)) {
      return ((typeof value === 'boolean' ? value ? part.o : part.r : getPlural(pluralRules, part, value)) || '').replace(REGEX_PLURAL_VALUE_INJECTION, value);
    }
    const formattedValue = formatterKeys.length ? applyFormatters(formatters, formatterKeys, value) : value;
    return ('' + (formattedValue !== null && formattedValue !== void 0 ? formattedValue : '')).trim();
  }).join('');

  const translate = (textParts, pluralRules, formatters, args) => {
    const firstArg = args[0];
    const isObject = firstArg && typeof firstArg === 'object' && firstArg.constructor === Object;
    const transformedArgs = args.length === 1 && isObject ? firstArg : args;
    return applyArguments(textParts, pluralRules, formatters, transformedArgs);
  };

  const getPartsFromString = (cache, text) => cache[text] || (cache[text] = parseRawText(text));

  const getTranslateInstance = (locale, formatters) => {
    const cache = {};
    const pluralRules = new Intl.PluralRules(locale);
    return (text, ...args) => translate(getPartsFromString(cache, text), pluralRules, formatters, args);
  };

  function i18nObject$1(locale, translations, formatters = {}) {
    return createProxy(translations, getTranslateInstance(locale, formatters));
  }

  const wrap = (proxyObject = {}, translateFn) => typeof proxyObject === 'string' ? translateFn.bind(null, proxyObject) : Object.assign(Object.defineProperty(() => '', 'name', {
    writable: true
  }), proxyObject);

  const createProxy = (proxyObject, translateFn) => new Proxy(wrap(proxyObject, translateFn), {
    get: (target, key) => {
      if (key === Symbol.iterator) return [][Symbol.iterator].bind(Object.values(target).map(entry => wrap(entry, translateFn)));
      return createProxy(target[key], translateFn);
    }
  });

  const baseLocale = 'en-US';

  const locales = [ 'en-US', 'zh-CN' ];

  const loadedLocales = {};

  const loadedFormatters = {};

  const i18nObject = locale => i18nObject$1(locale, loadedLocales[locale], loadedFormatters[locale]);

  const detectLocale = (...detectors) => Nr(baseLocale, locales, ...detectors);

  const initFormatters = locale => {
    const formatters = {};
    return formatters;
  };

  const en_US = {
    // percentage-ranges
    modeLabel: 'Mode',
    modeValue: 'Value',
    modePercentage: 'Percentage',
    modeMaxForged: 'Max Forged',
    avgLabel: 'Avg',
    hotkeyHint: 'Hotkeys: f, w',
    unknownError: 'Unknown error',
    forumLink: 'Forum Link:',
    pinned: 'Pinned',
    compareLabel: 'Compare:'
  };

  const zh_CN = {
    // percentage-ranges
    modeLabel: '模式',
    modeValue: '数值(F切换百分比,W切换满锻)',
    modePercentage: '百分比(按F切换数值,W切换满锻)',
    modeMaxForged: '满锻',
    avgLabel: '优秀度',
    hotkeyHint: '快捷键: f, w',
    unknownError: '未知错误',
    forumLink: '论坛链接:',
    pinned: '已固定',
    compareLabel: '对比:'
  };

  const localeTranslations = {
    'en-US': en_US,
    'zh-CN': zh_CN
  };

  const loadLocale = locale => {
    if (loadedLocales[locale]) return;
    loadedLocales[locale] = localeTranslations[locale];
    loadFormatters(locale);
  };

  const loadFormatters = locale => void (loadedFormatters[locale] = initFormatters());

  function initI18n() {
    const locale = detectLocale(e);
    loadLocale(locale);
    return i18nObject(locale);
  }

  const forumsCss = '.hv-tip{position:fixed;width:420px;font-size:8pt;font-family:verdana;text-align:center;color:#5c0d11;background-color:#e3e0d1;padding:4px 0;border:1px solid #5c0d11}.hv-tip p{margin:0}.hv-tip .showequip>div{margin:3px auto 0;padding:1px}.hv-tip .showequip>div:first-child,.hv-tip .eq span,.hv-tip .eqt,.hv-tip .eqr,.hv-tip .eqc{font-weight:700}.hv-tip .showequip>div:first-child{border-bottom:1px solid #a47c78;font-size:10pt;padding:2px 0 4px}.hv-tip .eq>div{margin:1px auto;padding:1px;text-align:center;min-height:17px}.hv-tip .eqt,.hv-tip .eqr{font-size:110%}.hv-tip .ex,.hv-tip .ep{display:grid;gap:2px 5px;justify-items:center}.hv-tip .ex{grid-template-columns:repeat(2,1fr);border-top:1px solid #a47c78;text-align:right!important}.hv-tip .ex>div{width:165px;height:18px}.hv-tip .ex>div>div:nth-child(1){float:left;width:99px;padding:2px;white-space:nowrap}.hv-tip .ex>div>div:nth-child(2){float:left;width:45px;padding:2px 0 2px 2px}.hv-tip .ex>div>div:nth-child(3){float:left;width:6px;padding:2px}.hv-tip .ep>div{width:115px;height:18px}.hv-tip .ep>div:first-child{font-weight:700;margin:4px auto 0!important;width:320px!important;grid-column:1 / -1}.hv-tip .ep>div>div:nth-child(1){float:left;width:60px;padding:2px;text-align:right;white-space:nowrap}.hv-tip .ep>div>div:nth-child(2){float:left;width:45px;padding:2px 0 2px 2px;text-align:left}.hv-tip .ep1{grid-template-columns:repeat(1,1fr)}.hv-tip .ep2{grid-template-columns:repeat(2,1fr)}.hv-tip .ep3{grid-template-columns:repeat(3,1fr)}.hv-tip a:link,.hv-tip a:visited,.hv-tip a:active{color:#5c0d11}';

  importCSS(forumsCss);

  function isValidKey(e2) {
    if (e2.repeat || e2.ctrlKey || e2.altKey || e2.metaKey) return false;
    const target = e2.target;
    if (!target) return false;
    const tag2 = target.tagName;
    if (tag2 === 'INPUT' || tag2 === 'TEXTAREA' || target.isContentEditable) return false;
    return true;
  }

  function getDefaultExportFromCjs(x) {
    return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
  }

  var isMobile$1 = {
    exports: {}
  };

  var hasRequiredIsMobile;

  function requireIsMobile() {
    if (hasRequiredIsMobile) return isMobile$1.exports;
    hasRequiredIsMobile = 1;
    isMobile$1.exports = isMobile2;
    isMobile$1.exports.isMobile = isMobile2;
    isMobile$1.exports.default = isMobile2;
    const mobileRE = /(android|bb\d+|meego).+mobile|armv7l|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|redmi|series[46]0|samsungbrowser.*mobile|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i;
    const notMobileRE = /CrOS/;
    const tabletRE = /android|ipad|playbook|silk/i;
    function isMobile2(opts) {
      if (!opts) opts = {};
      let ua = opts.ua;
      if (!ua && typeof navigator !== 'undefined') ua = navigator.userAgent;
      if (ua && ua.headers && typeof ua.headers['user-agent'] === 'string') {
        ua = ua.headers['user-agent'];
      }
      if (typeof ua !== 'string') return false;
      let result = mobileRE.test(ua) && !notMobileRE.test(ua) || !!opts.tablet && tabletRE.test(ua);
      if (!result && opts.tablet && opts.featureDetect && navigator && navigator.maxTouchPoints > 1 && ua.indexOf('Macintosh') !== -1 && ua.indexOf('Safari') !== -1) {
        result = true;
      }
      return result;
    }
    return isMobile$1.exports;
  }

  var isMobileExports = requireIsMobile();

  const isMobileFn = /* @__PURE__ */ getDefaultExportFromCjs(isMobileExports);

  const isMobile = isMobileFn({
    tablet: true,
    featureDetect: true
  });

  const keyboard_configs = {
    key_toggle: 'f',
    key_pin: 'q',
    key_forge: 'w',
    key_delete: 'delete',
    key_link: 'l'
  };

  const REGEX_TARGET = /^https?:\/\/(alt\.)?hentaiverse\.org\/(isekai\/)?equip/;

  var _GM_getValue = /* @__PURE__ */ (() => typeof GM_getValue != 'undefined' ? GM_getValue : void 0)();

  var _GM_setValue = /* @__PURE__ */ (() => typeof GM_setValue != 'undefined' ? GM_setValue : void 0)();

  var _GM_xmlhttpRequest = /* @__PURE__ */ (() => typeof GM_xmlhttpRequest != 'undefined' ? GM_xmlhttpRequest : void 0)();

  const GM_Request = ({method: method = 'GET', ...rest}, signal) => new Promise((resolve, reject) => {
    if (signal == null ? void 0 : signal.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    let abortHandle = null;
    const onSignalAbort = () => abortHandle == null ? void 0 : abortHandle.abort();
    const cleanup = () => {
      if (signal) {
        signal.removeEventListener('abort', onSignalAbort);
      }
    };
    if (signal) {
      signal.addEventListener('abort', onSignalAbort);
    }
    abortHandle = _GM_xmlhttpRequest({
      method: method,
      ...rest,
      onload: res => {
        cleanup();
        if (res.status >= 200 && res.status < 300) resolve(res); else reject(new Error(`HTTP Error: ${res.status} ${res.statusText}`));
      },
      onerror: event => {
        cleanup();
        reject(new Error(event.error || 'Network Error'));
      },
      ontimeout: () => {
        cleanup();
        reject(new Error('Timeout'));
      },
      onabort: () => {
        cleanup();
        reject(new Error('Aborted'));
      }
    });
  });

  const popup = document.getElementById('popup_box');

  const equipInfo = document.getElementById('equipinfo');

  // Dynamic equipment is prepared by the shared interface observer.

  const quality_configs = {
    Peerless: {
      range: [ 200, 200 ],
      cap: 60
    },
    Legendary: {
      range: [ 170, 200 ],
      cap: 50
    },
    Magnificent: {
      range: [ 150, 180 ],
      cap: 40
    },
    Exquisite: {
      range: [ 120, 160 ],
      cap: 20
    },
    Superior: {
      range: [ 90, 130 ],
      cap: 20
    },
    Average: {
      range: [ 60, 100 ],
      cap: 20
    },
    Fair: {
      range: [ 30, 70 ],
      cap: 20
    },
    Crude: {
      range: [ 0, 40 ],
      cap: 20
    }
  };

  const charmExclusiveBonus = /* @__PURE__ */ new Set([ 'HP Bonus', 'MP Bonus', 'Counter-parry' ]);

  const color = {
    green: 'text-#0ab844',
    red: 'text-#f03939',
    mid: 'text-#1d3271'
  };

  const colorClasses = Object.values(color);

  const removeColor = el => {
    el.classList.remove(...colorClasses);
  };

  function renderEquip(container, compareQuality = null) {
    const equip = equipMap.get(container);
    if (!equip) return;
    const {showPercent: showPercent, showMaxForge: showMaxForge} = globalState;
    if (equip.type === 'Soulbound') {
      const {tier_up: up, tier_iw: iw, tier_max: max2} = equip;
      if (showMaxForge && (max2 - up > 0 || max2 - iw > 0)) {
        const diff = cur => max2 - cur > 0 ? `${cur}<span class="${color.green}">+${max2 - cur}</span>` : max2;
        equip._eqt.innerHTML = `Tier ${diff(up)} / ${diff(iw)} / ${max2}`;
      } else {
        equip._eqt.textContent = `Tier ${up} / ${iw} / ${max2}`;
      }
    }
    let totalPercent = 0;
    let statCount = 0;
    const [min, max] = compareQuality && quality_configs[compareQuality] ? quality_configs[compareQuality].range : equip.range;
    const forge_current = equip.type === 'Soulbound' ? equip.tier_up + equip.tier_iw : 0;
    const getColor = (percent, max2 = 70, min2 = 30) => percent >= max2 ? color.green : percent <= min2 ? color.red : color.mid;
    for (const stat of equip.stats) {
      const el = stat._el;
      removeColor(el);
      let percent = null;
      if (stat.base !== null) {
        const span2 = max - min || 30;
        percent = Number.parseFloat(((stat.base - (max - span2)) / span2 * 100).toFixed(1));
        totalPercent += percent;
        statCount++;
      }
      const isForgeMode = showMaxForge && equip.forge_max > forge_current && !charmExclusiveBonus.has(stat.title);
      const isPercentMode = showPercent && !isForgeMode && percent !== null;
      const hideSurrounding = isForgeMode || isPercentMode;
      if (stat._preNode) {
        stat._preNode.textContent = hideSurrounding ? '' : stat.prefix;
      }
      if (stat._sufNode && !stat.typeText) {
        stat._sufNode.textContent = hideSurrounding ? '' : stat.suffix;
      }
      const typeText = stat.typeText ? ` ${stat.typeText}` : '';
      if (isForgeMode) {
        const ratio = stat.rate / 100;
        const maxVal = stat.val * (1 + equip.forge_max * ratio) / (1 + forge_current * ratio);
        const gain = +(maxVal - stat.val).toFixed(2);
        el.innerHTML = `${stat.valStr}<span class="${color.green}">+${gain}</span>${typeText}`;
      } else if (isPercentMode && percent !== null) {
        el.textContent = `${percent}%${typeText}`;
        el.classList.add(getColor(percent));
      } else {
        el.textContent = `${stat.valStr}${typeText}`;
      }
    }
    if (statCount > 0) {
      const avg = Number.parseFloat((totalPercent / statCount).toFixed(1));
      const mode = showMaxForge ? t.modeMaxForged() : showPercent ? t.modePercentage() : t.modeValue();
      equip._avg.innerHTML = `<div class="${getColor(avg, 60, 40)}">${t.avgLabel()}: ${avg}%</div><div class="text-10px" title="${t.hotkeyHint()}">${t.modeLabel()}: ${mode}</div>`;
    } else {
      equip._avg.textContent = '';
    }
  }

  const equipMap = /* @__PURE__ */ new WeakMap;

  const state$1 = {
    showPercent: _GM_getValue('showPercent', true),
    showMaxForge: false
  };

  const globalState = state$1;

  function togglePercent() {
    state$1.showMaxForge = false;
    state$1.showPercent = !state$1.showPercent;
    _GM_setValue('showPercent', state$1.showPercent);
    renderAll();
    HV.modeChanged();
  }

  function toggleForge() {
    state$1.showPercent = false;
    state$1.showMaxForge = !state$1.showMaxForge;
    renderAll();
    HV.modeChanged();
  }

  function renderAll() {
    if ((popup == null ? void 0 : popup.style.visibility) === 'visible') {
      renderEquip(popup);
    }
    for (const el of document.querySelectorAll('.showequip')) {
      const select2 = el.querySelector('select');
      const qualityKey = select2 ? (select2.options[select2.selectedIndex].getAttribute('data-quality') || select2.value) : null;
      renderEquip(el, qualityKey);
    }
  }

  let protoOf = Object.getPrototypeOf;

  let changedStates, derivedStates, curDeps, curNewDerives, alwaysConnectedDom = {
    isConnected: 1
  };

  let gcCycleInMs = 1e3, statesToGc, propSetterCache = {};

  let objProto = protoOf(alwaysConnectedDom), funcProto = protoOf(protoOf), _undefined;

  let addAndScheduleOnFirst = (set, s2, f, waitMs) => (set != null ? set : (waitMs ? setTimeout(f, waitMs) : queueMicrotask(f),
  /* @__PURE__ */ new Set)).add(s2);

  let runAndCaptureDeps = (f, deps, arg) => {
    let prevDeps = curDeps;
    curDeps = deps;
    try {
      return f(arg);
    } catch (e2) {
      console.error(e2);
      return arg;
    } finally {
      curDeps = prevDeps;
    }
  };

  let keepConnected = l2 => l2.filter(b2 => {
    var _a;
    return (_a = b2._dom) == null ? void 0 : _a.isConnected;
  });

  let addStatesToGc = d => statesToGc = addAndScheduleOnFirst(statesToGc, d, () => {
    for (let s2 of statesToGc) s2._bindings = keepConnected(s2._bindings), s2._listeners = keepConnected(s2._listeners);
    statesToGc = _undefined;
  }, gcCycleInMs);

  let stateProto = {
    get val() {
      var _a;
      (_a = curDeps == null ? void 0 : curDeps._getters) == null ? void 0 : _a.add(this);
      return this.rawVal;
    },
    get oldVal() {
      var _a;
      (_a = curDeps == null ? void 0 : curDeps._getters) == null ? void 0 : _a.add(this);
      return this._oldVal;
    },
    set val(v) {
      var _a;
      (_a = curDeps == null ? void 0 : curDeps._setters) == null ? void 0 : _a.add(this);
      if (v !== this.rawVal) {
        this.rawVal = v;
        this._bindings.length + this._listeners.length ? (derivedStates == null ? void 0 : derivedStates.add(this),
        changedStates = addAndScheduleOnFirst(changedStates, this, updateDoms)) : this._oldVal = v;
      }
    }
  };

  let state = initVal => ({
    __proto__: stateProto,
    rawVal: initVal,
    _oldVal: initVal,
    _bindings: [],
    _listeners: []
  });

  let bind = (f, dom) => {
    let deps = {
      _getters: /* @__PURE__ */ new Set,
      _setters: /* @__PURE__ */ new Set
    }, binding = {
      f: f
    }, prevNewDerives = curNewDerives;
    curNewDerives = [];
    let newDom = runAndCaptureDeps(f, deps, dom);
    newDom = (newDom != null ? newDom : document).nodeType ? newDom : new Text(newDom);
    for (let d of deps._getters) deps._setters.has(d) || (addStatesToGc(d), d._bindings.push(binding));
    for (let l2 of curNewDerives) l2._dom = newDom;
    curNewDerives = prevNewDerives;
    return binding._dom = newDom;
  };

  let derive = (f, s2 = state(), dom) => {
    var _a;
    let deps = {
      _getters: /* @__PURE__ */ new Set,
      _setters: /* @__PURE__ */ new Set
    }, listener = {
      f: f,
      s: s2
    };
    listener._dom = (_a = dom != null ? dom : curNewDerives == null ? void 0 : curNewDerives.push(listener)) != null ? _a : alwaysConnectedDom;
    s2.val = runAndCaptureDeps(f, deps, s2.rawVal);
    for (let d of deps._getters) deps._setters.has(d) || (addStatesToGc(d), d._listeners.push(listener));
    return s2;
  };

  let add = (dom, ...children) => {
    for (let c of children.flat(Infinity)) {
      let protoOfC = protoOf(c != null ? c : 0);
      let child = protoOfC === stateProto ? bind(() => c.val) : protoOfC === funcProto ? bind(c) : c;
      child != _undefined && dom.append(child);
    }
    return dom;
  };

  let tag = (ns, name, ...args) => {
    var _a, _b, _c, _d;
    let [{is: is, ...props}, ...children] = protoOf((_a = args[0]) != null ? _a : 0) === objProto ? args : [ {}, ...args ];
    let dom = ns ? document.createElementNS(ns, name, {
      is: is
    }) : document.createElement(name, {
      is: is
    });
    for (let [k, v] of Object.entries(props)) {
      let getPropDescriptor = proto => {
        var _a2;
        return proto ? (_a2 = Object.getOwnPropertyDescriptor(proto, k)) != null ? _a2 : getPropDescriptor(protoOf(proto)) : _undefined;
      };
      let cacheKey = name + ',' + k;
      let propSetter = (_d = propSetterCache[cacheKey]) != null ? _d : propSetterCache[cacheKey] = (_c = (_b = getPropDescriptor(protoOf(dom))) == null ? void 0 : _b.set) != null ? _c : 0;
      let setter = k.startsWith('on') ? (v2, oldV) => {
        let event = k.slice(2);
        dom.removeEventListener(event, oldV);
        dom.addEventListener(event, v2);
      } : propSetter ? propSetter.bind(dom) : dom.setAttribute.bind(dom, k);
      let protoOfV = protoOf(v != null ? v : 0);
      k.startsWith('on') || protoOfV === funcProto && (v = derive(v), protoOfV = stateProto);
      protoOfV === stateProto ? bind(() => (setter(v.val, v._oldVal), dom)) : setter(v);
    }
    return add(dom, children);
  };

  let handler = ns => ({
    get: (_, name) => tag.bind(_undefined, ns, name)
  });

  let update = (dom, newDom) => newDom ? newDom !== dom && dom.replaceWith(newDom) : dom.remove();

  let updateDoms = () => {
    let iter = 0, derivedStatesArray = [ ...changedStates ].filter(s2 => s2.rawVal !== s2._oldVal);
    do {
      derivedStates = /* @__PURE__ */ new Set;
      for (let l2 of new Set(derivedStatesArray.flatMap(s2 => s2._listeners = keepConnected(s2._listeners)))) derive(l2.f, l2.s, l2._dom),
      l2._dom = _undefined;
    } while (++iter < 100 && (derivedStatesArray = [ ...derivedStates ]).length);
    let changedStatesArray = [ ...changedStates ].filter(s2 => s2.rawVal !== s2._oldVal);
    changedStates = _undefined;
    for (let b2 of new Set(changedStatesArray.flatMap(s2 => s2._bindings = keepConnected(s2._bindings)))) update(b2._dom, bind(b2.f, b2._dom)),
    b2._dom = _undefined;
    for (let s2 of changedStatesArray) s2._oldVal = s2.rawVal;
  };

  const van = {
    tags: new Proxy(ns => new Proxy(tag, handler(ns)), handler())
  };

  const {a: a, aside: aside, audio: audio, b: b, blockquote: blockquote, br: br, button: button, canvas: canvas, code: code, datalist: datalist, dd: dd, details: details, dialog: dialog, div: div, dl: dl, dt: dt, em: em, fieldset: fieldset, figcaption: figcaption, figure: figure, footer: footer, form: form, h1: h1, h2: h2, h3: h3, h4: h4, h5: h5, h6: h6, header: header, hr: hr, i: i, iframe: iframe, img: img, input: input, label: label, legend: legend, li: li, main: main, nav: nav, ol: ol, optgroup: optgroup, option: option, p: p, pre: pre, progress: progress, ruby: ruby, s: s, script: script, search: search, section: section, select: select, small: small, source: source, span: span, strong: strong, style: style, sub: sub, summary: summary, sup: sup, table: table, tbody: tbody, td: td, textarea: textarea, tfoot: tfoot, th: th, thead: thead, tr: tr, u: u, ul: ul, video: video} = van.tags;

  const defaultButtonClass = 'ml-5px cursor-pointer transition-color-200 border-none bg-transparent';

  const createPercentButton = () => button({
    type: 'button',
    textContent: '%',
    style: 'font-weight: bold;',
    class: defaultButtonClass,
    onclick: togglePercent
  });

  const createForgeButton = () => button({
    type: 'button',
    textContent: '馃敤',
    class: defaultButtonClass,
    onclick: toggleForge
  });

  const createPinButton = () => button({
    type: 'button',
    textContent: '馃搶',
    class: defaultButtonClass,
    onclick: actionPinWindow
  });

  const excludeRegex = new RegExp([ '?s=Character&ss=eq', '?s=Battle&ss=iw', '?s=Bazaar&ss=am&screen=modify&' ].map(p2 => p2.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)).join('|'));

  function injectCompare(container, quality) {
    const showCompare = /\/equip(?:\/|$)/.test(location.pathname) || !!(equipInfo == null ? void 0 : equipInfo.contains(container)) && location.search !== '' && !excludeRegex.test(location.search);
    if (showCompare) {
      const qualityKeys = Object.keys(quality_configs);
      const selectEl = select({
        id: 'hv-quality-compare',
        onchange: e2 => {
          const qualityKey = e2.target.options[e2.target.selectedIndex].getAttribute('data-quality') || e2.target.value;
          renderEquip(container, qualityKey);
        }
      }, qualityKeys.map(k => option({
        value: k,
        'data-quality': k,
        selected: k === quality
      }, k)));
      // 滚轮切换品质
      selectEl.addEventListener('wheel', e2 => {
        e2.preventDefault();
        const idx = selectEl.selectedIndex;
        const delta = e2.deltaY > 0 ? 1 : -1;
        const newIdx = Math.max(0, Math.min(qualityKeys.length - 1, idx + delta));
        if (newIdx !== idx) {
          selectEl.selectedIndex = newIdx;
          selectEl.dispatchEvent(new Event('change'));
        }
      }, { passive: false });
      const compare = div({
        style: 'padding: 6px; border-top: 1px solid #A47C78;'
      }, b(t.compareLabel()), selectEl, isMobile ? [ createPercentButton(), createForgeButton() ] : []);
      container.append(compare);
    }
  }

  const REGEX_VAL = /^(\d+(?:\.\d+)?)(?:\s+(\S.*))?$/;

  const REGEX_BASE = /Base:\s*([+-]?[\d.]+)/i;

  const REGEX_TIER = /Tier\s+(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/i;

  const REGEX_DAMAGE = /^(?:Magic|Attack|Void|Crushing|Piercing|Slashing) Damage/;

  function parseEquip(container) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
    if (container.querySelector('.hv-lpr-avg')) return;
    const eq = container.querySelector('.eq');
    const eqt = container.querySelector('.eqt');
    if (!eq || !eqt) return;
    const titleWrapper = container.firstElementChild;
    const lastChildText = (_b = (_a = titleWrapper == null ? void 0 : titleWrapper.lastElementChild) == null ? void 0 : _a.textContent.trim()) != null ? _b : '';
    const title = lastChildText.startsWith('(') && lastChildText.endsWith(')') ? lastChildText.slice(1, -1) : (_e = (_d = (_c = titleWrapper == null ? void 0 : titleWrapper.querySelector('a')) == null ? void 0 : _c.textContent) != null ? _d : titleWrapper == null ? void 0 : titleWrapper.textContent) == null ? void 0 : _e.trim();
    if (!title) return;
    const found = Object.entries(quality_configs).find(([key]) => title.startsWith(key));
    if (!found) return;
    const [quality, {range: range, cap: cap}] = found;
    const stats = [];
    const rows = [ ...eq.querySelectorAll('.ex > div, .ep > div'), ...Array.from(eq.querySelectorAll('[title^="Base: "]')).filter(el => !el.closest('.ex, .ep')) ];
    for (const row of rows) {
      const span2 = row.querySelector('span');
      if (!span2) continue;
      const match = REGEX_VAL.exec(span2.textContent.trim());
      if (!match) continue;
      const [_, valStr, typeText] = match;
      if (!valStr) continue;
      const name = typeText != null ? typeText : (_f = row.firstElementChild) == null ? void 0 : _f.textContent.trim();
      if (!name) continue;
      const baseMatch = (_g = row.getAttribute('title')) == null ? void 0 : _g.match(REGEX_BASE);
      const prefixNode = span2.previousSibling;
      const suffixNode = (_i = (_h = span2.parentNode) == null ? void 0 : _h.nextSibling) != null ? _i : null;
      stats.push({
        title: name,
        val: Number.parseFloat(valStr),
        valStr: valStr,
        base: baseMatch ? Number.parseFloat(baseMatch[1]) : null,
        rate: REGEX_DAMAGE.test(name) ? 2 : 1,
        prefix: (prefixNode == null ? void 0 : prefixNode.nodeType) === 3 ? prefixNode.textContent : '',
        suffix: (_j = suffixNode == null ? void 0 : suffixNode.textContent) != null ? _j : null,
        typeText: typeText != null ? typeText : null,
        _el: span2,
        _preNode: prefixNode,
        _sufNode: suffixNode
      });
    }
    const avg = div({
      class: `hv-lpr-avg p-2px text-12px font-bold ${container.closest('#popup_box') ? ' absolute bottom-1 inset-x-0 text-center' : ''}`
    });
    container.append(avg);
    const tierMatch = REGEX_TIER.exec(eqt.textContent);
    return {
      title: title,
      quality: quality,
      range: range,
      stats: stats,
      _eq: eq,
      _avg: avg,
      ...tierMatch ? {
        type: 'Soulbound',
        tier_up: +tierMatch[1],
        tier_iw: +tierMatch[2],
        tier_max: +tierMatch[3],
        forge_max: +tierMatch[3] * 2,
        _eqt: eqt
      } : {
        type: 'Tradeable',
        level: +((_l = (_k = /Level (\d+)/i.exec(eqt.textContent)) == null ? void 0 : _k[1]) != null ? _l : 0),
        forge_max: cap
      }
    };
  }

  function initEquip(container) {
    const equip = parseEquip(container);
    if (!equip) return;
    equipMap.set(container, equip);
    injectCompare(container, equip.quality);
    renderEquip(container);
  }

  const CACHE_PREFIX = 'HvPerc_';

  const getCache = url => sessionStorage.getItem(CACHE_PREFIX + url);

  const setCache = (url, data) => {
    const save = () => {
      sessionStorage.setItem(CACHE_PREFIX + url, data);
    };
    try {
      save();
    } catch (e2) {
      console.warn('SessionStorage is full, cache failed');
      for (const k of Object.keys(sessionStorage)) {
        if (k.startsWith(CACHE_PREFIX)) {
          sessionStorage.removeItem(k);
        }
      }
      console.info('Cleared cache, retrying...');
      try {
        save();
      } catch (err) {
        console.error('Retry failed', err);
      }
    }
  };

  function parseRawHtml(html, url) {
    var _a;
    const doc = (new DOMParser).parseFromString(html, 'text/html');
    (_a = doc.querySelector('div[style*="border-top"] p')) == null ? void 0 : _a.remove();
    const content = doc.querySelector('.showequip');
    if (!content) {
      throw new Error(doc.body.textContent);
    }
    const titleDiv = content.firstElementChild;
    if (titleDiv) {
      const link = a({
        href: url,
        target: '_blank',
        class: 'color-inherit decoration-none cursor-pointer'
      }, Array.from(titleDiv.childNodes));
      titleDiv.replaceChildren(link);
    }
    return content.outerHTML;
  }

  let zIndex = 2e4;

  function createPin(tip2, url) {
    var _a;
    const existingWin = document.querySelector(`.hv-pin-box[data-url="${url}"]`);
    if (existingWin) return;
    const content = div({
      class: 'overflow-auto max-h-80vh',
      innerHTML: (_a = getCache(url)) != null ? _a : tip2.innerHTML
    });
    const eq = content.firstElementChild;
    if (!eq) return;
    initEquip(eq);
    if (isMobile) {
      content.append(createPercentButton(), createForgeButton());
    }
    const handleDrag = e2 => {
      if (e2.button !== 0 || !e2.isPrimary) return;
      e2.preventDefault();
      pinWin.style.zIndex = String(++zIndex);
      const target = e2.currentTarget;
      target.setPointerCapture(e2.pointerId);
      const startX = e2.clientX;
      const startY = e2.clientY;
      const {left: left, top: top} = pinWin.getBoundingClientRect();
      const onMove = ev => {
        pinWin.style.left = `${left + (ev.clientX - startX)}px`;
        pinWin.style.top = `${top + (ev.clientY - startY)}px`;
      };
      const onUp = ev => {
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.releasePointerCapture(ev.pointerId);
      };
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
    };
    const pinWin = div({
      class: 'hv-pin-box pt-0! flex-col border:solid border:#5c0d11 shadow hv-tip',
      'data-url': url,
      style: `top: ${tip2.style.top}; left: ${tip2.style.left}; z-index:${++zIndex};`
    }, div({
      class: 'flex-between py-3px px-6px font-bold bg-#5c0d11 text-#edebdf cursor-move select-none touch-none',
      onpointerdown: handleDrag
    }, span(t.pinned()), span({
      textContent: '[X]',
      class: 'hover:text-red cursor-pointer font-mono ml-2',
      onclick: () => {
        pinWin.remove();
      },
      onpointerdown: e2 => {
        e2.stopPropagation();
      }
    })), content);
    document.body.append(pinWin);
  }

  let tip = null;

  let curLink = null;

  let showTimer = null;

  let hideTimer = null;

  const clearShowTimer = () => {
    if (showTimer) {
      globalThis.clearTimeout(showTimer);
      showTimer = null;
    }
  };

  const clearHideTimer = () => {
    if (hideTimer) {
      globalThis.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const hideTip = () => {
    if (tip) tip.style.display = 'none';
  };

  let abortCtrl = null;

  const clearAbortCtrl = () => {
    if (abortCtrl) {
      abortCtrl.abort();
      abortCtrl = null;
    }
  };

  const renderContent = (link, html) => {
    if (!tip || link !== curLink) return;
    tip.innerHTML = html;
    const eq = tip.firstElementChild;
    if (eq) {
      initEquip(eq);
      if (isMobile) {
        tip.append(createPercentButton(), createForgeButton(), createPinButton());
      }
    }
    tip.style.display = 'block';
    const rect = link.getBoundingClientRect();
    const tRect = tip.getBoundingClientRect();
    let pos;
    if (isMobile) {
      pos = getMobileTooltipPosition(rect, tRect);
    } else {
      let top = rect.top + 10;
      let left = rect.right + 10;
      if (left + tRect.width > globalThis.innerWidth) {
        left = rect.left - tRect.width - 10;
        if (left < 0) {
          left = 5;
        }
      }
      if (top + tRect.height > globalThis.innerHeight) {
        top = top < 0 ? rect.bottom + 10 : globalThis.innerHeight - tRect.height - 10;
      }
      pos = {
        left: left,
        top: top
      };
    }
    tip.style.top = `${pos.top}px`;
    tip.style.left = `${pos.left}px`;
  };

  const renderTip = link => {
    if ((tip == null ? void 0 : tip.contains(link)) || link.closest('.hv-pin-box')) return;
    const url = link.href.replace(/^http:/, 'https:');
    if (!REGEX_TARGET.test(url)) return;
    clearAbortCtrl();
    clearShowTimer();
    clearHideTimer();
    curLink = link;
    if (!tip) {
      tip = div({
        style: 'display: none;',
        class: 'hv-tip z-10000'
      });
      document.body.append(tip);
    }
    const cached = getCache(url);
    if (cached) {
      renderContent(link, cached);
    } else {
      showTimer = setTimeout(async () => {
        if (!tip) return;
        abortCtrl = new AbortController;
        try {
          const {responseText: responseText} = await GM_Request({
            url: url
          }, abortCtrl.signal);
          if (curLink !== link) return;
          const html = parseRawHtml(responseText, url);
          setCache(url, html);
          renderContent(link, html);
        } catch (error) {
          if (curLink !== link || error instanceof Error && error.message === 'Aborted') return;
          tip.innerHTML = `<div class="p-10px color-red font-bold"> ${error instanceof Error ? error.message : t.unknownError()}</div>`;
        }
      }, 200);
    }
  };

  const initTipEvents = () => {
    document.addEventListener('pointerover', e2 => {
      if (e2.pointerType === 'touch') return;
      const target = e2.target;
      if (tip == null ? void 0 : tip.contains(target)) {
        clearHideTimer();
        return;
      }
      const link = target.closest('a');
      if (!link) return;
      if (link === curLink) {
        clearHideTimer();
        return;
      }
      renderTip(link);
    });
    document.addEventListener('pointerout', e2 => {
      if (!curLink || !tip) return;
      if (e2.pointerType === 'touch') return;
      const target = e2.target;
      if (!tip.contains(target) && !curLink.contains(target)) return;
      const related = e2.relatedTarget;
      if (tip.contains(related) || curLink.contains(related)) return;
      clearAbortCtrl();
      clearShowTimer();
      clearHideTimer();
      hideTimer = setTimeout(() => {
        curLink = null;
        hideTip();
      }, 200);
    });
  };

  function actionPinWindow() {
    if (!tip || tip.style.display === 'none' || !curLink) return;
    createPin(tip, curLink.href);
    hideTip();
  }

  let longPressTimer = null;

  let isLongPressTriggered = false;

  const clearLongPressTimer = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  function initMobileEvents() {
    document.addEventListener('touchstart', e2 => {
      const target = e2.target;
      const link = target.closest('a');
      clearLongPressTimer();
      isLongPressTriggered = false;
      if (!link) {
        if (tip && tip.style.display !== 'none' && !tip.contains(target)) {
          tip.style.display = 'none';
        }
        return;
      }
      longPressTimer = setTimeout(() => {
        isLongPressTriggered = true;
        renderTip(link);
      }, 500);
    }, {
      passive: true
    });
    document.addEventListener('touchmove', clearLongPressTimer, {
      passive: true
    });
    document.addEventListener('touchend', clearLongPressTimer);
    document.addEventListener('contextmenu', e2 => {
      if (!isLongPressTriggered) return;
      const target = e2.target;
      const link = target.closest('a');
      if (link && REGEX_TARGET.test(link.href) || (tip == null ? void 0 : tip.contains(target))) {
        e2.preventDefault();
        e2.stopPropagation();
      }
    });
  }

  function getMobileTooltipPosition(targetRect, tipRect) {
    const {innerWidth: innerWidth, innerHeight: innerHeight} = globalThis;
    let top = targetRect.top - tipRect.height - 20;
    let left = (innerWidth - tipRect.width) / 2;
    if (left + tipRect.width > innerWidth) {
      left = targetRect.left - tipRect.width - 10;
      if (left < 0) left = 5;
    }
    if (top + tipRect.height > innerHeight) {
      top = top < 0 ? targetRect.bottom + 10 : innerHeight - tipRect.height - 10;
    }
    return {
      top: Math.max(5, top),
      left: Math.max(5, left)
    };
  }

  function initForums() {
    initTipEvents();
    if (isMobile) {
      initMobileEvents();
    }
    document.addEventListener('keydown', e2 => {
      if (!isValidKey(e2)) return;
      const key = e2.key.toLowerCase();
      if (key === keyboard_configs.key_pin) {
        actionPinWindow();
      } else if (key === keyboard_configs.key_delete) {
        for (const w of document.querySelectorAll('.hv-pin-box:hover')) {
          w.remove();
        }
      }
    });
  }

  function initHv() {
    document.addEventListener('keydown', e2 => {
      if (!isValidKey(e2) || e2.target.closest?.('[data-hv-ui]')) return;
      if (e2.key.toLowerCase() === keyboard_configs.key_toggle) { e2.preventDefault(); togglePercent(); }
      else if (e2.key.toLowerCase() === keyboard_configs.key_forge) { e2.preventDefault(); toggleForge(); }
      else if (e2.key.toLowerCase() === keyboard_configs.key_link && REGEX_TARGET.test(location.href)) {
        const equip= equipMap.get(document.querySelector('.showequip'));
        if(equip) globalThis.prompt(t.forumLink(), '[url='+location.href+']'+equip.title+'[/url]');
      }
    }, true);
  }

  const t = initI18n();

  initHv();

  if (location.hostname.includes('forums.e-hentai.org')) {
    initForums();
  }


  return {
    mode: () => state$1.showMaxForge ? 'forge' : state$1.showPercent ? 'percentage' : 'value',
    setMode(mode) {
      state$1.showMaxForge=mode==='forge'; state$1.showPercent=mode==='percentage';
      _GM_setValue('showPercent',state$1.showPercent); renderAll(); HV.modeChanged();
    },
    prepare(root) {
      const element=root.nodeType===1?root:root.parentElement;
      if(!element)return;
      const candidates=new Set(element.querySelectorAll?.('.showequip') || []);
      const owner=element.closest?.('.showequip, #popup_box');
      if(owner)candidates.add(owner);
      if(element.id==='popup_box')candidates.add(element);
      candidates.forEach(initEquip);
    }
  };

}

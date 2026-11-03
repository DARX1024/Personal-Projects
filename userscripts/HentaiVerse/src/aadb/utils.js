// 工具库层
AAD.Utils = {};

AAD.Utils.Array = {
      // 对象数组排序函数，从小到大排序
      objArrSort: (key) => {
        return (obj1, obj2) => {
          return (obj2[key] < obj1[key]) ? 1 : (obj2[key] > obj1[key]) ? -1 : 0;
        };
      }
    };

AAD.Utils.Aggregation = {
      mergeDataObjects(target, source, excludeKeys = []) {
        const excludeSet = new Set(excludeKeys);
        for (const key in source) {
          if (excludeSet.has(key)) continue;
          const value = source[key];
          if (typeof value === 'number') {
            target[key] = (target[key] || 0) + value;
          } else if (typeof value === 'object' && value !== null) {
            if (!target[key]) target[key] = {};
            this.mergeDataObjects(target[key], value, excludeKeys);
          } else if (!target[key]) {
            target[key] = value;
          }
        }
      }
    };

AAD.Utils.Time = {
      getRandomDelayMs(minMs, maxMs, roundMs = 0) {
        const delay = minMs + Math.random() * (maxMs - minMs);
        if (roundMs > 0) {
          return Math.floor(delay / roundMs) * roundMs;
        }
        return delay;
      },

      getIdleArenaDelay(minPercent = 30, maxPercent = 200) {
        const option = AAD.Core.Storage.getValue('option') || {};
        const baseSeconds = Number(option.idleArenaTime);
        const safeBaseSeconds = Number.isFinite(baseSeconds) && baseSeconds > 0 ? baseSeconds : 60;
        const minSeconds = safeBaseSeconds * (minPercent / 100);
        const maxSeconds = safeBaseSeconds * (maxPercent / 100);
        return this.getRandomDelayMs(minSeconds * 1000, maxSeconds * 1000, 1000);
      },

      getUtcDayKey(timeMs = Date.now()) {
        return new Date(timeMs).toISOString().split('T')[0];
      },

      getUtcDayStartMs(dayKey) {
        return Date.parse(`${dayKey}T00:00:00Z`);
      },

    };

AAD.Utils.DOM = {
      rawText(element) {
        if (!element) return '';
        const current=element.textContent || '';
        return element.getAttribute('data-hv-rendered-text') === current
          ? element.getAttribute('data-hv-original-text') ?? current : current;
      },
      gE(ele, mode, parent) {
        // 兼容原有调用方式，同时保持性能
        if (typeof ele === 'object') {
          return ele;
        } else if (mode === undefined && parent === undefined) {
          if (isNaN(ele * 1)) {
            // 纯 #id 选择器直接走 getElementById
            if (ele.startsWith('#')) {
              const pureIdMatch = ele.match(/^#([\w-]+)$/);
              if (pureIdMatch) {
                return document.getElementById(pureIdMatch[1]);
              }
            }

            // 战斗相关元素使用缓存优化
            const isBattleElement = ele.includes('btm') || ele.includes('mkey_') ||
                                   ele.includes('#pane_effects') || ele.includes('#ckey_') ||
                                   ele.includes('#vbh') || ele.includes('#dvbh') ||
                                   ele.includes('#vbm') || ele.includes('#dvbm') ||  // MP条
                                   ele.includes('#vbs') || ele.includes('#dvbs') ||  // SP条
                                   ele.includes('#vcp') || ele.includes('#dvrc') ||  // OC槽
                                   ele.includes('#stamina_readout') || ele.includes('#riddlecounter');

            if (isBattleElement) {
              return AAD.Core.Storage.getElement(ele, document, true);
            } else {
              return document.querySelector(ele);
            }
          } else {
            return document.getElementById(ele);
          }
        } else if (mode === 'all') {
          // 缓存固定的 mode='all' 查询
          const cacheableAllSelectors = [
            'div.btm3>div>div',  // 怪物名字（固定）
            'div.btm6',          // 怪物buff区域容器（固定）
            'div.btm1'           // 怪物头部区域（固定）
          ];

          if (cacheableAllSelectors.includes(ele) && parent === undefined) {
            return AAD.Core.Storage.getAllElements(ele, document, true);  // 使用缓存版本
          }

          return (parent === undefined) ? document.querySelectorAll(ele) : parent.querySelectorAll(ele);
        } else if (typeof mode === 'object' && parent === undefined) {
          return mode.querySelector(ele);
        }
      },

      // 检查技能/物品是否可用
      isOn(id) {
        if (id * 1 > 10000) { // 使用物品
          return this.gE('.bti3>div[onmouseover*="' + id + '"]');
        } else { // 施放技能
          return (this.gE(id) && this.gE(id).style.opacity !== '0.5') ? this.gE(id) : false;
        }
      },

      cE(name) {
        return document.createElement(name);
      },

    };

AAD.Utils.Condition = {
      _context: null,

      setContext(context) {
        this._context = context || null;
      },

      parseConditionValue(str) {
        // 函数调用
        if (str.match(/^_/)) {
          const arr = str.split('_');
          const funcName = arr[1];
          let args = arr.slice(2);

          // hasDebuff参数兼容：忽略前缀wpn/trio，保留真实buff关键词
          if (funcName === 'hasDebuff') {
            const normalized = args
              .filter((arg) => arg !== undefined && arg !== null && String(arg).trim() !== '')
              .map((arg) => String(arg).trim());

            while (normalized.length > 1) {
              const head = normalized[0].toLowerCase();
              if (head === 'wpn' || head === 'trio') {
                normalized.shift();
                continue;
              }
              break;
            }

            args = normalized.length > 0 ? [normalized.join('_')] : [];
          }

          if (this.ConditionFunctions[funcName]) {
            const result = this.ConditionFunctions[funcName](...args, this._context);
            return result;
          }
          return 0;
        }
        // 字符串字面量
        if (str.match(/^'.*?'$|^".*?"$/)) {
          return str.slice(1, -1);
        }
        // 全局变量
        if (isNaN(str * 1)) {
          const value = AAD.Core.State.get(str);
          return value;
        }
        // 数字字面量
        return str * 1;
      },

      // 比较操作符映射表
      COMPARISON_OPERATORS: {
        '1': (a, b) => a > b,   // 大于
        '2': (a, b) => a < b,   // 小于
        '3': (a, b) => a >= b,  // 大于等于
        '4': (a, b) => a <= b,  // 小于等于
        '5': (a, b) => a === b, // 等于
        '6': (a, b) => a !== b  // 不等于
      },

      // 条件函数库 - 用于条件评估
      ConditionFunctions: {
        // 技能冷却检查
        isCd: (id) => AAD.Utils.DOM.isOn(id) ? 0 : 1,

        // Buff 剩余回合数检查
        buffTurn: (img, suffix, context) => {
          if (context == null && suffix && typeof suffix === 'object') {
            context = suffix;
            suffix = undefined;
          }
          if (suffix !== undefined && suffix === 'scroll') {
            img = img + '_' + suffix;
          }
          const buffSnapshot = context && (context.playerBuffs ? context : context.buffSnapshot);
          if (!buffSnapshot || !buffSnapshot.playerBuffs) return 0;

          // 从快照中查找匹配的buff
          return buffSnapshot.playerBuffs[img] || 0;
        },

        // 怪物 Debuff 检查
        hasDebuff: (img) => {
          const monsterStatus = AAD.Core.State.get('monsterStatus');
          if (!monsterStatus || !monsterStatus[0]) return 0;
          const monsterBuff = AAD.Utils.DOM.gE('#mkey_' + monsterStatus[0].id + '>.btm6');
          return AAD.Utils.DOM.gE('img[src*="' + img + '"]', monsterBuff) ? 1 : 0;
        },

        // 怪物效果检查
        hasEffect: (effect) => {
          const monsterStatus = AAD.Core.State.get('monsterStatus');
          if (!monsterStatus || !monsterStatus[0]) return 0;
          const monsterBuff = AAD.Utils.DOM.gE('#mkey_' + monsterStatus[0].id + '>.btm6');
          return AAD.Utils.DOM.gE('img[onmouseover*="' + effect + '"]', monsterBuff) ? 1 : 0;
        },

        // Boss 检查
        isBoss: () => {
          const monsterStatus = AAD.Core.State.get('monsterStatus');
          if (!monsterStatus || !monsterStatus[0]) return 0;
          const mid = Number(monsterStatus[0].mid);
          return Number.isFinite(mid) && BOSS_MONSTER_IDS.has(mid) ? 1 : 0;
        },

        // 怪物血量百分比检查
        monHp: (ratio) => {
          const monsterStatus = AAD.Core.State.get('monsterStatus');
          if (!monsterStatus || !monsterStatus[0]) return 0;
          const hpRatio = monsterStatus[0].hpNow / monsterStatus[0].hp;
          return hpRatio * 100 <= parseInt(ratio) ? 1 : 0;
        },

        // 怪物满血值检查
        monFullHp: (amount) => {
          const monsterStatus = AAD.Core.State.get('monsterStatus');
          if (!monsterStatus || !monsterStatus[0]) return 0;
          return monsterStatus[0].hp <= parseInt(amount) ? 1 : 0;
        },

        // 怪物当前血值检查
        monNowHp: (amount) => {
          const monsterStatus = AAD.Core.State.get('monsterStatus');
          if (!monsterStatus || !monsterStatus[0]) return 0;
          return monsterStatus[0].hpNow <= parseInt(amount) * 50000 ? 1 : 0;
        },

        // Spirit Shield状态检查
        isSsOn: () => {
          return AAD.Utils.DOM.gE('#ckey_spirit[src*="spirit_a"]') ? 1 : 0;
        }
      },

      // 条件组评估函数
      compiled: new Map(),
      compileCondition(source) {
        if (typeof source !== 'string') return null;
        if (this.compiled.has(source)) return this.compiled.get(source);
        const parts=source.split(',').map(part=>part.trim());
        const operand = text => {
          if (!text) return null;
          if (/^(['"]).*\1$/.test(text)) { const value=text.slice(1,-1); return () => value; }
          if (Number.isFinite(Number(text))) { const value=Number(text); return () => value; }
          if (text.startsWith('_')) {
            if (!this.ConditionFunctions[text.split('_')[1]]) return null;
            return () => this.parseConditionValue(text);
          }
          if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(text)) return null;
          return () => AAD.Core.State.get(text);
        };
        const left=parts.length===3?operand(parts[0]):null;
        const right=parts.length===3?operand(parts[2]):null;
        const compare=this.COMPARISON_OPERATORS[parts[1]];
        const compiled=left&&right&&compare?()=>{const a=left(),b=right();return a!==undefined&&b!==undefined&&compare(a,b);}:null;
        if(this.compiled.size>=1000)this.compiled.clear();
        this.compiled.set(source,compiled);
        return compiled;
      },

      validateConfig(config) {
        for(const [key,groups] of Object.entries(config)) {
          if(!key.endsWith('Condition') || !groups || typeof groups!=='object')continue;
          for(const [group,conditions] of Object.entries(groups)) {
            if(!Array.isArray(conditions) || conditions.some(value=>!this.compileCondition(value))) {
              throw new Error('条件格式错误：'+key+' / '+group);
            }
          }
        }
      },

      evaluateConditionGroups(parms) {
        if (!parms) return true;

        // 遍历每个条件组（OR 关系）
        for (const groupKey in parms) {
          const group = parms[groupKey];
          if (!Array.isArray(group)) continue;

          let groupResult = true;

          // 遍历组内的条件（AND 关系）
          for (let i = 0; i < group.length; i++) {
            const evaluate = this.compileCondition(group[i]);
            if (!evaluate) { groupResult = false; break; }

            // 如果任何条件不满足，整个组失败
            if (!evaluate()) {
              groupResult = false;
              break;
            }
          }

          // 如果任何组满足，返回true
          if (groupResult) {
            return true;
          }
        }

        return false;
      },

    };

AAD.Utils.Format = {
      formatDuration(seconds) {
        if (!seconds || seconds < 0) return 'NA';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor(seconds / 60) % 60;
        const secs = seconds % 60;
        const wholeSecs = Math.floor(secs);
        const ms = Math.round((secs - wholeSecs) * 100);

        // 小时为0时不显示小时部分
        return (hours > 0 ? hours + ':' : '') +
               (minutes < 10 && hours > 0 ? '0' : '') + minutes +
               (wholeSecs < 10 ? ':0' : ':') + wholeSecs +
               (ms < 10 ? '.0' : '.') + ms;
      },



      formatLargeNumber(num) {
        if (num === 0) return '0';

        const absNum = Math.abs(num);
        const sign = num < 0 ? '-' : '';

        if (absNum >= 1e12) {
          return sign + (absNum / 1e12).toFixed(2) + 't';
        } else if (absNum >= 1e9) {
          return sign + (absNum / 1e9).toFixed(2) + 'b';
        } else if (absNum >= 1e6) {
          return sign + (absNum / 1e6).toFixed(2) + 'm';
        } else if (absNum >= 1e3) {
          return sign + (absNum / 1e3).toFixed(1) + 'k';
        } else {
          return sign + absNum.toString();
        }
      },

      // 数值精度修复
      fixPrecision(value, decimals) {
        decimals = decimals || 2;
        return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
      },


    };

AAD.Utils.Common = {
      // 显示状态消息
      showStatus(message) {
        console.log(`[AAD状态] ${message}`);
      },

      // 节流函数 - 限制函数执行频率
      throttle(func, delay) {
        let lastCall = 0;
        let timeoutId = null;

        return function(...args) {
          const now = Date.now();
          const timeSinceLastCall = now - lastCall;

          if (timeSinceLastCall >= delay) {
            lastCall = now;
            func.apply(this, args);
          } else {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
              lastCall = Date.now();
              func.apply(this, args);
            }, delay - timeSinceLastCall);
          }
        };
      },

      // 警告提示函数 (alert)
      alert(func, l0, l2, answer) {
        if (func === -1) {
          return l0;
        } else if (func === 0) {
          window.alert(l0);
        } else if (func === 1) {
          return window.confirm(l0);
        } else if (func === 2) {
          return window.prompt(l0, answer);
        }
      },

    };


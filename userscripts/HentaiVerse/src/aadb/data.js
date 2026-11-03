AAD.Data = {};

AAD.Data.MonsterDB = {
      storageKey: 'MonsterDB_monsters',
      storeCache: null,

      loadStore() {
        if (this.storeCache) return this.storeCache;
        try {
          const json = localStorage.getItem(this.storageKey);
          this.storeCache = json ? JSON.parse(json) : {};
        } catch (error) {
          console.error('[MonsterDB] 读取怪物数据库失败:', error);
          this.storeCache = {};
        }
        return this.storeCache;
      },

      saveStore(store) {
        localStorage.setItem(this.storageKey, JSON.stringify(store || {}));
        this.storeCache = store || {};
      },

      getById(monsterId) {
        const store = this.loadStore();
        return store && monsterId ? (store[monsterId] || null) : null;
      },

      clearStoreCache() {
        this.storeCache = null;
      },

      hasStoredData() {
        return !!localStorage.getItem(this.storageKey);
      },

      getStatusText() {
        if (this.storeCache) return `已加载 (${Object.keys(this.storeCache).length})`;
        return this.hasStoredData() ? '就绪' : '未加载';
      },

      deleteData() {
        localStorage.removeItem(this.storageKey);
        this.clearStoreCache();
      },

      async update() {
        const data = await new Promise((resolve, reject) => {
          const handleLoad = (response) => {
            if (response.status < 200 || response.status >= 400) {
              reject(new Error(`HTTP ${response.status}`));
              return;
            }
            try {
              resolve(response.response || JSON.parse(response.responseText));
            } catch (error) {
              reject(error);
            }
          };
          const request = GM.xmlHttpRequest({
            method: 'GET',
            url: 'https://hv-monsterdb-data.skk.moe/persistent.json',
            responseType: 'json',
            onload: handleLoad,
            onerror: () => reject(new Error('MonsterDB request failed'))
          });
          if (request && typeof request.then === 'function') {
            request.then(handleLoad).catch(reject);
          }
        });
        const store = {};
        let count = 0;
        for (const monster of data) {
          if (!monster || monster.plvl <= 1500) continue;
          store[monster.monsterId] = {
            monsterId: monster.monsterId,
            monsterClass: monster.monsterClass,
            plvl: monster.plvl,
            piercing: monster.piercing,
            crushing: monster.crushing,
            slashing: monster.slashing,
            cold: monster.cold,
            wind: monster.wind,
            elec: monster.elec,
            fire: monster.fire,
            dark: monster.dark,
            holy: monster.holy,
            lastUpdate: monster.lastUpdate
          };
          count += 1;
        }
        this.saveStore(store);
        return count;
      }
    };

AAD.Data.Recorder = {
      combat: {},
      drops: {},
      timelog: {},

      // 记录状态
      isRecording: false,
      battleStarted: false,
      battleEnded: false,

      init() {
        // 从页面生命周期管理器恢复临时数据
        const restored = AAD.Core.Storage.PageLifecycle.restoreTempData();
        if (restored) {
          console.log('[数据记录器] 从页面生命周期管理器恢复战斗数据成功');
        } else {
          console.log('[数据记录器] 未找到临时数据，将从新战斗开始记录');
        }

      },


      // 开始战斗记录
      startBattle() {
        if (this.battleStarted) return;

        this.battleStarted = true;
        this.isRecording = true;
        this.battleEnded = false;

        // 初始化时间记录（延迟到第一次动作时设置）
        this.timelog = {
          startTime: null,
          endTime: null
        };

        this._initBattleData();


      },

      // 小马图计数（答题页触发）
      recordHorseFromRiddle() {
        const option = AAD.Core.Storage.getValue('option') || {};
        if (!option.dataRecordSwitch) return false;

        if (sessionStorage.getItem('db_riddle_counted') === '1') {
          return false;
        }

        const key = AAD.Core.Storage.PageLifecycle.getTempDataKey();
        const tempData = AAD.Core.Storage.getValue(key);
        if (!tempData || !tempData.battleStarted || !tempData.combat || !tempData.combat.stats) {
          return false;
        }

        sessionStorage.setItem('db_riddle_counted', '1');
        tempData.combat.stats.horseCount = (tempData.combat.stats.horseCount || 0) + 1;
        AAD.Core.Storage.setValue(key, tempData);
        return true;
      },

      // 结束战斗记录并保存数据到IndexedDB
      endBattle() {
        if (!this.battleStarted || !this.isRecording) {
          return;
        }

        // 防止重复触发
        if (this.battleEnded) {
          return;
        }

        this.battleEnded = true;
        this.timelog.endTime = Date.now();

        const battleData = {
          combat: this.combat,
          drops: this.drops,
          timelog: this.timelog
        };

        AAD.Core.Database.saveBattle(battleData)
          .then(() => {
            console.log('[数据记录器] 战斗数据保存成功 - IndexedDB');
          })
          .catch(error => {
            console.error('[数据记录器] 保存战斗数据失败:', error);
          });

        this.reset();
      },



      // 掉落监控 - 处理战斗日志中的掉落信息
      dropMonitor(battleLog) {
        if (!this.battleStarted) {
          this.startBattle();
        }

        for (let i = 0; i < battleLog.length; i++) {
          const logEntry = battleLog[i];
          const textContent = AAD.Utils.DOM.rawText(logEntry);

          // 基础 EXP/Credit 掉落
          const gainMatch = textContent.match(/^You gain (\d+) (EXP|Credit)/);
          if (gainMatch) {
            this.drops[gainMatch[2]] = (this.drops[gainMatch[2]] || 0) + parseInt(gainMatch[1], 10);
            continue;
          }

          // 带有 span 标签的物品掉落
          const itemSpan = AAD.Utils.DOM.gE('span', logEntry);
          if (itemSpan) {
            this._processItemDrop(itemSpan, textContent);
            continue;
          }

          // 材料分解掉落 (salvage)
          if (textContent.includes('salvages it into')) {
            this._processSalvageDrop(textContent);
            continue;
          }

          // 其他物品掉落 (You find)
          const findMatch = textContent.match(/You find a (.+?)!/);
          if (findMatch) {
            const itemName = findMatch[1].trim();
            if (itemName) {
              this.drops[itemName] = (this.drops[itemName] || 0) + 1;
            }
          }
        }
      },

      // 处理物品掉落（私有方法）
      _processItemDrop(itemSpan, textContent) {
        const nameMatch = AAD.Utils.DOM.rawText(itemSpan).match(/^\[(.*?)\]$/);
        if (!nameMatch) return;

        const itemName = nameMatch[1];
        const color = itemSpan.style.color;
        const isSalvage = textContent && textContent.includes('salvages it into');
        if (isSalvage) {
          this._processSalvageDrop(textContent);
        }

        // 水晶掉落（紫色）
        if (color === 'rgb(186, 5, 180)') {
          const crystalMatch = itemName.match(/^(\d+)x (Crystal of \w+)$/) ||
                              itemName.match(/^(Crystal of \w+)$/);
          if (crystalMatch) {
            const crystalName = crystalMatch[2] || crystalMatch[1];
            const amount = crystalMatch[1] && crystalMatch[1].match(/^\d+$/) ?
                          parseInt(crystalMatch[1], 10) : 1;
            this.drops[crystalName] = (this.drops[crystalName] || 0) + amount;
          }
        }
        // 金币掉落（黄色）
        else if (color === 'rgb(168, 144, 0)') {
          const creditMatch = itemName.match(/(\d+)/);
          if (creditMatch) {
            const amount = parseInt(creditMatch[1], 10);
            const key = textContent.includes('gives you') ? 'CreditFromTrash' : 'Credit';
            this.drops[key] = (this.drops[key] || 0) + amount;
          }
        }
        // 装备掉落（红色）
        else if (color === 'rgb(255, 0, 0)') {
          const qualityKey = itemName.includes('Legendary')
            ? 'Legendary'
            : itemName.includes('Peerless')
              ? 'Peerless'
              : null;
          if (qualityKey) {
            this._recordEquipDrop(itemName, qualityKey);
          }
        }
        // 其他掉落
        else {
          if (itemName.includes('Blood')) {
            this.drops.Blood = (this.drops.Blood || 0) + 1;
          } else if (itemName.includes('Chaos')) {
            this.drops.Chaos = (this.drops.Chaos || 0) + 1;
          } else {
            this.drops[itemName] = (this.drops[itemName] || 0) + 1;
          }
        }
      },

      // 记录Legendary/Peerless装备掉落（私有方法）
      _recordEquipDrop(itemName, qualityKey) {
        if (!qualityKey) return;

        if (!this.drops.Equips) {
          this.drops.Equips = { Legendary: {}, Peerless: {} };
        }
        if (!this.drops.Equips[qualityKey]) {
          this.drops.Equips[qualityKey] = {};
        }

        this.drops.Equips[qualityKey][itemName] = (this.drops.Equips[qualityKey][itemName] || 0) + 1;
        this.drops[qualityKey] = (this.drops[qualityKey] || 0) + 1;
      },

      // 处理材料分解掉落（私有方法）
      _processSalvageDrop(textContent) {
        const salvageMatch = textContent.match(/salvages it into (.*)/);
        if (!salvageMatch) return;

        const materialMatches = [...salvageMatch[1].matchAll(/(\d+)x \[(.*?)\]/g)];
        for (const match of materialMatches) {
          const materialName = match[2];
          const amount = parseInt(match[1], 10);
          this.drops[materialName] = (this.drops[materialName] || 0) + amount;
        }
      },

      // 获取当前记录器状态
      getCurrentState() {
        return {
          combat: this.combat,
          drops: this.drops,
          timelog: this.timelog,
          isRecording: this.isRecording,
          battleStarted: this.battleStarted,
          battleEnded: this.battleEnded
        };
      },

      // 初始化战斗数据结构（私有方法）
      _initBattleData() {
        this.combat = {
          stats: {
            totalTurns: 0,
            totalRounds: 0,
            sparkCount: 0,
            horseCount: 0
          },
          resist: {
            debuffResist0: 0,
            debuffResist12: 0,
            debuffResist3: 0,
            magicHit: 0,
            magicCrit: 0,
            magicResistPartially: 0,
            magicResist: 0
          },
          items: {},
          magic: {},
          proficiency: {}
        };

        this.drops = {
          EXP: 0,
          Credit: 0,
          CreditFromTrash: 0,
          Legendary: 0,
          Peerless: 0,
          Equips: {
            Legendary: {},
            Peerless: {}
          }
        };
      },

      // 完全重置状态
      reset() {
        this.battleStarted = false;
        this.isRecording = false;
        this.battleEnded = false;

        // 重新创建对象，防止引用污染
        this._initBattleData();
        this.timelog = {};
      },

      // 确保抵抗统计结构完整（私有方法）
      _ensureResist(combat) {
        if (!combat.resist) {
          combat.resist = {
            debuffResist0: 0,
            debuffResist12: 0,
            debuffResist3: 0,
            magicHit: 0,
            magicCrit: 0,
            magicResistPartially: 0,
            magicResist: 0
          };
          return combat.resist;
        }

        const resist = combat.resist;
        if (resist.debuffResist0 == null) resist.debuffResist0 = 0;
        if (resist.debuffResist12 == null) resist.debuffResist12 = 0;
        if (resist.debuffResist3 == null) resist.debuffResist3 = 0;
        if (resist.magicHit == null) resist.magicHit = 0;
        if (resist.magicCrit == null) resist.magicCrit = 0;
        if (resist.magicResistPartially == null) resist.magicResistPartially = 0;
        if (resist.magicResist == null) resist.magicResist = 0;
        return resist;
      },

      // 统计Debuff抵抗次数（按施法块）
      _processDebuffResistLog(logEntries, endIndex, combat) {
        if (!logEntries || endIndex <= 0) return;

        const resist = this._ensureResist(combat);

        let pendingGain = 0;
        let pendingPartial = 0;
        let pendingShrug = 0;

        for (let i = 0; i < endIndex; i++) {
          const text = AAD.Utils.DOM.rawText(logEntries[i]);

          if (text.includes(' gains the effect ')) {
            pendingGain += 1;
            continue;
          }

          if (text.includes(' partially resists the effects of your spell.')) {
            pendingPartial += 1;
            continue;
          }

          if (text.includes(' shrugs off the effects of your spell.')) {
            pendingShrug += 1;
            continue;
          }

          if (text.trimStart().startsWith('You cast ')) {
            if (pendingGain || pendingPartial || pendingShrug) {
              const resist0 = pendingGain - pendingPartial;
              resist.debuffResist0 += resist0;
              if (pendingPartial > 0) resist.debuffResist12 += pendingPartial;
              if (pendingShrug > 0) resist.debuffResist3 += pendingShrug;
            }
            pendingGain = 0;
            pendingPartial = 0;
            pendingShrug = 0;
            continue;
          }

          if (pendingGain || pendingPartial || pendingShrug) {
            pendingGain = 0;
            pendingPartial = 0;
            pendingShrug = 0;
          }
        }
      },

      // 统计攻击法术的命中/抵抗（单行）
      _processMagicAttackResistLine(text, resist) {
        if (!text) return;

        if (text.includes('resists your spell.')) {
          resist.magicResist += 1;
          return;
        }

        if (text.includes('resists, and was')) {
          resist.magicResistPartially += 1;
        }

        const hitMatch = text.match(/\b(glanced|hit|crit|eviscerated)\b for \d+ \w+ damage/);
        if (!hitMatch) return;

        if (hitMatch[1] === 'crit') {
          resist.magicCrit += 1;
          return;
        }

        resist.magicHit += 1;
      },

      // 处理动作相关的日志
      processActionLog(text, combat, actionParm) {
        let reg, magic, point;

        // 火花检测
        if (text.match(/You gain the effect Cloak of the Fallen/)) {
          combat.stats.sparkCount = (combat.stats.sparkCount || 0) + 1;
        } else if (text.match(/You gain .* proficiency/)) {
          reg = text.match(/You gain ([\d.]+) points of (.*?) proficiency/);
          magic = reg[2];
          point = reg[1] * 1;
          combat.proficiency[magic] = (magic in combat.proficiency) ? combat.proficiency[magic] + point : point;
          combat.proficiency[magic] = combat.proficiency[magic].toFixed(3) * 1;
        }
      },

      // 处理战斗日志
      processBattleLog(actionParm = null) {
        if (!AAD.Core.Storage.getValue('option')?.dataRecordSwitch) return;

        try {
          // 确保数据记录器正在记录
          if (!this.battleStarted) {
            this.startBattle();
          }

          // 在第一个实际动作时记录开始时间
          if (this.timelog.startTime === null) {
            this.timelog.startTime = Date.now();
          }

          // 统一数据源：BattleRecorder.combat
          const combat = this.combat;

          // ===== 1. 动作记录部分（如果传入了动作参数） =====
          if (actionParm) {
            // 更新战斗统计
            const monsterAlive = AAD.Core.State.get('monsterAlive', 0);
            const isAttackMagic = actionParm.mode === 'magic' && SPELL_LISTS.ATTACK.includes(actionParm.magic);
            const resist = isAttackMagic ? this._ensureResist(combat) : null;

            if (monsterAlive === 0) {
              combat.stats.totalRounds += 1;
            }

            // 记录动作使用数据
            if (actionParm.mode === 'magic') {
              const magic = actionParm.magic;
              combat.magic[magic] = (magic in combat.magic) ? combat.magic[magic] + 1 : 1;
            } else if (actionParm.mode === 'items') {
              combat.items[actionParm.item] = (actionParm.item in combat.items) ? combat.items[actionParm.item] + 1 : 1;
            } else {
              combat.stats[actionParm.mode + 'Count'] = (combat.stats[actionParm.mode + 'Count'] || 0) + 1;
            }

            // 处理动作相关的日志
            if (actionParm.log && actionParm.log.length > 0) {
              let endIndex = actionParm.log.length;
              for (let i = 0; i < actionParm.log.length; i++) {
                if (actionParm.log[i].className === 'tls') {
                  endIndex = i;
                  break;
                }
                const text = AAD.Utils.DOM.rawText(actionParm.log[i]);
                this.processActionLog(text, combat, actionParm);
                if (isAttackMagic) {
                  this._processMagicAttackResistLine(text, resist);
                }
              }
              this._processDebuffResistLog(actionParm.log, endIndex, combat);
            }
          }

        } catch (error) {
          console.error('[Data.Recorder] 处理战斗日志失败:', error);
        }
      },

      // 处理战斗结束 - 整合所有战斗结束逻辑
      handleBattleEnd() {
        if (!this.battleStarted || this.battleEnded) {
          return;
        }

        const combat = this.combat;


        // 记录结束时间
        this.timelog.endTime = Date.now();

        // 记录战败日志（仅战败时保存完整文本）
        try {
          const isDefeat = AAD.Core.State.get('endbattle', false);
          if (isDefeat) {
            const textlog = document.getElementById('textlog');
            const logRows = textlog && textlog.rows ? Array.from(textlog.rows) : [];
            const logText = logRows.length > 0 ? logRows.map(row => row.innerText).join('\n') : '';
            combat.stats.defeatLog = {
              log: logText,
              timestamp: Date.now()
            };
          }
        } catch (error) {
          console.error('[数据记录器] 记录战败日志失败:', error);
        }

        // 触发战斗结束处理
        this.endBattle();
      }
    };

AAD.Data.Statistics = {
      extractCombatData(source, target, targetKey, excludeFields) {
        if (!source) return;

        // 确保目标键存在
        if (!target[targetKey]) {
          target[targetKey] = {};
        }

        for (const type in source) {
          if (typeof source[type] === 'number' && source[type] > 0 && !excludeFields.includes(type)) {
            target[targetKey][type] = (target[targetKey][type] || 0) + source[type];
          }
        }
      },

      extractAllCombatData(combatData, totalUsageData) {
        // 提取熟练度统计
        this.extractCombatData(combatData.proficiency, totalUsageData, 'proficiency', []);

        // 提取抵抗统计
        this.extractCombatData(combatData.resist, totalUsageData, 'resist', []);

        // 提取技能和物品使用数据
        if (combatData.items) {
          if (!totalUsageData.items) totalUsageData.items = {};
          for (const item in combatData.items) {
            if (combatData.items[item] > 0) {
              totalUsageData.items[item] = (totalUsageData.items[item] || 0) + combatData.items[item];
            }
          }
        }

        if (combatData.magic) {
          if (!totalUsageData.magic) totalUsageData.magic = {};
          for (const spell in combatData.magic) {
            if (combatData.magic[spell] > 0) {
              totalUsageData.magic[spell] = (totalUsageData.magic[spell] || 0) + combatData.magic[spell];
            }
          }
        }
      },

      // 数据转换函数
      convertToUnifiedBattleRecord(flatData) {
        // 格式化显示时间
        let formattedTime = '';
        const endTime = flatData.endTime;
        if (endTime && !isNaN(endTime)) {
          try {
            const date = new Date(endTime);
            if (!isNaN(date.getTime())) {
              formattedTime = date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate() + ' ' +
                             String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
            }
          } catch (e) {
            formattedTime = String(endTime).substring(0, 16);
          }
        }

        // 计算TPS
        const tps = flatData.duration > 0 ? Math.round((flatData.turns / flatData.duration) * 100) / 100 : 0;

          return {
            // 基础信息
            id: flatData.id,
            timestamp: formattedTime,
            rawTime: endTime,
            utcDate: flatData.date,
            battle_type: flatData.battleType || 'BA',

          // 直接使用扁平化字段（零开销）
          rounds: flatData.rounds,
          turns: flatData.turns,
          duration: AAD.Utils.Format.formatDuration(flatData.duration),
          tps: tps,
          seconds: flatData.duration,

          // 财务数据（已预计算）
          exp: flatData.exp,
          credit: flatData.credit,
          revenue: flatData.revenue,
          cost: flatData.cost,
          profit: flatData.profit,
          profit_without_ed: flatData.profitWithoutED,
          potion_net_income: flatData.potionNetIncome,
          scroll_net_income: flatData.scrollNetIncome,

          // 掉落统计（已预计算）
          artifacts: flatData.artifacts,
          blood: flatData.blood,
          chaos: flatData.chaos,
          legendary: flatData.legendary,
          peerless: flatData.peerless,

          // 消耗品统计（已预计算）
          potions: flatData.potions,
          scrolls: flatData.scrolls,
          gems: flatData.gems,
          others: flatData.others,

          // 技能统计（已预计算）
          attack_spells: flatData.attackSpells,
          support_spells: flatData.supportSpells,
          heal_spells: flatData.healSpells,
          debuff_spells: flatData.debuffSpells,

          // 事件统计（已预计算）
          horse: flatData.horse,
          spark: flatData.spark,

          // 详细数据（按需解压）
          _dropData: flatData.detailsCompressed.drops,
          _usageData: {
            items: flatData.detailsCompressed.items,
            magic: flatData.detailsCompressed.magic,
            proficiency: flatData.detailsCompressed.proficiency || {},
            resist: flatData.detailsCompressed.resist
          },
          _defeatLog: flatData.detailsCompressed.defeatLog
        };
      },

      // 数据统计和处理函数
      batchCountItemsAndSpells(combat) {
        const result = {
          potions: 0,
          scrolls: 0,
          gems: 0,
          others: 0,
          attack_spells: 0,
          support_spells: 0,
          heal_spells: 0,
          debuff_spells: 0
        };

        if (!combat || !combat.items) return result;

        result.potions = ItemStatsUtil.countItems(combat, ITEM_LISTS.POTIONS);
        result.scrolls = ItemStatsUtil.countItems(combat, ITEM_LISTS.SCROLLS);
        result.gems = ItemStatsUtil.countItems(combat, ITEM_LISTS.GEMS);
        result.others = ItemStatsUtil.countItems(combat, ITEM_LISTS.OTHERS);

        // 技能统计（如果有魔法数据）
        if (combat.magic) {
          for (const spellName in combat.magic) {
            const count = combat.magic[spellName] || 0;
            if (SPELL_LISTS.ATTACK.includes(spellName)) {
              result.attack_spells += count;
            } else if (SPELL_LISTS.SUPPORT.includes(spellName)) {
              result.support_spells += count;
            } else if (SPELL_LISTS.HEAL.includes(spellName)) {
              result.heal_spells += count;
            } else if (SPELL_LISTS.DEBUFF.includes(spellName)) {
              result.debuff_spells += count;
            }
          }
        }

        return result;
      },

      // 统计马事件数量
      countHorseEvents(combat) {
        if (!combat || !combat.stats) return 0;
        return combat.stats.horseCount || 0;
      },

      // 统计火花事件数量
      countSparkEvents(combat) {
        if (!combat || !combat.stats) return 0;
        return combat.stats.sparkCount || 0;
      },

      buildStatsQueryOptions(optionsOrLimit = 100, battleType = null, isIsekai = null, defaultLimit = 100) {
        const options = (typeof optionsOrLimit === 'object' && optionsOrLimit !== null)
          ? optionsOrLimit
          : { limit: optionsOrLimit, battleType: battleType, isekai: isIsekai };

        const limitValue = Number(options.limit);
        const limit = Number.isFinite(limitValue) ? Math.max(0, limitValue) : defaultLimit;
        const normalizedBattleType = (typeof options.battleType === 'string' && options.battleType !== '')
          ? options.battleType
          : null;
        const order = options.order === 'asc' ? 'asc' : 'desc';
        const normalizeIsekai = (value) => {
          if (typeof value === 'boolean') return value ? 1 : 0;
          if (value === 0 || value === 1) return value;
          return null;
        };
        const normalizedIsekai = normalizeIsekai(options.isekai);
        const includeAllWorlds = !!options.includeAllWorlds || normalizedIsekai === null;

        const parseDateStart = (dateStr) => {
          if (!dateStr) return null;
          const date = new Date(`${dateStr}T00:00:00`);
          const time = date.getTime();
          return Number.isNaN(time) ? null : time;
        };

        const parseDateEnd = (dateStr) => {
          if (!dateStr) return null;
          const date = new Date(`${dateStr}T23:59:59.999`);
          const time = date.getTime();
          return Number.isNaN(time) ? null : time;
        };

        const normalizeDateKey = (dateStr) => {
          if (!dateStr || typeof dateStr !== 'string') return null;
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
          const time = new Date(dateStr).getTime();
          if (Number.isNaN(time)) return null;
          return new Date(time).toISOString().split('T')[0];
        };

        let startTime = parseDateStart(options.dateFrom);
        let endTime = parseDateEnd(options.dateTo);
        let startDate = normalizeDateKey(options.dateFrom);
        let endDate = normalizeDateKey(options.dateTo);

        if (startTime !== null && endTime !== null && startTime > endTime) {
          const tempTime = startTime;
          startTime = endTime;
          endTime = tempTime;
          const tempDate = startDate;
          startDate = endDate;
          endDate = tempDate;
        } else if (startDate && endDate && startDate > endDate) {
          const tempDate = startDate;
          startDate = endDate;
          endDate = tempDate;
        }

        return {
          limit,
          battleType: normalizedBattleType,
          order,
          isekai: normalizedIsekai,
          includeAllWorlds,
          startTime,
          endTime,
          startDate,
          endDate
        };
      },

      async getBattleDataByRecord(optionsOrLimit = 100, battleType = null, isIsekai = null) {
        const queryOptions = this.buildStatsQueryOptions(optionsOrLimit, battleType, isIsekai, 100);
        if (queryOptions.limit <= 0) {
          return [];
        }

        const criteriaBase = {
          order: queryOptions.order,
          limit: queryOptions.limit
        };
        if (queryOptions.battleType) criteriaBase.battleType = queryOptions.battleType;
        if (queryOptions.startTime !== null) criteriaBase.startTime = queryOptions.startTime;
        if (queryOptions.endTime !== null) criteriaBase.endTime = queryOptions.endTime;

        let rawRecords = [];
        if (queryOptions.includeAllWorlds) {
          const [mainData, isekaiData] = await Promise.all([
            AAD.Core.Database.queryBattlesLimited(Object.assign({ isekai: 0 }, criteriaBase)),
            AAD.Core.Database.queryBattlesLimited(Object.assign({ isekai: 1 }, criteriaBase))
          ]);

          const direction = queryOptions.order === 'asc' ? 1 : -1;
          rawRecords = mainData.concat(isekaiData)
            .sort((a, b) => direction * ((a.endTime || 0) - (b.endTime || 0)))
            .slice(0, queryOptions.limit);
        } else {
          rawRecords = await AAD.Core.Database.queryBattlesLimited(
            Object.assign({ isekai: queryOptions.isekai }, criteriaBase)
          );
        }

        const unifiedRecords = [];
        rawRecords.forEach(record => {
          try {
            const unifiedRecord = this.convertToUnifiedBattleRecord(record);
            if (unifiedRecord && (unifiedRecord.exp >= 0 || unifiedRecord.credit >= 0 || unifiedRecord.rounds > 0)) {
              unifiedRecords.push(unifiedRecord);
            }
          } catch (error) {
            console.error('[BattleStats] 记录转换失败 ID:', record?.id, error);
          }
        });

        return unifiedRecords;
      },

      async getBattleDataByDay(optionsOrLimit = 50, battleType = null, isIsekai = null) {
        const queryOptions = this.buildStatsQueryOptions(optionsOrLimit, battleType, isIsekai, 50);
        if (queryOptions.limit <= 0) {
          return [];
        }

        const criteriaBase = {
          order: queryOptions.order,
          limitDays: queryOptions.limit
        };
        if (queryOptions.battleType) criteriaBase.battleType = queryOptions.battleType;
        if (queryOptions.startDate) criteriaBase.startDate = queryOptions.startDate;
        if (queryOptions.endDate) criteriaBase.endDate = queryOptions.endDate;
        if (queryOptions.startTime !== null) criteriaBase.startTime = queryOptions.startTime;
        if (queryOptions.endTime !== null) criteriaBase.endTime = queryOptions.endTime;

        if (queryOptions.includeAllWorlds) {
          const [mainRows, isekaiRows] = await Promise.all([
            AAD.Core.Database.queryDailyAggregates(Object.assign({ isekai: 0 }, criteriaBase)),
            AAD.Core.Database.queryDailyAggregates(Object.assign({ isekai: 1 }, criteriaBase))
          ]);
          return this._mergeDailyWorldRows(mainRows.concat(isekaiRows), queryOptions.order, queryOptions.limit);
        }

        return AAD.Core.Database.queryDailyAggregates(
          Object.assign({ isekai: queryOptions.isekai }, criteriaBase)
        );
      },

      _createDailyRow(dateKey) {
        return {
          timestamp: dateKey,
          rawTime: AAD.Utils.Time.getUtcDayStartMs(dateKey),
          utcDate: dateKey,
          battle_type: '汇总',
          rounds: 0, turns: 0, duration: '', tps: 0,
          exp: 0, credit: 0, revenue: 0, cost: 0, profit: 0,
          profit_without_ed: 0,
          artifacts: 0, blood: 0, chaos: 0, legendary: 0, peerless: 0,
          potions: 0, scrolls: 0, gems: 0, others: 0,
          potion_net_income: 0, scroll_net_income: 0,
          attack_spells: 0, support_spells: 0, heal_spells: 0, debuff_spells: 0,
          horse: 0, spark: 0, battleCount: 0, seconds: 0,
          _dropData: {},
          _usageData: { items: {}, magic: {}, proficiency: {}, resist: {} }
        };
      },

      _accumulateDailyRow(target, source) {
        STATISTICS_NUMERIC_FIELDS.forEach(field => {
          target[field] += source[field] || 0;
        });
        target.battleCount += source.battleCount || 0;
        target.seconds += source.seconds || 0;
        if (source._dropData) {
          AAD.Utils.Aggregation.mergeDataObjects(target._dropData, source._dropData, ['Credit', 'CreditFromTrash', 'EXP']);
        }
        if (source._usageData) {
          AAD.Utils.Aggregation.mergeDataObjects(target._usageData, source._usageData);
        }
      },

      _finalizeDailyRow(row) {
        ['revenue', 'cost', 'profit', 'profit_without_ed'].forEach(field => {
          row[field] = AAD.Utils.Format.fixPrecision(row[field], 2);
        });
        row.duration = row.seconds > 0 ? AAD.Utils.Format.formatDuration(row.seconds) : '0s';
        row.tps = row.seconds > 0 && row.turns > 0 ? Math.round((row.turns / row.seconds) * 100) / 100 : 0;
      },

      _mergeDailyWorldRows(rows, order, limit) {
        const dailyMap = new Map();

        rows.forEach(row => {
          const dateKey = row.timestamp || row.utcDate;
          if (!dateKey) return;
          if (!dailyMap.has(dateKey)) {
            dailyMap.set(dateKey, this._createDailyRow(dateKey));
          }
          this._accumulateDailyRow(dailyMap.get(dateKey), row);
        });

        const mergedRows = Array.from(dailyMap.values());
        mergedRows.forEach(row => this._finalizeDailyRow(row));
        mergedRows.sort((a, b) => {
          if (order === 'asc') {
            return a.timestamp.localeCompare(b.timestamp);
          }
          return b.timestamp.localeCompare(a.timestamp);
        });

        return mergedRows.slice(0, limit);
      },

      // 清空所有数据
      async clearAllData(isIsekai = null) {
        try {
          const db = await AAD.Core.Database.init();
          const transaction = db.transaction([AAD.Core.Database.storeName], 'readwrite');
          const store = transaction.objectStore(AAD.Core.Database.storeName);

          if (isIsekai !== null) {
            // 只清空指定世界的战斗数据
            const worldValue = isIsekai ? 1 : 0;
            const index = store.index('isekai_time');
            const range = IDBKeyRange.bound([worldValue, 0], [worldValue, Date.now()]);

            return new Promise((resolve, reject) => {
              const request = index.openCursor(range);
              let deletedCount = 0;

              request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                  cursor.delete();
                  deletedCount++;
                  cursor.continue();
                } else {
                  console.log(`[Data.Statistics] 已清理${isIsekai ? '异世界' : '主世界'}的${deletedCount}条记录`);
                  resolve(deletedCount);
                }
              };

              request.onerror = () => reject(request.error);
            });
          } else {
            // 清空所有数据
            return new Promise((resolve, reject) => {
              const request = store.clear();
              request.onsuccess = () => {
                console.log('[Data.Statistics] 已清空全部战斗数据');
                resolve();
              };
              request.onerror = () => reject(request.error);
            });
          }
        } catch (error) {
          console.error('[Data.Statistics] 清空数据失败:', error);
          throw error;
        }
      }
    };

AAD.Data.Finance = {
      // 计算收入（掉落物品价值 + 掉落的金币）
      calculateRevenue(dropData) {
        try {
          let revenue = 0;
          const itemPrices = AAD.Core.Storage.getValue('prices') || {};

          // 添加掉落的金币
          const creditRevenue = (dropData.Credit || 0) + (dropData.CreditFromTrash || 0);
          revenue += creditRevenue;

          // 计算掉落物品的价值
          const excludeKeys = ['Credit', 'CreditFromTrash', 'EXP', 'proficiency', 'Equips', 'Legendary', 'Peerless'];
          const itemRevenue = this.calculateItemValue(dropData, itemPrices, excludeKeys);
          revenue += itemRevenue;

          return AAD.Utils.Format.fixPrecision(revenue, 2);
        } catch (error) {
          console.error('[Data.Finance] 收入计算失败:', error);
          return 0;
        }
      },

      // 计算消耗（使用物品的价值）
      calculateCost(combat) {
        const itemPrices = AAD.Core.Storage.getValue('prices') || {};
        const usedItems = combat.items || {};
        const priceForCost = Object.assign({}, itemPrices, { 'Energy Drink': 0 });
        const cost = this.calculateItemValue(usedItems, priceForCost);
        return AAD.Utils.Format.fixPrecision(cost, 2);
      },

      // 计算药水净收入
      calculatePotionNetIncome(dropData, usageData) {
        return this.calculateItemNetIncome(dropData, usageData, (itemName) => {
          return itemName.includes('Potion') || itemName.includes('Elixir') || itemName.includes('Draught');
        });
      },

      // 计算卷轴净收入
      calculateScrollNetIncome(dropData, usageData) {
        return this.calculateItemNetIncome(dropData, usageData, (itemName) => {
          return itemName.includes('Scroll');
        });
      },

      // 计算物品价值（通用辅助函数）
      calculateItemValue(itemData, itemPrices, excludeKeys = []) {
        return this._calculateValueRecursive(itemData, itemPrices, excludeKeys);
      },

      // 计算物品净收入（通用辅助函数）
      calculateItemNetIncome(dropData, usageData, itemFilter) {
        const dropCount = this._countItemsRecursive(dropData, itemFilter);
        const usedItems = usageData.items || {};
        let usageCount = 0;

        for (const itemName in usedItems) {
          if (itemFilter(itemName)) {
            usageCount += usedItems[itemName] || 0;
          }
        }

        return dropCount - usageCount;
      },

      // 递归计算物品价值（私有方法）
      _calculateValueRecursive(itemData, itemPrices, excludeKeys = []) {
        let value = 0;

        for (const itemName in itemData) {
          if (excludeKeys.includes(itemName)) continue;

          const itemValue = itemData[itemName];
          if (typeof itemValue === 'number' && itemPrices[itemName]) {
            value += itemValue * itemPrices[itemName];
          } else if (typeof itemValue === 'object' && itemValue !== null) {
            value += this._calculateValueRecursive(itemValue, itemPrices, excludeKeys);
          }
        }

        return value;
      },

      // 递归统计物品数量（私有方法）
      _countItemsRecursive(data, itemFilter) {
        let count = 0;

        for (const itemName in data) {
          const itemValue = data[itemName];
          if (typeof itemValue === 'number' && itemFilter(itemName)) {
            count += itemValue;
          } else if (typeof itemValue === 'object' && itemValue !== null) {
            count += this._countItemsRecursive(itemValue, itemFilter);
          }
        }

        return count;
      },


      // 格式化字段值
      formatFieldValue(field, value) {
        if (field === 'exp' || field === 'credit' || field === 'revenue' || field === 'cost' ||
            field === 'profit' || field === 'profit_without_ed') {
          return AAD.Utils.Format.formatLargeNumber(AAD.Utils.Format.fixPrecision(value, 2));
        }
        // 所有其他数字都显示
        return value.toLocaleString();
      },


      // 汇总数据计算助手
      Helpers: {
        calculateSummaryRows(data) {
          if (data.length === 0) return { averageRow: {}, totalRow: {} };

          // 初始化汇总数据
          const summaryData = {
            averageRow: { timestamp: 'Average', battle_type: 'Average' },
            totalRow: { timestamp: 'Total', battle_type: 'Total' },
            totalDropData: {},
            totalUsageData: { items: {}, magic: {}, proficiency: {}, resist: {} },
            totalDurationSeconds: 0,
            totalTurns: 0,
            validBattles: 0
          };

          // 计算汇总数据
          data.forEach((row) => {
            // 累加数值字段
            STATISTICS_NUMERIC_FIELDS.forEach((field) => {
              const value = row[field] || 0;
              summaryData.totalRow[field] = (summaryData.totalRow[field] || 0) + value;
            });

            // 累加持续时间（使用统一的seconds字段）
            const durationSeconds = row.seconds || row.duration_seconds || 0;
            if (durationSeconds > 0) {
              summaryData.totalDurationSeconds += durationSeconds;
              summaryData.validBattles++;
            }

            // 累加回合数
            if (row.turns) {
              summaryData.totalTurns += row.turns;
            }

            // 合并掉落数据
            if (row.drops || row._dropData) {
              const dropData = row.drops || row._dropData;
              AAD.Utils.Aggregation.mergeDataObjects(summaryData.totalDropData, dropData);

            }

            // 合并使用数据（UI层统一结构）
            if (row._usageData) {
              AAD.Data.Statistics.extractAllCombatData(row._usageData, summaryData.totalUsageData);
            }

          });

          // 计算平均值
          const validRecords = summaryData.validBattles || data.length; // 回退到data.length如果没有有效记录
          if (validRecords > 0) {
            STATISTICS_NUMERIC_FIELDS.forEach((field) => {
              if (summaryData.totalRow[field] !== undefined) {
                const average = Math.round((summaryData.totalRow[field] / validRecords) * 100) / 100;
                summaryData.averageRow[field] = AAD.Data.Finance.formatFieldValue(field, average);
                summaryData.averageRow[field + '_raw'] = average; // 保存原始值用于后续计算
              }
            });

            // 计算平均持续时间和TPS
            const avgDuration = Math.round((summaryData.totalDurationSeconds / validRecords) * 100) / 100;
            const avgTps = summaryData.totalDurationSeconds > 0 ?
              Math.round((summaryData.totalTurns / summaryData.totalDurationSeconds) * 100) / 100 : 0;

            summaryData.averageRow.duration_seconds = AAD.Utils.Format.formatDuration(avgDuration);
            summaryData.averageRow.duration = AAD.Utils.Format.formatDuration(avgDuration);
            summaryData.averageRow.tps = avgTps;

            // 计算Total行的时长和TPS
            const totalTps = summaryData.totalDurationSeconds > 0 ?
              Math.round((summaryData.totalTurns / summaryData.totalDurationSeconds) * 100) / 100 : 0;

            summaryData.totalRow.duration_seconds = AAD.Utils.Format.formatDuration(summaryData.totalDurationSeconds);
            summaryData.totalRow.duration = AAD.Utils.Format.formatDuration(summaryData.totalDurationSeconds);
            summaryData.totalRow.tps = totalTps;
          }

          // 格式化Total行数值字段
          STATISTICS_NUMERIC_FIELDS.forEach((field) => {
            summaryData.totalRow[field] = AAD.Data.Finance.formatFieldValue(field, summaryData.totalRow[field] || 0);
          });

          // 设置聚合数据引用（用于tooltip）
          summaryData.averageRow._sourceDropData = summaryData.totalDropData;
          summaryData.averageRow._sourceCombatData = summaryData.totalUsageData;
          summaryData.averageRow._dataLength = data.length;
          summaryData.averageRow._lazyAveraging = true;

          // Total行也使用与Average行相同的数据源，确保数据一致性
          summaryData.totalRow._sourceDropData = summaryData.totalDropData;
          summaryData.totalRow._sourceCombatData = summaryData.totalUsageData;
          summaryData.totalRow._dataLength = data.length;
          summaryData.totalRow._lazyTotal = true; // Total行标记，用于tooltip逻辑

          return summaryData;
        }
      }
    };

AAD.Data.Market = {
      // 提取市场数据
      extractMarketData(doc) {
        // 获取表格中的所有行
        const table = doc.querySelector('#market_itemlist table');
        if (!table) {
          console.warn('[Data.Market] 未找到市场表格');
          return {};
        }

        const rows = table.querySelectorAll('tr');
        const result = {};

        // 跳过表头行，从第二行开始处理
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const cells = row.querySelectorAll('td');

          if (cells.length >= 5) {
            // 提取每列的数据
            const name = AAD.Utils.DOM.rawText(cells[0]).trim();
            const stock = parseInt(cells[1].textContent.trim().replace(/,/g, ''), 10);
            const bid = parseFloat(cells[2].textContent.trim().split(' ')[0]);
            const ask = parseFloat(cells[3].textContent.trim().split(' ')[0]);
            const mstock = parseInt(cells[4].textContent.trim().replace(/,/g, ''), 10);

            // 添加到结果对象
            result[name] = {
              stock: stock,
              bid: bid,
              ask: ask,
              mstock: mstock
            };
          }
        }
        return result;
      },

      // 获取市场价格数据
      async getPrices(ptype) {
        let prices = AAD.Core.Storage.getValue("prices") || {};
        const pages = Array("co", "ma", "tr", "ar", "fi", "mo");

        for (const page of pages) {
          try {
            // URL会自动适配当前世界（异世界时post会自动添加/isekai/前缀）
            let doc = await AAD.Core.Network.postPromise("?s=Bazaar&ss=mk&screen=browseitems&filter=" + page);
            let priceOb = this.extractMarketData(doc);

            for (const key in priceOb) {
              // 处理可能的null/undefined值
              if (ptype === "bid") {
                prices[key] = priceOb[key].bid !== undefined && priceOb[key].bid !== null ? priceOb[key].bid : null;
              } else {
                prices[key] = priceOb[key].ask !== undefined && priceOb[key].ask !== null ? priceOb[key].ask : null;
              }
            }
          } catch (error) {
            console.error(`[价格更新] 获取页面 ${page} 数据失败:`, error);
          }
        }

        AAD.Core.Storage.setValue("prices", prices);
        console.log(`[价格更新]价格更新完成，共${Object.keys(prices).length}个物品`);
      },

      // 更新价格数据主函数
      async updatePriceData(type) {
        try {
          // 更新价格数据
          await this.getPrices(type);
        } catch (error) {
          console.error('[价格更新] 处理失败', error);
          throw error;
        }
      }
    };

AAD.Data.Economy = {

      // 计算不包含ED的利润（无ED环情况下ED恢复10体力）
      calculateProfitWithoutED(baseProfit, battleType, rounds) {
        const edPrice = this.getItemPrice('Energy Drink');

        if (edPrice === 0) {
          return baseProfit; // 如果没有ED价格数据，返回基础利润
        }

        // 计算体力消耗
        const staminaCost = this.calculateStaminaCost(battleType, rounds);
        const edCost = (staminaCost / 10) * edPrice;
        return AAD.Utils.Format.fixPrecision(baseProfit - edCost, 2);
      },

      // 计算体力消耗成本
      calculateStaminaCost(battleType, rounds) {
        let staminaCost = rounds * 0.02;     // 战斗一层消耗0.02体力值
        if (battleType === 'gr') {
          staminaCost += 1;
        }
        return staminaCost;
      },

      // 获取物品价格
      getItemPrices() {
        return AAD.Core.Storage.getValue('prices') || {};
      },

      // 获取单个物品价格
      getItemPrice(itemName) {
        const prices = this.getItemPrices();
        return prices[itemName] || 0;
      }
    };

// 用户界面层 - 负责所有用户交互界面

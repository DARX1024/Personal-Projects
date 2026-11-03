// 游戏逻辑层
AAD.Logic = {};

AAD.Logic.Battle = {
      logWatchdogTimer: null,
      logObserver: null,
      lastLogCount: 0,

      getLogWatchdogDelay(option) {
        const delaySeconds = Number(option && option.delayReloadTime);
        return Number.isFinite(delaySeconds) && delaySeconds > 0 ? delaySeconds * 1000 : 60000;
      },

      getBattleLogCount() {
        const logBody = AAD.Utils.DOM.gE('#textlog>tbody');
        return logBody ? logBody.children.length : 0;
      },

      shouldRunLogWatchdog(option = AAD.Core.Storage.getValue('option') || {}) {
        if (!option.delayReload) return false;
        if (AAD.Core.Storage.getValue('disabled') || AAD.Core.Storage.getValue('missanswer')) return false;
        if (AAD.Utils.DOM.gE('#riddlecounter')) return false;
        return true;
      },

      resetLogWatchdog() {
        if (this.logWatchdogTimer) {
          clearTimeout(this.logWatchdogTimer);
          this.logWatchdogTimer = null;
        }

        const option = AAD.Core.Storage.getValue('option') || {};
        if (!this.shouldRunLogWatchdog(option)) return;

        this.logWatchdogTimer = setTimeout(() => {
          this.triggerLogWatchdogRefresh();
        }, this.getLogWatchdogDelay(option));
      },

      triggerLogWatchdogRefresh() {
        if (!this.shouldRunLogWatchdog()) {
          this.stopLogWatchdog();
          return;
        }

        AAD.Runtime.refreshPage();
      },

      bindLogObserver() {
        if (this.logObserver) {
          this.logObserver.disconnect();
          this.logObserver = null;
        }

        const logContainer = AAD.Utils.DOM.gE('#textlog');
        if (!logContainer) {
          this.lastLogCount = 0;
          this.resetLogWatchdog();
          return;
        }

        this.lastLogCount = this.getBattleLogCount();
        this.logObserver = new MutationObserver(() => {
          const currentCount = this.getBattleLogCount();
          if (currentCount === this.lastLogCount) return;

          this.lastLogCount = currentCount;
          this.resetLogWatchdog();
        });

        this.logObserver.observe(logContainer, { childList: true, subtree: true });
        this.resetLogWatchdog();
      },

      startLogWatchdog() {
        this.stopLogWatchdog();
        if (!this.shouldRunLogWatchdog()) return;
        this.bindLogObserver();
      },

      stopLogWatchdog() {
        if (this.logWatchdogTimer) {
          clearTimeout(this.logWatchdogTimer);
          this.logWatchdogTimer = null;
        }
        if (this.logObserver) {
          this.logObserver.disconnect();
          this.logObserver = null;
        }
        this.lastLogCount = 0;
      },

      // 主战斗循环
      main() {
        AAD.Core.Storage.beginTurn();
        try {
        const roundContext = this.collectRoundState();
        if (!roundContext) return;

        this.normalizeRoundContext(roundContext);

        const actions = this.decideRoundActions(roundContext);
        this.executeRoundActions(roundContext, actions);
        } finally { AAD.Core.Storage.endTurn(); }
      },

      collectRoundState() {
        const disabled = AAD.Core.Storage.getValue('disabled');
        const missanswer = AAD.Core.Storage.getValue('missanswer');

        if (disabled || missanswer) {
          document.title = AAD.Utils.Common.alert(-1, 'hvAutoAttack暂停中');
          const pauseButton = AAD.Utils.DOM.gE('#dbBox2>button');
          if (pauseButton) {
            pauseButton.innerHTML = '继续';
          }
          return null;
        }

        AAD.Core.State.set('end', false);
        this.loadMonsterStatus();

        const currentTurn = AAD.Core.State.get('turn', 0);
        AAD.Core.State.set('turn', currentTurn + 1);

        if (AAD.Data.Recorder.combat && AAD.Data.Recorder.combat.stats) {
          AAD.Data.Recorder.combat.stats.totalTurns += 1;
        }

        const battleElements = this.ensureBattleElements();
        this.updateStatusValues(battleElements);

        const option = AAD.Core.Storage.getValue('option') || {};
        if (option.dataRecordSwitch) {
          this.processBattleLog();
        }

        this.ensureMonsterStatus();
        this.updateBattleInfo();

        const buffSnapshot = this.collectBuffSnapshot();

        return {
          option,
          buffSnapshot,
          hasGemButton: !!AAD.Utils.DOM.gE('#ikey_p'),
          hasChanneling: !!AAD.Utils.DOM.gE('#pane_effects>img[src*="channeling"]')
        };
      },

      normalizeRoundContext(roundContext) {
        AAD.Utils.Condition.setContext(roundContext.buffSnapshot);
      },

      decideRoundActions(roundContext) {
        const option = roundContext.option;
        const actions = [];

        if (option.autoFlee && AAD.Utils.Condition.evaluateConditionGroups(option.fleeCondition)) {
          actions.push('autoFlee');
          return actions;
        }

        if (option.autoPause && AAD.Utils.Condition.evaluateConditionGroups(option.pauseCondition)) {
          actions.push('autoPause');
          return actions;
        }

        if (roundContext.hasGemButton) {
          actions.push('useGem');
        }

        if (Array.isArray(option.itemOrder) && option.itemOrder.length > 0) {
          actions.push('deadSoon');
        }

        if (option.specialPause && AAD.Utils.Condition.evaluateConditionGroups(option.specialPauseCondition)) {
          actions.push('specialPause');
          return actions;
        }

        if (option.defend && AAD.Utils.Condition.evaluateConditionGroups(option.defendCondition)) {
          actions.push('defend');
          return actions;
        }

        if (option.scrollSwitch && option.scroll &&
            AAD.Utils.Condition.evaluateConditionGroups(option.scrollCondition)) {
          actions.push('scroll');
        }

        if (option.channelSkillSwitch && option.channelSkill && roundContext.hasChanneling) {
          actions.push('channelSkill');
        }

        if (option.buffSkillSwitch && option.buffSkill &&
            AAD.Utils.Condition.evaluateConditionGroups(option.buffSkillCondition)) {
          actions.push('buffSkill');
        }

        if (AAD.Core.State.get('attackStatus') !== 0 && option.item && option.item.Infusion &&
            AAD.Utils.Condition.evaluateConditionGroups(option.itemInfusionCondition)) {
          actions.push('infusion');
        }

        if (option.debuffSkillSwitch &&
            AAD.Utils.Condition.evaluateConditionGroups(option.debuffSkillCondition)) {
          actions.push('debuff');
        }

        actions.push('attack');
        return actions;
      },

      executeRoundActions(roundContext, actions) {
        for (let i = 0; i < actions.length; i++) {
          if (this.executeRoundAction(roundContext, actions[i])) return;
          if (AAD.Core.State.get('end')) return;
        }
      },

      executeRoundAction(roundContext, action) {
        const buffSnapshot = roundContext.buffSnapshot;

        switch (action) {
          case 'autoFlee':
            AAD.Utils.DOM.gE('1001').click();
            setTimeout(() => AAD.Runtime.refreshPage(), AAD.Utils.Time.getRandomDelayMs(2000, 5000));
            return true;
          case 'autoPause':
          case 'specialPause':
            AAD.UI.Panel.pauseChange();
            return true;
          case 'useGem':
            this.Special.useGem();
            return AAD.Core.State.get('end');
          case 'deadSoon':
            this.Special.deadSoon();
            return AAD.Core.State.get('end');
          case 'defend':
            AAD.Utils.DOM.gE('#ckey_defend').click();
            return true;
          case 'scroll':
            this.Special.useScroll(buffSnapshot);
            return AAD.Core.State.get('end');
          case 'channelSkill':
            this.useChannelSkill();
            return AAD.Core.State.get('end');
          case 'buffSkill':
            this.useBuffSkill(buffSnapshot);
            return AAD.Core.State.get('end');
          case 'infusion':
            this.Special.useInfusions();
            return AAD.Core.State.get('end');
          case 'debuff':
            this.Skills.executeDebuffStrategy(buffSnapshot);
            return AAD.Core.State.get('end');
          case 'attack':
            this.Core.attack(buffSnapshot);
            return true;
          default:
            return false;
        }
      },

      // 采集当前回合的buff快照
      collectBuffSnapshot() {
        const snapshot = {
          playerBuffs: {},
          monsters: []
        };

        // 1. 采集玩家buff
        const playerEffects = AAD.Utils.DOM.gE('#pane_effects');
        if (playerEffects) {
          const playerBuffImgs = AAD.Utils.DOM.gE('img', 'all', playerEffects);
          for (let i = 0; i < playerBuffImgs.length; i++) {
            const img = playerBuffImgs[i];
            const src = img.getAttribute('src');
            const onmouseover = img.getAttribute('onmouseover');

            // 提取buff名称（从src中提取，如 /y/e/protection.png -> protection）
            const buffMatch = src.match(/\/e\/([^.]+)\.png/);
            if (!buffMatch) continue;
            const buffKey = buffMatch[1];

            // 提取剩余回合数
            let turns = Infinity;  // 默认为永久效果
            if (onmouseover) {
              const turnMatch = onmouseover.match(/,\s*['"]*(\d+)['"]*\s*\)$/);
              if (turnMatch) {
                turns = parseInt(turnMatch[1], 10);
              }
            }

            snapshot.playerBuffs[buffKey] = turns;
          }
        }

        // 2. 采集怪物buff
        const monsterBuffContainers = AAD.Utils.DOM.gE('div.btm6', 'all');
        for (let i = 0; i < monsterBuffContainers.length; i++) {
          const container = monsterBuffContainers[i];
          const monsterData = {
            slots: 0,
            buffs: {}
          };

          const buffImgs = AAD.Utils.DOM.gE('img', 'all', container);
          monsterData.slots = 0;

          for (let j = 0; j < buffImgs.length; j++) {
            const img = buffImgs[j];
            const src = img.getAttribute('src');
            const onmouseover = img.getAttribute('onmouseover');

            // 提取buff名称
            const buffMatch = src.match(/\/e\/([^.]+)\.png/);
            if (!buffMatch) continue;
            const buffKey = buffMatch[1];
            if (buffKey.startsWith('trio_')) continue;

            // 提取剩余回合数
            let turns = 0;  // 怪物buff默认为0（无法解析时）
            if (onmouseover) {
              const turnMatch = onmouseover.match(/,\s*['"]*(\d+)['"]*\s*\)$/);
              if (turnMatch) {
                turns = parseInt(turnMatch[1], 10);
              }
            }

            monsterData.buffs[buffKey] = turns;
            monsterData.slots += 1;
          }

          snapshot.monsters.push(monsterData);
        }

        return snapshot;
      },

      // 战斗事件初始化器
      initBattleEvents() {

        const option = AAD.Core.Storage.getValue('option') || {};

        // 创建动作参数对象
        let actionObj = null;

        // 创建战斗开始事件监听器
        const eventStart = AAD.Utils.DOM.cE('a');
        eventStart.id = 'eventStart';
        eventStart.onclick = () => {
          const option = AAD.Core.Storage.getValue('option') || {};
          const info = unsafeWindow.info;

          if (option.dataRecordSwitch) {
            // 为基础动作注入mode值
            let actionMode = info.mode;
            if (!actionMode && info.skill) {
              // 基础动作通过skill ID识别
              if (info.skill === '#ckey_focus') actionMode = 'focus';
              else if (info.skill === '#ckey_defend') actionMode = 'defend';
              else if (info.skill === '#ckey_attack') actionMode = 'attack';
            }

            actionObj = { mode: actionMode };
            if (info.mode === 'items') {
              const itemElement = AAD.Utils.DOM.gE('#pane_item div[id^="ikey"][onclick*="skill(\'' + info.skill + '\')"]');
              actionObj.item = itemElement ? itemElement.textContent : '';
            } else if (info.mode === 'magic') {
              const magicElement = AAD.Utils.DOM.gE(info.skill);
              actionObj.magic = AAD.Utils.DOM.rawText(magicElement);
              const cost = magicElement?.getAttribute('onmouseover')?.match(/\('.*', '.*', '.*', (\d+), (\d+), \d+\)/);
              if (cost) {
                actionObj.mp = parseInt(cost[1], 10);
                actionObj.oc = parseInt(cost[2], 10);
              }
            }
          }
        };
        document.body.appendChild(eventStart);

        // 创建战斗结束事件监听器
        const eventEnd = AAD.Utils.DOM.cE('a');
        eventEnd.id = 'eventEnd';
        eventEnd.onclick = () => {
          const option = AAD.Core.Storage.getValue('option') || {};
          const timeNow = Date.now();
          const runSpeed = (1000 / (timeNow - AAD.Core.State.get('timeNow', timeNow))).toFixed(2);
          AAD.Core.State.set('runSpeed', runSpeed);
          AAD.Core.State.set('timeNow', timeNow);

          // 更新怪物状态
          const monsterDead = AAD.Utils.DOM.gE('img[src*="nbardead"]', 'all').length;
          const monsterAlive = AAD.Core.State.get('monsterAll', 0) - monsterDead;
          AAD.Core.State.set('monsterAlive', monsterAlive);

          // 更新Boss状态
          const bossDead = AAD.Utils.DOM.gE('div.btm1[style*="opacity"] div.btm2[style*="background"]', 'all').length;
          const bossAlive = AAD.Core.State.get('bossAll', 0) - bossDead;
          AAD.Core.State.set('bossAlive', bossAlive);

          // 处理战斗日志
          const battleLog = AAD.Utils.DOM.gE('#textlog>tbody>tr>td', 'all');
          const gemElement = AAD.Utils.DOM.gE('#ikey_p');
          if (gemElement && battleLog && battleLog.length > 0) {
            for (let i = 0; i < battleLog.length; i++) {
              const logEntry = battleLog[i];
              if (logEntry.className === 'tls') break;
              if (AAD.Utils.DOM.rawText(logEntry).includes('You do not have a powerup gem.')) {
                gemElement.remove();
                break;
              }
            }
          }
          if (option.dataRecordSwitch && actionObj) {
            actionObj.log = battleLog;
            AAD.Data.Recorder.processBattleLog(actionObj);
          }

          if (AAD.Utils.DOM.gE('#btcp')) {
            if (option.dataRecordSwitch) {
              AAD.Data.Recorder.dropMonitor(battleLog);
            }

            // 检查战斗结束条件
            const currentRound = AAD.Core.State.get('roundNow', 0);
            const totalRounds = AAD.Core.State.get('roundAll', 0);
            const isDefeat = monsterAlive > 0;
            const isVictory = !isDefeat && currentRound === totalRounds;
            const isNextRound = !isDefeat && currentRound < totalRounds;

            if (isDefeat) {
              AAD.Core.State.set('endbattle', true);
            }

            if (option.dataRecordSwitch && (isVictory || isDefeat)) {
              AAD.Data.Recorder.handleBattleEnd();
            }

            if (isNextRound) {// 下一回合
              const completionPane = AAD.Utils.DOM.gE('#pane_completion');
              if (completionPane) {
                const btcpElement = AAD.Utils.DOM.gE('#btcp');
                if (btcpElement) {
                  completionPane.removeChild(btcpElement);
                }
              }

              // 发送下一回合请求
              AAD.Core.Network.postCallback(window.location.href, (data) => {
                if (AAD.Utils.DOM.gE('#riddlecounter', data)) {
                  // 有答题页面
                  const event = new Event('DOMContentLoaded');
                  document.dispatchEvent(event);
                  AAD.Logic.PageHandler.misspony();
                  AAD.Runtime.refreshPage();
                  return;
                }

                // 更新战斗界面
                const battleMain = AAD.Utils.DOM.gE('#battle_main');
                const battleRight = AAD.Utils.DOM.gE('#battle_right', data);
                const battleLeft = AAD.Utils.DOM.gE('#battle_left', data);

                if (battleRight && battleMain) {
                  battleMain.replaceChild(battleRight, AAD.Utils.DOM.gE('#battle_right'));
                }
                if (battleLeft && battleMain) {
                  battleMain.replaceChild(battleLeft, AAD.Utils.DOM.gE('#battle_left'));
                }

                // 重新初始化战斗对象
                unsafeWindow.battle = new unsafeWindow.Battle();
                window.battle = unsafeWindow.battle;
                unsafeWindow.battle.clear_infopane();

                const event = new Event('DOMContentLoaded');
                document.dispatchEvent(event);

                AAD.Logic.Battle.bindLogObserver();
                AAD.Logic.Battle.newRound();
                AAD.Logic.Battle.initBattleState();
                AAD.Logic.PageHandler.misspony();
                AAD.Logic.Battle.main();
              });
            } else if (isDefeat || isVictory) {
              // 战斗结束（胜利/战败）
              if (isDefeat) {
                this.handleDefeatShutdown();
              }
              AAD.Core.Storage.delValue(2); // 清理战斗相关存储
              AAD.Core.Storage.clearBattleCache(); // 清除DOM缓存
              AAD.Logic.Battle.PartialImp.clearCache();
              this.stopLogWatchdog();

              if (option.autoquit) {
                setTimeout(AAD.Runtime.refreshPage, AAD.Utils.Time.getRandomDelayMs(2000, 5000));
              }
            }
          } else {
            AAD.Logic.PageHandler.misspony();
            AAD.Logic.Battle.main();
          }
        };
        document.body.appendChild(eventEnd);
        this.startLogWatchdog();

        // 设置会话存储
        window.sessionStorage.delay = option.delay || 0;
        window.sessionStorage.delay2 = option.delay2 || 0;

        // 注入API调用劫持脚本
        const fakeApiCall = AAD.Utils.DOM.cE('script');
        fakeApiCall.textContent = 'api_call = ' + function (b, a, d) {
          const delay = window.sessionStorage.delay * 1;
          const delay2 = window.sessionStorage.delay2 * 1;
          window.info = a;
          b.open('POST', window.MAIN_URL+'json');
          b.setRequestHeader('Content-Type', 'application/json');
          b.withCredentials = true;
          b.onreadystatechange = d;
          b.onload = function () {
            document.getElementById('eventEnd').click();
          };
          document.getElementById('eventStart').click();
          if (a.mode === 'magic' && a.skill >= 200) {
            if (delay <= 0) {
              b.send(JSON.stringify(a));
            } else {
              setTimeout(function () {
                b.send(JSON.stringify(a));
              }, delay * (Math.random() * 50 + 50) / 100);
            }
          } else {
            if (delay2 <= 0) {
              b.send(JSON.stringify(a));
            } else {
              setTimeout(function () {
                b.send(JSON.stringify(a));
              }, delay2 * (Math.random() * 50 + 50) / 100);
            }
          }
        }.toString();
        document.head.appendChild(fakeApiCall);

        // 注入API响应处理脚本
        const fakeApiResponse = AAD.Utils.DOM.cE('script');
        fakeApiResponse.textContent = 'api_response = ' + function (b) {
          if (b.readyState === 4) {
            if (b.status === 200) {
              const a = JSON.parse(b.responseText);
              if (a.login !== undefined) {
                unsafeWindow.top.window.location.href = unsafeWindow.login_url;
              } else {
                if (a.error || a.reload) window.location.href = window.location.search;
                return a;
              }
            } else {
              window.location.href = window.location.search;
            }
          }
          return false;
        }.toString();
        document.head.appendChild(fakeApiResponse);
      },

      handleDefeatShutdown() {
        const option = AAD.Core.Storage.getValue('option') || {};
        if (!option.defeatShutdown) {
          return;
        }

        if (!option.idleArena && !option.autoIW) {
          return;
        }

        const nextOption = { ...option, idleArena: false, autoIW: false };
        AAD.Core.Storage.setValue('option', nextOption);
        AAD.Core.State.set('option', nextOption);

        const idleArenaToggleButton = document.getElementById('idleArenaToggleButton');
        if (idleArenaToggleButton) {
          idleArenaToggleButton.textContent = '自动AR:关';
        }

      },

      // 使用Channel技能
      useChannelSkill() {
        const option = AAD.Core.Storage.getValue('option') || {};
        if (!option?.channelSkillSwitch || !option?.channelSkill) return;

        // 检查是否有Channeling效果
        if (!AAD.Utils.DOM.gE('#pane_effects>img[src*="channeling"]')) {
          AAD.Utils.Common.showStatus('Channel技能: 无Channeling效果');
          return;
        }

        // 按顺序检查Channel技能
        const skillPack = Array.isArray(option.channelSkillOrder) ? option.channelSkillOrder : [];
        if (skillPack.length > 0) {

          for (let i = 0; i < skillPack.length; i++) {
            const skillKey = skillPack[i].trim();
            const condition = option['channelSkill' + skillKey + 'Condition'];

            if (option.channelSkill[skillKey] &&
                AAD.Utils.Condition.evaluateConditionGroups(condition)) {
              const skill = CAST_SUPPORT[skillKey];
              if (skill && AAD.Utils.DOM.isOn(skill.id)) {
                AAD.Utils.DOM.gE(skill.id).click();
                AAD.Core.State.set('end', true);
                return;
              }
            }
          }
        }

      },

      // 使用BUFF技能
      useBuffSkill(buffSnapshot) {
        const option = AAD.Core.Storage.getValue('option') || {};
        if (!option?.buffSkillSwitch || !option?.buffSkill) return;

        // 检查技能
        const skillPack = Array.isArray(option.buffSkillOrder) ? option.buffSkillOrder : [];
        for (let i = 0; i < skillPack.length; i++) {
          const j = skillPack[i];
          const skill = CAST_SUPPORT[j];
          if (!skill) continue;
          if (option.buffSkill[j] &&
              AAD.Utils.Condition.evaluateConditionGroups(option['buffSkill' + j + 'Condition']) &&
              !buffSnapshot.playerBuffs[skill.img] &&
              AAD.Utils.DOM.isOn(skill.id)) {
            AAD.Utils.DOM.gE(skill.id).click();
            AAD.Core.State.set('end', true);
            return;
          }
        }

        // 检查药剂
        for (const i in CAST_BUFF_ITEMS) {
          if (!buffSnapshot.playerBuffs[CAST_BUFF_ITEMS[i].img] &&
              option.buffSkill &&
              option.buffSkill[i] &&
              AAD.Utils.Condition.evaluateConditionGroups(option['buffSkill' + i + 'Condition']) &&
              AAD.Utils.DOM.gE('.bti3>div[onmouseover*="' + CAST_BUFF_ITEMS[i].id + '"]')) {
            AAD.Utils.DOM.gE('.bti3>div[onmouseover*="' + CAST_BUFF_ITEMS[i].id + '"]').click();
            AAD.Core.State.set('end', true);
            return;
          }
        }
      },

      // 初始化战斗状态
      initBattleState() {
        // 重置结束标志
        AAD.Core.State.set('end', false);
        this.ensureBattleElements();

      },

      // 缓存战斗相关DOM元素
      ensureBattleElements() {
        const cachedElements = AAD.Core.State.get('battleElements');
        if (cachedElements &&
            cachedElements.hpBar &&
            cachedElements.mpBar &&
            cachedElements.spBar &&
            cachedElements.ocDisplay &&
            document.contains(cachedElements.hpBar) &&
            document.contains(cachedElements.mpBar) &&
            document.contains(cachedElements.spBar) &&
            document.contains(cachedElements.ocDisplay)) {
          return cachedElements;
        }

        const battleElements = {
          isCompactMode: !AAD.Utils.DOM.gE('#vbh'),
          hpBar: null,
          mpBar: null,
          spBar: null,
          ocDisplay: null
        };

        if (!battleElements.isCompactMode) {
          battleElements.hpBar = AAD.Utils.DOM.gE('#vbh>div>img');
          battleElements.mpBar = AAD.Utils.DOM.gE('#vbm>div>img');
          battleElements.spBar = AAD.Utils.DOM.gE('#vbs>div>img');
          battleElements.ocDisplay = AAD.Utils.DOM.gE('#vcp>div>div');
        } else {
          battleElements.hpBar = AAD.Utils.DOM.gE('#dvbh>div>img');
          battleElements.mpBar = AAD.Utils.DOM.gE('#dvbm>div>img');
          battleElements.spBar = AAD.Utils.DOM.gE('#dvbs>div>img');
          battleElements.ocDisplay = AAD.Utils.DOM.gE('#dvrc');
        }

        AAD.Core.State.set('battleElements', battleElements);
        return battleElements;
      },

      // 更新状态值 (HP/MP/SP/OC)
      updateStatusValues(elements) {
        if (!elements.isCompactMode) {
          AAD.Core.State.set('hp', elements.hpBar ? elements.hpBar.offsetWidth / 500 * 100 : 0);
          AAD.Core.State.set('mp', elements.mpBar ? elements.mpBar.offsetWidth / 210 * 100 : 0);
          AAD.Core.State.set('sp', elements.spBar ? elements.spBar.offsetWidth / 210 * 100 : 0);
          AAD.Core.State.set('oc', elements.ocDisplay ? (AAD.Utils.DOM.gE('#vcp>div>div', 'all').length - AAD.Utils.DOM.gE('#vcp>div>div#vcr', 'all').length) * 25 : 0);
        } else {
          AAD.Core.State.set('hp', elements.hpBar ? elements.hpBar.offsetWidth / 418 * 100 : 0);
          AAD.Core.State.set('mp', elements.mpBar ? elements.mpBar.offsetWidth / 418 * 100 : 0);
          AAD.Core.State.set('sp', elements.spBar ? elements.spBar.offsetWidth / 418 * 100 : 0);
          AAD.Core.State.set('oc', elements.ocDisplay ? elements.ocDisplay.textContent : 0);
        }
      },

      ensureMonsterStatus() {
        const monsterHp = AAD.Utils.DOM.gE('div.btm4>div.btm5:nth-child(1)', 'all');
        const monsterCount = monsterHp.length;
        const monsterStatus = AAD.Core.State.get('monsterStatus');
        const hasHoles = Array.isArray(monsterStatus) && monsterStatus.some(item => !item);

        if (!Array.isArray(monsterStatus) || monsterStatus.length !== monsterCount || hasHoles) {
          return this.fixMonsterStatus();
        }

        return monsterStatus;
      },

      // 加载怪物状态
      loadMonsterStatus() {
        const monsterStatusStored = AAD.Core.Storage.getValue('monsterStatus');
        const monsterAll = AAD.Core.State.get('monsterAll');

        if (monsterStatusStored && monsterStatusStored.length === monsterAll) {
          AAD.Core.State.set('monsterStatus', monsterStatusStored);
        } else {
          this.fixMonsterStatus();
        }
      },


      // 处理战斗日志
      processBattleLog() {
        AAD.Data.Recorder.processBattleLog();
      },

      // 更新战斗信息显示
      updateBattleInfo() {
        // 创建或获取战斗信息显示元素
        let logElement = AAD.Utils.DOM.gE('#dbLog');
        if (!logElement) {
          const container = AAD.Utils.DOM.gE('#dbBox2');
          if (container) {
            logElement = AAD.Utils.DOM.cE('div');
            logElement.id = 'dbLog';
            logElement.className = 'dbLog';
            container.appendChild(logElement);
          }
        }

        // 攻击模式状态数组
        const attackStatusNames = [
          '物理', '火', '冰', '雷', '风', '圣', '暗'
        ];

        // 获取战斗数据
        const turn = AAD.Core.State.get('turn', 0);
        const totalTurns = AAD.Data.Recorder.combat?.stats?.totalTurns || 0;
        const runSpeed = AAD.Core.State.get('runSpeed', 0);
        const roundNow = AAD.Core.State.get('roundNow', 0);
        const roundAll = AAD.Core.State.get('roundAll', 0);
        const attackStatus = AAD.Core.State.get('attackStatus', 0);
        const monsterAlive = AAD.Core.State.get('monsterAlive', 0);
        const monsterAll = AAD.Core.State.get('monsterAll', 0);

        // 更新页面战斗信息显示
        if (logElement) {
          logElement.innerHTML = `层回合: ${turn}<br>总回合: ${totalTurns} t<br>刷速: ${runSpeed} t/s<br>层数: ${roundNow}/${roundAll}<br>模式: ${attackStatusNames[attackStatus] || '未知'}<br>敌人: ${monsterAlive}/${monsterAll}`;
        }

        // 更新页面标题
        document.title = `${turn}||${runSpeed}||${roundNow}/${roundAll}||${monsterAlive}/${monsterAll}`;
        this.countMonsterHP();
      },

      // 统计怪物血量
      countMonsterHP() {
        const monsterHp = AAD.Utils.DOM.gE('div.btm4>div.btm5:nth-child(1)', 'all');
        const namedivs = AAD.Utils.DOM.gE('div.btm3>div>div', 'all');
        const monsterStatus = AAD.Core.State.get('monsterStatus');
        const monsterBuff = AAD.Utils.DOM.gE('div.btm6', 'all');
        const option = AAD.Core.Storage.getValue('option') || {};
        let hpArray = [];
        let yggdrasilOrder = null;

        // 第一次循环 - 更新血量和死亡状态
        for (let i = 0; i < monsterHp.length; i++) {
          if (AAD.Utils.DOM.gE('img[src*="nbardead.png"]', monsterHp[i])) {
            monsterStatus[i].isDead = true;
            monsterStatus[i].hpNow = Infinity;
            monsterStatus[i].markimp = 1;
            monsterStatus[i].effHp = Infinity;
          } else {
            monsterStatus[i].isDead = false;
            monsterStatus[i].hpNow = Math.floor(monsterStatus[i].hp * parseFloat(AAD.Utils.DOM.gE('img', monsterHp[i]).style.width) / 120) + 1;
            monsterStatus[i].markimp = (monsterBuff[i] && AAD.Utils.DOM.gE('img[src*="imperil"]', monsterBuff[i])) ? 1 : 0;
            hpArray.push(monsterStatus[i].hpNow);
          }
        }

        AAD.Core.Storage.setValue('monsterStatus', monsterStatus);

        // 计算全局的最大最小血量（必须在第一次循环完成后）
        const hpLowest = Math.min.apply(null, hpArray);
        const hpMost = Math.max.apply(null, hpArray);
        const ruleReverse = option.ruleReverse;

        // 第二次循环 - 计算权重 + 特殊怪物调整
        for (let i = 0; i < monsterStatus.length; i++) {
          // 1. 计算基础权重
          if (monsterStatus[i].isDead) {
            monsterStatus[i].finWeight = Infinity;
          } else {
            monsterStatus[i].finWeight = ruleReverse ? hpMost / monsterStatus[i].hpNow * 10 : monsterStatus[i].hpNow / hpLowest * 10;
          }

          // 2. 特殊怪物权重调整
          const name = namedivs[i] ? namedivs[i].textContent : '';
          if (name === "Yggdrasil") {
            if (!monsterStatus[i].isDead && yggdrasilOrder === null) {
              yggdrasilOrder = i;
            }
            monsterStatus[i].finWeight += monsterStatus[i].isDead ? Infinity : -9999;
          } else if (name === "Urd") {
            monsterStatus[i].finWeight += monsterStatus[i].isDead ? Infinity : 9999;
          }
        }

        AAD.Core.State.set('yggdrasilOrder', yggdrasilOrder);

        // Debuff权重调整
        const weight = option.weight || {};

        const debuffCount = Math.min(monsterStatus.length, monsterBuff.length);
        for (let i = 0; i < debuffCount; i++) {
          for (const j in DEBUFF_STATUS) {
            const weightValue = weight[j] ?? 0;
            monsterStatus[i].finWeight += (AAD.Utils.DOM.gE('img[src*="' + DEBUFF_STATUS[j].img + '"]', monsterBuff[i])) ? (ruleReverse ? -weightValue : weightValue) : 0;
          }
        }

        // 怪物头部背景权重调整
        const monsterHead = AAD.Utils.DOM.gE('div.btm1', 'all');
        const headCount = Math.min(monsterStatus.length, monsterHead.length);
        for (let i = 0; i < headCount; i++) {
          monsterStatus[i].finWeight += (AAD.Utils.DOM.gE('.btm2[style^="background"]', monsterHead[i])) ? (ruleReverse ? 1000 : -1000) : 0;
        }

        // 顺序攻击规则
        const roundType = AAD.Core.State.get('roundType');
        // 全局顺序攻击：在所有场合生效
        if (option.ruleOrderGlobal) {
          for (let i = 0; i < headCount; i++) {
            monsterStatus[i].finWeight = monsterStatus[i].isDead ? Infinity : (ruleReverse ? (monsterHead.length - i) : i);
          }
        }
        // 塔内顺序攻击：仅在塔楼生效
        else if (option.ruleOrder && (roundType === 'tw')) {
          for (let i = 0; i < headCount; i++) {
            monsterStatus[i].finWeight = monsterStatus[i].isDead ? Infinity : (ruleReverse ? (monsterHead.length - i) : i);
          }
        }

        monsterStatus.sort(AAD.Utils.Array.objArrSort('finWeight'));
        AAD.Core.State.set('monsterStatus', monsterStatus);
      },

      // 新回合初始化
      newRound() {
        AAD.Core.State.set('turn', 0);

        if (window.location.hash !== '') {
          AAD.Runtime.refreshPage();
          return;
        }

        // 统计怪物数量
        const monsterCount = AAD.Utils.DOM.gE('div.btm1', 'all').length;
        AAD.Core.State.set('monsterAll', monsterCount);

        const monsterDead = AAD.Utils.DOM.gE('img[src*="nbardead"]', 'all').length;
        AAD.Core.State.set('monsterAlive', monsterCount - monsterDead);

        // 统计Boss数量
        AAD.Core.State.set('bossAll', AAD.Utils.DOM.gE('div.btm2[style^="background"]', 'all').length);
        const bossDead = AAD.Utils.DOM.gE('div.btm1[style*="opacity"] div.btm2[style*="background"]', 'all').length;
        AAD.Core.State.set('bossAlive', AAD.Core.State.get('bossAll') - bossDead);

        // 获取战斗日志
        const battleLog = AAD.Utils.DOM.gE('#textlog>tbody>tr>td', 'all');

        // 识别回合类型
        AAD.Core.State.set('roundType', (function () {
          const option = AAD.Core.Storage.getValue('option') || {};
          if (AAD.Core.Storage.getValue('roundType')) {
            const savedRoundType = AAD.Core.Storage.getValue('roundType');
            return savedRoundType;
          } else {
            let roundType;
            const temp = battleLog[battleLog.length - 1].textContent;
            if (!temp.match(/^Initializing/)) {
              roundType = '';
            } else if (temp.match(/^Initializing The Tower/)) {
              roundType = 'tw';
            } else if (temp.match(/^Initializing arena challenge/) && temp.match(/\d+/)[0] * 1 <= 35) {
              roundType = 'ar';
            } else if (temp.match(/^Initializing arena challenge/) && temp.match(/\d+/)[0] * 1 >= 105) {
              roundType = 'rb';
            } else if (temp.match(/^Initializing random encounter/)) {
              roundType = 'ba';
              if (option?.encounter && AAD.Logic.Encounter?.recordEncounterStart) {
                AAD.Logic.Encounter.recordEncounterStart(Date.now());
              }
            } else if (temp.match(/^Initializing Item World/)) {
              roundType = 'iw';
            } else if (temp.match(/^Initializing Grindfest/)) {
              roundType = 'gr';
            } else {
              roundType = '';
            }
            AAD.Core.Storage.setValue('roundType', roundType);
            return roundType;
          }
        })());

        const skillOTOS = {};
        for (const key in SPECIAL_SKILLS) {
          skillOTOS[key] = 0;
        }
        AAD.Core.State.set('skillOTOS', skillOTOS);

        // 如果是新战斗开始，初始化战斗记录器
        if (battleLog[battleLog.length - 1].textContent.match('Initializing')) {
          // 强制开启新战斗，防止沿用上一场时间
          AAD.Data.Recorder.startBattle();

          const monsterStatus = [];
          let id = 0;

          // 解析怪物信息
          for (let i = battleLog.length - 2; i > battleLog.length - 2 - AAD.Core.State.get('monsterAll'); i--) {
            let match = battleLog[i].textContent.match(/MID=(\d+).*LV=(\d+).*HP=(\d+)$/);
            let mid = match ? match[1] * 1 : null;
            let lvl = match ? match[2] * 1 : null;
            let hp = match ? match[3] * 1 : NaN;
            if (isNaN(hp)) hp = monsterStatus.length > 0 ? monsterStatus[monsterStatus.length - 1].hp : 1000;

            monsterStatus[id] = {
              order: id,
              id: (id === 9) ? 0 : id + 1,
              hp: hp,
              mid: mid,
              lvl: lvl,
              hpNow: hp,
              isDead: false,
              markimp: 0,
              effHp: null
            };
            id = id + 1;
          }

          AAD.Core.Storage.setValue('monsterStatus', monsterStatus);
          AAD.Core.State.set('monsterStatus', monsterStatus);

          // 从Initializing日志中解析回合信息
          const round = battleLog[battleLog.length - 1].textContent.match(/\(Round (\d+) \/ (\d+)\)/);
          let roundNow, roundAll;
          if (AAD.Core.State.get('roundType') !== 'ba' && round !== null) {
            roundNow = round[1] * 1;
            roundAll = round[2] * 1;
          } else {
            roundNow = 1;
            roundAll = 1;
          }

          // 直接保存到Storage
          AAD.Core.Storage.setValue('roundNow', roundNow);
          AAD.Core.Storage.setValue('roundAll', roundAll);
        } else if (!AAD.Core.Storage.getValue('monsterStatus') ||
                   AAD.Core.Storage.getValue('monsterStatus').length !== AAD.Utils.DOM.gE('div.btm2', 'all').length) {
          // 非初始化情况：重置回合信息
          AAD.Core.Storage.setValue('roundNow', 1);
          AAD.Core.Storage.setValue('roundAll', 1);
          AAD.Logic.Battle.fixMonsterStatus();
        }

        // 同步加载到内存状态
        AAD.Core.State.set('roundNow', AAD.Core.Storage.getValue('roundNow'));
        AAD.Core.State.set('roundAll', AAD.Core.Storage.getValue('roundAll'));
        AAD.Core.State.set('roundLeft', AAD.Core.Storage.getValue('roundAll') - AAD.Core.Storage.getValue('roundNow'));


      },

      PartialImp: {
        MONSTER_RACE_BASE: new Map([
          ['Arthropod', { END: 100, WIS: 40 }],
          ['Avion', { END: 40, WIS: 50 }],
          ['Beast', { END: 70, WIS: 20 }],
          ['Celestial', { END: 50, WIS: 80 }],
          ['Daimon', { END: 40, WIS: 50 }],
          ['Dragonkin', { END: 90, WIS: 60 }],
          ['Elemental', { END: 40, WIS: 120 }],
          ['Giant', { END: 120, WIS: 10 }],
          ['Humanoid', { END: 50, WIS: 70 }],
          ['Mechanoid', { END: 70, WIS: 30 }],
          ['Reptilian', { END: 80, WIS: 40 }],
          ['Sprite', { END: 20, WIS: 60 }],
          ['Undead', { END: 100, WIS: 20 }]
        ]),
        WEEKDAY_ATTR: ['holy', 'dark', 'fire', 'cold', 'wind', 'all', 'elec'],
        ATTACK_ELEM: ['Physical', 'fire', 'cold', 'elec', 'wind', 'holy', 'dark'],
        MAGIC_DAMAGE_MULT: {
          elemental: { 1: 4.25, 2: 5.85, 3: 7.5 },
          divine: { 1: 4.5, 2: 6, 3: 7.5 }
        },
        MAGIC_FINISHER_EXTRA_DAMAGE_MULT: 0.73,
        cache: {
          effHpMultiplier: new Map(),
          statUpgrade: new Map(),
          scaledStat: new Map(),
          attributeScore: new Map(),
          attributeScoreDay: null,
          profFactorPow: new Map(),
          maxSize: 1000
        },

        manageCache(cacheMap) {
          if (cacheMap.size > this.cache.maxSize) {
            cacheMap.delete(cacheMap.keys().next().value);
          }
        },

        clearCache() {
          this.cache.effHpMultiplier.clear();
          this.cache.statUpgrade.clear();
          this.cache.scaledStat.clear();
          this.cache.attributeScore.clear();
          this.cache.profFactorPow.clear();
          this.cache.attributeScoreDay = null;
        },

        statUpgrade(plvl) {
          const cache = this.cache.statUpgrade;
          if (cache.has(plvl)) return cache.get(plvl);
          const thresholds = [1300, 1431, 1560, 1698, 1839, 1983, 2100, 2200];
          let result = 17;
          for (let i = thresholds.length - 1; i >= 0; i--) {
            if (plvl >= thresholds[i]) {
              result = 18 + i;
              break;
            }
          }
          cache.set(plvl, result);
          this.manageCache(cache);
          return result;
        },

        scaledStat(base, upgrade, level) {
          const cacheKey = `${base}_${upgrade}_${level}`;
          const cache = this.cache.scaledStat;
          if (cache.has(cacheKey)) return cache.get(cacheKey);
          const upgradeFactor = Math.min(Math.max(base * 0.1, 6), 10);
          const baseStat = (base + upgradeFactor * upgrade) * level * 0.01;
          const levelBonus = Math.pow(level, 1.076675) * 0.3325;
          const result = Math.floor(baseStat + levelBonus);
          cache.set(cacheKey, result);
          this.manageCache(cache);
          return result;
        },

        getAttributeScore(attr) {
          const day = new Date().getUTCDay();
          if (this.cache.attributeScoreDay !== day) {
            this.cache.attributeScore = new Map();
            this.cache.attributeScoreDay = day;
          }
          const cache = this.cache.attributeScore;
          if (cache.has(attr)) return cache.get(attr);
          let result = 0;
          if (day === 5) {
            result = 5;
          } else if (this.WEEKDAY_ATTR[day] === attr) {
            result = 10;
          }
          cache.set(attr, result);
          return result;
        },

        getProfFactorPow(profFactor) {
          const cache = this.cache.profFactorPow;
          if (cache.has(profFactor)) return cache.get(profFactor);
          const result = Math.pow(profFactor, 1.5);
          cache.set(profFactor, result);
          this.manageCache(cache);
          return result;
        },

        getEffHpMultiplier(profFactor, attackStatus, monster) {
          const cacheAttackStatus = Number.isFinite(Number(attackStatus)) ? Number(attackStatus) : 0;
          const cacheKey = `${monster.mid}_${monster.lvl}_${monster.hp}_${profFactor}_${cacheAttackStatus}_${monster.markimp}`;
          const cache = this.cache.effHpMultiplier;
          if (cache.has(cacheKey)) return cache.get(cacheKey);

          const playerElement = this.ATTACK_ELEM[cacheAttackStatus] || this.ATTACK_ELEM[0];
          const monsterData = AAD.Data.MonsterDB.getById(monster.mid);
          let monMmi = 0.8;
          let monEmi = 75;

          if (monsterData) {
            const raceBase = this.MONSTER_RACE_BASE.get(monsterData.monsterClass);
            if (raceBase) {
              const upgrade = this.statUpgrade(monsterData.plvl);
              const monEnd = this.scaledStat(raceBase.END, upgrade, monster.lvl);
              const monWis = this.scaledStat(raceBase.WIS, upgrade, monster.lvl);
              const levelFactor = Math.max(1, (monster.lvl - 100) * 0.01);
              const baseHp = (100 + monster.lvl * 10 + monEnd * 5) * levelFactor * 2 + 50;
              const tokenUp = Math.min(Math.max(monster.hp / baseHp - 1, 0), 1);
              const baseMitigation = 900 / (900 + monEnd + monWis * 0.5);
              monMmi = 1 - baseMitigation * (1 - tokenUp * 0.2);
              monEmi = monsterData[playerElement];
              if (!Number.isFinite(monEmi)) monEmi = 75;
            }
          }

          if (monster.markimp === 1) {
            monMmi *= 0.5;
            monEmi = Math.max(monEmi - 40, 0);
          }

          monEmi -= this.getAttributeScore(playerElement);
          if (monEmi > 0) {
            monEmi = Math.max(monEmi - 50 * this.getProfFactorPow(profFactor), 0);
          }

          const multiplier = (1 / (1 - monMmi)) * (1 / (1 - monEmi * 0.01));
          cache.set(cacheKey, multiplier);
          this.manageCache(cache);
          return multiplier;
        },

        calculateEffHp(monster, option, attackStatusOverride = null) {
          const profFactor = Number(option.profFactor);
          const stateAttackStatus = AAD.Core.State.get('attackStatus', option.attackStatus || 0);
          const attackStatus = Number(attackStatusOverride ?? stateAttackStatus);
          if (!Number.isFinite(profFactor) || !Number.isFinite(attackStatus)) return null;
          if (!Number.isFinite(monster.mid) || !Number.isFinite(monster.lvl) || !Number.isFinite(monster.hp) || !Number.isFinite(monster.hpNow)) return null;
          const multiplier = this.getEffHpMultiplier(profFactor, attackStatus, monster);
          return multiplier == null ? null : Math.floor(monster.hpNow * multiplier);
        },

        calculateMagicDamage(option, buffSnapshot, mode = 3, overrides = {}) {
          const mageDamage = Number(overrides.mageDamage ?? 1);
          const mdb = Number(option.mageMDB);
          const edb = Number(overrides.edb ?? option.mageEDB);
          const hath = Number.isFinite(Number(option.hathBonus)) ? Number(option.hathBonus) : 0.5;
          const tw = Number.isFinite(Number(option.twBonus)) ? Number(option.twBonus) : 0.1;
          if (!Number.isFinite(mageDamage) || !Number.isFinite(mdb) || !Number.isFinite(edb)) return null;
          const stateAttackStatus = AAD.Core.State.get('attackStatus', option.attackStatus || 0);
          const attackStatus = Number(overrides.attackStatus ?? stateAttackStatus);
          const multGroup = (attackStatus === 5 || attackStatus === 6) ? this.MAGIC_DAMAGE_MULT.divine : this.MAGIC_DAMAGE_MULT.elemental;
          const mult = Number.isFinite(Number(overrides.mult)) ? Number(overrides.mult) : (multGroup[mode] || multGroup[3]);
          const ponyBuff = (buffSnapshot?.playerBuffs?.riddlemasterperk || 0) > 2 ? 1.2 : 1;
          return Math.floor(mageDamage * mult * mdb * (1 + edb / 100) * (1 + hath) * (1 + tw) * 1.25 * ponyBuff);
        },

        getImpDamageThreshold(option, buffSnapshot) {
          const damage = this.calculateMagicDamage(option, buffSnapshot);
          const impDamage = Number(option.impDamage);
          if (!Number.isFinite(damage) || !Number.isFinite(impDamage)) return null;
          return impDamage * damage;
        },

        getImperilArea(index, monsters) {
          return [index - 1, index, index + 1].filter((areaIndex) => areaIndex >= 0 && areaIndex < monsters.length);
        },

        hasImperil(monster, snapshotMonsters) {
          const snapshot = snapshotMonsters[monster.order] || {};
          const buffs = snapshot.buffs || {};
          return Object.prototype.hasOwnProperty.call(buffs, 'imperil');
        },

        buildPlannerInput(monsterStatus, buffSnapshot, option) {
          const ordered = [...monsterStatus].sort((a, b) => a.order - b.order);
          const snapshotMonsters = buffSnapshot?.monsters || [];
          const monsters = [];
          for (let i = 0; i < ordered.length; i++) {
            const monster = { ...ordered[i] };
            if (monster.isDead) {
              monster.markimp = 1;
              monster.effHp = Infinity;
            } else {
              monster.markimp = this.hasImperil(monster, snapshotMonsters) ? 1 : 0;
            }
            monster.effHp = (!monster.isDead && monster.markimp === 0) ? this.calculateEffHp(monster, option) : null;
            if (monster.isDead) monster.effHp = Infinity;
            monsters.push(monster);
          }
          return monsters;
        },

        calculatePartialPlan(monstersInput, impDamage) {
          const monsters = monstersInput.map((monster) => ({ ...monster }));
          const result = [];
          const isTarget = (monster) => !monster.isDead && monster.effHp > impDamage && monster.markimp === 0;
          const isNonTarget = (monster) => !monster.isDead && monster.effHp <= impDamage && monster.markimp === 0;
          while (monsters.some(isTarget)) {
            let bestPoint = -1;
            let bestScore = -1;
            let bestArea = [];
            for (let i = 0; i < monsters.length; i++) {
              if (monsters[i].isDead) continue;
              const area = this.getImperilArea(i, monsters);
              let score = 0;
              let containsTarget = false;
              for (let j = 0; j < area.length; j++) {
                const monster = monsters[area[j]];
                if (isTarget(monster)) {
                  score += 3;
                  containsTarget = true;
                } else if (isNonTarget(monster)) {
                  score += 1;
                }
              }
              if (containsTarget && score > bestScore) {
                bestScore = score;
                bestPoint = i;
                bestArea = area;
              }
            }
            if (bestPoint === -1) break;
            for (let i = 0; i < bestArea.length; i++) {
              if (!monsters[bestArea[i]].isDead) monsters[bestArea[i]].markimp = 1;
            }
            result.push(monsters[bestPoint].id);
          }
          return result;
        },

        calculateAllPlan(monstersInput) {
          const monsters = monstersInput.map((monster) => ({ ...monster }));
          const result = [];
          while (true) {
            const index = monsters.findIndex((monster) => monster.markimp === 0 && !monster.isDead);
            if (index === -1) break;
            let target = index + 1;
            if (target >= monsters.length) target = monsters.length - 1;
            while (target >= index && monsters[target].isDead) {
              target -= 1;
            }
            if (target < index) return [];
            result.push(monsters[target].id);
            const area = this.getImperilArea(target, monsters);
            for (let i = 0; i < area.length; i++) {
              if (!monsters[area[i]].isDead) monsters[area[i]].markimp = 1;
            }
          }
          return result;
        },

        castImperil(targetId) {
          const skillElement = AAD.Utils.DOM.gE(DEBUFF_CAST.Im.id);
          const targetElement = AAD.Utils.DOM.gE('#mkey_' + targetId);
          if (!skillElement || !targetElement) return false;
          skillElement.click();
          targetElement.click();
          AAD.Core.State.set('end', true);
          const monsterStatus = AAD.Core.State.get('monsterStatus');
          if (Array.isArray(monsterStatus)) {
            monsterStatus.sort(AAD.Utils.Array.objArrSort('finWeight'));
            AAD.Core.State.set('monsterStatus', monsterStatus);
          }
          return true;
        },

        executeBossMode(monsterStatus, buffSnapshot) {
          const monsters = [...monsterStatus].sort((a, b) => a.order - b.order);
          const snapshotMonsters = buffSnapshot?.monsters || [];
          let hasBoss = false;
          let bestPoint = -1;
          let bestBossHits = 0;
          let bestExtraHits = -1;

          for (let i = 0; i < monsters.length; i++) {
            if (monsters[i].isDead) continue;
            const area = this.getImperilArea(i, monsters);
            let bossHits = 0;
            let extraHits = 0;

            for (let j = 0; j < area.length; j++) {
              const monster = monsters[area[j]];
              if (monster.isDead) continue;
              const mid = Number(monster.mid);
              const isBoss = Number.isFinite(mid) && BOSS_MONSTER_IDS.has(mid);
              if (isBoss) hasBoss = true;
              if (this.hasImperil(monster, snapshotMonsters)) continue;
              if (isBoss) {
                bossHits += 1;
              } else {
                extraHits += 1;
              }
            }

            if (bossHits > bestBossHits || (bossHits === bestBossHits && extraHits > bestExtraHits)) {
              bestPoint = i;
              bestBossHits = bossHits;
              bestExtraHits = extraHits;
            }
          }

          if (!hasBoss) return null;
          if (bestPoint === -1 || bestBossHits <= 0) return false;
          return this.castImperil(monsters[bestPoint].id);
        },

        execute(buffSnapshot) {
          const option = AAD.Core.Storage.getValue('option') || {};
          if (!option.debuffSkillSwitch || !option.debuffSkillPartialIm) return false;
          if (!AAD.Utils.Condition.evaluateConditionGroups(option.debuffSkillpartialimpCondition)) return false;
          if (!AAD.Utils.DOM.isOn(DEBUFF_CAST.Im.id)) return false;
          const monsterStatus = AAD.Core.State.get('monsterStatus');
          if (!Array.isArray(monsterStatus) || monsterStatus.length === 0) return false;

          if (option.debuffSkillPartialImBossMode && AAD.Core.State.get('roundType') === 'ar') {
            const bossResult = this.executeBossMode(monsterStatus, buffSnapshot);
            if (bossResult !== null) return bossResult;
          }

          const threshold = this.getImpDamageThreshold(option, buffSnapshot);
          if (!Number.isFinite(threshold)) return false;
          const monsters = this.buildPlannerInput(monsterStatus, buffSnapshot, option);
          if (!monsters.some((monster) => !monster.isDead && monster.markimp === 0 && Number.isFinite(monster.effHp))) return false;

          const partialPlan = this.calculatePartialPlan(monsters, threshold);
          const allPlan = this.calculateAllPlan(monsters);
          let targetId = Math.min(...allPlan);
          if (partialPlan.length < allPlan.length) {
            targetId = Math.min(...partialPlan);
          }
          if (!Number.isFinite(targetId)) return false;

          return this.castImperil(targetId);
        }
      },

      // 修复怪物状态
      fixMonsterStatus() {
        document.title = AAD.Utils.Common.alert(-1, 'monsterStatus错误，正在尝试修复');
        const monsterStatus = [];
        AAD.Utils.DOM.gE('div.btm2', 'all').forEach(function(monster, i) {
          const hp = (monster.style.background === '') ? 1000 : 100000;
          monsterStatus.push({
            order: i,
            id: (i === 9) ? 0 : i + 1,
            hp: hp,
            mid: null,
            lvl: null,
            hpNow: hp,
            isDead: false,
            markimp: 0,
            effHp: null
          });
        });
        AAD.Core.Storage.setValue('monsterStatus', monsterStatus);
        AAD.Core.State.set('monsterStatus', monsterStatus);
        return monsterStatus;
      },





      // 战斗技能模块
      Skills: {

        // 使用Debuff技能
        useDeSkill(buffSnapshot) {
          const option = AAD.Core.Storage.getValue('option') || {};
          if (!option.debuffSkillSwitch || !option.debuffSkill) return false;
          if (!buffSnapshot || !Array.isArray(buffSnapshot.monsters)) return false;

          const skillPack = Array.isArray(option.debuffSkillOrder) ? option.debuffSkillOrder : [];
          const monsterStatus = AAD.Core.State.get('monsterStatus');
          if (!monsterStatus || !monsterStatus[0]) return false;

          const targetOrder = monsterStatus[0].order;
          const snapshotMonsters = buffSnapshot.monsters;
          if (targetOrder < 0 || targetOrder >= snapshotMonsters.length) return false;
          const targetMonsterData = snapshotMonsters[targetOrder];
          if (!targetMonsterData) return false;
          const targetSlots = targetMonsterData.slots || 0;
          if (targetSlots >= GAME_MECHANICS.BUFF_SLOT_LIMIT) return false;

          for (let i = 0; i < skillPack.length; i++) {
            const j = skillPack[i];
            const skill = DEBUFF_CAST[j];
            if (!skill) continue;
            const buffs = targetMonsterData.buffs || {};
            const hasBuff = Object.prototype.hasOwnProperty.call(buffs, skill.img);
            if (option.debuffSkill[j] &&
                AAD.Utils.DOM.isOn(skill.id) &&
                AAD.Utils.Condition.evaluateConditionGroups(option['debuffSkill' + j + 'Condition']) &&
                !hasBuff) {
                AAD.Utils.DOM.gE(skill.id).click();

                // 全局顺序攻击：在所有场合生效
                if (option.ruleOrderGlobal && 2 < AAD.Core.State.get('monsterAlive')) {
                  AAD.Utils.DOM.gE('#mkey_' + AAD.Core.State.get('monsterStatus')[1].id).click();
                }
                // 塔内顺序攻击：仅在塔楼生效
                else if (option.ruleOrder && AAD.Core.State.get('roundType') === 'tw' && 2 < AAD.Core.State.get('monsterAlive')) {
                  AAD.Utils.DOM.gE('#mkey_' + AAD.Core.State.get('monsterStatus')[1].id).click();
                }
                else {
                  AAD.Utils.DOM.gE('#mkey_' + AAD.Core.State.get('monsterStatus')[0].id).click();
                }

                AAD.Core.State.set('end', true);
                return true;
            }
          }
          return false;
        },

        // 快照统计某Debuff数量（槽满视为已满足）
        countBuffInSnapshot(buffSnapshot, buffKey, threshold = 0) {
          const monsters = buffSnapshot?.monsters || [];
          let count = 0;

          for (let i = 0; i < monsters.length; i++) {
            const monster = monsters[i];
            if (!monster) continue;

            const slots = monster.slots || 0;
            if (slots >= GAME_MECHANICS.BUFF_SLOT_LIMIT) {
              count += 1;
              continue;
            }

            const buffs = monster.buffs || {};
            const hasBuff = Object.prototype.hasOwnProperty.call(buffs, buffKey);
            if (threshold > 0) {
              if (hasBuff && buffs[buffKey] > threshold) count += 1;
            } else if (hasBuff) {
              count += 1;
            }
          }

          return count;
        },

        // 对所有怪物施放Debuff
        castDebuffToAll(skillKey, reverseOrder, buffSnapshot) {
          const skill = DEBUFF_CAST[skillKey];
          if (!skill) return false;
          if (!buffSnapshot || !Array.isArray(buffSnapshot.monsters)) return false;
          const skillId = skill.id;
          const imgName = skill.img;
          const conflicts = Array.isArray(skill.conflicts) ? skill.conflicts : [];
          const isSleep = (imgName === 'sleep');
          const isReverseOrder = !!reverseOrder;
          const skillAvailable = AAD.Utils.DOM.isOn(skillId);
          if (!skillAvailable) return false;

          let monsterStatus = AAD.Core.State.get('monsterStatus');
          if (!monsterStatus) return false;

          // 按照order排序
          monsterStatus = [...monsterStatus].sort((a, b) => a.order - b.order);

          const snapshotMonsters = buffSnapshot.monsters;
          const length = Math.min(monsterStatus.length, snapshotMonsters.length);
          if (length <= 0) return false;

          // 确定遍历方向和范围
          const start = isReverseOrder ? length - 1 : 0;
          const end = isReverseOrder ? 0 : length - 1;
          const step = isReverseOrder ? -1 : 1;

          for (let i = start; isReverseOrder ? i > end : i < length; i += step) {
            if (i >= length || i < 0) continue;

            // 检查是否需要施放Debuff（从快照读取）
            const monsterData = snapshotMonsters[i];
            if (!monsterData) continue;
            const slots = monsterData.slots || 0;
            const buffs = monsterData.buffs || {};
            const hasBuff = Object.prototype.hasOwnProperty.call(buffs, imgName);
            let hasConflict = false;
            for (let c = 0; c < conflicts.length; c++) {
              if (Object.prototype.hasOwnProperty.call(buffs, conflicts[c])) {
                hasConflict = true;
                break;
              }
            }
            let canCast = false;
            if (isSleep) {
              const turns = hasBuff ? (buffs[imgName] || 0) : 0;
              if (slots >= GAME_MECHANICS.BUFF_SLOT_LIMIT) {
                canCast = hasBuff && turns <= GAME_MECHANICS.DEBUFF_EFFECTIVE_TURNS;
              } else {
                canCast = !hasBuff || turns <= GAME_MECHANICS.DEBUFF_EFFECTIVE_TURNS;
              }
            } else if (slots < GAME_MECHANICS.BUFF_SLOT_LIMIT && !hasBuff) {
              canCast = true;
            }
            const isAlive = !monsterStatus[i].isDead;

            if (canCast && !hasConflict && isAlive) {
              AAD.Utils.DOM.gE(skillId).click();

              // 提取目标选择逻辑
              this.selectDebuffTarget(i, length, monsterStatus, isReverseOrder);

              AAD.Core.State.set('end', true);
              // 确保恢复排序
              monsterStatus.sort(AAD.Utils.Array.objArrSort('finWeight'));
              AAD.Core.State.set('monsterStatus', monsterStatus);
              return true;
            }
          }

          // 确保恢复排序
          monsterStatus.sort(AAD.Utils.Array.objArrSort('finWeight'));
          AAD.Core.State.set('monsterStatus', monsterStatus);
          return false;
        },

        // 选择Debuff目标
        selectDebuffTarget(i, length, monsterStatus, reverseOrder) {
          // 特殊处理：sleep从后往前，优先选择前一个目标
          if (reverseOrder) {
            if (i === 0) {
              AAD.Utils.DOM.gE('#mkey_' + monsterStatus[i].id).click();
            } else if (i - 1 > -1 && !monsterStatus[i - 1].isDead) {
              AAD.Utils.DOM.gE('#mkey_' + monsterStatus[i - 1].id).click();
            } else if (i + 1 < length && !monsterStatus[i + 1].isDead) {
              AAD.Utils.DOM.gE('#mkey_' + monsterStatus[i + 1].id).click();
            } else {
              AAD.Utils.DOM.gE('#mkey_' + monsterStatus[i].id).click();
            }
          } else {
            // 正常顺序：优先选择下一个目标
            if (i + 1 === length) {
              AAD.Utils.DOM.gE('#mkey_' + monsterStatus[i].id).click();
            } else if (i + 1 < length && !monsterStatus[i + 1].isDead) {
              AAD.Utils.DOM.gE('#mkey_' + monsterStatus[i + 1].id).click();
            } else if (i - 1 > -1 && !monsterStatus[i - 1].isDead) {
              AAD.Utils.DOM.gE('#mkey_' + monsterStatus[i - 1].id).click();
            } else {
              AAD.Utils.DOM.gE('#mkey_' + monsterStatus[i].id).click();
            }
          }
        },

        // 执行Debuff策略
        executeDebuffStrategy(buffSnapshot) {
          const option = AAD.Core.Storage.getValue('option') || {};
          const monsterAlive = AAD.Core.State.get('monsterAlive');
          let targetCount = 0;

          if (option.debuffSkillAllSleep && AAD.Utils.Condition.evaluateConditionGroups(option['debuffSkillallsleepCondition'])) {
            const sleepCount = this.countBuffInSnapshot(buffSnapshot, 'sleep', GAME_MECHANICS.DEBUFF_EFFECTIVE_TURNS);
            const minAwake = 3;
            const awakeMonstersCount = monsterAlive - sleepCount;
            if (awakeMonstersCount > minAwake) {
              targetCount = (monsterAlive - 1) * option.sleepRatio;
              if (sleepCount < targetCount) {
                AAD.Logic.Battle.GroupSkills.allsleep(buffSnapshot);
                if (AAD.Core.State.get('end')) return;
              }
            }
          }

          if (option.debuffSkillAllMN && AAD.Utils.Condition.evaluateConditionGroups(option['debuffSkillallmagnetCondition'])) {
            const magnetCount = this.countBuffInSnapshot(buffSnapshot, 'magnet');
            targetCount = (monsterAlive - 1) * option.magnetRatio;
            if (magnetCount < targetCount) {
              AAD.Logic.Battle.GroupSkills.allmagnet(buffSnapshot);
              if (AAD.Core.State.get('end')) return;
            }
          }

          if (option.debuffSkillAllWeak && AAD.Utils.Condition.evaluateConditionGroups(option['debuffSkillallweakCondition'])) {
            const weakenCount = this.countBuffInSnapshot(buffSnapshot, 'weaken');
            targetCount = monsterAlive * option.weakRatio;
            if (weakenCount < targetCount) {
              AAD.Logic.Battle.GroupSkills.allweaken(buffSnapshot);
              if (AAD.Core.State.get('end')) return;
            }
          }

          if (option.debuffSkillAllSi && AAD.Utils.Condition.evaluateConditionGroups(option['debuffSkillallsilenceCondition'])) {
            const silenceCount = this.countBuffInSnapshot(buffSnapshot, 'silence');
            targetCount = monsterAlive  * option.silenceRatio;
            if (silenceCount < targetCount) {
              AAD.Logic.Battle.GroupSkills.allsilence(buffSnapshot);
              if (AAD.Core.State.get('end')) return;
            }
          }

          if (AAD.Logic.Battle.PartialImp.execute(buffSnapshot)) return;

          if (option.debuffSkillAllIm && AAD.Utils.Condition.evaluateConditionGroups(option['debuffSkillallimpCondition'])) {
            const imperilCount = this.countBuffInSnapshot(buffSnapshot, 'imperil');
            targetCount = monsterAlive * option.impRatio;
            if (imperilCount < targetCount) {
              AAD.Logic.Battle.GroupSkills.allImperiled(buffSnapshot);
              if (AAD.Core.State.get('end')) return;
            }
          }

          // 单体施法
          if (option.debuffSkillSwitch && option.debuffSkill && AAD.Utils.Condition.evaluateConditionGroups(option.debuffSkillCondition)) {
            this.useDeSkill(buffSnapshot);
          }
        }
      },

      // 群体技能模块
      GroupSkills: {
        allsleep(buffSnapshot) {
          AAD.Logic.Battle.Skills.castDebuffToAll('Sle', true, buffSnapshot);
          return AAD.Core.State.get('end');
        },

        allweaken(buffSnapshot) {
          AAD.Logic.Battle.Skills.castDebuffToAll('We', false, buffSnapshot);
          return AAD.Core.State.get('end');
        },

        allsilence(buffSnapshot) {
          AAD.Logic.Battle.Skills.castDebuffToAll('Si', false, buffSnapshot);
          return AAD.Core.State.get('end');
        },

        allmagnet(buffSnapshot) {
          AAD.Logic.Battle.Skills.castDebuffToAll('MN', false, buffSnapshot);
          return AAD.Core.State.get('end');
        },

        allImperiled(buffSnapshot) {
          AAD.Logic.Battle.Skills.castDebuffToAll('Im', false, buffSnapshot);
          return AAD.Core.State.get('end');
        }
      },

      Special: {

        // 自动使用宝石
        useGem() {
          const gemElement = AAD.Utils.DOM.gE('#ikey_p');
          if (!gemElement) return;

          const gem = gemElement.textContent;
          const option = AAD.Core.Storage.getValue('option') || {};

          if (gem === 'Health Gem' && option.item && option.item.HealthGem && AAD.Utils.Condition.evaluateConditionGroups(option.itemHealthGemCondition)) {
            gemElement.click();
            AAD.Core.State.set('end', true);
          } else if (gem === 'Mana Gem' && option.item && option.item.ManaGem && AAD.Utils.Condition.evaluateConditionGroups(option.itemManaGemCondition)) {
            gemElement.click();
            AAD.Core.State.set('end', true);
          } else if (gem === 'Spirit Gem' && option.item && option.item.SpiritGem && AAD.Utils.Condition.evaluateConditionGroups(option.itemSpiritGemCondition)) {
            gemElement.click();
            AAD.Core.State.set('end', true);
          } else if (gem === 'Mystic Gem' && option.item && option.item.MysticGem && AAD.Utils.Condition.evaluateConditionGroups(option.itemMysticGemCondition)) {
            gemElement.click();
            AAD.Core.State.set('end', true);
          }
        },

        // 自动回血回魔
        deadSoon() {
          const option = AAD.Core.Storage.getValue('option') || {};
          const itemOrder = Array.isArray(option.itemOrder) ? option.itemOrder : [];
          if (itemOrder.length === 0) return;

          if (!AAD.Core.State.get('_cachedItemOrder') ||
              AAD.Core.State.get('_cachedItemOrderKey') !== itemOrder.join(',')) {
            const mappedOrder = [];
            for (let i = 0; i < itemOrder.length; i++) {
              const key = itemOrder[i];
              const item = CAST_ITEMS[key];
              if (item) {
                mappedOrder.push({ key, id: item.id });
              }
            }
            AAD.Core.State.set('_cachedItemOrder', mappedOrder);
            AAD.Core.State.set('_cachedItemOrderKey', itemOrder.join(','));
          }

          const cache = AAD.Core.State.get('_cachedItemOrder');
          for (let i = 0; i < cache.length; i++) {
            const item = cache[i];
            const itemNode = AAD.Utils.DOM.isOn(item.id);
            if (option.item[item.key] &&
                AAD.Utils.Condition.evaluateConditionGroups(option['item' + item.key + 'Condition']) &&
                itemNode) {
              itemNode.click();
              AAD.Core.State.set('end', true);
              return;
            }
          }
        },

        // 自动使用卷轴
        useScroll(buffSnapshot) {
          const option = AAD.Core.Storage.getValue('option') || {};
          if (!option?.scrollSwitch || !option?.scroll) return;

          const scrollFirst = (option.scrollFirst) ? '_scroll' : '';

          for (const i in CAST_SCROLLS) {
            const scroll = CAST_SCROLLS[i];
            const buffImgs = scroll.buffImgs || [];
            if (option.scroll[i] &&
                AAD.Utils.DOM.gE('.bti3>div[onmouseover*="' + scroll.id + '"]') &&
                AAD.Utils.Condition.evaluateConditionGroups(option['scroll' + i + 'Condition'])) {

              const hasBuff = buffImgs.some(img => buffSnapshot.playerBuffs[img + scrollFirst]);
              if (!hasBuff) {
                AAD.Utils.DOM.gE('.bti3>div[onmouseover*="' + scroll.id + '"]').click();
                AAD.Core.State.set('end', true);
                return;
              }
            }
          }
        },

        // 自动使用魔药
        useInfusions() {
          const attackStatus = AAD.Core.State.get('attackStatus');

          if (CAST_INFUSIONS[attackStatus] &&
              AAD.Utils.DOM.gE('.bti3>div[onmouseover*="' + CAST_INFUSIONS[attackStatus].id + '"]') &&
              !AAD.Utils.DOM.gE('#pane_effects>img[src*="' + CAST_INFUSIONS[attackStatus].img + '"]')) {
            AAD.Utils.DOM.gE('.bti3>div[onmouseover*="' + CAST_INFUSIONS[attackStatus].id + '"]').click();
            AAD.Core.State.set('end', true);
          }
        }
      },

      // 战斗核心模块
      Core: {
        // 检查是否应该跳过攻击 - 战斗基础检查，所有子模块共享
        shouldSkipAttack() {
          const option = AAD.Core.Storage.getValue('option') || {};

          // 检查Focus技能
          if (option.focus && AAD.Utils.Condition.evaluateConditionGroups(option.focusCondition)) {
            AAD.Utils.DOM.gE('#ckey_focus').click();
            return true;
          }

          // 检查Spirit Shield切换
          const shouldToggleSS = (option.turnOnSS && AAD.Utils.Condition.evaluateConditionGroups(option.turnOnSSCondition) && !AAD.Utils.DOM.gE('#ckey_spirit[src*="spirit_a"]')) ||
                                 (option.turnOffSS && AAD.Utils.Condition.evaluateConditionGroups(option.turnOffSSCondition) && AAD.Utils.DOM.gE('#ckey_spirit[src*="spirit_a"]'));
          if (shouldToggleSS) {
            AAD.Utils.DOM.gE('#ckey_spirit').click();
            AAD.Core.State.set('end', true);
            return true;
          }

          return false;
        },

        getAOENextNum(mode) {
          if (mode === 1) return 2;
          if (mode === 2) return 3;
          return 4;
        },

        getAOECastRange(mode) {
          if (mode === 3) return (AAD.Runtime.pageType === 'isekai') ? GAME_MECHANICS.AOE_T3_RANGE_ISEKAI : 10;
          if (mode === 2) return 7;
          return 5;
        },

        getAOEAreaIndexes(centerIndex, mode, monsterTotal) {
          const before = this.getAOENextNum(mode);
          const castRange = this.getAOECastRange(mode);
          const after = castRange - before - 1;
          const start = Math.max(0, centerIndex - before);
          const end = Math.min(monsterTotal - 1, centerIndex + after);
          const indexes = [];
          for (let i = start; i <= end; i++) {
            indexes.push(i);
          }
          return indexes;
        },

        isMonsterTargetAlive(monNodes, index) {
          const node = monNodes[index];
          return !!(node && node.hasAttribute('onclick'));
        },

        isStatusAlive(statusByOrder, index) {
          const monster = statusByOrder && statusByOrder[index];
          return !!(monster && !monster.isDead && Number.isFinite(monster.hpNow));
        },

        isTargetSelectable(monNodes, index, statusByOrder = null) {
          if (statusByOrder && !this.isStatusAlive(statusByOrder, index)) return false;
          return this.isMonsterTargetAlive(monNodes, index);
        },

        hasCoalescedManaAt(index, buffSnapshot, monNodes, statusByOrder = null) {
          if (!buffSnapshot || !this.isTargetSelectable(monNodes, index, statusByOrder)) return false;
          const buffs = buffSnapshot.monsters[index]?.buffs;
          return !!(buffs && Object.prototype.hasOwnProperty.call(buffs, 'coalescemana'));
        },

        getStatusByOrder(monsterStatus) {
          const statusByOrder = {};
          if (!Array.isArray(monsterStatus)) return statusByOrder;
          for (let i = 0; i < monsterStatus.length; i++) {
            const monster = monsterStatus[i];
            if (monster && Number.isFinite(monster.order)) {
              statusByOrder[monster.order] = monster;
            }
          }
          return statusByOrder;
        },

        resolveLegacyAOECenterIndex(mode, monNodes, statusByOrder = null) {
          const monsterTotal = monNodes.length;
          const nextnum = this.getAOENextNum(mode);
          for (let i = 0; i < monsterTotal; i++) {
            if (!this.isTargetSelectable(monNodes, i, statusByOrder)) continue;
            let centerIndex = i;
            if (i <= monsterTotal - nextnum) {
              for (let ii = i + nextnum; ii > i; ii--) {
                if (ii < monsterTotal && this.isTargetSelectable(monNodes, ii, statusByOrder)) {
                  centerIndex = ii;
                  break;
                }
              }
            }
            return centerIndex;
          }
          return -1;
        },

        getAliveTargetIndexes(statusByOrder, monsterTotal) {
          const indexes = [];
          for (let i = 0; i < monsterTotal; i++) {
            if (this.isStatusAlive(statusByOrder, i)) indexes.push(i);
          }
          return indexes;
        },

        getYggdrasilTargetIndex(monNodes, statusByOrder = null) {
          const yggdrasilOrder = AAD.Core.State.get('yggdrasilOrder', null);
          if (yggdrasilOrder !== null && yggdrasilOrder >= 0 && yggdrasilOrder < monNodes.length && this.isTargetSelectable(monNodes, yggdrasilOrder, statusByOrder)) {
            return yggdrasilOrder;
          }
          return -1;
        },

        buildAttackContext() {
          const monNodes = AAD.Utils.DOM.gE('div.btm1', 'all');
          const monsterStatus = AAD.Core.State.get('monsterStatus') || [];
          const statusByOrder = this.getStatusByOrder(monsterStatus);
          return {
            monNodes,
            monsterStatus,
            monsterTotal: monNodes.length,
            statusByOrder,
            aliveIndexes: this.getAliveTargetIndexes(statusByOrder, monNodes.length),
            yggdrasilIndex: this.getYggdrasilTargetIndex(monNodes, statusByOrder)
          };
        },

        getMageEffectiveHp(monster, option, attackStatusOverride = null) {
          if (!monster) return null;
          let effHp = null;
          if (attackStatusOverride === null) {
            effHp = (typeof monster.effHp === 'number' && Number.isFinite(monster.effHp) && monster.effHp > 0) ? monster.effHp : null;
          }
          if (effHp === null) {
            const calculated = AAD.Logic.Battle.PartialImp.calculateEffHp(monster, option, attackStatusOverride);
            effHp = Number.isFinite(calculated) && calculated > 0 ? calculated : null;
          }
          return effHp;
        },

        calculateMageActualDamage(monster, option, buffSnapshot, mode) {
          const rawDamage = AAD.Logic.Battle.PartialImp.calculateMagicDamage(option, buffSnapshot, mode);
          if (!Number.isFinite(rawDamage)) return null;
          if (!monster || !Number.isFinite(monster.hpNow) || monster.hpNow <= 0) return rawDamage;

          const effHp = this.getMageEffectiveHp(monster, option);
          if (effHp === null) return rawDamage;

          const multiplier = effHp / monster.hpNow;
          if (!Number.isFinite(multiplier) || multiplier <= 0) return rawDamage;
          return rawDamage / multiplier;
        },

        canClearAllWithAOEAt(centerIndex, mode, option, buffSnapshot, context) {
          if (!context || context.aliveIndexes.length === 0) return false;
          const area = this.getAOEAreaIndexes(centerIndex, mode, context.monsterTotal);
          for (let i = 0; i < context.aliveIndexes.length; i++) {
            if (!area.includes(context.aliveIndexes[i])) return false;
          }

          for (let i = 0; i < context.aliveIndexes.length; i++) {
            const monster = context.statusByOrder[context.aliveIndexes[i]];
            const damage = this.calculateMageActualDamage(monster, option, buffSnapshot, mode);
            if (!monster || !Number.isFinite(monster.hpNow) || !Number.isFinite(damage) || damage * 0.8 <= monster.hpNow) return false;
          }
          return true;
        },

        selectClearAllTargetIndex(mode, option, buffSnapshot, context) {
          if (context.yggdrasilIndex !== -1 && this.canClearAllWithAOEAt(context.yggdrasilIndex, mode, option, buffSnapshot, context)) return context.yggdrasilIndex;

          const candidates = [];
          for (let i = 0; i < context.monsterTotal; i++) {
            if (!this.isTargetSelectable(context.monNodes, i, context.statusByOrder)) continue;
            if (!this.canClearAllWithAOEAt(i, mode, option, buffSnapshot, context)) continue;
            candidates.push({
              index: i,
              hasCoalescedMana: this.hasCoalescedManaAt(i, buffSnapshot, context.monNodes, context.statusByOrder)
            });
          }
          if (candidates.length === 0) return -1;
          candidates.sort((a, b) => Number(b.hasCoalescedMana) - Number(a.hasCoalescedMana) || a.index - b.index);
          return candidates[0].index;
        },

        selectCoalescedPreferredTargetIndex(mode, buffSnapshot, context) {
          if (context.yggdrasilIndex !== -1) return context.yggdrasilIndex;

          for (let i = 0; i < context.monsterTotal; i++) {
            if (this.hasCoalescedManaAt(i, buffSnapshot, context.monNodes, context.statusByOrder)) return i;
          }
          return this.resolveLegacyAOECenterIndex(mode, context.monNodes, context.statusByOrder);
        },

        selectSortedFallbackTargetIndex(mode, option, buffSnapshot, context) {
          if (context.yggdrasilIndex !== -1) return context.yggdrasilIndex;

          const firstAliveIndex = context.aliveIndexes[0];
          const lastAliveIndex = context.aliveIndexes[context.aliveIndexes.length - 1];
          const candidates = [];

          for (let i = 0; i < context.monsterTotal; i++) {
            if (!this.isTargetSelectable(context.monNodes, i, context.statusByOrder)) continue;
            const area = this.getAOEAreaIndexes(i, mode, context.monsterTotal);
            let totalDamage = 0;
            let aliveCount = 0;
            let coveredMaxEffHp = -Infinity;
            for (let j = 0; j < area.length; j++) {
              const monster = context.statusByOrder[area[j]];
              if (!this.isStatusAlive(context.statusByOrder, area[j])) continue;
              const damage = this.calculateMageActualDamage(monster, option, buffSnapshot, mode);
              const effHp = this.getMageEffectiveHp(monster, option) ?? Number(monster.hpNow);
              aliveCount++;
              totalDamage += Math.min(Number.isFinite(damage) ? damage : 0, Number(monster.hpNow) || 0);
              if (Number.isFinite(effHp) && effHp > coveredMaxEffHp) coveredMaxEffHp = effHp;
            }
            candidates.push({
              index: i,
              coversEdge: area.includes(firstAliveIndex) || area.includes(lastAliveIndex),
              coveredMaxEffHp,
              totalDamage,
              aliveCount,
              hasCoalescedMana: this.hasCoalescedManaAt(i, buffSnapshot, context.monNodes, context.statusByOrder)
            });
          }

          if (candidates.length === 0) return -1;
          candidates.sort((a, b) => Number(b.coversEdge) - Number(a.coversEdge) ||
                                   b.coveredMaxEffHp - a.coveredMaxEffHp ||
                                   b.totalDamage - a.totalDamage ||
                                   b.aliveCount - a.aliveCount ||
                                   Number(b.hasCoalescedMana) - Number(a.hasCoalescedMana));
          return candidates[0].index;
        },

        createCurrentTargetPlan(targetIndex = null) {
          return { type: 'current', targetIndex };
        },

        createAOETargetPlan(rangeMode, targetIndex = null) {
          return { type: 'aoe', rangeMode, targetIndex };
        },

        getSpecialSkillTargetPlan(targetMode) {
          if (targetMode === TARGET_MODES.CURRENT) return this.createCurrentTargetPlan();
          return this.createAOETargetPlan(1);
        },

        createMagicAction(attackStatus, mode, targetIndex) {
          return {
            type: 'magic',
            skillId: '1' + attackStatus + mode,
            targetPlan: this.createAOETargetPlan(mode, targetIndex)
          };
        },

        getMagicFinisherConfig(option) {
          const tier = Number(option.magicFinisherTier || 3);
          let attackStatus = Number(option.magicFinisherType || 3);
          if (!Number.isFinite(attackStatus) || attackStatus < 1 || attackStatus > 6) attackStatus = 3;
          return {
            attackStatus,
            tier: (tier === 1 || tier === 2 || tier === 3) ? tier : 3,
            firstEDB: Number(option.magicFinisherFirstEDB || 0)
          };
        },

        calculateMagicFinisherDamage(option, buffSnapshot, config) {
          const firstDamage = AAD.Logic.Battle.PartialImp.calculateMagicDamage(option, buffSnapshot, config.tier, {
            attackStatus: config.attackStatus,
            edb: config.firstEDB
          });
          const extraOptions = {
            attackStatus: config.attackStatus,
            mageDamage: 1.25
          };
          if (config.tier === 3) {
            extraOptions.mult = AAD.Logic.Battle.PartialImp.MAGIC_FINISHER_EXTRA_DAMAGE_MULT;
          }
          const extraDamage = AAD.Logic.Battle.PartialImp.calculateMagicDamage(option, buffSnapshot, config.tier === 3 ? 3 : config.tier + 1, extraOptions);
          if (!Number.isFinite(firstDamage) || !Number.isFinite(extraDamage)) return null;
          return firstDamage + extraDamage;
        },

        selectMagicFinisherTargetIndex(option, buffSnapshot, context, config) {
          if (!context || context.aliveIndexes.length === 0) return -1;
          const damage = this.calculateMagicFinisherDamage(option, buffSnapshot, config);
          if (!Number.isFinite(damage)) return -1;

          for (let i = 0; i < context.aliveIndexes.length; i++) {
            const monster = context.statusByOrder[context.aliveIndexes[i]];
            const effHp = this.getMageEffectiveHp(monster, option, config.attackStatus);
            if (!Number.isFinite(effHp) || effHp >= damage * 0.8) return -1;
          }

          const candidates = [];
          for (let i = 0; i < context.monsterTotal; i++) {
            if (!this.isTargetSelectable(context.monNodes, i, context.statusByOrder)) continue;
            const area = this.getAOEAreaIndexes(i, config.tier, context.monsterTotal);
            let coversAll = true;
            for (let j = 0; j < context.aliveIndexes.length; j++) {
              if (!area.includes(context.aliveIndexes[j])) {
                coversAll = false;
                break;
              }
            }
            if (!coversAll) continue;
            candidates.push({
              index: i,
              hasCoalescedMana: this.hasCoalescedManaAt(i, buffSnapshot, context.monNodes, context.statusByOrder)
            });
          }
          if (candidates.length === 0) return -1;
          candidates.sort((a, b) => Number(b.hasCoalescedMana) - Number(a.hasCoalescedMana) || a.index - b.index);
          return candidates[0].index;
        },

        decideMagicFinisherSpell(option, buffSnapshot, context) {
          if (!option.magicFinisherSwitch) return null;
          const config = this.getMagicFinisherConfig(option);
          const skillId = '1' + config.attackStatus + config.tier;
          if (!AAD.Utils.DOM.isOn(skillId)) return null;
          const targetIndex = this.selectMagicFinisherTargetIndex(option, buffSnapshot, context, config);
          if (targetIndex === -1) return null;
          return this.createMagicAction(config.attackStatus, config.tier, targetIndex);
        },

        decideSpecialSkill(option) {
          if (!option.skillSwitch) return null;

          const skillOrder = Array.isArray(option.skillOrder) ? option.skillOrder : [];
          if (skillOrder.length === 0) return null;
          const oc = AAD.Core.State.get('oc') || 0;
          const skillOTOS = AAD.Core.State.get('skillOTOS') || {};
          const fightingStyle = option.fightingStyle || '1';

          const getSkillId = (skillType) => {
            const skill = SPECIAL_SKILLS[skillType];
            if (!skill) return null;
            if (skill.id) return skill.id;
            if (skill.attackStatusOption) return '1' + (option[skill.attackStatusOption] || skill.defaultAttackStatus) + (option[skill.tierOption] || 1);
            return '2' + fightingStyle + skill.idSuffix;
          };

          const getTargetMode = (skillType) => {
            return SPECIAL_SKILL_TARGET_MODES[fightingStyle]?.[skillType] ?? TARGET_MODES.CURRENT;
          };

          for (const skillType of skillOrder) {
            const skill = SPECIAL_SKILLS[skillType];
            const skillId = getSkillId(skillType);
            if (!skill || !skillId) continue;

            if (!AAD.Utils.Condition.evaluateConditionGroups(option['skill' + skillType + 'Condition']) ||
                !AAD.Utils.DOM.isOn(skillId) ||
                oc < skill.oc) {
              continue;
            }

            // 检查OTOS限制
            if (option.skillOTOS && option.skillOTOS[skillType] && skillOTOS[skillType] >= 1) {
              continue;
            }

            return {
              type: 'special',
              skillType,
              skillId,
              targetPlan: this.getSpecialSkillTargetPlan(getTargetMode(skillType))
            };
          }
          return null;
        },

        decideMageClearSpell(option, buffSnapshot, context) {
          const attackStatus = AAD.Core.State.get('attackStatus') || 0;
          if (attackStatus === 0 || context.monsterTotal === 0) return null;

          if (AAD.Utils.DOM.isOn('1' + attackStatus + '1')) {
            const targetIndex = this.selectClearAllTargetIndex(1, option, buffSnapshot, context);
            if (targetIndex !== -1) return this.createMagicAction(attackStatus, 1, targetIndex);
          }

          if (AAD.Utils.Condition.evaluateConditionGroups(option.middleSkillCondition) && AAD.Utils.DOM.isOn('1' + attackStatus + '2')) {
            const targetIndex = this.selectClearAllTargetIndex(2, option, buffSnapshot, context);
            if (targetIndex !== -1) return this.createMagicAction(attackStatus, 2, targetIndex);
          }

          return null;
        },

        shouldUseEtherTap(option) {
          return option.etherTap &&
                 (!AAD.Utils.DOM.gE('#pane_effects>img[onmouseover*="Ether Tap (x2)"]') ||
                  AAD.Utils.DOM.gE('#pane_effects>img[src*="wpn_et"][id*="effect_expire"]')) &&
                 AAD.Utils.Condition.evaluateConditionGroups(option.etherTapCondition);
        },

        getEtherTapTargetIndex(buffSnapshot, context) {
          for (let i = 0; i < context.aliveIndexes.length; i++) {
            const index = context.aliveIndexes[i];
            if (this.hasCoalescedManaAt(index, buffSnapshot, context.monNodes, context.statusByOrder)) return index;
          }
          return -1;
        },

        decideEtherTapAttack(option, buffSnapshot, context) {
          if (!this.shouldUseEtherTap(option)) return null;
          const targetIndex = this.getEtherTapTargetIndex(buffSnapshot, context);
          if (targetIndex === -1) return null;
          return {
            type: 'tap',
            skillId: null,
            targetPlan: this.createCurrentTargetPlan(targetIndex)
          };
        },

        decideMageNormalSpell(option, buffSnapshot, context) {
          const attackStatus = AAD.Core.State.get('attackStatus') || 0;
          if (attackStatus === 0 || context.monsterTotal === 0) return null;

          if (AAD.Utils.Condition.evaluateConditionGroups(option.highSkillCondition) && AAD.Utils.DOM.isOn('1' + attackStatus + '3')) {
            return this.createMagicAction(attackStatus, 3, this.selectCoalescedPreferredTargetIndex(3, buffSnapshot, context));
          }

          if (AAD.Utils.Condition.evaluateConditionGroups(option.middleSkillCondition) && AAD.Utils.DOM.isOn('1' + attackStatus + '2')) {
            return this.createMagicAction(attackStatus, 2, this.selectSortedFallbackTargetIndex(2, option, buffSnapshot, context));
          }

          if (AAD.Utils.DOM.isOn('1' + attackStatus + '1')) {
            return this.createMagicAction(attackStatus, 1, this.selectSortedFallbackTargetIndex(1, option, buffSnapshot, context));
          }

          return null;
        },

        decidePhysicalAttack(context) {
          const target = context.monsterStatus && context.monsterStatus[0];
          return {
            type: 'attack',
            skillId: null,
            targetPlan: this.createCurrentTargetPlan(Number.isFinite(target?.order) ? target.order : null)
          };
        },

        decideAttackAction(option, buffSnapshot, context) {
          const special = this.decideSpecialSkill(option);
          if (special) return special;

          const tap = this.decideEtherTapAttack(option, buffSnapshot, context);
          if (tap) return tap;

          const mageClear = this.decideMageClearSpell(option, buffSnapshot, context);
          if (mageClear) return mageClear;

          const magicFinisher = this.decideMagicFinisherSpell(option, buffSnapshot, context);
          if (magicFinisher) return magicFinisher;

          const mageNormal = this.decideMageNormalSpell(option, buffSnapshot, context);
          if (mageNormal) return mageNormal;

          return this.decidePhysicalAttack(context);
        },

        // AOE目标选择 - 战斗核心逻辑，所有子模块共享
        selectAOETarget(tmode, buffSnapshot, context = null) {
          const mon = context?.monNodes || AAD.Utils.DOM.gE('div.btm1', 'all');
          const statusByOrder = context?.statusByOrder || null;
          const monsterTotal = mon.length;
          if (monsterTotal === 0) return;

          const castRange = this.getAOECastRange(tmode);
          const halfRange = Math.ceil(castRange / 2);

          const findFirstCoalesce = (startIndex, endIndex) => {
            for (let i = startIndex; i <= endIndex; i++) {
              if (this.hasCoalescedManaAt(i, buffSnapshot, mon, statusByOrder)) return i;
            }
            return -1;
          };

          const yggdrasilIndex = context?.yggdrasilIndex ?? this.getYggdrasilTargetIndex(mon, statusByOrder);
          if (yggdrasilIndex !== -1) {
            mon[yggdrasilIndex].click();
            return;
          }

          if (monsterTotal <= castRange) {
            const coalesceIndex = findFirstCoalesce(0, monsterTotal - 1);
            if (coalesceIndex !== -1) {
              mon[coalesceIndex].click();
              return;
            }
          }

          const centerIndex = this.resolveLegacyAOECenterIndex(tmode, mon, statusByOrder);
          if (centerIndex === -1) return;

          if (centerIndex + 1 <= halfRange) {
            const coalesceIndex = findFirstCoalesce(0, centerIndex);
            if (coalesceIndex !== -1) {
              mon[coalesceIndex].click();
              return;
            }
          }

          mon[centerIndex].click();
        },

        selectCurrentTarget(targetIndex = null, context = null) {
          const mon = context?.monNodes || AAD.Utils.DOM.gE('div.btm1', 'all');
          const statusByOrder = context?.statusByOrder || null;
          if (Number.isInteger(targetIndex) && this.isTargetSelectable(mon, targetIndex, statusByOrder)) {
            mon[targetIndex].click();
            return;
          }

          const monsterStatus = context?.monsterStatus || AAD.Core.State.get('monsterStatus');
          if (monsterStatus && monsterStatus.length > 0) {
            AAD.Utils.DOM.gE('#mkey_' + monsterStatus[0].id).click();
          }
        },

        selectTargetByPlan(targetPlan, buffSnapshot, context) {
          const plan = targetPlan || this.createCurrentTargetPlan();
          const targetIndex = plan.targetIndex;
          if (plan.type === 'aoe') {
            if (Number.isInteger(targetIndex) && this.isTargetSelectable(context.monNodes, targetIndex, context.statusByOrder)) {
              context.monNodes[targetIndex].click();
            } else {
              this.selectAOETarget(plan.rangeMode || 1, buffSnapshot, context);
            }
            return;
          }

          this.selectCurrentTarget(targetIndex, context);
        },

        executeAttackAction(action, buffSnapshot, context) {
          if (action?.type === 'special') {
            const skillOTOS = AAD.Core.State.get('skillOTOS') || {};
            skillOTOS[action.skillType] = (skillOTOS[action.skillType] || 0) + 1;
            AAD.Core.State.set('skillOTOS', skillOTOS);
          }

          if (action?.skillId) {
            AAD.Utils.DOM.gE(action.skillId).click();
          }

          this.selectTargetByPlan(action?.targetPlan, buffSnapshot, context);
          AAD.Core.State.set('end', true);
        },

        // 核心攻击函数
        attack(buffSnapshot) {

          if (this.shouldSkipAttack()) {
            return;
          }

          const option = AAD.Core.Storage.getValue('option') || {};
          const context = this.buildAttackContext();
          const action = this.decideAttackAction(option, buffSnapshot, context);
          this.executeAttackAction(action, buffSnapshot, context);
        }
      }
    };


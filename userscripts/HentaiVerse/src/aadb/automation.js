AAD.Logic.Arena = {
      ensureDailyReset() {
        const option = AAD.Core.Storage.getValue('option') || {};
        return AAD.Core.DailyReset.ensure(
          'arena',
          'world',
          () => !!option.idleArena,
          (info) => this.resetDailyState(info)
        );
      },

      // 闲置竞技场主函数
      async runArena() {
        const option = AAD.Core.Storage.getValue('option') || {};
        const resetState = this.ensureDailyReset();
        if (!resetState) {
          return;
        }
        let arena = this.getArenaData();

        // ========== 竞技场完成检查 ==========
        if (arena.isOk) {
          this.handleArenaCompleteIfNeeded(arena);
          return;
        }

        // ========== 体力恢复检查 ==========
        if (option.restoreStamina && AAD.Utils.DOM.gE('#stamina_readout .fc4.far>div')) {
          const staminaElement = AAD.Utils.DOM.gE('#stamina_readout .fc4.far>div');
          const stamina = parseInt(staminaElement.textContent.match(/\d+/)[0], 10);
          if (stamina <= option.staminaLow && stamina < 85) {
            const data = await AAD.Core.Network.postPromise("?s=Bazaar&ss=is");
            const inventory = await AAD.Logic.Utility.getStock(data);
            if (inventory && inventory['Energy Drink'] > 0) {
              AAD.Core.Network.postCallback(window.location.href, AAD.Runtime.refreshPage, 'recover=stamina');
              return;
            }
          }
        }

        // ========== 初始化竞技场数组 ==========
        if (!arena.array) {
          const idleArenaOrder = option.idleArenaOrder;
          if (Array.isArray(idleArenaOrder)) {
            arena.array = idleArenaOrder.slice();
          } else {
            arena.array = [];
          }
        }

        // 如果arena.array为空，直接标记完成
        if (arena.array.length === 0) {
          this.setArenaComplete(arena, '当前世界无竞技场配置');
          return;
        }

        // ========== 处理竞技场队列 ==========
        const entry = this.getNextArenaEntry(arena);
        if (!entry) {
          this.setArenaComplete(arena, '当前世界竞技场全部完成');
          return;
        }

        AAD.Core.Storage.setValue('arena', arena);

        await this.applyArenaLoadout(entry);

        // 设置页面标题并执行战斗
        document.title = AAD.Utils.Common.alert(-1, '闲置竞技场');

        // 执行战斗
        if (entry.type === 'gr') {
          await this.executeGrindFestBattle(arena);
        } else if (entry.type === 'tw') {
          await this.executeTowerBattle(arena);
        } else {
          await this.executeArenaBattleById(arena, entry.href, entry.id);
        }
      },

      getArenaData() {
        let arena = AAD.Core.Storage.getValue('arena');
        if (!arena) {
          arena = this.createArenaState();
          AAD.Core.Storage.setValue('arena', arena);
        }
        return arena;
      },

      createArenaState() {
        return this.buildArenaState({
          dayKey: AAD.Utils.Time.getUtcDayKey()
        });
      },

      buildArenaState({ dayKey }) {
        const option = AAD.Core.Storage.getValue('option') || {};
        return {
          dayKey: dayKey,
          gr: option.idleArenaGrTime || 0,
          isOk: false,
          completeHandled: false,
          completeReason: ''
        };
      },

      resetDailyState(info) {
        const arena = this.buildArenaState({
          dayKey: info.dayKey
        });
        AAD.Core.Storage.setValue('arena', arena);

        const option = AAD.Core.Storage.getValue('option') || {};
        if (!option.idleArena) {
          return;
        }

        const marker = AAD.Core.Storage.getValue('arenaAutoStart');
        if (marker && marker.dayKey === info.dayKey) {
          return;
        }

        AAD.Core.Storage.setValue('arenaAutoStart', {
          dayKey: info.dayKey
        });
        setTimeout(() => AAD.Runtime.refreshPage(), 2000);
      },

      findArenaButton(data, id) {
        const buttons = AAD.Utils.DOM.gE('img[src*="startchallenge.png"]:not([style])', 'all', data) || [];
        for (const button of buttons) {
          const onclickAttr = button.getAttribute('onclick') || '';
          const match = onclickAttr.match(/init_battle\((\d+),/);
          if (match && Number(match[1]) === id) {
            return button;
          }
        }
        return null;
      },

      getBattlePostoken(data) {
        const postokenInput = AAD.Utils.DOM.gE('input[name="postoken"]', data);
        return postokenInput?.value || '';
      },

      getNextArenaEntry(arena) {
        while (arena.array && arena.array.length > 0) {
          let id = arena.array[0];
          if (id === 'tw') {
            if (!AAD.Runtime.isIsekai()) {
              arena.array.splice(0, 1);
              continue;
            }
            return { type: 'tw', href: 'tw', id: 1 };
          }
          if (isNaN(id * 1)) {
            if (arena.gr <= 0) {
              arena.array.splice(0, 1);
              continue;
            }
            arena.gr -= 1;
            return { type: 'gr', href: 'gr', id: 1 };
          }
          id = id * 1;
          const href = id >= 105 ? 'rb' : 'ar';
          return { type: href, href, id };
        }
        return null;
      },

      isBlankValue(value) {
        return value === '' || value === null || value === undefined;
      },

      async applyArenaLoadout(entry) {
        const option = AAD.Core.Storage.getValue('option') || {};
        if (!option.personaConfigSwitch || !entry) return;

        const typeKey = entry.type === 'gr' ? 'gf' : entry.type === 'tw' ? 'tw' : 'ar';
        const persona = option[`${typeKey}Persona`];
        const equip = option[`${typeKey}Equip`];
        const configCode = option[`${typeKey}Config`];

        if (this.isBlankValue(persona) || this.isBlankValue(equip) || this.isBlankValue(configCode)) {
          return;
        }

        const backups = AAD.Core.Storage.getValue('backup') || {};
        const backupConfig = backups[configCode];
        if (!backupConfig) return;

        const next = {
          persona: String(persona),
          equip: String(equip),
          config: String(configCode)
        };

        try {
          await AAD.Core.Network.postPromise('?s=Character&ss=ch', `persona_set=${encodeURIComponent(next.persona)}`);
          await AAD.Core.Network.postPromise('?s=Character&&ss=eq', `equip_set=${encodeURIComponent(next.equip)}`);
        } catch (error) {
          console.error('[人格配置] 切换失败:', error);
          return;
        }

        const merged = AAD.Core.Config.mergeConfigWithExclusions(backupConfig);
        AAD.Core.Storage.setValue('option', merged);
      },

      setArenaComplete(arena, reason) {
        arena.isOk = true;
        arena.completeReason = reason;
        arena.completeHandled = false;
        AAD.Core.Storage.setValue('arena', arena);
        this.handleArenaCompleteIfNeeded(arena);
      },

      handleArenaCompleteIfNeeded(arena) {
        if (!arena.isOk || arena.completeHandled) {
          return;
        }
        arena.completeHandled = true;
        AAD.Core.Storage.setValue('arena', arena);
        AAD.Logic.World.handleArenaCompleteCrossWorld(arena.completeReason || '竞技场已完成');
      },

      consumeCurrentArena(arena, keepCurrent = false) {
        if (!keepCurrent && arena.array && arena.array.length > 0) {
          arena.array.splice(0, 1);
        }
        if (!arena.array || arena.array.length === 0) {
          arena.isOk = true;
          arena.completeReason = '当前世界竞技场全部完成';
          arena.completeHandled = false;
        } else {
          arena.isOk = false;
        }
        AAD.Core.Storage.setValue('arena', arena);
      },

      skipCurrentArena(arena, reason, delay = 1000) {
        if (reason) {
          console.log(reason);
        }
        this.consumeCurrentArena(arena);
        if (arena.isOk) {
          this.handleArenaCompleteIfNeeded(arena);
          return;
        }
        setTimeout(() => this.runArena(), delay);
      },



      // 执行GrindFest战斗
      async executeGrindFestBattle(arena) {
        const goto_battle = () => {
          AAD.Core.Network.postCallback('?s=Battle&ss=gr', (data) => {
            const grButton = AAD.Utils.DOM.gE('img[src*="startgrindfest.png"]:not([style])', data);
            const postoken = this.getBattlePostoken(data);

            if (!grButton || !postoken) {
              this.skipCurrentArena(arena, '[竞技场] GrindFest不可进入（无按钮或无postoken）');
              return;
            }

            this.consumeCurrentArena(arena, arena.gr > 0);
            setTimeout(() => {
              AAD.Core.Network.postCallback('?s=Battle&ss=gr', AAD.Runtime.refreshPage, `initid=1&postoken=${postoken}`);
            }, 500);
          });
        };

        goto_battle();
      },

      // 执行Tower战斗
      async executeTowerBattle(arena) {
        const goto_battle_tw = () => {
          AAD.Core.Network.postCallback('?s=Battle&ss=tw', (data) => {
            // 检查postoken和开始按钮
            const startBtn = AAD.Utils.DOM.gE('img[src*="startchallenge.png"]:not([style])', data);
            const postoken = this.getBattlePostoken(data);

            if (!postoken || !startBtn) {
              this.skipCurrentArena(arena, '[竞技场] Tower不可进入（无按钮或无token）');
              return;
            }

            console.log('[竞技场] 开始Tower战斗');
            this.consumeCurrentArena(arena);
            setTimeout(() => {
              AAD.Core.Network.postCallback('?s=Battle&ss=tw', AAD.Runtime.refreshPage, `initid=1&postoken=${postoken}`);
            }, 500 + Math.random() * 1500);
          });
        };

        goto_battle_tw();
      },

      // 执行Arena/RB战斗
      async executeArenaBattleById(arena, href, id) {
        const goto_battle2 = () => {
          AAD.Core.Network.postCallback(`?s=Battle&ss=${href}`, (data) => {
            const arenaButton = this.findArenaButton(data, id);
            const postoken = this.getBattlePostoken(data);

            if (!arenaButton || !postoken) {
              this.skipCurrentArena(arena, `[竞技场] ${href}不可进入（未找到ID ${id}或无postoken）`);
              return;
            }

            this.consumeCurrentArena(arena);
            setTimeout(() => {
              AAD.Core.Network.postCallback(`?s=Battle&ss=${href}`, AAD.Runtime.refreshPage, `initid=${id}&postoken=${postoken}`);
            }, 500);
          });
        };

        goto_battle2();
      }
    };

AAD.Logic.AutoIW = {
      getState() {
        const state = AAD.Core.Storage.getValue('iwState') || {};
        return {
          index: Number.isInteger(state.index) && state.index >= 0 ? state.index : 0
        };
      },

      setState(state) {
        AAD.Core.Storage.setValue('iwState', state);
      },

      resetState() {
        this.setState({ index: 0 });
      },

      normalizeStatus(status) {
        switch (status) {
          case IW_TASK_STATUS.WAITING:
          case IW_TASK_STATUS.RUNNING:
          case IW_TASK_STATUS.DONE:
          case IW_TASK_STATUS.ERROR:
            return status;
          default:
            return IW_TASK_STATUS.WAITING;
        }
      },

      normalizeTasks(tasks) {
        if (!Array.isArray(tasks)) return [];
        const normalized = [];
        for (let i = 0; i < tasks.length; i++) {
          const task = tasks[i] || {};
          const id = String(task.id || '').trim();
          const target = parseInt(task.target, 10);
          if (!id || !Number.isFinite(target) || target <= 0) continue;
          normalized.push({
            id: id,
            target: target,
            filter: String(task.filter || '').trim(),
            title: String(task.title || '').trim(),
            status: this.normalizeStatus(task.status)
          });
        }
        return normalized;
      },

      persistTasks(tasks) {
        const option = AAD.Core.Storage.getValue('option') || {};
        const nextOption = { ...option, autoIWTasks: this.normalizeTasks(tasks) };
        AAD.Core.Storage.setValue('option', nextOption);
      },

      finishAllTasks(option) {
        const currentOption = option || AAD.Core.Storage.getValue('option') || {};
        const nextOption = { ...currentOption, autoIW: false };
        AAD.Core.Storage.setValue('option', nextOption);
        this.resetState();
      },

      completeTask(state, tasks, status = IW_TASK_STATUS.DONE) {
        if (Array.isArray(tasks) && state.index >= 0 && state.index < tasks.length) {
          tasks[state.index].status = this.normalizeStatus(status);
          this.persistTasks(tasks);
        }
        state.index += 1;
        this.setState(state);
        if (state.index >= tasks.length) {
          this.finishAllTasks();
        }
      },

      skipTaskOnError(state, tasks) {
        this.completeTask(state, tasks, IW_TASK_STATUS.ERROR);
      },

      ensureIwPage(task) {
        const params = new URLSearchParams(window.location.search);
        const isIwPage = params.get('s') === 'Battle' &&
                         params.get('ss') === 'iw' &&
                         params.get('screen') === 'itemworld';
        const currentFilter = params.get('filter') || '';
        const targetFilter = task.filter || '';

        if (isIwPage && (!targetFilter || targetFilter === currentFilter)) {
          return true;
        }

        const nextUrl = targetFilter
          ? `?s=Battle&ss=iw&screen=itemworld&filter=${encodeURIComponent(targetFilter)}`
          : '?s=Battle&ss=iw&screen=itemworld';
        window.location.href = nextUrl;
        return false;
      },

      findEquipCheckbox(taskId) {
        return document.getElementById(`e${taskId}`);
      },

      parseIwLevel(checkbox) {
        const row = checkbox && checkbox.closest ? checkbox.closest('tr') : null;
        const tds = row ? row.querySelectorAll('td') : [];
        let levelCell = null;
        for (let i = 0; i < tds.length; i++) {
          if (/^\s*\d+\s*\/\s*\d+\s*\/\s*\d+/.test(tds[i].textContent)) {
            levelCell = tds[i];
            break;
          }
        }
        const nums = levelCell.textContent.match(/\d+/g);
        const current = parseInt(nums[1], 10);
        const cap = parseInt(nums[2], 10);
        return { current, cap };
      },

      findConfirmButton() {
        const confirmOuter = document.getElementById('confirm_outer');
        if (!confirmOuter) {
          return null;
        }

        const outerStyle = window.getComputedStyle(confirmOuter);
        const outerVisible = outerStyle.visibility !== 'hidden' &&
                             outerStyle.display !== 'none' &&
                             outerStyle.opacity !== '0';
        if (!outerVisible) {
          return null;
        }

        const directButton = confirmOuter.querySelector('#confirm_button');
        if (directButton &&
            !directButton.disabled) {
          return directButton;
        }
        return null;
      },

      async selectEquipAndEnter(task, checkbox, state) {
        if (!checkbox.checked) {
          const row = checkbox.closest('tr');
          if (row && typeof row.click === 'function') {
            row.click();
          } else {
            checkbox.click();
          }
        }

        const delayMs = 4000 + Math.random() * 5000;
        await new Promise(resolve => setTimeout(resolve, delayMs));

        const enterButton = document.getElementById('equipsubmit');
        if (!enterButton || enterButton.disabled) {
          throw new Error('iw_enter_unavailable');
        }

        enterButton.click();

        const confirmButton = this.findConfirmButton();
        if (!confirmButton) {
          throw new Error('iw_confirm_missing');
        }

        confirmButton.click();
        return true;
      },

      async runAutoIW() {
        const option = AAD.Core.Storage.getValue('option') || {};
        if (!option.autoIW) {
          return;
        }

        const tasks = this.normalizeTasks(option.autoIWTasks);
        if (!tasks.length) {
          this.finishAllTasks(option);
          return;
        }

        const state = this.getState();
        if (state.index >= tasks.length) {
          this.finishAllTasks(option);
          return;
        }

        while (state.index < tasks.length) {
          const task = tasks[state.index];

          const isReady = this.ensureIwPage(task);
          if (!isReady) {
            return;
          }

          try {
            const checkbox = this.findEquipCheckbox(task.id);
            if (!checkbox) {
              this.completeTask(state, tasks);
              continue;
            }

            const level = this.parseIwLevel(checkbox);
            const effectiveTarget = Math.min(task.target, level.cap);
            if (level.current >= effectiveTarget) {
              this.completeTask(state, tasks);
              continue;
            }

            await this.selectEquipAndEnter(task, checkbox, state);
            return;
          } catch (error) {
            this.skipTaskOnError(state, tasks);
          }
        }
      }
    };

AAD.Logic.Encounter = {
      timerId: null,

      // 遭遇战检查主函数
      runEncounter() {
        console.log('[遭遇战] 检查遭遇战');

        const now = Date.now();
        const option = AAD.Core.Storage.getValue('option') || {};
        const resetState = AAD.Core.DailyReset.ensure(
          'encounter',
          'global',
          () => !!option.encounter,
          (info) => this.resetDailyState(info)
        );
        if (!resetState) {
          return;
        }

        const encounter = this.getEncounterData(resetState?.resetTime);

        if (resetState && !resetState.hasReset && resetState.resetTime) {
          if (encounter.dateKey !== resetState.dayKey && encounter.nextTime !== resetState.resetTime) {
            encounter.nextTime = resetState.resetTime;
            AAD.Core.Storage.setValue('encounter', encounter);
          }
        }

        if (encounter.time >= encounter.dailyLimit && (!resetState || resetState.hasReset)) {
          this.updateEncounterUI(encounter, 'done');
          return;
        }

        if (encounter.nextTime && now >= encounter.nextTime) {
          this.triggerEncounter(encounter, now);
          this.updateEncounterUI(encounter, 'triggered');
        } else {
          this.updateEncounterUI(encounter, 'scheduled');
        }

        const nextDelay = encounter.nextTime ? Math.max(1000, encounter.nextTime - now) : 60 * 60 * 1000;
        this.scheduleNextCheck(nextDelay);
      },

      // 获取遭遇战数据
      getEncounterData(resetTime = null) {
        let encounter = AAD.Core.Storage.getValue('encounter');
        if (!encounter) {
          encounter = this.createDailyEncounter(resetTime);
          AAD.Core.Storage.setValue('encounter', encounter);
        }
        return encounter;
      },

      createDailyEncounter(resetTime) {
        return this.buildEncounterState({
          dayKey: AAD.Utils.Time.getUtcDayKey(),
          resetTime: resetTime
        });
      },

      buildEncounterState({ dayKey, resetTime }) {
        return {
          dateKey: dayKey,
          time: 0,
          dailyLimit: this.getDailyEncounterLimit(),
          lastTime: null,
          nextTime: resetTime
        };
      },

      resetDailyState(info) {
        const encounter = this.buildEncounterState({
          dayKey: info.dayKey,
          resetTime: info.resetTime
        });
        AAD.Core.Storage.setValue('encounter', encounter);
        this.scheduleNextCheck(1000);
      },

      // 获取每日遭遇战限制
      getDailyEncounterLimit() {
        const option = AAD.Core.Storage.getValue('option') || {};
        const minOption = parseInt(option.encounterDailyMin, 10);
        const maxOption = parseInt(option.encounterDailyMax, 10);
        let min = minOption;
        let max = maxOption;
        min = Math.max(1, Math.min(min, 24));
        max = Math.max(1, Math.min(max, 24));

        if (min > max) {
          const temp = min;
          min = max;
          max = temp;
        }
        if (min === max) {
          return min;
        }
        return this.getRandomInt(min, max);
      },

      // 重新制定遭遇战计划（上限 + 下次时间）
      resetEncounterPlan() {
        const encounter = this.getEncounterData();
        const now = Date.now();
        const newLimit = this.getDailyEncounterLimit();
        const time = encounter.time || 0;

        encounter.dailyLimit = Math.max(newLimit, time + 1);
        encounter.nextTime = this.getNextEncounterTime(now);

        AAD.Core.Storage.setValue('encounter', encounter);
        this.updateEncounterUI(encounter, 'scheduled');
        this.scheduleNextCheck(Math.max(1000, encounter.nextTime - now));
      },

      // 记录实际遭遇战开始
      recordEncounterStart(timeNow = Date.now()) {
        const encounter = this.getEncounterData();

        encounter.lastTime = timeNow;
        encounter.time = (encounter.time || 0) + 1;

        if (encounter.time >= encounter.dailyLimit) {
          encounter.nextTime = null;
        } else {
          encounter.nextTime = this.getNextEncounterTime(timeNow);
        }

        AAD.Core.Storage.setValue('encounter', encounter);
      },

      // 触发遭遇战
      triggerEncounter(encounter, timeNow = Date.now()) {
        console.log('[遭遇战] 触发遭遇战');
        if (encounter) {
          encounter.lastTime = timeNow;
          encounter.nextTime = this.getNextEncounterTime(timeNow);
          AAD.Core.Storage.setValue('encounter', encounter);
        }
        AAD.UI.UITools.openUrl('https://e-hentai.org/news.php?encounter');
      },

      // 更新遭遇战UI
      updateEncounterUI(encounter, status) {
        const data = encounter || this.getEncounterData();
        const now = Date.now();
        const lastEncounter = AAD.Utils.DOM.gE('#lastEncounter') ||
                             AAD.Utils.DOM.cE('a');

        if (!lastEncounter.id) {
          lastEncounter.id = 'lastEncounter';
          lastEncounter.className = 'lastEncounter';
          lastEncounter.href = 'https://e-hentai.org/news.php?encounter';
          document.body.appendChild(lastEncounter);
        }

        if (status === 'done') {
          lastEncounter.innerHTML = `今日遭遇战已完成 (${data.time}/${data.dailyLimit})`;
          return;
        }

        const minutesToNext = data.nextTime ? Math.max(0, Math.ceil((data.nextTime - now) / 60000)) : 0;
        const nextText = data.nextTime ? `距离下次遭遇 ${minutesToNext} 分钟` : '下次遭遇战时间待定';

        lastEncounter.innerHTML = `${nextText} (${data.time}/${data.dailyLimit})`;
      },

      // 调度下次检查
      scheduleNextCheck(delay) {
        if (this.timerId) {
          clearTimeout(this.timerId);
        }
        this.timerId = setTimeout(() => {
          this.timerId = null;
          this.runEncounter();
        }, Math.max(delay, 1000));
      },

      getNextEncounterTime(fromTimeMs) {
        const minIntervalMs = GAME_MECHANICS.ENCOUNTER_INTERVAL_MIN_MINUTES * 60 * 1000;
        const maxIntervalMs = GAME_MECHANICS.ENCOUNTER_INTERVAL_MAX_MINUTES * 60 * 1000;
        return this.getRandomMs(fromTimeMs + minIntervalMs, fromTimeMs + maxIntervalMs);
      },

      getRandomInt(min, max) {
        const safeMin = Math.ceil(min);
        const safeMax = Math.floor(max);
        return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
      },

      getRandomMs(minMs, maxMs) {
        if (maxMs <= minMs) return minMs;
        return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
      }
    };

AAD.Logic.PageHandler = {
      // 处理e-hentai页面
      handleEhentaiPage() {
        console.log('[页面处理器] 处理e-hentai页面');

        const storedUrl = AAD.Core.Storage.getValue('url');
        const referrer = document.referrer || '';
        let href;

        if (referrer && /hentaiverse\.org/.test(referrer)) {
          href = new URL(referrer).origin;
        } else if (storedUrl && /hentaiverse\.org/.test(storedUrl)) {
          href = storedUrl;
        } else {
          href = 'https://hentaiverse.org';
        }

        // 检查是否有事件页面链接
        const eventLink = AAD.Utils.DOM.gE('#eventpane>div>a');
        if (eventLink) {
          href = href + '/' + eventLink.href.split('/')[3];
        } else {
          href = AAD.Core.Storage.getValue('lastEncounter') || href;
        }

        // 处理遭遇战页面
        if (window.location.href === 'https://e-hentai.org/news.php?encounter') {
          AAD.UI.UITools.openUrl(href);
        } else if (eventLink) {
          AAD.Core.Storage.setValue('lastEncounter', href);
        }
      },

      // 处理答题页面
      handleRiddlePage() {
        console.log('[页面处理器] 处理答题页面');
        this.misspony();
        AAD.Data.Recorder.recordHorseFromRiddle();
      },

      // 处理战斗页面
      handleBattlePage() {
        console.log('[页面处理器] 处理战斗页面');

        // 获取配置
        const option = AAD.Core.Storage.getValue('option') || {};
        const shouldRecord = !!option.dataRecordSwitch;

        sessionStorage.removeItem('db_riddle_counted');
        if (shouldRecord) {
          AAD.Data.Recorder.init();
          AAD.Core.Storage.init(true);
        }

        // 注入战斗页面脚本
        const script = document.createElement('script');
        script.textContent = `
          if (window.location.protocol === "https:") {
            MAIN_URL = MAIN_URL.replace("http:", "https:");
          }
        `;
        document.body.appendChild(script);

        // 创建战斗UI容器
        const box2 = document.body.appendChild(AAD.Utils.DOM.cE('div'));
        box2.id = 'dbBox2';

        // 添加暂停按钮
        if (option.pauseButton) {
          const button = box2.appendChild(AAD.Utils.DOM.cE('button'));
          button.innerHTML = '暂停';
          button.id = 'pauseChange';
          button.className = 'pauseChange';
          button.onclick = () => AAD.UI.Panel.pauseChange();
        }

        // 添加暂停热键监听
        if (option.pauseHotkey) {
          document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (String(e.key).toLowerCase() === String(option.pauseHotkeyStr).toLowerCase()) {
              AAD.UI.Panel.pauseChange();
            }
          }, false);
        }

        // 初始化战斗事件处理器
        if (typeof AAD.Logic.Battle.initBattleEvents === 'function') {
          AAD.Logic.Battle.initBattleEvents();
        } else {
          console.error('[页面处理器] AAD.Logic.Battle.initBattleEvents 不是函数', typeof AAD.Logic.Battle.initBattleEvents, AAD.Logic.Battle.initBattleEvents);
          throw new Error('Battle.initBattleEvents is not properly initialized');
        }

        AAD.Core.State.set('attackStatus', option.attackStatus);
        AAD.Core.State.set('timeNow', Date.now());
        AAD.Core.State.set('runSpeed', 1);

        // 开始新回合
        AAD.Logic.Battle.newRound();
        AAD.Logic.PageHandler.misspony();
        AAD.Logic.Battle.main();
      },

      // 处理世界页面
      async handleWorldPage() {


        // 清除战斗相关临时数据
        AAD.Core.Storage.delValue(2);
        AAD.Core.Storage.clearBattleCache();
        AAD.Logic.Battle.PartialImp.clearCache();

        // 启动遭遇战检查
        const option = AAD.Core.Storage.getValue('option') || {};
        AAD.Logic.World.syncCrossWorldEnabledFromOption(option);
        const todayKey = AAD.Utils.Time.getUtcDayKey();
        const arenaAutoStart = AAD.Core.Storage.getValue('arenaAutoStart');
        if (arenaAutoStart) {
          if (arenaAutoStart.dayKey !== todayKey) {
            AAD.Core.Storage.delValue('arenaAutoStart');
          }
        }

        if (AAD.Logic.World.enforceWorldConsistency()) {
          return;
        }

        if (option.encounter) {
          AAD.Logic.Encounter.runEncounter();
        }

        // 处理礼物接收
        if (option.regifts) {
          await AAD.Logic.Utility.receiveGifts();
        }

        // 检查耐力是否足够
        if (!option.restoreStamina) {
          const staminaElement = AAD.Utils.DOM.gE('#stamina_readout .fc4.far>div');
          if (staminaElement) {
            const staminaValue = parseInt(staminaElement.textContent.match(/\d+/)[0], 10);
            if (staminaValue <= option.staminaLow) {
              return;
            }
          }
        }

        // 处理自动购买物品
        let autobuyCompleted = false;
        if (option.autobuy && AAD.Logic.Utility.checkStockAndBuy) {
          let itemliststr = option.autobuylist;
          if (itemliststr && itemliststr.length > 0) {
            let itemlist = itemliststr.split(',');
            let itemdict = {
              "HD": 11191, "HP": 11195, "HE": 11199, "MD": 11291, "MP": 11295, "ME": 11299,
              "SD": 11391, "SP": 11395, "SE": 11399, "SM": 60053, "SC": 60051, "SW": 60054,
              "EC": 60071, "SL": 60052
            };
            let itemnameab = {
              "HD": "Health Draught", "HP": "Health Potion", "HE": "Health Elixir",
              "MD": "Mana Draught", "MP": "Mana Potion", "ME": "Mana Elixir",
              "SD": "Spirit Draught", "SP": "Spirit Potion", "SE": "Spirit Elixir",
              "SM": "Scrap Metal", "SC": "Scrap Cloth", "SW": "Scrap Wood",
              "EC": "Energy Cell", "SL": "Scrap Leather"
            };

            let wantbuylist = {};
            for (let item of itemlist) {
              item = item.trim();
              if (itemdict[item] && itemnameab[item]) {
                wantbuylist[itemnameab[item]] = itemdict[item];
              }
            }

            if (Object.keys(wantbuylist).length > 0) {
              await AAD.Logic.Utility.checkStockAndBuy(wantbuylist);
              autobuyCompleted = true;
            }
          }
        }

        // 处理装备修理
        if (option.repair) {
          if (autobuyCompleted) {
            await AAD.Logic.Utility.sleep(AAD.Utils.Time.getRandomDelayMs(800, 1100));
          }
          await this.handleEquipmentRepair(option);
        }

        if (option.idleArena) {
          AAD.Logic.Arena.ensureDailyReset();
        }

        // 竞技场优先：竞技场未完成时优先执行竞技场
        const arenaState = AAD.Core.Storage.getValue('arena');
        const arenaCompleted = !!(arenaState &&
                                  arenaState.dayKey === todayKey &&
                                  arenaState.isOk &&
                                  arenaState.completeHandled);

        if (option.idleArena && !arenaCompleted) {
          const delay = AAD.Utils.Time.getIdleArenaDelay();
          console.log(`[闲置竞技场] 将在${(delay / 1000).toFixed(1)}秒后检查竞技场`);
          setTimeout(() => {
            AAD.Logic.Arena.runArena();
          }, delay);
          return;
        }

        // 自动IW：仅在竞技场关闭或竞技场完成后执行
        if (option.autoIW && Array.isArray(option.autoIWTasks) && option.autoIWTasks.length > 0) {
          await AAD.Logic.AutoIW.runAutoIW();
        }
      },

      // 装备修理处理函数
      async handleEquipmentRepair(option) {
        if (AAD.Logic.Utility.handleIsekaiRepair) {
          await AAD.Logic.Utility.handleIsekaiRepair(option);
        }
      },

      // 小马辅助功能
      misspony() {
        const option = AAD.Core.Storage.getValue('option') || {};
        if (option.ponymiss) {
          if (AAD.Utils.DOM.gE('#pane_effects>img[src*="riddlemaster"]')) {
            AAD.Core.Storage.setValue('missanswer', false);
          }
          if (AAD.Utils.DOM.gE('#riddlecounter')) {
            AAD.Core.Storage.setValue('missanswer', true);
          }
        } else {
          AAD.Core.Storage.setValue('missanswer', false);
        }
      }
    };

AAD.Logic.World = {
      FLOW_KEY: 'crossWorldFlow',
      ENABLED_KEY: 'crossWorldEnabled',

      STAGE: Object.freeze({
        MAIN_RUNNING: 'main_running',
        ISEKAI_RUNNING: 'isekai_running',
        DONE: 'done'
      }),

      normalizeStage(stage) {
        if (stage === this.STAGE.MAIN_RUNNING ||
            stage === this.STAGE.ISEKAI_RUNNING ||
            stage === this.STAGE.DONE) {
          return stage;
        }
        return this.STAGE.MAIN_RUNNING;
      },

      isCrossWorldEnabled() {
        return !!AAD.Core.Storage.getValue(this.ENABLED_KEY);
      },

      setCrossWorldEnabled(enabled) {
        AAD.Core.Storage.setValue(this.ENABLED_KEY, !!enabled);
      },

      syncCrossWorldEnabledFromOption(option) {
        if (AAD.Runtime.isIsekai()) {
          return;
        }
        this.setCrossWorldEnabled(!!(option && option.crossWorldArena));
      },

      createDefaultFlow(dayKey) {
        return {
          dayKey: dayKey || AAD.Utils.Time.getUtcDayKey(),
          stage: this.STAGE.MAIN_RUNNING,
          jumpLock: false
        };
      },

      getFlowState() {
        const stored = AAD.Core.Storage.getValue(this.FLOW_KEY) || {};
        const dayKey = stored.dayKey || AAD.Utils.Time.getUtcDayKey();
        return {
          dayKey,
          stage: this.normalizeStage(stored.stage),
          jumpLock: !!stored.jumpLock
        };
      },

      setFlowState(state) {
        const current = this.getFlowState();
        const next = {
          dayKey: state && state.dayKey ? state.dayKey : current.dayKey,
          stage: this.normalizeStage(state && state.stage),
          jumpLock: !!(state && state.jumpLock)
        };
        AAD.Core.Storage.setValue(this.FLOW_KEY, next);
      },

      resetFlowForNewDay(dayKey) {
        const targetDayKey = dayKey || AAD.Utils.Time.getUtcDayKey();
        this.setFlowState(this.createDefaultFlow(targetDayKey));
      },

      resetFlowFromUI() {
        AAD.Core.Storage.delValue('crossWorldState');
        AAD.Core.Storage.delValue('crossWorldFlow');
        this.resetFlowForNewDay();
      },

      setManualStage(stage) {
        const todayKey = AAD.Utils.Time.getUtcDayKey();
        const normalizedStage = this.normalizeStage(stage);
        const flow = this.ensureDailyFlowSync(todayKey);
        if (flow.stage === normalizedStage && !flow.jumpLock && flow.dayKey === todayKey) {
          return false;
        }

        const nextFlow = {
          dayKey: todayKey,
          stage: normalizedStage,
          jumpLock: false
        };
        this.setFlowState(nextFlow);

        if (this.isCrossWorldEnabled()) {
          this.enforceWorldConsistency();
        }
        return true;
      },

      ensureDailyFlowSync(dayKey) {
        const targetDayKey = dayKey || AAD.Utils.Time.getUtcDayKey();
        const flow = this.getFlowState();
        if (flow.dayKey !== targetDayKey) {
          this.resetFlowForNewDay(targetDayKey);
          return this.getFlowState();
        }
        return flow;
      },

      resolveExpectedWorld(flow) {
        const stage = this.normalizeStage(flow && flow.stage);
        if (stage === this.STAGE.ISEKAI_RUNNING) return 'isekai';
        return 'main';
      },

      buildJumpUrl(targetWorld) {
        const currentUrl = window.location.origin + window.location.pathname;
        if (targetWorld === 'isekai') {
          return AAD.Runtime.isIsekai()
            ? currentUrl
            : currentUrl.replace(/hentaiverse\.org\//, 'hentaiverse.org/isekai/');
        }
        return currentUrl.replace(/\/isekai\//, '/');
      },

      startJump(flow, targetWorld, reason = '') {
        if (!flow || flow.jumpLock) {
          return true;
        }
        const nextFlow = { ...flow, jumpLock: true };
        this.setFlowState(nextFlow);
        const targetUrl = this.buildJumpUrl(targetWorld);
        const reasonText = reason ? `，原因：${reason}` : '';
        console.log(`[跨世界] 执行防卫跳转 -> ${targetWorld}${reasonText}`);
        document.title = `[AAD] 跳转到${targetWorld === 'isekai' ? '异世界' : '主世界'}`;
        AAD.UI.UITools.openUrl(targetUrl);
        return true;
      },

      enforceWorldConsistency() {
        if (!this.isCrossWorldEnabled()) {
          return false;
        }

        const todayKey = AAD.Utils.Time.getUtcDayKey();
        const flow = this.ensureDailyFlowSync(todayKey);
        const isIsekai = AAD.Runtime.isIsekai();
        const expectedWorld = this.resolveExpectedWorld(flow);
        const currentWorld = isIsekai ? 'isekai' : 'main';

        if (flow.stage === this.STAGE.DONE) {
          if (flow.jumpLock) {
            this.setFlowState({ ...flow, jumpLock: false });
          }
          return false;
        }

        if (currentWorld === expectedWorld) {
          if (flow.jumpLock) {
            this.setFlowState({ ...flow, jumpLock: false });
          }
          return false;
        }

        return this.startJump(flow, expectedWorld, '当前世界与流程阶段不一致');
      },

      // 处理竞技场完成后的跨世界逻辑
      handleArenaCompleteCrossWorld(reason) {
        if (!this.isCrossWorldEnabled()) {
          return;
        }

        const flow = this.ensureDailyFlowSync();
        const isMainWorld = !AAD.Runtime.isIsekai();
        const worldLabel = isMainWorld ? '主世界' : '异世界';
        console.log(`[跨世界] ${worldLabel}竞技场完成：${reason}`);

        if (flow.stage === this.STAGE.DONE) {
          console.log('[跨世界] 本日循环已完成，不触发跳转');
          return;
        }

        if (isMainWorld) {
          if (flow.stage !== this.STAGE.MAIN_RUNNING) {
            console.log('[跨世界] 当前阶段不是主世界流程，忽略主世界完成信号');
            return;
          }
          const nextFlow = { ...flow, stage: this.STAGE.ISEKAI_RUNNING, jumpLock: false };
          this.setFlowState(nextFlow);
          document.title = AAD.Utils.Common.alert(-1, '主世界完成');
          this.startJump(nextFlow, 'isekai', '主世界竞技场完成');
          return;
        }

        if (flow.stage !== this.STAGE.ISEKAI_RUNNING) {
          console.log('[跨世界] 当前阶段不是异世界流程，忽略异世界完成信号');
          return;
        }
        const nextFlow = { ...flow, stage: this.STAGE.DONE, jumpLock: false };
        this.setFlowState(nextFlow);
        document.title = AAD.Utils.Common.alert(-1, '异世界完成');
        this.startJump(nextFlow, 'main', '异世界竞技场完成');
      }
    };

AAD.Logic.Utility = {
      GIFT_INTERVAL_KEY: 'nextGiftIntervalMs',

      shouldSkipRecentRequest(key) {
        const now = Date.now();
        const nextTime = Number(AAD.Core.Storage.getValue(key)) || 0;

        if (nextTime && now < nextTime) {
          return true;
        }

        AAD.Core.Storage.setValue(key, now + AAD.Utils.Time.getRandomDelayMs(
          GAME_MECHANICS.BAZAAR_REQUEST_COOLDOWN_MIN_MINUTES * 60 * 1000,
          GAME_MECHANICS.BAZAAR_REQUEST_COOLDOWN_MAX_MINUTES * 60 * 1000
        ));
        return false;
      },

      sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
      },

      getNextGiftIntervalMs(forceRefresh = false) {
        const minMs = GAME_MECHANICS.GIFT_MIN_HOURS * 3600 * 1000;
        const maxMs = GAME_MECHANICS.GIFT_MAX_HOURS * 3600 * 1000;
        const createRandomInterval = () => Math.round(minMs + Math.random() * (maxMs - minMs));

        if (forceRefresh) {
          const next = createRandomInterval();
          AAD.Core.Storage.setValue(this.GIFT_INTERVAL_KEY, next);
          return next;
        }

        const interval = Number(AAD.Core.Storage.getValue(this.GIFT_INTERVAL_KEY));
        if (!Number.isFinite(interval) || interval < minMs || interval > maxMs) {
          const next = createRandomInterval();
          AAD.Core.Storage.setValue(this.GIFT_INTERVAL_KEY, next);
          return next;
        }
        return interval;
      },

      // 礼物领取功能
      async receiveGifts() {
        if (AAD.Runtime.isIsekai()) {
          return;
        }
        AAD.Utils.Common.showStatus('正在检查礼物领取状态...');

        const gifturl = "?s=Bazaar&ss=ml";
        const nowtime = Date.now();
        const lastGiftTime = Number(AAD.Core.Storage.getValue('lastGiftTime')) || 0;
        const nextGiftIntervalMs = this.getNextGiftIntervalMs();

        if (lastGiftTime && (nowtime - lastGiftTime) < nextGiftIntervalMs) {
          AAD.Utils.Common.showStatus('礼物领取: 时间未到，无需领取');
          return;
        }

        const statusText = lastGiftTime ? '正在领取礼物...' : '首次运行，正在领取礼物...';
        AAD.Utils.Common.showStatus(statusText);
        await AAD.Core.Network.postPromise(gifturl);
        await AAD.Core.Network.postPromise(gifturl, "feed_all=food");
        AAD.Core.Storage.setValue('lastGiftTime', nowtime);
        this.getNextGiftIntervalMs(true);
        AAD.Utils.Common.showStatus('礼物领取完成');
      },

      // 检查库存并购买物品
      async checkStockAndBuy(items) {
        if (this.shouldSkipRecentRequest('nextAutobuyCheckTime')) {
          return;
        }

        AAD.Utils.Common.showStatus('正在检查库存并购买物品...');

        const url = "?s=Bazaar&ss=is"
        const data = await AAD.Core.Network.postPromise(url)
        const inventory = await this.getStock(data)
        if (!inventory) {
          AAD.Utils.Common.showStatus('库存解析失败，已跳过自动购买');
          return;
        }
        AAD.Core.State.set('inventory', inventory)
        const storetoken = AAD.Core.Network.getstoken(data)
        if (!storetoken) {
          AAD.Utils.Common.showStatus('无法获取商店令牌，已跳过自动购买');
          return;
        }

        let purchasedCount = 0;
        const isIsekai = AAD.Runtime.isIsekai();
        const minStock = isIsekai ? 300 : 400;
        const buyCount = isIsekai ? 300 : 500;
        const buyTargets = [];

        for (const item in items) {
          const itemId = items[item];
          if (!data.querySelector(`#shop_pane #item_${itemId}`)) {
            continue;
          }
          const currentCount = Object.prototype.hasOwnProperty.call(inventory, item) ? inventory[item] : 0;
          if (currentCount < minStock) {
            buyTargets.push(itemId);
          }
        }

        for (let i = 0; i < buyTargets.length; i++) {
          if (i > 0) {
            await this.sleep(AAD.Utils.Time.getRandomDelayMs(350, 700));
          }
          const success = await this.buyItem(buyTargets[i], buyCount, storetoken);
          if (success) {
            purchasedCount++;
          }
        }

        if (purchasedCount > 0) {
          AAD.Utils.Common.showStatus(`已购买 ${purchasedCount} 件物品`);
        } else {
          AAD.Utils.Common.showStatus('库存充足，无需购买');
        }
      },

      // 购买单个物品
      async buyItem(id, count, storetoken) {
        const params = `storetoken=${storetoken}&select_mode=shop_pane&select_item=${id}&select_count=${count}`;
        const data = await AAD.Core.Network.postPromise("?s=Bazaar&ss=is", params);
        const messageBox = data && data.querySelector ? data.querySelector('#messagebox_outer') : null;
        const success = !messageBox;
        return success;
      },


      // 获取库存数据
      async getStock(data) {
        const table = data && data.querySelector ? data.querySelector('#item_pane table.itemlist') : null;
        if (!table) {
          return null;
        }

        let inventory = {};
        const rows = table.querySelectorAll('tr');
        for (let i = 0; i < rows.length; i++) {
          const cells = rows[i].querySelectorAll('td');
          if (cells.length >= 2) {
            const itemName = cells[0].textContent.trim();
            const quantity = parseInt(cells[1].textContent.trim(), 10);
            if (itemName && !Number.isNaN(quantity)) {
              inventory[itemName] = quantity;
            }
          }
        }

        return inventory;
      },

      // 修理装备（阈值修理）
      async handleIsekaiRepair(option) {
        if (this.shouldSkipRecentRequest('nextRepairCheckTime')) {
          return;
        }

        const repairValue = Number(option && option.repairValue);
        const url = '?s=Bazaar&ss=am&screen=repair&filter=equipped';
        const data = await AAD.Core.Network.postPromise(url);
        const postoken = AAD.Utils.DOM.gE('[name="postoken"]', data).value;
        const rows = AAD.Utils.DOM.gE('#equiplist tr[onmouseover]', 'all', data);
        const eqitemsMatch = data.body.innerHTML.match(/eqitems\s?=\s?(\{.*?\});/);
        const eqitems = eqitemsMatch ? JSON.parse(eqitemsMatch[1]) : {};
        const params = new URLSearchParams();
        let hasTargets = false;

        params.append('postoken', postoken);
        for (const row of rows) {
          const equipId = AAD.Utils.DOM.gE('input', row).value;
          const condition = parseInt(AAD.Utils.DOM.gE('td:nth-child(2)', row).textContent, 10);
          if (condition <= repairValue && eqitems[equipId]?.m) {
            params.append('eqids[]', equipId);
            hasTargets = true;
          }
        }

        if (hasTargets) {
          await this.sleep(AAD.Utils.Time.getRandomDelayMs(350, 700));
          await AAD.Core.Network.postPromise(url, params.toString());
        }
      }
    };

// 数据处理层

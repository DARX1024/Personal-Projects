AAD.UI = {};

AAD.UI.ColumnSettings = {
      // 获取启用的列定义
      getEnabledColumns() {
        const config = AAD.Core.Config.getAll() || {};
        const savedColumns = config.dataColumns || {};
        const enabledColumns = {};

        Object.keys(dbTableColumnsAll).forEach(groupName => {
          const enabledInGroup = [];
          dbTableColumnsAll[groupName].forEach(column => {
            const isEnabled = savedColumns[column.id] === true;

            if (isEnabled) {
              enabledInGroup.push(column);
            }
          });

          if (enabledInGroup.length > 0) {
            enabledColumns[groupName] = enabledInGroup;
          }
        });

        return enabledColumns;
      }
    };

AAD.UI.Panel = {
      // 面板状态管理
      isVisible: false,
      currentTab: 'CombatCore',
      orderKeys: ['itemOrder', 'channelSkillOrder', 'buffSkillOrder', 'debuffSkillOrder', 'skillOrder', 'idleArenaOrder'],
      orderState: null,

      // 初始化配置面板
      init() {
        this.createButton();
      },

      // 创建浮动配置按钮
      createButton() {
        if (document.getElementById('dbButton')) {
          return;
        }

        const button = AAD.Utils.DOM.cE('div');
        button.id = 'dbButton';
        button.className = 'dbButton';
        button.title = 'hvAutoAttack 设置';
        button.onclick = () => this.toggle();
        button.innerHTML = '⚙';
        document.body.appendChild(button);
      },

      // 切换面板显示状态
      toggle() {
        const panel = AAD.Utils.DOM.gE('#dbBox');
        if (panel) {
          this.isVisible = !this.isVisible;
          panel.style.display = this.isVisible ? 'block' : 'none';
          if (!this.isVisible) {
            AAD.Core.State.set('customizePinned', false);
            AAD.Core.State.set('customizeTarget', null);
            const customizeBox = AAD.Utils.DOM.gE('#customizeBox');
            if (customizeBox) {
              const inspectButton = customizeBox.querySelector('.dbInspect');
              if (inspectButton) inspectButton.title = 'off';
              customizeBox.style.display = 'none';
              customizeBox.style.zIndex = '-1';
            }
          }
        } else {
          this.createPanel();
          this.isVisible = true;
        }
      },

      // 创建配置面板
      createPanel() {
        const panel = AAD.Utils.DOM.cE('div');
        panel.id = 'dbBox';
        panel.className = 'dbPanel';

        // 构建面板HTML结构
        panel.innerHTML = this.buildPanelHTML();

        document.body.appendChild(panel);

        // 绑定面板事件
        this.bindPanelEvents(panel);

        // 加载配置到面板
        this.loadConfigToPanel(panel);

        // 初始化预设选择器
        AAD.UI.Preset.initPresetSelector(panel);

        // 显示面板
        panel.style.display = 'block';
        this.isVisible = true;
      },

      initOrderState(config) {
        const state = {};
        for (let i = 0; i < this.orderKeys.length; i++) {
          const key = this.orderKeys[i];
          const value = Array.isArray(config[key]) ? config[key].slice() : [];
          state[key] = key === 'idleArenaOrder' ? value.map(item => String(item)) : value;
        }
        this.orderState = state;
      },

      forEachPanelField(panel, handler, includeTextarea = false) {
        const selector = includeTextarea ? 'input, select, textarea' : 'input, select';
        const fields = panel.querySelectorAll(selector);
        for (let i = 0; i < fields.length; i++) {
          handler(fields[i]);
        }
      },

      getFieldName(input) {
        return input.name || input.id || '';
      },

      isOrderCheckbox(input, orderKeys) {
        if (input.type !== 'checkbox' || !input.id) return false;
        for (let i = 0; i < orderKeys.length; i++) {
          if (input.id.startsWith(orderKeys[i] + '_')) return true;
        }
        return false;
      },

        getConfigValue(config, itemName) {
          if (itemName.includes('.')) {
            const parts = itemName.split('.');
            return config[parts[0]] ? config[parts[0]][parts[1]] : undefined;
          }

          const itemArray = itemName.split('_');
          if (itemArray.length === 2 && typeof config[itemArray[0]] === 'object' && config[itemArray[0]][itemArray[1]] !== undefined) {
            return config[itemArray[0]][itemArray[1]];
          }

          return config[itemName];
        },

      setConfigValue(config, itemName, itemValue, isArrayValue) {
        if (itemName.includes('.')) {
          const parts = itemName.split('.');
          if (!config[parts[0]]) config[parts[0]] = {};
          config[parts[0]][parts[1]] = itemValue;
          return;
        }

        const itemArray = itemName.split('_');
        if (itemArray.length === 1) {
          config[itemName] = itemValue;
          return;
        }

        if (!config[itemArray[0]]) config[itemArray[0]] = {};
        if (isArrayValue) {
          if (!Array.isArray(config[itemArray[0]][itemArray[1]])) {
            config[itemArray[0]][itemArray[1]] = [];
          }
          config[itemArray[0]][itemArray[1]].push(itemValue);
        } else {
          config[itemArray[0]][itemArray[1]] = itemValue;
        }
      },

      // 构建面板HTML
      buildPanelHTML() {
        const tabDefs = [
          { name: 'CombatCore', label: '战斗核心', build: () => this.buildCombatCoreTab() },
          { name: 'Automation', label: '自动化', build: () => this.buildAutomationTab() },
          { name: 'Item', label: '物品', build: () => this.buildItemTab() },
          { name: 'Channel', menuHtml: '<input id="channelSkillSwitch" type="checkbox"><label for="channelSkillSwitch">Channel</label>', build: () => this.buildChannelTab() },
          { name: 'Buff', menuHtml: '<input id="buffSkillSwitch" type="checkbox"><label for="buffSkillSwitch">BUFF</label>', build: () => this.buildBuffTab() },
          { name: 'Debuff', menuHtml: '<input id="debuffSkillSwitch" type="checkbox"><label for="debuffSkillSwitch">DEBUFF</label>', build: () => this.buildDebuffTab() },
          { name: 'Skill', menuHtml: '<input id="skillSwitch" type="checkbox"><label for="skillSwitch">其他技能</label>', build: () => this.buildSkillTab() },
          { name: 'Scroll', menuHtml: '<input id="scrollSwitch" type="checkbox"><label for="scrollSwitch">卷轴</label>', build: () => this.buildScrollTab() },
          { name: 'PersonaConfig', menuHtml: '<input id="personaConfigSwitch" type="checkbox"><label for="personaConfigSwitch">人格配置</label>', build: () => this.buildPersonaConfigTab() },
          { name: 'DataRecord', menuHtml: '<input id="dataRecordSwitch" type="checkbox"><label for="dataRecordSwitch">数据记录</label>', build: () => this.buildDataRecordTab() },
          { name: 'ConfigSettings', label: '配置设置', build: () => this.buildConfigSettingsTab() },
          { name: 'System', label: '系统设置', build: () => this.buildSystemTab() }
        ];

        const menuHtml = tabDefs.map((tab, index) => {
          const activeClass = index === 0 ? ' class="active"' : '';
          const content = tab.menuHtml || tab.label;
          return `<span name="${tab.name}"${activeClass}>${content}</span>`;
        }).join('');

        const contentHtml = tabDefs.map((tab, index) => {
          const activeClass = index === 0 ? ' active' : '';
          return `
            <div class="dbTab${activeClass}" id="dbTab-${tab.name}">
              ${tab.build()}
            </div>
          `;
        }).join('');

        return `
          <div class="dbCenter">
            <h1 style="display:inline;">AADB</h1>
            <div class="dbTopButtons">
              <button class="dbReset" title="重置所有设置为默认值">重置设置</button>
              <button class="dbApply" title="应用当前设置">应用</button>
              <button class="dbCancel" title="取消修改">取消</button>
            </div>
          </div>
          <div class="dbTablist">
            <div class="dbTabmenu">
              ${menuHtml}
            </div>
            ${contentHtml}
          </div>
        `;
      },

      // 构建战斗核心标签页
      buildCombatCoreTab() {
        return `
          <div id="attackStatus" style="color:red;"><b>攻击模式</b>
            <select class="dbNumber" name="attackStatus">
              <option value="-1"></option>
              <option value="0">物理</option>
              <option value="1">火</option>
              <option value="2">冰</option>
              <option value="3">雷</option>
              <option value="4">风</option>
              <option value="5">圣</option>
              <option value="6">暗</option>
            </select>
          </div>
          <div><b>魔法技能</b> <br>
            <span class="dbTipText">中阶技能使用条件</span> <div class="customize" name="middleSkillCondition"></div>
            <span class="dbTipText">高阶技能使用条件</span> <div class="customize" name="highSkillCondition"></div>
          </div>
          <div><b>数据配置</b><br>
            <span class="dbTipText">系数 <input class="dbNumber" name="impDamage" type="text" placeholder="1.5"> 熟练 <input class="dbNumber" name="profFactor" type="text" placeholder="0.79"> MDB <input class="dbNumber" name="mageMDB" type="text" placeholder="4000"> EDB <input class="dbNumber" name="mageEDB" type="text" placeholder="400"> 攻击环 <input class="dbNumber" name="hathBonus" type="text" placeholder="0.5"> TW <input class="dbNumber" name="twBonus" type="text" placeholder="0.1"></span><br>
            <span class="dbTipText">怪物数据库: <span id="monsterDbStatus">${AAD.Data.MonsterDB.getStatusText()}</span> <button class="monsterDbUpdate" type="button">更新</button><button class="monsterDbDelete" type="button">删除</button></span>
          </div>
          <div><input id="magicFinisherSwitch" type="checkbox"><label for="magicFinisherSwitch"><b>魔法补刀</b></label>
            类型 <select class="dbNumber" name="magicFinisherType"><option value="1">火</option><option value="2">冰</option><option value="3">雷</option><option value="4">风</option><option value="5">圣</option><option value="6">暗</option></select>
            阶数 <select class="dbNumber" name="magicFinisherTier"><option value="1">T1</option><option value="2">T2</option><option value="3">T3</option></select>
            EDB <input class="dbNumber" name="magicFinisherFirstEDB" type="text" placeholder="0">
          </div>
          <div><input id="turnOnSS" type="checkbox"><label for="turnOnSS"><b>开启灵动架势</b></label> <div class="customize" name="turnOnSSCondition"></div></div>
          <div><input id="turnOffSS" type="checkbox"><label for="turnOffSS"><b>关闭灵动架势</b></label> <div class="customize" name="turnOffSSCondition"></div></div>
          <div><input id="defend" type="checkbox"><label for="defend"><b>防御</b></label> <div class="customize" name="defendCondition"></div></div>
          <div><input id="focus" type="checkbox"><label for="focus"><b>专注</b></label> <div class="customize" name="focusCondition"></div></div>
          <div><input id="etherTap" type="checkbox"><label for="etherTap"><b>法力回流</b></label> <div class="customize" name="etherTapCondition"></div></div>
          <div><b>攻击规则</b><br>
            <span class="dbTipText">每回合按当前血量计算基础权重：最低血量的敌人为 10，其它敌人按 当前血量 / 最低血量 × 10 计算。基础权重会与下方各状态权重相加。</span><br>
            <span class="dbTipText">虚弱 <input class="dbNumber" name="weight_We" placeholder="0" type="text"> 陷危 <input class="dbNumber" name="weight_Im" placeholder="0" type="text"> 沉眠 <input class="dbNumber" name="weight_Sle" placeholder="0" type="text"> 沉默 <input class="dbNumber" name="weight_Si" placeholder="0" type="text"> 定身 <input class="dbNumber" name="weight_MN" placeholder="0" type="text"></span><br>
            <span class="dbTipText">眩晕 <input class="dbNumber" name="weight_Stun" placeholder="0" type="text"> 混乱 <input class="dbNumber" name="weight_Co" placeholder="0" type="text"> 枯竭 <input class="dbNumber" name="weight_Dr" placeholder="0" type="text"> 减速 <input class="dbNumber" name="weight_Slo" placeholder="0" type="text"> 致盲 <input class="dbNumber" name="weight_Bl" placeholder="0" type="text"></span><br>
            <span class="dbTipText">破甲 <input class="dbNumber" name="weight_PA" placeholder="0" type="text"> 流血 <input class="dbNumber" name="weight_BW" placeholder="0" type="text"> 法力合流 <input class="dbNumber" name="weight_CM" placeholder="0" type="text"></span></div>
          <div><input id="ruleReverse" type="checkbox"><label for="ruleReverse">勾选攻击权重最最大，不勾选攻击权重最小</label></div>
          <div><input id="ruleOrder" type="checkbox"><label for="ruleOrder">塔内顺序攻击</label></div>
          <div><input id="ruleOrderGlobal" type="checkbox"><label for="ruleOrderGlobal">全局顺序攻击</label></div>
        `;
      },

      // 构建自动化标签页
      buildAutomationTab() {
        return `
          <div><input id="idleArena" type="checkbox"><label for="idleArena"><b>自动AR</b></label>
            <span class="dbTipText">场间延迟</span><input class="dbNumber" name="idleArenaTime" placeholder="60" type="text"> <button class="idleArenaReset">重置战斗</button>
            <button class="dbShowLevels">切换显示</button><button class="dbLevelsClear">清空</button><span class="dbTipText" id="idleArenaResetTime" style="margin-left:40px;"></span>
            <br>
            <input id="idleArenaOrderDisplay" style="width:98%;" type="text" disabled>
            <div id="dbArenaLevels" class="dbArenaLevels">
              <input id="arLevel_1" value="1" type="checkbox"><label for="arLevel_1">1</label> <input id="arLevel_10" value="3" type="checkbox"><label for="arLevel_10">10</label> <input id="arLevel_20" value="5" type="checkbox"><label for="arLevel_20">20</label> <input id="arLevel_30" value="8" type="checkbox"><label for="arLevel_30">30</label> <input id="arLevel_40" value="9" type="checkbox"><label for="arLevel_40">40</label> <input id="arLevel_50" value="11" type="checkbox"><label for="arLevel_50">50</label> <input id="arLevel_60" value="12" type="checkbox"><label for="arLevel_60">60</label> <input id="arLevel_70" value="13" type="checkbox"><label for="arLevel_70">70</label> <input id="arLevel_80" value="15" type="checkbox"><label for="arLevel_80">80</label> <input id="arLevel_90" value="16" type="checkbox"><label for="arLevel_90">90</label> <input id="arLevel_100" value="17" type="checkbox"><label for="arLevel_100">100</label> <input id="arLevel_110" value="19" type="checkbox"><label for="arLevel_110">110</label> <input id="arLevel_120" value="20" type="checkbox"><label for="arLevel_120">120</label><br>
              <input id="arLevel_130" value="21" type="checkbox"><label for="arLevel_130">130</label> <input id="arLevel_140" value="23" type="checkbox"><label for="arLevel_140">140</label> <input id="arLevel_150" value="24" type="checkbox"><label for="arLevel_150">150</label> <input id="arLevel_165" value="26" type="checkbox"><label for="arLevel_165">165</label> <input id="arLevel_180" value="27" type="checkbox"><label for="arLevel_180">180</label> <input id="arLevel_200" value="28" type="checkbox"><label for="arLevel_200">200</label> <input id="arLevel_225" value="29" type="checkbox"><label for="arLevel_225">225</label> <input id="arLevel_250" value="32" type="checkbox"><label for="arLevel_250">250</label> <input id="arLevel_300" value="33" type="checkbox"><label for="arLevel_300">300</label><input id="arLevel_400" value="34" type="checkbox"><label for="arLevel_400">400</label><input id="arLevel_500" value="35" type="checkbox"><label for="arLevel_500">500</label><br>
              <input id="arLevel_RB50" value="105" type="checkbox"><label for="arLevel_RB50">RB50</label> <input id="arLevel_RB75A" value="106" type="checkbox"><label for="arLevel_RB75A">RB75A</label> <input id="arLevel_RB75B" value="107" type="checkbox"><label for="arLevel_RB75B">RB75B</label> <input id="arLevel_RB75C" value="108" type="checkbox"><label for="arLevel_RB75C">RB75C</label> <input id="arLevel_RB100" value="109" type="checkbox"><label for="arLevel_RB100">RB100</label> <input id="arLevel_RB150" value="110" type="checkbox"><label for="arLevel_RB150">RB150</label> <input id="arLevel_RB200" value="111" type="checkbox"><label for="arLevel_RB200">RB200</label> <input id="arLevel_RB250" value="112" type="checkbox"><label for="arLevel_RB250">RB250</label><br>
              <input id="arLevel_TW" value="tw" type="checkbox"><label for="arLevel_TW">TW(isk)</label> <input id="arLevel_GF" value="gr" type="checkbox"><label for="arLevel_GF">GF <input class="dbNumber" name="idleArenaGrTime" placeholder="0" type="text"></label>
            </div>
          </div>
          <div style="border-top:1px solid #ccc;padding-top:8px;margin-top:8px;">
              <input id="autoIW" type="checkbox"><label for="autoIW"><b>自动IW</b></label>
              <span class="dbTipText">目标等级</span><input class="dbNumber" name="autoIWTargetLevel" placeholder="" type="text">
            <button class="autoIWAddTask">增加任务</button><button class="autoIWClearTasks">清空任务</button>
            <input type="hidden" name="autoIWTasksJson">
            <div id="autoIWTaskList" class="dbTipText" style="margin-top:6px;"></div>
          </div>
          <div><input id="crossWorldArena" type="checkbox"><label for="crossWorldArena" style="color:#4CAF50;"><b>跨界连打</b></label>
            <button class="crossWorldJumpReset">重置跳转</button>
            <button class="crossWorldSetIsekai">切换异界</button>
            <button class="crossWorldSetDone">切换完成</button>
            <span id="crossWorldArenaIsekaiHint" style="display:none;color:#FF9800;margin-left:1em;">📍 当前在异世界，此选项在主世界控制</span>
          </div>
          <div><input id="encounter" type="checkbox"><label for="encounter"><b>自动遭遇</b></label> <button class="encounterResetPlan">重置计划</button> <input class="dbNumber" name="encounterDailyMin" placeholder="12" type="text">~<input class="dbNumber" name="encounterDailyMax" placeholder="24" type="text"></div>
          <div><input id="autoquit" type="checkbox"><label for="autoquit"><b>自动出场</b></label></div>
          <div><input id="defeatShutdown" type="checkbox"><label for="defeatShutdown"><b>战败停机</b></label></div>
          <div><input id="autoFlee" type="checkbox"><label for="autoFlee"><b>自动逃跑</b></label> <div class="customize" name="fleeCondition"></div></div>
          <div><input id="autoPause" type="checkbox"><label for="autoPause"><b>自动暂停</b></label> <div class="customize" name="pauseCondition"></div></div>
          <div><input id="specialPause" type="checkbox"><label for="specialPause"><b>特别暂停</b></label> <div class="customize" name="specialPauseCondition"></div></div>
          <div><input id="ponymiss" type="checkbox"><label for="ponymiss"><b>错马暂停</b></label></div>
          <div><input id="repair" type="checkbox"><label for="repair"><b>修复装备</b></label>:
            耐久度 ≤ <input class="dbNumber" name="repairValue" placeholder="60" type="text">%</div>
          <div><input id="autobuy" type="checkbox"><label for="autobuy"><b>自动补充</b></label><input class="dbInputWide" name="autobuylist" type="text"></div>
          <div><input id="regifts" type="checkbox"><label for="regifts"><b>自动收礼</b></label></div>
          <div><input id="restoreStamina" type="checkbox"><label for="restoreStamina"><b>战前回复</b>: </label>
            <span class="dbTipText">自动AR入场前,体力<<input class="dbNumber" name="staminaLow" placeholder="21" type="text"></label></span><br>
            <span class="dbTipText">不勾选时，小于设定值则不进行自动AR</span></div>
        `;
      },

      // 构建物品标签页
      buildItemTab() {
        return `
          <div class="itemOrder"><span class="dbTipText">施放顺序</span> <input class="dbInputWide" name="itemOrder" type="text" disabled><br>
            <input id="itemOrder_Cure" type="checkbox"><label for="itemOrder_Cure">治疗</label><input id="itemOrder_FC" type="checkbox"><label for="itemOrder_FC">完全治疗</label><input id="itemOrder_HP" type="checkbox"><label for="itemOrder_HP">生命药水</label><input id="itemOrder_HE" type="checkbox"><label for="itemOrder_HE">生命秘药</label><input id="itemOrder_MP" type="checkbox"><label for="itemOrder_MP">法力药水</label><input id="itemOrder_ME" type="checkbox"><label for="itemOrder_ME">法力秘药</label><br>
            <input id="itemOrder_SP" type="checkbox"><label for="itemOrder_SP">灵力药水</label><input id="itemOrder_SE" type="checkbox"><label for="itemOrder_SE">灵力秘药</label><input id="itemOrder_LE" type="checkbox"><label for="itemOrder_LE">终极秘药</label><input id="itemOrder_ED" type="checkbox"><label for="itemOrder_ED">能量饮料</label></div>
          <div><input id="item_Cure" type="checkbox"><label for="item_Cure"><b>治疗</b></label> <div class="customize" name="itemCureCondition"></div></div>
          <div><input id="item_FC" type="checkbox"><label for="item_FC"><b>完全治疗</b></label> <div class="customize" name="itemFCCondition"></div></div>
          <div><input id="item_HP" type="checkbox"><label for="item_HP"><b>生命药水</b></label> <div class="customize" name="itemHPCondition"></div></div>
          <div><input id="item_HE" type="checkbox"><label for="item_HE"><b>生命秘药</b></label> <div class="customize" name="itemHECondition"></div></div>
          <div><input id="item_MP" type="checkbox"><label for="item_MP"><b>法力药水</b></label> <div class="customize" name="itemMPCondition"></div></div>
          <div><input id="item_ME" type="checkbox"><label for="item_ME"><b>法力秘药</b></label> <div class="customize" name="itemMECondition"></div></div>
          <div><input id="item_SP" type="checkbox"><label for="item_SP"><b>灵力药水</b></label> <div class="customize" name="itemSPCondition"></div></div>
          <div><input id="item_SE" type="checkbox"><label for="item_SE"><b>灵力秘药</b></label> <div class="customize" name="itemSECondition"></div></div>
          <div><input id="item_LE" type="checkbox"><label for="item_LE"><b>终极秘药</b></label> <div class="customize" name="itemLECondition"></div></div>
          <div><input id="item_ED" type="checkbox"><label for="item_ED"><b>能量饮料</b></label> <div class="customize" name="itemEDCondition"></div></div>
          <div><input id="item_Infusion" type="checkbox"><label for="item_Infusion"><b>魔药</b></label> <div class="customize" name="itemInfusionCondition"></div><br><span class="dbTipText">魔药属性与<span>战斗核心</span>里的攻击模式相同</span></div>
          <div><input id="item_HealthGem" type="checkbox"><label for="item_HealthGem"><b>生命宝石</b></label> <div class="customize" name="itemHealthGemCondition"></div></div>
          <div><input id="item_ManaGem" type="checkbox"><label for="item_ManaGem"><b>法力宝石</b></label> <div class="customize" name="itemManaGemCondition"></div></div>
          <div><input id="item_SpiritGem" type="checkbox"><label for="item_SpiritGem"><b>灵力宝石</b></label> <div class="customize" name="itemSpiritGemCondition"></div></div>
          <div><input id="item_MysticGem" type="checkbox"><label for="item_MysticGem"><b>神秘宝石</b></label> <div class="customize" name="itemMysticGemCondition"></div></div>
        `;
      },

      // 构建Channel标签页
      buildChannelTab() {
        return `
          <div class="channelSkillOrder"><span class="dbTipText">施放顺序</span>
            <input class="dbInputWide" name="channelSkillOrder" type="text" disabled><br>
            <input id="channelSkillOrder_Pr" type="checkbox"><label for="channelSkillOrder_Pr">守护</label><input id="channelSkillOrder_SL" type="checkbox"><label for="channelSkillOrder_SL">生命火花</label><input id="channelSkillOrder_SS" type="checkbox"><label for="channelSkillOrder_SS">灵力盾</label><input id="channelSkillOrder_Ha" type="checkbox"><label for="channelSkillOrder_Ha">加速</label><input id="channelSkillOrder_AF" type="checkbox"><label for="channelSkillOrder_AF">奥术专注</label><input id="channelSkillOrder_He" type="checkbox"><label for="channelSkillOrder_He">觅心者</label><br>
            <input id="channelSkillOrder_Re" type="checkbox"><label for="channelSkillOrder_Re">细胞活化</label><input id="channelSkillOrder_SV" type="checkbox"><label for="channelSkillOrder_SV">影纱</label><input id="channelSkillOrder_Ab" type="checkbox"><label for="channelSkillOrder_Ab">吸收</label></div>
          <div><input id="channelSkill_Pr" type="checkbox"><label for="channelSkill_Pr"><b>守护</b></label> <div class="customize" name="channelSkillPrCondition"></div></div>
          <div><input id="channelSkill_SL" type="checkbox"><label for="channelSkill_SL"><b>生命火花</b></label> <div class="customize" name="channelSkillSLCondition"></div></div>
          <div><input id="channelSkill_SS" type="checkbox"><label for="channelSkill_SS"><b>灵力盾</b></label> <div class="customize" name="channelSkillSSCondition"></div></div>
          <div><input id="channelSkill_Ha" type="checkbox"><label for="channelSkill_Ha"><b>加速</b></label> <div class="customize" name="channelSkillHaCondition"></div></div>
          <div><input id="channelSkill_AF" type="checkbox"><label for="channelSkill_AF"><b>奥术专注</b></label> <div class="customize" name="channelSkillAFCondition"></div></div>
          <div><input id="channelSkill_He" type="checkbox"><label for="channelSkill_He"><b>觅心者</b></label> <div class="customize" name="channelSkillHeCondition"></div></div>
          <div><input id="channelSkill_Re" type="checkbox"><label for="channelSkill_Re"><b>细胞活化</b></label> <div class="customize" name="channelSkillReCondition"></div></div>
          <div><input id="channelSkill_SV" type="checkbox"><label for="channelSkill_SV"><b>影纱</b></label> <div class="customize" name="channelSkillSVCondition"></div></div>
          <div><input id="channelSkill_Ab" type="checkbox"><label for="channelSkill_Ab"><b>吸收</b></label> <div class="customize" name="channelSkillAbCondition"></div></div>
        `;
      },

      // 构建Buff标签页
      buildBuffTab() {
        return `<div class="buffSkillOrder"><span class="dbTipText">施放顺序</span>
            <input class="dbInputWide" name="buffSkillOrder" type="text" disabled><br>
            <input id="buffSkillOrder_Pr" type="checkbox"><label for="buffSkillOrder_Pr">守护</label><input id="buffSkillOrder_SL" type="checkbox"><label for="buffSkillOrder_SL">生命火花</label><input id="buffSkillOrder_SS" type="checkbox"><label for="buffSkillOrder_SS">灵力盾</label><input id="buffSkillOrder_Ha" type="checkbox"><label for="buffSkillOrder_Ha">加速</label><input id="buffSkillOrder_AF" type="checkbox"><label for="buffSkillOrder_AF">奥术专注</label><input id="buffSkillOrder_He" type="checkbox"><label for="buffSkillOrder_He">觅心者</label><br>
            <input id="buffSkillOrder_Re" type="checkbox"><label for="buffSkillOrder_Re">细胞活化</label><input id="buffSkillOrder_SV" type="checkbox"><label for="buffSkillOrder_SV">影纱</label><input id="buffSkillOrder_Ab" type="checkbox"><label for="buffSkillOrder_Ab">吸收</label></div>
          <div class="buffSkillCondition"><div class="customize" name="buffSkillCondition"></div></div>
          <div><input id="buffSkill_HD" type="checkbox"><label for="buffSkill_HD"><b>生命长效药</b></label> <div class="customize" name="buffSkillHDCondition"></div></div>
          <div><input id="buffSkill_MD" type="checkbox"><label for="buffSkill_MD"><b>法力长效药</b></label> <div class="customize" name="buffSkillMDCondition"></div></div>
          <div><input id="buffSkill_SD" type="checkbox"><label for="buffSkill_SD"><b>灵力长效药</b></label> <div class="customize" name="buffSkillSDCondition"></div></div>
          <div><input id="buffSkill_FV" type="checkbox"><label for="buffSkill_FV"><b>花瓶</b></label> <div class="customize" name="buffSkillFVCondition"></div></div>
          <div><input id="buffSkill_BG" type="checkbox"><label for="buffSkill_BG"><b>泡泡糖</b></label> <div class="customize" name="buffSkillBGCondition"></div></div>
          <div><input id="buffSkill_Pr" type="checkbox"><label for="buffSkill_Pr"><b>守护</b></label> <div class="customize" name="buffSkillPrCondition"></div></div>
          <div><input id="buffSkill_SL" type="checkbox"><label for="buffSkill_SL"><b>生命火花</b></label> <div class="customize" name="buffSkillSLCondition"></div></div>
          <div><input id="buffSkill_SS" type="checkbox"><label for="buffSkill_SS"><b>灵力盾</b></label> <div class="customize" name="buffSkillSSCondition"></div></div>
          <div><input id="buffSkill_Ha" type="checkbox"><label for="buffSkill_Ha"><b>加速</b></label> <div class="customize" name="buffSkillHaCondition"></div></div>
          <div><input id="buffSkill_AF" type="checkbox"><label for="buffSkill_AF"><b>奥术专注</b></label> <div class="customize" name="buffSkillAFCondition"></div></div>
          <div><input id="buffSkill_He" type="checkbox"><label for="buffSkill_He"><b>觅心者</b></label> <div class="customize" name="buffSkillHeCondition"></div></div>
          <div><input id="buffSkill_Re" type="checkbox"><label for="buffSkill_Re"><b>细胞活化</b></label> <div class="customize" name="buffSkillReCondition"></div></div>
          <div><input id="buffSkill_SV" type="checkbox"><label for="buffSkill_SV"><b>影纱</b></label> <div class="customize" name="buffSkillSVCondition"></div></div>
          <div><input id="buffSkill_Ab" type="checkbox"><label for="buffSkill_Ab"><b>吸收</b></label> <div class="customize" name="buffSkillAbCondition"></div></div>
        `;
      },

      // 构建Debuff标签页
      buildDebuffTab() {
        return `
          <div class="debuffSkillOrder"><span class="dbTipText">施放顺序</span>
            <input class="dbInputWide" name="debuffSkillOrder" type="text" disabled><br>
            <input id="debuffSkillOrder_Sle" type="checkbox"><label for="debuffSkillOrder_Sle">睡眠</label><input id="debuffSkillOrder_Im" type="checkbox"><label for="debuffSkillOrder_Im">陷危</label><input id="debuffSkillOrder_Si" type="checkbox"><label for="debuffSkillOrder_Si">沉默</label><input id="debuffSkillOrder_We" type="checkbox"><label for="debuffSkillOrder_We">虚弱</label><input id="debuffSkillOrder_Bl" type="checkbox"><label for="debuffSkillOrder_Bl">致盲</label><input id="debuffSkillOrder_Slo" type="checkbox"><label for="debuffSkillOrder_Slo">减速</label>
            <input id="debuffSkillOrder_MN" type="checkbox"><label for="debuffSkillOrder_MN">定身</label><input id="debuffSkillOrder_Dr" type="checkbox"><label for="debuffSkillOrder_Dr">枯竭</label><input id="debuffSkillOrder_Co" type="checkbox"><label for="debuffSkillOrder_Co">混乱</label></div>
          <div class="debuffSkillCondition"><div class="customize" name="debuffSkillCondition"></div></div>
          <div><input id="debuffSkillAllSleep" type="checkbox"><label for="debuffSkillAllSleep"><b>全体睡眠</b></label>
            <input class="dbNumber" name="sleepRatio" type="text" placeholder="0">
            <div class="customize" name="debuffSkillallsleepCondition"></div></div>
          <div><input id="debuffSkillAllMN" type="checkbox"><label for="debuffSkillAllMN"><b>全体定身</b></label><input class="dbNumber" name="magnetRatio" type="text" placeholder="0"> <div class="customize" name="debuffSkillallmagnetCondition"></div></div>
          <div><input id="debuffSkillAllWeak" type="checkbox"><label for="debuffSkillAllWeak"><b>全体虚弱</b></label>
            <input class="dbNumber" name="weakRatio" type="text" placeholder="0">
            <div class="customize" name="debuffSkillallweakCondition"></div></div>
          <div><input id="debuffSkillAllSi" type="checkbox"><label for="debuffSkillAllSi"><b>全体沉默</b></label><input class="dbNumber" name="silenceRatio" type="text" placeholder="0"> <div class="customize" name="debuffSkillallsilenceCondition"></div></div>
          <div><input id="debuffSkillPartialIm" type="checkbox"><label for="debuffSkillPartialIm"><b>部分陷危</b></label> <input id="debuffSkillPartialImBossMode" type="checkbox"><label for="debuffSkillPartialImBossMode">BOSS模式</label>
            <div class="customize" name="debuffSkillpartialimpCondition"></div></div>
          <div><input id="debuffSkillAllIm" type="checkbox"><label for="debuffSkillAllIm"><b>全体陷危</b></label><input class="dbNumber" name="impRatio" type="text" placeholder="0"> <div class="customize" name="debuffSkillallimpCondition"></div></div>
          <div><input id="debuffSkill_Sle" type="checkbox"><label for="debuffSkill_Sle"><b>睡眠</b></label> <div class="customize" name="debuffSkillSleCondition"></div></div>
          <div><input id="debuffSkill_Bl" type="checkbox"><label for="debuffSkill_Bl"><b>致盲</b></label> <div class="customize" name="debuffSkillBlCondition"></div></div>
          <div><input id="debuffSkill_Slo" type="checkbox"><label for="debuffSkill_Slo"><b>减速</b></label> <div class="customize" name="debuffSkillSloCondition"></div></div>
          <div><input id="debuffSkill_Im" type="checkbox"><label for="debuffSkill_Im"><b>陷危</b></label> <div class="customize" name="debuffSkillImCondition"></div></div>
          <div><input id="debuffSkill_MN" type="checkbox"><label for="debuffSkill_MN"><b>定身</b></label> <div class="customize" name="debuffSkillMNCondition"></div></div>
          <div><input id="debuffSkill_Si" type="checkbox"><label for="debuffSkill_Si"><b>沉默</b></label> <div class="customize" name="debuffSkillSiCondition"></div></div>
          <div><input id="debuffSkill_Dr" type="checkbox"><label for="debuffSkill_Dr"><b>枯竭</b></label> <div class="customize" name="debuffSkillDrCondition"></div></div>
          <div><input id="debuffSkill_We" type="checkbox"><label for="debuffSkill_We"><b>虚弱</b></label> <div class="customize" name="debuffSkillWeCondition"></div></div>
          <div><input id="debuffSkill_Co" type="checkbox"><label for="debuffSkill_Co"><b>混乱</b></label> <div class="customize" name="debuffSkillCoCondition"></div></div>
        `;
      },

      // 构建Skill标签页
      buildSkillTab() {
        return `
          <div class="skillOrder"><span class="dbTipText">施放顺序</span>
            <input class="dbInputWide" name="skillOrder" type="text" disabled><br>
            <input id="skillOrder_OFC" type="checkbox"><label for="skillOrder_OFC">马炮</label><input id="skillOrder_FRD" type="checkbox"><label for="skillOrder_FRD">龙吼</label><input id="skillOrder_Cor" type="checkbox"><label for="skillOrder_Cor">法1</label><input id="skillOrder_Smi" type="checkbox"><label for="skillOrder_Smi">法2</label><input id="skillOrder_FBl" type="checkbox"><label for="skillOrder_FBl">法3</label><input id="skillOrder_T3" type="checkbox"><label for="skillOrder_T3">T3</label><input id="skillOrder_T2" type="checkbox"><label for="skillOrder_T2">T2</label><input id="skillOrder_T1" type="checkbox"><label for="skillOrder_T1">T1</label></div>
          <div><b>马炮</b> <input id="skillOTOS_OFC" type="checkbox"><label for="skillOTOS_OFC" class="dbTipText">一层一次</label> <div class="customize" name="skillOFCCondition"></div></div>
          <div><b>龙吼</b> <input id="skillOTOS_FRD" type="checkbox"><label for="skillOTOS_FRD" class="dbTipText">一层一次</label> <div class="customize" name="skillFRDCondition"></div></div>
          <div><b>法1</b> <select class="dbNumber" name="skillCorType"><option value="">暗</option><option value="1">火</option><option value="2">冰</option><option value="3">雷</option><option value="4">风</option><option value="5">圣</option><option value="6">暗</option></select> <select class="dbNumber" name="skillCorTier"><option value="">T1</option><option value="2">T2</option><option value="3">T3</option></select> <input id="skillOTOS_Cor" type="checkbox"><label for="skillOTOS_Cor" class="dbTipText">一层一次</label> <div class="customize" name="skillCorCondition"></div></div>
          <div><b>法2</b> <select class="dbNumber" name="skillSmiType"><option value="">圣</option><option value="1">火</option><option value="2">冰</option><option value="3">雷</option><option value="4">风</option><option value="5">圣</option><option value="6">暗</option></select> <select class="dbNumber" name="skillSmiTier"><option value="">T1</option><option value="2">T2</option><option value="3">T3</option></select> <input id="skillOTOS_Smi" type="checkbox"><label for="skillOTOS_Smi" class="dbTipText">一层一次</label> <div class="customize" name="skillSmiCondition"></div></div>
          <div><b>法3</b> <select class="dbNumber" name="skillFBlType"><option value="">火</option><option value="1">火</option><option value="2">冰</option><option value="3">雷</option><option value="4">风</option><option value="5">圣</option><option value="6">暗</option></select> <select class="dbNumber" name="skillFBlTier"><option value="">T1</option><option value="2">T2</option><option value="3">T3</option></select> <input id="skillOTOS_FBl" type="checkbox"><label for="skillOTOS_FBl" class="dbTipText">一层一次</label> <div class="customize" name="skillFBlCondition"></div></div>
          <div><label><b>战斗风格</b></label> <select class="dbNumber" name="fightingStyle"><option value="1">二天一流</option><option value="2">单手</option><option value="3">双手</option><option value="4">双持</option></select></div>
          <div><b>T3</b> <input id="skillOTOS_T3" type="checkbox"><label for="skillOTOS_T3" class="dbTipText">一层一次</label> <div class="customize" name="skillT3Condition"></div></div>
          <div><b>T2</b> <input id="skillOTOS_T2" type="checkbox"><label for="skillOTOS_T2" class="dbTipText">一层一次</label> <div class="customize" name="skillT2Condition"></div></div>
          <div><b>T1</b> <input id="skillOTOS_T1" type="checkbox"><label for="skillOTOS_T1" class="dbTipText">一层一次</label> <div class="customize" name="skillT1Condition"></div></div>
        `;
      },

      // 构建Scroll标签页
      buildScrollTab() {
        return `
          <div><div class="customize" name="scrollCondition"></div></div>
          <input id="scrollFirst" type="checkbox"><label for="scrollFirst">存在技能生成的Buff时，仍然使用卷轴.</label>
          <div><input id="scroll_Go" type="checkbox"><label for="scroll_Go"><b>神之卷轴</b></label><div class="customize" name="scrollGoCondition"></div></div>
          <div><input id="scroll_Av" type="checkbox"><label for="scroll_Av"><b>化身卷轴</b></label><div class="customize" name="scrollAvCondition"></div></div>
          <div><input id="scroll_Pr" type="checkbox"><label for="scroll_Pr"><b>保护卷轴</b></label><div class="customize" name="scrollPrCondition"></div></div>
          <div><input id="scroll_Sw" type="checkbox"><label for="scroll_Sw"><b>加速卷轴</b></label><div class="customize" name="scrollSwCondition"></div></div>
          <div><input id="scroll_Li" type="checkbox"><label for="scroll_Li"><b>生命卷轴</b></label><div class="customize" name="scrollLiCondition"></div></div>
          <div><input id="scroll_Sh" type="checkbox"><label for="scroll_Sh"><b>幻影卷轴</b></label><div class="customize" name="scrollShCondition"></div></div>
          <div><input id="scroll_Ab" type="checkbox"><label for="scroll_Ab"><b>吸收卷轴</b></label><div class="customize" name="scrollAbCondition"></div></div>
        `;
      },

      // 构建人格配置标签页
      buildPersonaConfigTab() {
        return `
          <div class="dbTipText">字段为空则不切换</div>
          <div><b>AR&nbsp;</b> 人格 <input class="dbNumber" name="arPersona" type="text"> 装备 <input class="dbNumber" name="arEquip" type="text"> 配置 <select class="dbNumber dbBackupList" name="arConfig"></select></div>
          <div><b>GF&nbsp;</b> 人格 <input class="dbNumber" name="gfPersona" type="text"> 装备 <input class="dbNumber" name="gfEquip" type="text"> 配置 <select class="dbNumber dbBackupList" name="gfConfig"></select></div>
          <div><b>TW</b> 人格 <input class="dbNumber" name="twPersona" type="text"> 装备 <input class="dbNumber" name="twEquip" type="text"> 配置 <select class="dbNumber dbBackupList" name="twConfig"></select></div>
        `;
      },

      // 构建数据记录标签页
      buildDataRecordTab() {
        return `
          <div>
            <b>数据记录</b>
            <button class="reDataRecord">重置</button>
            <div style="margin:16px 0;border-top:1px solid #dee2e6;padding-top:16px;">
              <div style="display:flex;gap:16px;">
                <!-- 左侧：数据列显示控制框 -->
                <div style="flex:1;border:1px solid #dee2e6;background-color:var(--aad-bg-white);padding:16px;border-radius:6px;">
                    <div style="margin-bottom:12px;"><b>列显示控制</b></div>
                    <div class="dbColumnControls" style="max-height:300px;overflow-y:auto;">
                    <div class="dbTipText" style="margin-bottom:12px;font-size:13px;">勾选要显示的列项目</div>
                    ${this.buildColumnControlsHTML()}
                  </div>
                </div>
                <!-- 右侧：功能选项和操作按钮 -->
                <div style="flex:1;display:flex;flex-direction:column;gap:16px;">
                  <div style="border:1px solid #dee2e6;background-color:var(--aad-bg-white);padding:16px;border-radius:6px;">
                    <div style="margin-bottom:12px;"><b>功能选项</b></div>
                    <div style="display:flex;flex-direction:column;gap:8px;">
                      <div><input id="defeatLogSwitch" type="checkbox"><label for="defeatLogSwitch">战败日志</label></div>
                      <div><input id="resistTooltipSwitch" type="checkbox"><label for="resistTooltipSwitch">抵抗统计</label></div>
                      <div><input id="proficiencyTooltipSwitch" type="checkbox"><label for="proficiencyTooltipSwitch">熟练度显示</label></div>
                    </div>
                  </div>
                  <div style="border:1px solid #dee2e6;background-color:var(--aad-bg-white);padding:16px;border-radius:6px;">
                    <div style="margin-bottom:12px;"><b>数据操作</b></div>
                    <div style="display:flex;flex-direction:column;gap:8px;">
                      <button class="dbShowBattleStatsModal">战斗数据统计</button>
                      <div style="display:flex;gap:8px;flex-wrap:nowrap;">
                        <button class="updateData_bid" style="flex:1 1 0;white-space:nowrap;">买价更新</button>
                        <button class="updateData_ask" style="flex:1 1 0;white-space:nowrap;">卖价更新</button>
                        <button class="showPrices" style="flex:1 1 0;white-space:nowrap;">查看价格</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;
      },

      // 构建列控制器HTML
      buildColumnControlsHTML() {
        let html = '';

        Object.keys(dbTableColumnsAll).forEach(groupName => {
          html += '<div style="margin-bottom:15px;">';
          html += '<div style="margin-bottom:8px;"><b>' + groupName + '</b></div>';

          dbTableColumnsAll[groupName].forEach(column => {
            html += '<div style="margin-left:15px;margin-bottom:5px;">';
            html += '<input type="checkbox" id="' + column.id + '" name="dataColumns.' + column.id + '">';
            html += '<label for="' + column.id + '" style="margin-left:5px;cursor:pointer;">' + column.column_name + '</label>';
            html += '</div>';
          });

          html += '</div>';
        });

        return html;
      },

      // 构建系统设置标签页
      buildSystemTab() {
        return `
          <div><b>页面配色</b>
            <select id="themeSelector" class="dbNumber" name="themeSelector">
              <option value="white">天水碧</option>
              <option value="popBrutal">奶油波普</option>
              <option value="night">夜间</option>
            </select>
            <button id="applyTheme">应用配色</button>
          </div>
          <div class="dbTipText"><b>战斗卡住</b>
            <input id="delayReload" type="checkbox"><label for="delayReload"><input class="dbNumber" name="delayReloadTime" type="text" placeholder="60">秒，刷新页面</label>
          </div>
          <div class="dbTipText"><b>暂停相关</b>
            <input id="pauseButton" type="checkbox"><label for="pauseButton">使用按钮</label>
            <input id="pauseHotkey" type="checkbox"><label for="pauseHotkey">使用热键 <input name="pauseHotkeyStr" type="text" style="width:32px;"></label>
          </div>
          <div class="dbTipText"><b>外置按钮</b>
            <input id="idleArenaExternalButton" type="checkbox"><label for="idleArenaExternalButton">自动AR开关</label>
            <input id="battleStatsExternalButton" type="checkbox"><label for="battleStatsExternalButton">战斗数据按钮</label>
          </div>
          <div class="dbTipText"><b>动作延迟</b>  魔法/技能 <input class="dbNumber" name="delay" placeholder="0" type="text">ms  攻击/物品 <input class="dbNumber" name="delay2" placeholder="0" type="text">ms<br>
          </div>
        `;
      },

      // 构建配置设置标签页
      buildConfigSettingsTab() {
        const option = AAD.Core.Storage.getValue('option') || {};

        return `
          <div><b>预设配置</b>
            <button class="dbLoadPreset">加载预设</button>
            <select id="presetSelector" class="dbNumber"></select>
            <div id="presetDescription" class="dbTipText" style="margin-top:8px;font-size:12px;max-width:400px;"></div>
          </div>
          <div><b>备份配置</b><button class="dbBackup">保存备份</button><button class="dbRestore">加载备份</button><button class="dbDelete">删除备份</button><select class="dbNumber" id="dbBackupListLast"></select></div>
          <div><b>迁移配置</b><button class="dbExport">导出配置</button><button class="dbImport">导入配置</button><br><textarea id="dbConfig" class="dbInputWide"></textarea></div>
        `;
      },

      // 绑定面板事件
      bindPanelEvents(panel) {
        const arenaOrderHandler = this.createArenaOrderHandler(panel);
        const skillOrderHandlers = {
          itemOrder: this.createSkillOrderHandler('itemOrder'),
          buffSkillOrder: this.createSkillOrderHandler('buffSkillOrder'),
          debuffSkillOrder: this.createSkillOrderHandler('debuffSkillOrder'),
          channelSkillOrder: this.createSkillOrderHandler('channelSkillOrder'),
          skillOrder: this.createSkillOrderHandler('skillOrder')
        };

        const handlePriceUpdate = async (type, label) => {
          if (AAD.Utils.Common.alert(1, `是否更新(${type})`)) {
            try {
              await AAD.Data.Market.updatePriceData(type);
            } catch (error) {
              console.error(`[UI] ${label}价格更新失败:`, error);
              AAD.Utils.Common.alert(0, `${label}价格更新失败，请查看控制台日志`);
            }
          }
        };

        const updateMonsterDbStatus = (message) => {
          const status = panel.querySelector('#monsterDbStatus');
          if (status) status.textContent = message || AAD.Data.MonsterDB.getStatusText();
        };

        panel.addEventListener('click', (e) => {
          const target = e.target;
          const tabSpan = target.closest('.dbTabmenu span[name]');
          if (tabSpan) {
            const targetTag = target.tagName;
            if (targetTag === 'LABEL') {
              e.preventDefault();
              this.switchTab(tabSpan.getAttribute('name'));
            } else if (targetTag !== 'INPUT') {
              this.switchTab(tabSpan.getAttribute('name'));
            }
            return;
          }

          if (target.tagName === 'INPUT' && target.type === 'checkbox') {
            if (target.closest('#dbArenaLevels')) {
              arenaOrderHandler(e);
              return;
            }
            if (target.closest('.itemOrder')) {
              skillOrderHandlers.itemOrder(e);
              return;
            }
            if (target.closest('.buffSkillOrder')) {
              skillOrderHandlers.buffSkillOrder(e);
              return;
            }
            if (target.closest('.debuffSkillOrder')) {
              skillOrderHandlers.debuffSkillOrder(e);
              return;
            }
            if (target.closest('.channelSkillOrder')) {
              skillOrderHandlers.channelSkillOrder(e);
              return;
            }
            if (target.closest('.skillOrder')) {
              skillOrderHandlers.skillOrder(e);
              return;
            }
          }

          if (target.closest('.dbApply')) {
            this.applyConfig(panel);
            return;
          }
          if (target.closest('.dbCancel')) {
            this.cancelConfig(panel);
            return;
          }
          if (target.closest('.dbReset')) {
            this.resetConfig(panel);
            return;
          }
          if (target.closest('.dbShowBattleStatsModal')) {
            AAD.UI.Stats.showBattleStats();
            return;
          }
          if (target.closest('#applyTheme')) {
            const selector = panel.querySelector('#themeSelector');
            if (selector) {
              const selectedTheme = selector.value;
              AAD.UI.Theme.applyTheme(selectedTheme);
            }
            return;
          }
          if (target.closest('.idleArenaReset')) {
            if (confirm('是否重置竞技场队列状态')) {
              AAD.Core.Storage.delValue('arena');
              alert('重置成功');
            }
            return;
          }
          if (target.closest('.crossWorldJumpReset')) {
            if (confirm('是否重置跨世界跳转状态')) {
              AAD.Logic.World.resetFlowFromUI();
              alert('重置成功，跨世界流程状态已清空');
            }
            return;
          }
          if (target.closest('.crossWorldSetIsekai')) {
            if (confirm('是否将跨世界流程切换到 isekai_running ？')) {
              const changed = AAD.Logic.World.setManualStage(AAD.Logic.World.STAGE.ISEKAI_RUNNING);
              if (changed) {
                alert('已切换到 isekai_running');
              } else {
                alert('当前已是 isekai_running');
              }
            }
            return;
          }
          if (target.closest('.crossWorldSetDone')) {
            if (confirm('是否将跨世界流程切换到 done ？')) {
              const changed = AAD.Logic.World.setManualStage(AAD.Logic.World.STAGE.DONE);
              if (changed) {
                alert('已切换到 done');
              } else {
                alert('当前已是 done');
              }
            }
            return;
          }
          if (target.closest('.encounterResetPlan')) {
            AAD.Logic.Encounter.resetEncounterPlan();
            return;
          }
          if (target.closest('.dbShowLevels')) {
            const levelsDiv = panel.querySelector('#dbArenaLevels');
            if (levelsDiv) {
              levelsDiv.style.display = levelsDiv.style.display === 'block' ? 'none' : 'block';
            }
            return;
          }
          if (target.closest('.dbLevelsClear')) {
            if (!this.orderState) {
              this.initOrderState({});
            }
            this.orderState.idleArenaOrder = [];
            this.syncArenaOrderUI([], panel);
            return;
          }
          if (target.closest('.autoIWAddTask')) {
            this.addAutoIWTask(panel);
            return;
          }
          if (target.closest('.autoIWClearTasks')) {
            this.clearAutoIWTasks(panel);
            return;
          }
          const removeTaskButton = target.closest('.autoIWRemoveTask');
          if (removeTaskButton) {
            const equipId = removeTaskButton.getAttribute('data-eqid') || '';
            this.removeAutoIWTask(panel, equipId);
            return;
          }
          if (target.closest('.updateData_bid')) {
            handlePriceUpdate('bid', 'BID');
            return;
          }
          if (target.closest('.updateData_ask')) {
            handlePriceUpdate('ask', 'ASK');
            return;
          }
          if (target.closest('.showPrices')) {
            const prices = AAD.Data.Economy.getItemPrices();
            const entries = Object.entries(prices);
            if (entries.length === 0) {
              console.log('[价格数据] 暂无已存储价格');
            } else {
              console.log(`[价格数据] 已存储${entries.length}个物品价格`);
              console.table(prices);
            }
            return;
          }
          if (target.closest('.monsterDbUpdate')) {
            updateMonsterDbStatus('更新中...');
            AAD.Data.MonsterDB.update().then((count) => {
              updateMonsterDbStatus(`已加载 (${count})`);
            }).catch((error) => {
              console.error('[MonsterDB] 更新失败:', error);
              updateMonsterDbStatus('更新失败');
            });
            return;
          }
          if (target.closest('.monsterDbDelete')) {
            AAD.Data.MonsterDB.deleteData();
            updateMonsterDbStatus();
            return;
          }
          if (target.closest('.dbDelete')) {
            const select = panel.querySelector('#dbBackupListLast');
            const code = select ? select.value : '';

            if (!code) {
              alert('请先选择要删除的备份');
              return;
            }

            if (confirm('确定删除这个备份？')) {
              if (AAD.Core.Config.deleteConfig(code)) {
                const options = select.querySelectorAll('option');
                for (const option of options) {
                  if (option.value === code) {
                    option.remove();
                    break;
                  }
                }
              }
            }
            return;
          }
          if (target.closest('.dbLoadPreset')) {
            const selector = panel.querySelector('#presetSelector');
            const selectedPreset = selector ? selector.value : '';
          if (!selectedPreset) {
            AAD.Utils.Common.alert(0, '请选择要加载的预设配置');
            return;
          }
          const preset = AAD.Core.PRESET_CONFIGS[selectedPreset];
          const mergedConfig = AAD.Core.Config.mergeConfigWithExclusions(preset.config);
          this.loadConfigToPanel(panel, mergedConfig);
          return;
        }
          if (target.closest('.reDataRecord')) {
            const worldName = AAD.Runtime.isIsekai() ? '异世界' : '主世界';
            const confirmMsg = `是否重置【${worldName}】的数据记录？`;

            if (confirm(confirmMsg)) {
              const isIsekai = AAD.Runtime.isIsekai() ? 1 : 0;
              AAD.Data.Statistics.clearAllData(isIsekai).then(() => {
                alert(`【${worldName}】的数据记录已重置完成`);
              }).catch(error => {
                console.error('[Data.Recorder] 重置数据失败:', error);
                alert('重置数据失败，请重试');
              });
            }
            return;
          }
          if (target.closest('.dbBackup')) {
            this.backupConfig(panel);
            return;
          }
          if (target.closest('.dbRestore')) {
            this.restoreConfig(panel);
            return;
          }
          if (target.closest('.dbExport')) {
            this.exportConfig(panel);
            return;
          }
          if (target.closest('.dbImport')) {
            this.importConfig(panel);
            return;
          }
        });

        this.bindConditionBoxEvents(panel);
      },

      // 绑定条件框鼠标悬停事件
      bindConditionBoxEvents(panel) {
        let customizeBoxCreated = false;
        let customizeBoxElement = null;
        let lastTarget = null;
        let lastPositionTop = null;
        let lastPositionLeft = null;

        // 使用节流，30Hz (33ms)
        const throttledHandler = AAD.Utils.Common.throttle((e) => {
          let target = e.target;
          const pinned = AAD.Core.State.get('customizePinned', false);

          if (pinned) {
            target = AAD.Core.State.get('customizeTarget');
            if (!target || !document.body.contains(target)) {
              AAD.Core.State.set('customizePinned', false);
              if (customizeBoxElement) {
                const inspectButton = customizeBoxElement.querySelector('.dbInspect');
                if (inspectButton) inspectButton.title = 'off';
                customizeBoxElement.style.display = 'none';
                customizeBoxElement.style.zIndex = '-1';
              }
              return;
            }
          } else {
            target = target.closest ? target.closest('.customize') : null;
          }

          if (!customizeBoxCreated) {
            const customizeBox = AAD.UI.Stats.customizeBox();
            customizeBoxCreated = true;
            customizeBoxElement = AAD.Utils.DOM.gE('#customizeBox');
          }

          // 检查是否在customize元素上
          if (!pinned && !target) {
            if (customizeBoxElement) {
              customizeBoxElement.style.display = 'none';
              customizeBoxElement.style.zIndex = '-1';
            }
            return;
          }

          // 只在target变化时更新group
          if (!pinned && lastTarget !== target) {
            AAD.Core.State.set('customizeTarget', target);
            this.updateConditionBoxGroups(target);
            lastTarget = target;
          }

          // 安全检查：确保target是有效的DOM元素且能正确定位
          if (!target || !target.getBoundingClientRect) {
            if (customizeBoxElement) {
              customizeBoxElement.style.display = 'none';
            }
            return;
          }

          const position = target.getBoundingClientRect();
          // 边界检查
          if (position.bottom < 0 || position.left < 0 || position.width === 0 || position.height === 0) {
            if (customizeBoxElement) {
              customizeBoxElement.style.display = 'none';
            }
            return;
          }

          // 显示并定位横条
          if (customizeBoxElement) {
            const nextTop = position.bottom + window.scrollY + 'px';
            const nextLeft = position.left + window.scrollX + 'px';
            customizeBoxElement.style.display = 'block';
            customizeBoxElement.style.zIndex = '5';
            if (lastPositionTop !== nextTop) {
              customizeBoxElement.style.top = nextTop;
              lastPositionTop = nextTop;
            }
            if (lastPositionLeft !== nextLeft) {
              customizeBoxElement.style.left = nextLeft;
              lastPositionLeft = nextLeft;
            }
          }
        }, 33); // 33ms = 30Hz

        // 绑定鼠标移动事件
        panel.addEventListener('mousemove', throttledHandler);
      },

      // 更新条件框组选择器
      updateConditionBoxGroups(target) {
        const groups = target.querySelectorAll('.customizeGroup');
        const customizeBox = AAD.Utils.DOM.gE('#customizeBox');

        if (!customizeBox) return;

        // 缓存select元素引用
        const selectElement = AAD.Utils.DOM.gE('select[name="groupChoose"]', customizeBox);
        if (!selectElement) return;

        const currentGroupLength = groups.length;
        if (this._lastConditionTarget === target &&
            this._lastConditionGroupLength === currentGroupLength) {
          return;
        }
        this._lastConditionTarget = target;
        this._lastConditionGroupLength = currentGroupLength;

        selectElement.innerHTML = '';

        // 使用DocumentFragment批量插入
        const fragment = document.createDocumentFragment();
        for (let i = 0; i <= currentGroupLength; i++) {
          const optionElement = AAD.Utils.DOM.cE('option');
          if (i === currentGroupLength) {
            optionElement.value = 'new';
            optionElement.textContent = 'new';
          } else {
            optionElement.value = i + 1;
            optionElement.textContent = i + 1;
          }
          fragment.appendChild(optionElement);
        }
        selectElement.appendChild(fragment);
      },

      // 创建技能顺序处理器工厂函数
      createSkillOrderHandler(inputName, extractName = (id) => id.match(/_(.*)/)[1]) {
        return (e) => {
          if (e.target.tagName !== 'INPUT' || e.target.type !== 'checkbox') return;

          const name = extractName(e.target.id);
          // 根据checkbox的id确定对应的容器类名
          const containerClass = e.target.id.replace(/_[^_]+$/, ''); // 移除最后一个下划线及之后的部分
          const container = e.target.closest(`.${containerClass}`);
          const input = container?.querySelector(`input[name="${inputName}"]`);
          if (!input) return;

          if (!this.orderState) {
            this.initOrderState({});
          }
          const order = this.orderState[inputName] || (this.orderState[inputName] = []);
          const index = order.indexOf(name);

          if (e.target.checked) {
            if (index === -1) {
              order.push(name);
            }
          } else if (index !== -1) {
            order.splice(index, 1);
          }

          input.value = order.join(',');
        };
      },

      // 创建竞技场顺序处理器工厂函数
      createArenaOrderHandler(panel, inputName = 'idleArenaOrder') {
        return (e) => {
          if (e.target.tagName !== 'INPUT' || e.target.type !== 'checkbox') return;

          const value = e.target.value;
          if (!value) return;

          if (!this.orderState) {
            this.initOrderState({});
          }

          const order = this.orderState[inputName] || (this.orderState[inputName] = []);
          const index = order.indexOf(value);

          if (e.target.checked) {
            if (index === -1) {
              order.push(value);
            }
          } else if (index !== -1) {
            order.splice(index, 1);
          }

          this.syncArenaOrderUI(order, panel);
        };
      },

      syncArenaOrderUI(order, panel) {
        const container = panel.querySelector('#dbArenaLevels');
        const display = panel.querySelector('#idleArenaOrderDisplay');
        if (!container || !display) return;

        const orderList = Array.isArray(order) ? order : [];
        const selected = new Set(orderList.map(value => String(value)));
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        const labelMap = {};

        for (let i = 0; i < checkboxes.length; i++) {
          const checkbox = checkboxes[i];
          checkbox.checked = selected.has(checkbox.value);
          const label = panel.querySelector(`label[for="${checkbox.id}"]`);
          const text = label ? label.textContent.trim() : '';
          if (text) {
            labelMap[checkbox.value] = text;
          }
        }

        const labels = [];
        for (let i = 0; i < orderList.length; i++) {
          const id = orderList[i];
          labels.push(labelMap[id] || String(id));
        }

        display.value = labels.join(',');
      },

      // 处理跨界连打UI
      handleSpecialConfigItems(panel) {
        const crossWorldEnabled = AAD.Logic.World.isCrossWorldEnabled();

        const crossWorldCheckbox = panel.querySelector('#crossWorldArena');
        if (crossWorldCheckbox) {
          crossWorldCheckbox.checked = crossWorldEnabled;
        }

        // 异世界UI禁用
        if (AAD.Runtime.isIsekai()) {
          if (crossWorldCheckbox) {
            const disabledOpacity = '0.5';
            crossWorldCheckbox.disabled = true;
            crossWorldCheckbox.style.opacity = disabledOpacity;
            const crossWorldLabel = crossWorldCheckbox.nextElementSibling;
            if (crossWorldLabel) crossWorldLabel.style.opacity = disabledOpacity;
          }

          const isekaiHint = panel.querySelector('#crossWorldArenaIsekaiHint');
          if (isekaiHint) {
            isekaiHint.style.display = 'inline';
          }
        }
      },

      getAutoIWTasksFromPanel(panel) {
        const hiddenInput = panel.querySelector('input[name="autoIWTasksJson"]');
        if (!hiddenInput || !hiddenInput.value) return [];
        try {
          return AAD.Logic.AutoIW.normalizeTasks(JSON.parse(hiddenInput.value));
        } catch (error) {
          return [];
        }
      },

      setAutoIWTasksInPanel(panel, tasks) {
        const normalized = AAD.Logic.AutoIW.normalizeTasks(tasks);
        const hiddenInput = panel.querySelector('input[name="autoIWTasksJson"]');
        if (hiddenInput) {
          hiddenInput.value = JSON.stringify(normalized);
        }
        this.renderAutoIWTaskList(panel, normalized);
      },

      renderAutoIWTaskList(panel, tasks) {
        const listContainer = panel.querySelector('#autoIWTaskList');
        if (!listContainer) return;
        listContainer.innerHTML = '';

        const option = AAD.Core.Storage.getValue('option') || {};
        const iwState = AAD.Core.Storage.getValue('iwState') || {};
        const runningIndex = option.autoIW && Number.isInteger(iwState.index) ? iwState.index : -1;

        if (!tasks.length) {
          listContainer.textContent = '暂无任务';
          return;
        }

        const fragment = document.createDocumentFragment();
        for (let i = 0; i < tasks.length; i++) {
          const task = tasks[i];
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:2px 0;';

          const info = document.createElement('span');
          const title = task.title || `[${task.id}]`;
          let status = AAD.Logic.AutoIW.normalizeStatus(task.status);
          if (i === runningIndex && option.autoIW && status !== IW_TASK_STATUS.DONE && status !== IW_TASK_STATUS.ERROR) {
            status = IW_TASK_STATUS.RUNNING;
          }
          const statusLabel = IW_TASK_STATUS_LABELS[status] || IW_TASK_STATUS_LABELS[IW_TASK_STATUS.WAITING];
          info.textContent = `${i + 1}. ${title} 目标${task.target} ${statusLabel}`;

          const removeBtn = document.createElement('button');
          removeBtn.className = 'autoIWRemoveTask';
          removeBtn.setAttribute('data-eqid', task.id);
          removeBtn.textContent = '删除';

          row.appendChild(info);
          row.appendChild(removeBtn);
          fragment.appendChild(row);
        }

        listContainer.appendChild(fragment);
      },

      persistAutoIWTasks(tasks, targetLevel) {
        const option = AAD.Core.Storage.getValue('option') || {};
        const nextOption = { ...option, autoIWTasks: AAD.Logic.AutoIW.normalizeTasks(tasks) };
        if (Number.isFinite(targetLevel) && targetLevel > 0) {
          nextOption.autoIWTargetLevel = targetLevel;
        }
        AAD.Core.Storage.setValue('option', nextOption);

        const iwState = AAD.Core.Storage.getValue('iwState');
        if (iwState && (iwState.index >= nextOption.autoIWTasks.length)) {
          AAD.Core.Storage.setValue('iwState', { index: 0 });
        }
      },

      addAutoIWTask(panel) {
        const urlParams = new URLSearchParams(window.location.search);
        const isIwPage = urlParams.get('s') === 'Battle' &&
                         urlParams.get('ss') === 'iw' &&
                         urlParams.get('screen') === 'itemworld';
        if (!isIwPage) {
          alert('请在 Item World 子页面添加任务');
          return;
        }

        const targetInput = panel.querySelector('input[name="autoIWTargetLevel"]');
        const target = parseInt(targetInput ? targetInput.value : '', 10);
        if (!Number.isFinite(target) || target <= 0) {
          alert('请输入有效的目标等级');
          return;
        }

        const checked = document.querySelectorAll('#equiplist input[name="eqids[]"]:checked');
        if (!checked || checked.length === 0) {
          alert('请先在IW页面勾选装备');
          return;
        }

        const tasks = this.getAutoIWTasksFromPanel(panel);
        const filter = urlParams.get('filter') || '';

        for (let i = 0; i < checked.length; i++) {
          const checkbox = checked[i];
          const equipId = String(checkbox.value || '').trim();
          if (!equipId) continue;
          const label = checkbox.closest('label');
          const title = label ? label.textContent.replace(/\s+/g, ' ').trim() : '';
          const task = {
            id: equipId,
            target: target,
            filter: filter,
            title: title,
            status: IW_TASK_STATUS.WAITING
          };
          const existingIndex = tasks.findIndex(item => item.id === equipId);
          if (existingIndex >= 0) {
            tasks[existingIndex] = task;
          } else {
            tasks.push(task);
          }
        }

        this.setAutoIWTasksInPanel(panel, tasks);
        this.persistAutoIWTasks(tasks, target);
      },

      removeAutoIWTask(panel, equipId) {
        const tasks = this.getAutoIWTasksFromPanel(panel).filter(task => task.id !== equipId);
        this.setAutoIWTasksInPanel(panel, tasks);
        this.persistAutoIWTasks(tasks);
      },

      clearAutoIWTasks(panel) {
        this.setAutoIWTasksInPanel(panel, []);
        this.persistAutoIWTasks([]);
      },

      // 更新技能顺序复选框状态
      updateSkillOrderCheckboxes(inputName, value, panel = document) {
        const skills = Array.isArray(value) ? value : [];
        const prefix = inputName;

        // 找到所有相关的复选框并更新状态
        const checkboxes = panel.querySelectorAll(`input[id^="${prefix}_"]`);
        checkboxes.forEach(checkbox => {
          const skillName = checkbox.id.match(/_(.*)/)[1];
          checkbox.checked = skills.includes(skillName);
        });
      },

      // 切换标签页
      switchTab(tabName) {
        // 更新活动标签页
        const tabs = document.querySelectorAll('.dbTabmenu > span');
        tabs.forEach(tab => tab.classList.remove('active'));

        const activeTab = document.querySelector(`.dbTabmenu > span[name="${tabName}"]`);
        if (activeTab) {
          activeTab.classList.add('active');
        }

        // 更新活动内容区域
        const contents = document.querySelectorAll('.dbTab');
        contents.forEach(content => content.classList.remove('active'));

        const activeContent = document.querySelector(`#dbTab-${tabName}`);
        if (activeContent) {
          activeContent.classList.add('active');
        }

        this.currentTab = tabName;
      },

      // 应用配置
      applyConfig(panel) {
        try {
          // 验证攻击模式是否已选择
          const attackStatusSelect = panel.querySelector('select[name="attackStatus"]');
          if (attackStatusSelect && (!attackStatusSelect.value || attackStatusSelect.value === '-1')) {
            alert('请选择攻击模式');
            // 切换到战斗核心标签页
            const combatTab = panel.querySelector('.dbTabmenu > span[name="CombatCore"]');
            if (combatTab) combatTab.click();
            return;
          }

          const newConfig = this.collectConfigFromPanel(panel);
          AAD.Core.Config.applyConfig(newConfig);

          // 重新加载主题
          const savedTheme = AAD.Core.Storage.getValue('currentTheme');
          const currentTheme = AAD.UI.Theme.themes[savedTheme] ? savedTheme : 'white';
          AAD.UI.Theme.applyTheme(currentTheme);

          // 隐藏面板
          this.toggle();

          console.log('[UI.Panel] 配置已应用');
        } catch (error) {
          console.error('[UI.Panel] 应用配置失败:', error);
          alert('应用配置失败：' + error.message);
        }
      },

      // 从面板收集配置
      collectConfigFromPanel(panel) {
        const config = {};

        const orderKeys = this.orderKeys || [];

        this.forEachPanelField(panel, (input) => {
          let itemName = '';
          let itemValue;

          if (input.tagName === 'SELECT' || input.type === 'select-one') {
            itemName = this.getFieldName(input);
            itemValue = input.value;
          } else if (input.classList.contains('dbNumber')) {
            itemName = input.name;
            itemValue = parseFloat(input.value || input.placeholder);

            if (isNaN(itemValue)) return;
          } else if (input.type === 'text' || input.type === 'hidden') {
            itemName = input.name;
            itemValue = input.value || input.placeholder || '';
            if (itemValue === '') return;
          } else if (input.type === 'checkbox') {
            if (input.id && input.id.startsWith('arLevel_')) {
              return;
            }
            itemName = this.getFieldName(input);
            itemValue = input.checked;
            if (!itemValue && !itemName.includes('dataColumns.') && !itemName.includes('_')) {
              return;
            }
          } else {
            return;
          }

          if (!itemName) return;

          if (itemName === 'autoIWTasksJson') {
            const tasks = AAD.Logic.AutoIW.normalizeTasks((() => {
              try {
                return JSON.parse(itemValue || '[]');
              } catch (error) {
                return [];
              }
            })());
            if (tasks.length > 0) {
              config.autoIWTasks = tasks;
            }
            return;
          }

          if (input.type === 'checkbox' && this.isOrderCheckbox(input, orderKeys)) {
            return;
          }

          if (orderKeys.includes(itemName)) {
            return;
          }

          this.setConfigValue(config, itemName, itemValue, input.classList.contains('customizeInput'));
        });


        if (this.orderState) {
          for (let i = 0; i < orderKeys.length; i++) {
            const key = orderKeys[i];
            const order = this.orderState[key];
            if (Array.isArray(order) && order.length > 0) {
              config[key] = order.slice();
            }
          }
        }

        return config;
      },

      // 取消配置
      cancelConfig(panel) {
        this.loadConfigToPanel(panel);
        this.toggle();
      },

      // 重置配置
      resetConfig(panel) {
        if (confirm('确定要重置所有设置为默认值吗？注意这将清空目前配置信息')) {
          AAD.Core.Config.resetConfig();
          this.loadConfigToPanel(panel);
        }
      },

      updateBackupSelects(panel, backups) {
        const selects = panel.querySelectorAll('select.dbBackupList');
        if (!selects.length) return;
        const codes = Object.keys(backups || {});
        selects.forEach(select => {
          const current = select.value;
          select.innerHTML = '<option value="">选择配置</option>';
          for (let i = 0; i < codes.length; i++) {
            const option = document.createElement('option');
            option.textContent = codes[i];
            option.value = codes[i];
            select.appendChild(option);
          }
          if (current) select.value = current;
        });
      },

      // 加载配置到面板
      loadConfigToPanel(panel, configOverride) {
        const config = configOverride || AAD.Core.Storage.getValue('option') || {};
        const orderPrefixes = this.orderKeys || [];
        this.initOrderState(config);

        // 加载备份列表
        const select = panel.querySelector('#dbBackupListLast');
        const backups = AAD.Core.Storage.getValue('backup') || {};
        if (select) {
          // 清空现有选项
          select.innerHTML = '<option value="">选择备份</option>';

          // 加载所有备份
          Object.keys(backups).forEach(code => {
            const option = document.createElement('option');
            option.textContent = code;
            option.value = code;
            select.appendChild(option);
          });
        }
        this.updateBackupSelects(panel, backups);

        this.forEachPanelField(panel, (input) => {
          if (input.tagName === 'SELECT' || input.type === 'select-one') {
            if (input.name) {
              input.value = config[input.name] || '';
            }
            return;
          }

          const itemName = this.getFieldName(input);
          if (!itemName) return;

          if (input.type === 'checkbox') {
            if (this.isOrderCheckbox(input, orderPrefixes)) {
              return;
            }
            input.checked = this.getConfigValue(config, itemName);
            return;
          }

          if (input.type === 'number') {
            const value = this.getConfigValue(config, itemName);
            input.value = value ?? '';
            return;
          }

          if (input.type === 'text' || input.type === 'hidden' || input.tagName === 'TEXTAREA') {
            if (orderPrefixes.includes(itemName)) return;
            const value = this.getConfigValue(config, itemName);
            input.value = value ?? '';
          }
        }, true);

        const resetInfo = AAD.Core.DailyReset.loadState('arena');
        const resetTimeLabel = panel.querySelector('#idleArenaResetTime');
        if (resetTimeLabel) {
          resetTimeLabel.textContent = resetInfo?.resetTime ? `计划时刻 ${new Date(resetInfo.resetTime).toLocaleTimeString()}` : '';
        }

        // 设置主题选择器
        const themeSelector = panel.querySelector('#themeSelector');
        if (themeSelector) {
          const savedTheme = AAD.Core.Storage.getValue('currentTheme');
          const currentTheme = AAD.UI.Theme.themes[savedTheme] ? savedTheme : 'white';
          themeSelector.value = currentTheme;
        }

        this.setAutoIWTasksInPanel(panel, config.autoIWTasks || []);

        this.handleSpecialConfigItems(panel);

        // 更新技能顺序复选框状态
        for (let i = 0; i < this.orderKeys.length; i++) {
          const field = this.orderKeys[i];
          if (field === 'idleArenaOrder') continue;
          const order = this.orderState[field] || [];
          const input = panel.querySelector(`input[name="${field}"]`);
          if (input) {
            input.value = order.join(',');
          }
          this.updateSkillOrderCheckboxes(field, order, panel);
        }

        const arenaOrder = this.orderState.idleArenaOrder || [];
        this.syncArenaOrderUI(arenaOrder, panel);
        this.initConditionBoxes(panel, config);

      },

      // 初始化条件框数据
      initConditionBoxes(panel, config) {
        const customizeElements = panel.querySelectorAll('.customize');
        customizeElements.forEach(customizeElement => {
          const itemName = customizeElement.getAttribute('name');
          if (itemName && config[itemName]) {
            // 清空现有内容
            customizeElement.innerHTML = '';

            for (const groupKey in config[itemName]) {
              const group = AAD.Utils.DOM.cE('div');
              group.className = 'customizeGroup';
              group.innerHTML = (parseInt(groupKey) + 1) + '. ';

              for (let k = 0; k < config[itemName][groupKey].length; k++) {
                const input = AAD.Utils.DOM.cE('input');
                input.type = 'text';
                input.className = 'customizeInput';
                input.name = itemName + '_' + groupKey;
                input.value = config[itemName][groupKey][k];
                group.appendChild(input);
              }

              customizeElement.appendChild(group);
            }
          }
        });
      },

      // 备份配置
      backupConfig(panel) {
        const backupCode = AAD.Core.Config.backupConfig();

        const select = panel.querySelector('#dbBackupListLast');
        if (select) {
          const option = document.createElement('option');
          option.textContent = backupCode;
          option.value = backupCode;
          select.appendChild(option);
          select.value = backupCode;
        }
        this.updateBackupSelects(panel, AAD.Core.Storage.getValue('backup') || {});
      },

      restoreConfig(panel) {
        const select = panel.querySelector('#dbBackupListLast');
        const selectedCode = select ? select.value : '';

        if (!selectedCode) return;

        const restored = AAD.Core.Config.restoreConfig(selectedCode);
        if (!restored) {
          alert('加载备份失败：未找到对应配置');
        }
      },

      exportConfig(panel) {
        const configData = AAD.Core.Config.stripExcludedConfig(AAD.Core.Config.getAll());
        const textArea = panel.querySelector('#dbConfig');
        if (textArea) {
          textArea.value = JSON.stringify(configData, null, 2);
        }
      },

      importConfig(panel) {
        const textArea = panel.querySelector('#dbConfig');
        if (!textArea || !textArea.value) return;
        const configData = JSON.parse(textArea.value);
        const mergedConfig = AAD.Core.Config.mergeConfigWithExclusions(configData);
        AAD.Core.Config.applyConfig(mergedConfig);
      },

      setPaused(paused, title) {
        if (paused) {
          AAD.Core.Storage.setValue('disabled', true);
          AAD.Core.Storage.setValue('missanswer', false);
          AAD.Core.State.set('end', true);
          if (AAD.Logic.Battle && typeof AAD.Logic.Battle.stopLogWatchdog === 'function') {
            AAD.Logic.Battle.stopLogWatchdog();
          }
          const pauseButton = AAD.Utils.DOM.gE('#dbBox2>button');
          if (pauseButton) {
            pauseButton.innerHTML = '继续';
          }
          document.title = AAD.Utils.Common.alert(-1, title || 'hvAutoAttack暂停中');
          return;
        }

        AAD.Core.Storage.setValue('disabled', false);
        AAD.Core.Storage.setValue('missanswer', false);
        const pauseButton = AAD.Utils.DOM.gE('#dbBox2>button');
        if (pauseButton) {
          pauseButton.innerHTML = '暂停';
        }
        AAD.Logic.PageHandler.misspony();
        if (AAD.Logic.Battle && typeof AAD.Logic.Battle.startLogWatchdog === 'function') {
          AAD.Logic.Battle.startLogWatchdog();
        }
        if (typeof AAD.Logic.Battle.main === 'function') AAD.Logic.Battle.main();
      },

      // 暂停/继续切换
      pauseChange() {
        const disabled = AAD.Core.Storage.getValue('disabled');
        this.setPaused(!disabled);
      }
    };

AAD.UI.ExternalControls = {
      init(option) {
        this.createIdleArenaToggleButton(option);
        this.createBattleStatsButton(option);
      },

      createIdleArenaToggleButton(option) {
        if (!option || !option.idleArenaExternalButton) return;
        if (document.getElementById('idleArenaToggleButton')) return;

        const button = AAD.Utils.DOM.cE('button');
        button.id = 'idleArenaToggleButton';
        button.className = 'idleArenaToggleButton';
        button.textContent = option.idleArena ? '自动AR:开' : '自动AR:关';
        button.onclick = () => {
          const current = AAD.Core.Storage.getValue('option') || {};
          const next = { ...current, idleArena: !current.idleArena };
          AAD.Core.Config.applyConfig(next);
        };
        document.body.appendChild(button);
      },

      createBattleStatsButton(option) {
        if (!option || !option.battleStatsExternalButton) return;
        if (document.getElementById('battleStatsToggleButton')) return;

        const button = AAD.Utils.DOM.cE('div');
        button.id = 'battleStatsToggleButton';
        button.className = 'dbButton battleStatsToggleButton';
        button.textContent = '≡';
        button.title = '战斗数据';
        button.onclick = () => {
          const modal = AAD.Utils.DOM.gE('#AADBBattleStatsModal');
          if (modal && modal.style.display === 'block') {
            modal.style.display = 'none';
            return;
          }
          AAD.UI.Stats.showBattleStats();
        };

        document.body.appendChild(button);
      }
    };

AAD.UI.Stats = {
      // 显示战斗统计弹窗
      async showBattleStats() {
        console.log('[UI.Stats] 打开战斗统计弹窗');

        let modal = AAD.Utils.DOM.gE('#AADBBattleStatsModal');
        if (!modal) {
          modal = AAD.Utils.DOM.gE('body').appendChild(AAD.Utils.DOM.cE('div'));
          modal.id = 'AADBBattleStatsModal';
          modal.className = 'AADBBattleStatsModal';
          modal.innerHTML = '<div class="AADBContainer"><div class="AADBHeader"><div class="AADBTitle">战斗数据统计</div><div class="AADBActions"><button class="AADBExportBtn">导出</button><button class="AADBClose">×</button></div></div><div class="AADBFilters"></div><div class="AADBTableWrapper"><table class="AADBTable"></table></div></div>';

          AAD.Utils.DOM.gE('.AADBExportBtn', modal).onclick = () => this.exportBattleStats();
          const closeBtn = modal.querySelector('.AADBClose');
          if (closeBtn) {
            closeBtn.onclick = () => { modal.style.display = 'none'; };
          }
        }

        // 显示弹窗
        modal.style.display = 'block';
        await this.fillBattleStatsData(modal);
      },


      // 获取组合战斗数据
      async getCombinedBattleData() {
        const modal = AAD.Utils.DOM.gE('#AADBBattleStatsModal')
        const worldSelection = modal.querySelector('input[name="bsWorld"]:checked')?.value || 'current'
        const battleType = modal.querySelector('select[name="bsBattleType"]')?.value || ''
        const dateFrom = modal.querySelector('input[name="bsDateFrom"]')?.value || ''
        const dateTo = modal.querySelector('input[name="bsDateTo"]')?.value || ''
        const limitRowsInput = parseInt(modal.querySelector('input[name="bsLimitRows"]')?.value, 10)
        const limitRows = Number.isFinite(limitRowsInput) ? Math.max(0, limitRowsInput) : 50
        const dailySummary = modal.querySelector('input[name="bsDailySummary"]')?.checked || false

        try {
          let isekai = null;
          if (worldSelection === 'current') {
            isekai = AAD.Runtime.isIsekai() ? 1 : 0;
          } else if (worldSelection === 'main') {
            isekai = 0;
          } else if (worldSelection === 'isekai') {
            isekai = 1;
          }

          const queryOptions = {
            limit: limitRows,
            battleType: battleType && battleType !== '' ? battleType : null,
            isekai: isekai,
            includeAllWorlds: worldSelection === 'all',
            dateFrom: dateFrom,
            dateTo: dateTo,
            order: 'desc'
          };

          if (dailySummary) {
            return await AAD.Data.Statistics.getBattleDataByDay(queryOptions);
          }

          return await AAD.Data.Statistics.getBattleDataByRecord(queryOptions);
        } catch (error) {
          console.error('[BattleStats] 获取组合数据失败:', error);
          throw error;
        }
      },

      // 导出战斗统计数据
      async exportBattleStats() {
        try {
          const data = await this.getCombinedBattleData();
          const filename = 'bs_' + new Date().toISOString().slice(0, 10) + '.json';

          const jsonData = JSON.stringify(data, null, 2);
          const blob = new Blob([jsonData], { type: 'application/json' });
          const url = URL.createObjectURL(blob);

          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.click();

          URL.revokeObjectURL(url);
        } catch (error) {
          console.error('[UI.Stats] 导出失败:', error);
          alert('导出数据失败，请重试');
        }
      },

      // 创建Battle Stats过滤器
      createBattleStatsFilters(container) {
        if (container.children.length > 0) return; // 避免重复创建

        // 从 localStorage 读取上次的选择状态（默认不打勾）
          const savedDailySummary = localStorage.getItem('db_battleStats_dailySummary');
          const dailySummaryChecked = savedDailySummary === 'true' ? 'checked' : '';

        const filterHTML = [
          '<div class="AADBFilterRow">',
          '  <div style="display:inline-block; margin-right:15px; padding:5px; background:var(--aad-secondary-bg); border-radius:3px;">',
          '    <label style="margin-right:10px;">',
          '      <input type="radio" name="bsWorld" value="current" checked>',
          '      当前世界 (' + (AAD.Runtime.isIsekai() ? '异世界' : '主世界') + ')',
          '    </label>',
          '    <label style="margin-right:10px;">',
          '      <input type="radio" name="bsWorld" value="main">',
          '      主世界',
          '    </label>',
          '    <label style="margin-right:10px;">',
          '      <input type="radio" name="bsWorld" value="isekai">',
          '      异世界',
          '    </label>',
          '    <label>',
          '      <input type="radio" name="bsWorld" value="all">',
          '      全部',
          '    </label>',
          '  </div>',
          '  <br>',
          '  类型 <select name="bsBattleType">',
          '    <option value="">全部</option>',
          '    <option value="ar">竞技场</option>',
          '    <option value="ba">遭遇战</option>',
          '    <option value="rb">擂台</option>',
          '    <option value="gr">压榨界</option>',
          '    <option value="iw">道具界</option>',
          '    <option value="tw">塔楼</option>',
          '  </select>',
          '  数量 <input class="dbNumber" type="number" name="bsLimitRows" value="50" min="0" max="1000">',
          '  从 <input type="date" name="bsDateFrom">',
          '  至 <input type="date" name="bsDateTo">',
          '  <input type="checkbox" id="bsDailySummary" name="bsDailySummary" ' + dailySummaryChecked + '>',
          '  <label for="bsDailySummary">按天总结</label>',
          '  <button class="AADBApplyFilter">应用</button>',
          '  <button class="AADBClearFilter">清除</button>',
          '</div>'
        ].join('');

        container.innerHTML = filterHTML;

        // 绑定过滤器事件
        const applyBtn = container.querySelector('.AADBApplyFilter');
        const clearBtn = container.querySelector('.AADBClearFilter');

          applyBtn.onclick = () => {
            const dailySummaryInput = container.querySelector('input[name="bsDailySummary"]');
            if (dailySummaryInput) {
              localStorage.setItem('db_battleStats_dailySummary', dailySummaryInput.checked ? 'true' : 'false');
            }
            this.applyBattleStatsFilter(container.closest('.AADBContainer'));
          };

        clearBtn.onclick = () => {
          // 重置所有过滤器
          container.querySelector('input[name="bsWorld"][value="current"]').checked = true;
          container.querySelector('select[name="bsBattleType"]').value = '';
          container.querySelector('input[name="bsLimitRows"]').value = '50';
          container.querySelector('input[name="bsDateFrom"]').value = '';
          container.querySelector('input[name="bsDateTo"]').value = '';
          container.querySelector('input[name="bsDailySummary"]').checked = false;
          localStorage.setItem('db_battleStats_dailySummary', 'false');

          // 重新加载数据
          this.applyBattleStatsFilter(container.closest('.AADBContainer'));
        };
      },

      // 应用战斗统计过滤器
      async applyBattleStatsFilter(modal) {
        const table = modal.querySelector('.AADBTable');
        table.innerHTML = '<tr><td colspan="20">正在加载数据...</td></tr>';

        try {
          const data = await this.getCombinedBattleData();
          const tableHTML = this.generateBattleStatsTable(data);
          table.innerHTML = tableHTML;
        } catch (error) {
          console.error('[UI.Stats] 应用筛选失败:', error);
          table.innerHTML = '<tr><td colspan="20">加载数据失败: ' + error.message + '</td></tr>';
        }
      },

      // 填充战斗统计数据
      async fillBattleStatsData(modal) {
        const filterControls = modal.querySelector('.AADBFilters');
        const table = modal.querySelector('.AADBTable');

        // 创建过滤器
        this.createBattleStatsFilters(filterControls);
        table.innerHTML = '<tr><td colspan="20">正在加载数据...</td></tr>';

        try {
          const battleData = await this.getCombinedBattleData();

          // 生成表格
          const tableHTML = this.generateBattleStatsTable(battleData);
          table.innerHTML = tableHTML;
        } catch (error) {
          console.error('[UI.Stats] 填充数据失败:', error);
          table.innerHTML = '<tr><td colspan="20">加载数据失败: ' + error.message + '</td></tr>';
        }
      },

      // 生成战斗统计表格
      generateBattleStatsTable(data) {
        // 获取当前启用的列定义
        const columns = AAD.UI.ColumnSettings.getEnabledColumns();
        const option = AAD.Core.Storage.getValue('option') || {};
        this.defeatLogTooltipEnabled = !!option.defeatLogSwitch;
        this.resistTooltipEnabled = !!option.resistTooltipSwitch;
        this.proficiencyTooltipEnabled = !!option.proficiencyTooltipSwitch;

        // 检查是否有启用的列
        const enabledGroups = Object.keys(columns);
        if (enabledGroups.length === 0) {
          return '<tr><td colspan="1" class="AADBNoData">请先在配置面板中勾选要显示的列</td></tr>';
        }

        // 计算总列数
        let totalColumns = 0;
        enabledGroups.forEach(groupName => {
          totalColumns += columns[groupName].length;
        });

        if (data.length === 0) {
          return '<tr><td colspan="' + totalColumns + '" class="AADBNoData">暂无数据</td></tr>';
        }

        // 初始化数据映射，用于tooltip懒加载
        if (!this.tooltipDataMap) {
          this.tooltipDataMap = new Map();
        }
        this.tooltipDataMap.clear();

        // 生成表头
        let headerHTML = '<thead>';

        // 分组表头
        headerHTML += '<tr class="AADBGroupHeader">';
        Object.keys(columns).forEach(groupName => {
          const columnCount = columns[groupName].length;
          headerHTML += '<th colspan="' + columnCount + '" class="AADBGroupHeaderCell">' + groupName + '</th>';
        });
        headerHTML += '</tr>';

        // 列名表头
        headerHTML += '<tr class="AADBColumnHeader">';
        Object.keys(columns).forEach(groupName => {
          columns[groupName].forEach(column => {
            headerHTML += '<th class="AADBColumnHeaderCell">' + column.column_name + '</th>';
          });
        });
        headerHTML += '</tr>';

        headerHTML += '</thead>';

        // 生成表体
        let bodyHTML = '<tbody>';

        // 使用合并后的计算函数，一次遍历同时计算Average和Total
        const summaryRows = this.calculateSummaryRows(data);
        const averageRow = summaryRows.averageRow;
        const totalRow = summaryRows.totalRow;

        // 存储Average和Total行数据到映射 (键名需要与context参数一致)
        this.tooltipDataMap.set('average', averageRow);
        this.tooltipDataMap.set('total', totalRow);

        // Average行
        bodyHTML += '<tr class="AADBDataRow">';
        Object.keys(columns).forEach(groupName => {
          columns[groupName].forEach(column => {
            if (column.field === 'delete_action') {
              bodyHTML += '<td class="AADBDataCell"></td>';
              return;
            }
            const value = averageRow[column.field] || '';
            const cellClass = 'AADBDataCell';
            bodyHTML += this.generateTableCellWithTooltip(value, cellClass, column, averageRow, 'average');
          });
        });
        bodyHTML += '</tr>';

        // Total行
        bodyHTML += '<tr class="AADBDataRow">';
        Object.keys(columns).forEach(groupName => {
          columns[groupName].forEach(column => {
            if (column.field === 'delete_action') {
              bodyHTML += '<td class="AADBDataCell"></td>';
              return;
            }
            const value = totalRow[column.field] || '';
            const cellClass = 'AADBDataCell';
            bodyHTML += this.generateTableCellWithTooltip(value, cellClass, column, totalRow, 'total');
          });
        });
        bodyHTML += '</tr>';

        // 分隔线
        bodyHTML += '<tr class="AADBSeparatorRow"><td colspan="' + totalColumns + '" style="border-top:2px solid #000;padding:0;"></td></tr>';

        data.forEach(row => {
          // 存储行数据到映射
          // rowId优先级：id（普通行） > timestamp（按天聚合行） > 随机ID（fallback）
          const rowId = row.id || row.timestamp || ('row_' + Math.random());
          this.tooltipDataMap.set(rowId, row);

          bodyHTML += '<tr class="AADBDataRow">';

          Object.keys(columns).forEach(groupName => {
            columns[groupName].forEach(column => {
              if (column.field === 'delete_action') {
                bodyHTML += this.generateDeleteActionCell(row, 'AADBDataCell');
                return;
              }
              let value = row[column.field];
              let cellClass = 'AADBDataCell';

              // 处理空值或undefined，显示为0
              if (value === undefined || value === null || value === '') {
                value = 0;
              }

              if (typeof value === 'number' && STATISTICS_NUMERIC_FIELDS.includes(column.field)) {
                value = AAD.Data.Finance.formatFieldValue(column.field, value);
              }
              bodyHTML += this.generateTableCellWithTooltip(value, cellClass, column, row, 'data');
            });
          });

          bodyHTML += '</tr>';
        });
        bodyHTML += '</tbody>';

        // 初始化tooltip懒加载 (只初始化一次)
        if (!this.tooltipInitialized) {
          this.initTooltipLazyLoading();
          this.tooltipInitialized = true;
        }

        return headerHTML + bodyHTML;
      },

      // 计算汇总行
      calculateSummaryRows(data) {
        return AAD.Data.Finance.Helpers.calculateSummaryRows(data);
      },

      // 生成带tooltip的表格单元格
      generateTableCellWithTooltip(value, cellClass, column, row, context) {
        let tooltipAttr = '';
        let finalClass = cellClass;
        const hasDefeatLog = column.tooltip === 'defeat_log' && this.defeatLogTooltipEnabled && row?._defeatLog?.log;
        const displayValue = hasDefeatLog ? `<span class="dbDefeatLogHint">${value}</span>` : value;
        if (column.tooltip) {
          if (column.tooltip === 'defeat_log' && !hasDefeatLog) {
            return `<td class="${finalClass}">${displayValue}</td>`;
          }
          if (column.tooltip === 'exp_details' && !this.proficiencyTooltipEnabled) {
            return `<td class="${finalClass}">${displayValue}</td>`;
          }
          const rowId = context === 'data' ? (row.id || row.timestamp || ('row_' + Math.random())) : context;
          tooltipAttr = ` data-tooltip-type="${column.tooltip}" data-row-id="${rowId}" data-column-field="${column.field}"`;
        }

        return `<td class="${finalClass}"${tooltipAttr}>${displayValue}</td>`;
      },

      generateDeleteActionCell(row, cellClass = 'AADBDataCell') {
        if (!row || !row.id) {
          return `<td class="${cellClass}"></td>`;
        }
        return `<td class="${cellClass} AADBDeleteCell" data-delete-record-id="${row.id}"><span class="dbDefeatLogHint">删除</span></td>`;
      },

      async handleDeleteRecord(recordId) {
        if (this.deletingRecord) return;

        this.deletingRecord = true;
        try {
          await AAD.Core.Database.deleteBattleById(recordId);
          const modal = AAD.Utils.DOM.gE('#AADBBattleStatsModal');
          const container = modal ? modal.querySelector('.AADBContainer') : null;
          if (container) {
            await this.applyBattleStatsFilter(container);
          }
        } finally {
          this.deletingRecord = false;
        }
      },

      // 初始化tooltip懒加载
      initTooltipLazyLoading() {
        // 简化的tooltip初始化 - 可以后续完善
        if (this.tooltipInitialized) return;

        const modal = AAD.Utils.DOM.gE('#AADBBattleStatsModal');
        const table = modal ? modal.querySelector('.AADBTable') : null;
        if (!table) return;

        // 绑定鼠标悬停事件到统计表格
        table.addEventListener('mouseover', (e) => {
          const cell = e.target.closest('td[data-tooltip-type]');
          if (!cell) return;

          const tooltipType = cell.getAttribute('data-tooltip-type');
          const rowId = cell.getAttribute('data-row-id');
          const columnField = cell.getAttribute('data-column-field');

          if (!tooltipType || !rowId) return;
          if (tooltipType === 'defeat_log') {
            this.hideTooltip();
            return;
          }

          const rowData = this.tooltipDataMap.get(rowId);
          if (!rowData) return;

          const column = { tooltip: tooltipType, field: columnField };
          const content = this.generateTooltipContent(rowData, column);
          if (!content) {
            this.hideTooltip();
            return;
          }

          // 显示tooltip (简化实现)
          this.showTooltip(content, e.pageX, e.pageY);
        });

        table.addEventListener('mouseout', (e) => {
          const cell = e.target.closest('td[data-tooltip-type]');
          if (cell) {
            this.hideTooltip();
          }
        });

        table.addEventListener('click', (e) => {
          const deleteCell = e.target.closest('td[data-delete-record-id]');
          if (deleteCell) {
            const recordId = deleteCell.getAttribute('data-delete-record-id');
            if (recordId) {
              this.handleDeleteRecord(recordId);
            }
            return;
          }

          const cell = e.target.closest('td[data-tooltip-type="defeat_log"]');
          if (!cell) return;
          const rowId = cell.getAttribute('data-row-id');
          if (!rowId) return;
          const rowData = this.tooltipDataMap.get(rowId);
          const logText = rowData?._defeatLog?.log;
          if (!logText) return;
          this.showDefeatLogModal(logText);
        });

        this.tooltipInitialized = true;
      },

      // 显示tooltip
      showTooltip(content, x, y) {
        let tooltip = document.getElementById('dbTooltip');
        if (!tooltip) {
          tooltip = document.createElement('div');
          tooltip.id = 'dbTooltip';
          tooltip.className = 'dbTooltip';
          document.body.appendChild(tooltip);
        }

        tooltip.innerHTML = content;
        tooltip.style.left = (x + 10) + 'px';
        tooltip.style.top = (y + 10) + 'px';
        tooltip.style.display = 'block';
      },

      // 隐藏tooltip
      hideTooltip() {
        const tooltip = document.getElementById('dbTooltip');
        if (tooltip) {
          tooltip.style.display = 'none';
        }
      },

      showDefeatLogModal(logText) {
        let modal = document.getElementById('dbDefeatLogModal');
        if (!modal) {
          modal = document.body.appendChild(document.createElement('div'));
          modal.id = 'dbDefeatLogModal';
          modal.className = 'dbDefeatLogModal';
          modal.innerHTML = '<div class="dbDefeatLogContent"></div>';
          modal.addEventListener('click', (e) => {
            if (e.target === modal) {
              modal.style.display = 'none';
            }
          });
        }

        const content = modal.querySelector('.dbDefeatLogContent');
        if (content) {
          content.textContent = logText;
        }
        modal.style.display = 'flex';
      },

      // 生成tooltip内容
      generateTooltipContent(rowData, column) {
        const content = [];

        let dropData, combatData;

        // 对于Total和Average行，使用聚合数据
        if (rowData.timestamp === 'Total' || rowData.timestamp === 'Average') {
          if (rowData._lazyAveraging && rowData.timestamp === 'Average') {
            // Average行 + 惰性标记：按需平均化
            dropData = this.lazyAverageData(rowData._sourceDropData, rowData._dataLength);
            combatData = this.lazyAverageData(rowData._sourceCombatData, rowData._dataLength);
          } else if (rowData._lazyTotal && rowData.timestamp === 'Total') {
            // Total行：使用累积的总计数据
            dropData = rowData._sourceDropData;
            combatData = rowData._sourceCombatData;
          }
        } else {
          // 普通数据行和按天聚合行，使用标准化数据
          dropData = rowData._dropData || {};
          combatData = rowData._usageData || {};
        }

        switch (column.tooltip) {
          case 'exp_details':
            if (combatData.proficiency) {
              Object.keys(combatData.proficiency).forEach((name) => {
                const value = combatData.proficiency[name];
                if (value) {
                  const rounded = Math.round(value * 1000) / 1000;
                  content.push(name + ': ' + rounded);
                }
              });
            }
            break;

          case 'legendary_details': {
            const equipData = dropData.Equips && dropData.Equips.Legendary;
            if (equipData) {
              Object.keys(equipData).forEach((name) => {
                const count = equipData[name] || 0;
                if (count > 0) {
                  content.push(name + ': ' + count);
                }
              });
            }
            break;
          }

          case 'peerless_details': {
            const equipData = dropData.Equips && dropData.Equips.Peerless;
            if (equipData) {
              Object.keys(equipData).forEach((name) => {
                const count = equipData[name] || 0;
                if (count > 0) {
                  content.push(name + ': ' + count);
                }
              });
            }
            break;
          }

          case 'potion_details':
            if (combatData.items) {
              content.push(...ItemStatsUtil.getItemDetails(combatData, ITEM_LISTS.POTIONS, 'items'));
            }
            break;

          case 'scroll_details':
            if (combatData.items) {
              content.push(...ItemStatsUtil.getItemDetails(combatData, ITEM_LISTS.SCROLLS));
            }
            break;

          case 'gem_details':
            if (combatData.items) {
              content.push(...ItemStatsUtil.getItemDetails(combatData, ITEM_LISTS.GEMS));
            }
            break;

          case 'other_details':
            if (combatData.items) {
              content.push(...ItemStatsUtil.getItemDetails(combatData, ITEM_LISTS.OTHERS));
            }
            break;

          case 'attack_spell_details':
            if (combatData.magic) {
              content.push(...ItemStatsUtil.getItemDetails(combatData, SPELL_LISTS.ATTACK, 'magic'));
            }
            if (this.resistTooltipEnabled) {
              const resistData = combatData.resist || {};
              const magicHit = resistData.magicHit || 0;
              const magicCrit = resistData.magicCrit || 0;
              const magicResistPartially = resistData.magicResistPartially || 0;
              const magicResist = resistData.magicResist || 0;
              if (magicHit) content.push('magicHit: ' + magicHit);
              if (magicCrit) content.push('magicCrit: ' + magicCrit);
              if (magicResistPartially) content.push('magicResistPartially: ' + magicResistPartially);
              if (magicResist) content.push('magicResist: ' + magicResist);
            }
            break;

          case 'support_spell_details':
            if (combatData.magic) {
              content.push(...ItemStatsUtil.getItemDetails(combatData, SPELL_LISTS.SUPPORT, 'magic'));
            }
            break;

          case 'heal_spell_details':
            if (combatData.magic) {
              content.push(...ItemStatsUtil.getItemDetails(combatData, SPELL_LISTS.HEAL, 'magic'));
            }
            break;

          case 'debuff_spell_details':
            if (combatData.magic) {
              content.push(...ItemStatsUtil.getItemDetails(combatData, SPELL_LISTS.DEBUFF, 'magic'));
            }
            if (this.resistTooltipEnabled) {
              const resistData = combatData.resist || {};
              const resist0 = resistData.debuffResist0 || 0;
              const resist12 = resistData.debuffResist12 || 0;
              const resist3 = resistData.debuffResist3 || 0;
              if (resist0) content.push('debuffResist0: ' + resist0);
              if (resist12) content.push('debuffResist12: ' + resist12);
              if (resist3) content.push('debuffResist3: ' + resist3);
            }
            break;

          case 'defeat_log': {
            const defeatLog = rowData._defeatLog;
            if (defeatLog && defeatLog.log) {
              const logLines = defeatLog.log.split('\n');
              for (let i = 0; i < logLines.length; i++) {
                const line = logLines[i];
                if (line) {
                  content.push(line);
                }
              }
            }
            break;
          }

          case 'potion_net_details': {
            // 按药水类型合并计算净收入
            const potionNet = {};

            // 统计药水掉落
            for (const potionKey in dropData) {
              if (potionKey.includes('Potion') || potionKey.includes('Elixir') || potionKey.includes('Draught')) {
                potionNet[potionKey] = (potionNet[potionKey] || 0) + (dropData[potionKey] || 0);
              }
            }

            // 统计药水使用
            if (combatData.items) {
              ITEM_LISTS.POTIONS.forEach(potion => {
                const used = combatData.items[potion] || 0;
                if (used > 0) {
                  potionNet[potion] = (potionNet[potion] || 0) - used;
                }
              });
            }

            // 显示净收入（只显示非零的）
            for (const potionShort in potionNet) {
              if (potionNet[potionShort] !== 0) {
                const potionNetValue = AAD.Utils.Format.fixPrecision(potionNet[potionShort], 2);
                const potionSign = potionNetValue > 0 ? '+' : '';
                const potionDisplay = potionNetValue % 1 === 0 ? Math.round(potionNetValue) : potionNetValue;
                content.push(potionShort + ': ' + potionSign + potionDisplay);
              }
            }
            break;
          }

          case 'scroll_net_details': {
            // 按卷轴类型合并计算净收入
            const scrollNet = {};

            // 统计卷轴掉落（使用原名）
            for (const scrollKey in dropData) {
              if (scrollKey.includes('Scroll')) {
                scrollNet[scrollKey] = (scrollNet[scrollKey] || 0) + (dropData[scrollKey] || 0);
              }
            }

            // 统计卷轴使用（使用原名）
            if (combatData.items) {
              ITEM_LISTS.SCROLLS.forEach(scroll => {
                const used = combatData.items[scroll] || 0;
                if (used > 0) {
                  scrollNet[scroll] = (scrollNet[scroll] || 0) - used;
                }
              });
            }

            // 显示净收入（只显示非零的）
            for (const scrollName in scrollNet) {
              if (scrollNet[scrollName] !== 0) {
                const scrollNetValue = AAD.Utils.Format.fixPrecision(scrollNet[scrollName], 2);
                const scrollSign = scrollNetValue > 0 ? '+' : '';
                const scrollDisplay = scrollNetValue % 1 === 0 ? Math.round(scrollNetValue) : scrollNetValue;
                content.push(scrollName + ': ' + scrollSign + scrollDisplay);
              }
            }
            break;
          }

          default:
            break;
        }

        return content.length > 0 ? content.join('<br>') : '';
      },

      // 懒加载数据平均化
      lazyAverageData(sourceData, dataLength, excludeKeys = []) {
        if (!sourceData || dataLength <= 0) return {};

        const result = {};
        for (const key in sourceData) {
          if (excludeKeys.includes(key)) continue;
          if (typeof sourceData[key] === 'number') {
            result[key] = Math.round((sourceData[key] / dataLength) * 100) / 100;
          } else if (typeof sourceData[key] === 'object' && sourceData[key] !== null) {
            result[key] = this.lazyAverageData(sourceData[key], dataLength, excludeKeys);
          }
        }
        return result;
      },

      // 自定义条件界面
      customizeBox() {
        const existing = document.getElementById('customizeBox');
        if (existing) {
          return existing;
        }

        const customizeBox = document.body.appendChild(AAD.Utils.DOM.cE('div'));
        customizeBox.id = 'customizeBox';
        customizeBox.className = 'customizeBox';

        const statusOption = [
          '<option value="hp">hp</option>',
          '<option value="mp">mp</option>',
          '<option value="sp">sp</option>',
          '<option value="oc">oc</option>',
          '<option value="">- - - -</option>',
          '<option value="monsterAll">monsterAll</option>',
          '<option value="monsterAlive">monsterAlive</option>',
          '<option value="bossAll">bossAll</option>',
          '<option value="bossAlive">bossAlive</option>',
          '<option value="">- - - -</option>',
          '<option value="roundNow">roundNow</option>',
          '<option value="roundAll">roundAll</option>',
          '<option value="roundLeft">roundLeft</option>',
          '<option value="roundType">roundType</option>',
          '<option value="attackStatus">attackStatus</option>',
          '<option value="turn">turn</option>',
          '<option value="">- - - -</option>',
          '<option value="_isCd_">isCd</option>',
          '<option value="_buffTurn_">buffTurn</option>',
          '<option value="_hasDebuff_">hasDebuff</option>',
          '<option value="_hasEffect_">hasEffect</option>',
          '<option value="_isBoss_">isBoss</option>',
          '<option value="_monHp_">monHp</option>',
          '<option value="_monFullHp_">monFullHp</option>',
          '<option value="_monNowHp_">monNowHp</option>',
          '<option value="_isSsOn_">isSsOn</option>',
          '<option value=""></option>'
        ].join('');

        customizeBox.innerHTML = [
          '<span class="dbInspect" title="off">△</span>',
          '<select name="groupChoose"></select>',
          '<select name="statusA">' + statusOption + '</select>',
          '<select name="compareAB"><option value="1">＞</option><option value="2">＜</option><option value="3">≥</option><option value="4">≤</option><option value="5">＝</option><option value="6">≠</option></select>',
          '<select name="statusB">' + statusOption + '</select>',
          '<button class="groupAdd">＋</button>'
        ].join(' ');

        AAD.Utils.DOM.gE('.dbInspect', customizeBox).onclick = function() {
          const pinned = AAD.Core.State.get('customizePinned', false);
          const target = AAD.Core.State.get('customizeTarget');
          if (!pinned && !target) return;
          const nextPinned = !pinned;
          AAD.Core.State.set('customizePinned', nextPinned);
          this.title = nextPinned ? 'on' : 'off';
        };

        AAD.Utils.DOM.gE('.groupAdd', customizeBox).onclick = function() {
          const target = AAD.Core.State.get('customizeTarget');
          if (!target) return;
          const selects = AAD.Utils.DOM.gE('select', 'all', customizeBox);
          let groupChoose = selects[0].value;
          let group;
          if (groupChoose === 'new') {
            groupChoose = AAD.Utils.DOM.gE('option', 'all', selects[0]).length;
            group = target.appendChild(AAD.Utils.DOM.cE('div'));
            group.className = 'customizeGroup';
            group.innerHTML = groupChoose + '. ';
            selects[0].click();
          } else {
            group = AAD.Utils.DOM.gE('.customizeGroup', 'all', target)[groupChoose - 1];
          }
          const input = group.appendChild(AAD.Utils.DOM.cE('input'));
          input.type = 'text';
          input.className = 'customizeInput';
          input.name = target.getAttribute('name') + '_' + (groupChoose - 1);
          input.value = selects[1].value + ',' + selects[2].value + ',' + selects[3].value;
          AAD.UI.Panel.updateConditionBoxGroups(target);
        };

        return customizeBox;
      },


    };

AAD.UI.Theme = {
      cssVariables: {
        'main-bg': '--aad-main-bg',
        'accent-color': '--aad-accent-color',
        'border-color': '--aad-border-color',
        'secondary-bg': '--aad-secondary-bg',
        'card-bg': '--aad-card-bg',
          'hover-color': '--aad-hover-color',
          'modal-bg': '--aad-modal-bg',
        'modal-header-bg': '--aad-modal-header-bg',
        'modal-overlay': '--aad-modal-overlay',
        'shadow-color': '--aad-shadow-color',
        'text-primary': '--aad-text-primary',
        'text-white': '--aad-text-white',
        'bg-white': '--aad-bg-white',
        'link-color': '--aad-link-color',
        'link-hover': '--aad-link-hover',
        'text-heading': '--aad-text-heading',
        'input-border': '--aad-input-border',
        'input-focus': '--aad-input-focus'
      },

      // 主题配置
      themes: {
        white: {
          name: '天水碧',
          'main-bg': '#F7F3EB',
          'accent-color': '#5BA5B2',
          'border-color': '#5BA5B2',
          'secondary-bg': '#F0EDE3',
            'card-bg': '#F7F3EB',
            'hover-color': '#E8E3D8',
            'modal-bg': '#F7F3EB',
          'modal-header-bg': '#5BA5B2',
          'modal-overlay': 'rgba(91, 165, 178, 0.4)',
          'shadow-color': 'rgba(91, 165, 178, 0.15)',
          'text-primary': '#495057',
          'text-white': '#f8f9fa',
          'bg-white': '#f8f9fa',
          'link-color': '#6B8AB8',
          'link-hover': '#5A7A9F',
          'text-heading': '#212529',
          'input-border': '#6B8AB8',
          'input-focus': '#5A7A9F'
        },
        popBrutal: {
          name: '奶油波普',
          'main-bg': '#FFF8EC',
          'accent-color': '#7FCBFF',
          'border-color': '#111111',
          'secondary-bg': '#FFD3A1',
            'card-bg': '#FFFEF9',
            'hover-color': '#CFEAFF',
            'modal-bg': '#FFFEF9',
          'modal-header-bg': '#BFE7C8',
          'modal-overlay': 'rgba(0, 0, 0, 0.2)',
          'shadow-color': 'rgba(0, 0, 0, 0.25)',
          'text-primary': '#111111',
          'text-white': '#f8f9fa',
          'bg-white': '#f8f9fa',
          'link-color': '#5FA8E5',
          'link-hover': '#F1A255',
          'text-heading': '#111111',
          'input-border': '#111111',
          'input-focus': '#7FCBFF'
        },
        night: {
          name: "夜间",
          "main-bg": "#0D0F12",
          "accent-color": "#4A6C8F",
          "border-color": "#2A313A",
          "secondary-bg": "#13171D",
          "card-bg": "#181D24",
          "hover-color": "#202632",
          "modal-bg": "#181D24",
          "modal-header-bg": "#1E262F",
          "modal-overlay": "rgba(0, 0, 0, 0.7)",
          "shadow-color": "rgba(0, 0, 0, 0.7)",
          "text-primary": "#C4CDD6",
          "text-white": "#F7F9FB",
          "bg-white": "#12161C",
          "link-color": "#6F97BF",
          "link-hover": "#83A9CF",
          "text-heading": "#E9EDF1",
          "input-border": "#2D3641",
          "input-focus": "#5A7FA6"
        }
      },

      // 初始化统一主题系统
      init() {
        const existingStyle = document.getElementById('aad-unified-styles');
        if (existingStyle) {
          return;
        }

        // 加载保存的主题
        const savedTheme = AAD.Core.Storage.getValue('currentTheme');
        const themeName = this.themes[savedTheme] ? savedTheme : 'white';

        // 生成完整CSS
        const fullCSS = this.generateFullCSS(themeName);
        const style = document.createElement('style');
        style.id = 'aad-unified-styles';
        style.textContent = fullCSS;
        document.head.appendChild(style);

      },

      // 应用主题
      applyTheme(themeName) {
        if (this.themes[themeName]) {
          const theme = this.themes[themeName];
          AAD.Core.Storage.setValue('currentTheme', themeName);
          this.updateCSSVariables(theme);
        }
      },

      updateCSSVariables(theme) {
        const root = document.documentElement;
        Object.entries(this.cssVariables).forEach(([themeKey, cssVar]) => {
          if (theme[themeKey]) {
            root.style.setProperty(cssVar, theme[themeKey]);
          }
        });
      },

      // 生成完整CSS（包含CSS变量和所有样式）
      generateFullCSS(themeName) {
        const theme = this.themes[themeName];
        const cssVariables = `:root {\n${Object.entries(this.cssVariables)
          .map(([themeKey, cssVar]) => `  ${cssVar}: ${theme[themeKey]};`)
          .join('\n')}\n}`;
        const styles = this.generateAllStyles();

        return `${cssVariables}\n\n${styles}`;
      },

      // 生成所有样式
      generateAllStyles() {
        return `
          /* AADB 统一样式系统 */

          /* 基础样式 */
          #dbBox2 { top: 30px; left: 1238px; position: absolute; }
          .lastEncounter { font-weight: 600; font-size: 14px; position: absolute; top: 32px; left: 1240px; text-decoration: none; color: var(--aad-text-primary); background-color: transparent; padding: 6px 10px; }
          .dbButton {
            top: 4px;
            left: 1238px;
            position: absolute;
            z-index: 9999;
            cursor: pointer;
            width: 28px;
            height: 28px;
            background: transparent;
            border: none;
            border-radius: 50%;
            box-shadow: none;
            transition: background-color 0.15s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            color: var(--aad-text-primary);
            font-size: 22px;
          }
            .dbButton:hover { background: var(--aad-accent-color); }

          .idleArenaToggleButton {
            top: 5px;
            left: 1300px;
            position: absolute;
            z-index: 1;
            cursor: pointer;
            background-color: var(--aad-secondary-bg);
            color: var(--aad-text-primary);
            border: 1px solid var(--aad-border-color);
            padding: 4px 8px;
          }

          .battleStatsToggleButton {
            left: 1268px;
          }


            /* 主面板 */
            #dbBox {
            left: calc(50% - 525px);
            top: 50px;
            font-size: 14px !important;
            z-index: 4;
            width: 850px;
            min-height: 580px;
            position: absolute;
            text-align: left;
            background-color: var(--aad-main-bg);
            border: 1px solid var(--aad-accent-color);
            border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif;
              box-shadow: 0 4px 6px var(--aad-shadow-color);
            }

            /* 战斗暂停按钮 */
            .pauseChange {
              border: 1px solid var(--aad-input-border);
              border-radius: 4px;
              cursor: pointer;
              margin: 0 2px;
              padding: 6px 12px;
              background-color: var(--aad-secondary-bg);
              color: var(--aad-text-primary);
              font-size: 13px;
              font-weight: 500;
            }

            .pauseChange:hover {
              background-color: var(--aad-hover-color);
              border-color: var(--aad-border-color);
            }

            .pauseChange:active {
              background-color: var(--aad-accent-color);
            }

          /* 标题区域 */
          #dbBox .dbCenter:first-child {
            background-color: var(--aad-accent-color);
            padding: 16px;
            border-radius: 8px 8px 0 0;
            border-bottom: 1px solid var(--aad-border-color);
            display: flex;
            align-items: center;
          }
          #dbBox .dbCenter:first-child h1 {
            margin: 0;
            color: var(--aad-text-white);
            font-size: 20px;
            font-weight: 600;
          }

          /* 顶部按钮组 */
          .dbTopButtons {
            display: flex;
            gap: 8px;
            margin-left: auto;
            margin-right: 12px;
          }
          .dbTopButtons button {
            padding: 6px 12px;
            font-size: 12px;
            border: 1px solid var(--aad-input-border);
            border-radius: 4px;
            background-color: var(--aad-main-bg);
            color: var(--aad-text-primary);
            cursor: pointer;
            font-weight: 500;
          }
          .dbTopButtons button:hover {
            background-color: var(--aad-secondary-bg);
            border-color: var(--aad-border-color);
          }

          /* 侧边栏标签页布局 */
          .dbTablist {
            display: flex;
            min-height: 520px;
            border-radius: 0 0 6px 6px;
            overflow: hidden;
          }
          .dbTabmenu {
            flex: 0 0 100px;
            background-color: var(--aad-accent-color);
            border-right: 1px solid var(--aad-border-color);
            padding: 16px 0;
          }
          .dbTabmenu > span {
            display: block;
            padding: 8px 16px;
            margin: 2px 8px;
            border-radius: 4px;
            background-color: var(--aad-main-bg);
            border: 1px solid var(--aad-input-border);
            color: var(--aad-text-primary);
            text-decoration: none;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            text-align: left;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            transition: background-color 0.15s ease;
          }

          .dbTabmenu > span:hover {
            background-color: var(--aad-secondary-bg);
            border-color: var(--aad-border-color);
          }

          .dbTabmenu > span.active {
            background-color: var(--aad-border-color);
            color: var(--aad-text-white);
            border-color: var(--aad-border-color);
          }

          /* 内容区域 */
          .dbTab {
            flex: 1;
            padding: 20px;
            background-color: var(--aad-main-bg);
            color: var(--aad-text-primary);
            overflow: auto;
            max-height: 480px;
            display: none;
          }

          .dbTab.active {
            display: block;
          }

          /* 卡片样式 */
          .dbTab > div {
            margin-bottom: 12px;
            padding: 16px;
            background-color: var(--aad-card-bg);
            border: 1px solid var(--aad-input-border);
            border-radius: 6px;
          }

          .dbTab > div:hover {
            border-color: var(--aad-accent-color);
          }

          /* 表单控件样式 */
          .dbTab input[type="checkbox"] { margin-right: 8px; vertical-align: text-bottom; }

          .dbTab input[type="number"],
          .dbTab input[type="text"],
          .dbTab select,
          .dbTab textarea {
            padding: 6px 8px;
            border: 1px solid var(--aad-input-border);
            border-radius: 4px;
            background-color: var(--aad-main-bg);
            color: var(--aad-text-primary);
            font-size: 13px;
          }

          .dbTab input[type="number"]:hover,
          .dbTab input[type="text"]:hover,
          .dbTab select:hover,
          .dbTab textarea:hover,
          .dbTab input[type="number"]:focus,
          .dbTab input[type="text"]:focus,
          .dbTab select:focus,
          .dbTab textarea:focus {
            background-color: var(--aad-secondary-bg) !important;
          }

          .dbTab input[type="number"]:focus,
          .dbTab input[type="text"]:focus,
          .dbTab select:focus,
          .dbTab textarea:focus {
            outline: none;
            border-color: var(--aad-input-focus);
            box-shadow: 0 0 0 2px var(--aad-shadow-color);
          }

          /* dbNumber 小*/
          .dbTab input.dbNumber {
            padding: 2px 4px;
            width: 32px;
            font-size: 13px;
          }

          /* dbNumber 中 */
          .dbTab select.dbNumber {
            padding: 2px 4px;
            min-width: 56px;
            width: auto;
            font-size: 13px;
          }

          /* 长文本输入框 */
          .dbTab .dbInputWide {
            width: 65%;
          }


          /* 下拉框选项样式 */
          .dbTab select option {
            background-color: var(--aad-main-bg) ;
            color: var(--aad-text-primary);
          }


          .dbTab button {
            border: 1px solid var(--aad-input-border);
            border-radius: 4px;
            cursor: pointer;
            margin: 0 2px;
            padding: 6px 12px;
            background-color: var(--aad-secondary-bg);
            color: var(--aad-text-primary);
            font-size: 13px;
            font-weight: 500;
          }

          .dbTab button:hover {
            background-color: var(--aad-hover-color);
            border-color: var(--aad-border-color);
          }

          .dbTab button:active {
            background-color: var(--aad-accent-color);
          }

          /* 特殊样式 */
          .dbTipText {
            color: var(--aad-text-primary);
          }

          .dbTab b {
            font-family: inherit;
            font-size: 15px;
            color: var(--aad-text-heading);
            font-weight: 600;
          }

          .dbTab label {
            color: var(--aad-text-primary);
          }

          .dbTab a {
            margin: 0 4px;
            color: var(--aad-link-color);
            text-decoration: none;
          }

          .dbTab a:hover {
            text-decoration: underline;
            color: var(--aad-link-hover);
          }

          /* 条件框样式 */
          .customize {
            border: 1px dashed var(--aad-input-border);
            min-height: 24px;
            border-radius: 4px;
          }

          .customize > .customizeGroup {
            display: block;
            background-color: var(--aad-card-bg);
            border: 1px solid var(--aad-border-color);
            margin: 4px;
            padding-left: 1.05em;
            text-indent: -1.05em;
          }

          .customize > .customizeGroup:nth-child(2n) {
            background-color: var(--aad-secondary-bg);
          }

          .customizeBox {
            position: absolute;
            z-index: 100;
            display: none;
            border: 1px solid var(--aad-border-color);
            background-color: var(--aad-main-bg) !important;
            border-radius: 4px;
            box-shadow: 0 2px 8px var(--aad-shadow-color);
          }

          .customizeBox > span {
            display: inline-block;
            font-size: 14px;
            margin: 2px;
            padding: 4px 8px;
            font-weight: 500;
            border: 1px solid var(--aad-border-color);
            border-radius: 4px;
            color: var(--aad-text-primary);
            background-color: var(--aad-secondary-bg);
          }

          .customizeBox > span.dbInspect {
            cursor: pointer;
          }

          .customizeBox > span.dbInspect:hover {
            background-color: var(--aad-hover-color);
          }

          .customizeBox > span.dbInspect[title="on"] {
            background-color: #dc3545;
            color: var(--aad-text-white);
          }

          .customizeBox > button.groupAdd {
            display: inline-block;
            font-size: 14px;
            margin: 2px;
            padding: 4px 8px;
            font-weight: 500;
            border: 1px solid var(--aad-border-color);
            border-radius: 4px;
            color: var(--aad-text-primary);
            background-color: var(--aad-secondary-bg);
            cursor: pointer;
          }

          .customizeBox > button.groupAdd:hover {
            background-color: var(--aad-hover-color);
          }

          .customizeBox > span a {
            text-decoration: none;
            color: var(--aad-link-color);
          }

          .customizeBox > select {
            max-width: 70px;
            padding: 2px 4px;
            background-color: var(--aad-main-bg) !important;
            color: var(--aad-text-primary) !important;
          }

          .customizeBox select option {
            background-color: var(--aad-main-bg) !important;
            color: var(--aad-text-primary) !important;
          }

          /* Battle Stats弹窗样式 - 兼容原版 */
          .AADBContainer {
            position: absolute;
            top: 6%;
            left: 10%;
            width: 60%;
            height: 65%;
            max-width: 80%;
            max-height: 75%;
            background-color: var(--aad-main-bg);
            color: var(--aad-text-primary);
            text-align: center;
            padding: 10px 20px;
            border-radius: 6px;
            font-size: 8pt;
            box-shadow: 0 4px 12px var(--aad-shadow-color);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            z-index: 1000;
          }

          .AADBHeader {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            flex-shrink: 0;
          }

          .AADBTitle {
            font-size: 20pt;
            font-weight: bold;
          }

          .AADBActions button {
            margin-left: 5px;
            padding: 5px 10px;
            border: 1px solid var(--aad-input-border);
            background-color: var(--aad-main-bg);
            cursor: pointer;
            color: var(--aad-text-primary);
          }

          .AADBClose {
            font-size: 16pt;
            font-weight: bold;
          }

          .AADBFilters {
            margin-bottom: 10px;
            text-align: left;
            flex-shrink: 0;
          }

          .AADBFilterRow {
            line-height: 24px;
          }

          .AADBFilterRow select,
          .AADBFilterRow input {
            margin: 0 5px;
            background-color: var(--aad-main-bg);
            color: var(--aad-text-primary);
            border: 1px solid var(--aad-input-border);
            border-radius: 3px;
            padding: 2px 4px;
          }
          .AADBFilterRow select option {
            background-color: var(--aad-main-bg);
            color: var(--aad-text-primary);
          }
          .AADBFilterRow button {
            margin-left: 10px;
            padding: 2px 8px;
            border: 1px solid var(--aad-input-border);
            background-color: var(--aad-main-bg);
            cursor: pointer;
            color: var(--aad-text-primary);
          }

          .AADBDeleteCell {
            cursor: pointer;
          }

          .AADBTableWrapper {
            height: calc(100% - 120px);
            overflow: auto;
            flex: none;
            position: relative;
          }

          .AADBTable {
            width: max-content;
            margin: 0 auto;
            table-layout: auto;
            white-space: nowrap;
            text-align: center;
            font-size: 8pt;
            border-collapse: collapse;
            background-color: var(--aad-main-bg);
          }

          .AADBTable td,
          .AADBTable th {
            padding: 4px 5px;
            border: 1px solid var(--aad-border-color);
          }

          .AADBTable tr.AADBGroupHeader th {
            border-left: 1px solid var(--aad-border-color);
            border-right: 1px solid var(--aad-border-color);
            background-color: var(--aad-main-bg);
            position: sticky;
            top: 0;
            z-index: 3;
            color: var(--aad-text-heading);
          }

          .AADBTable tr.AADBColumnHeader th {
            background-color: var(--aad-main-bg);
            border: 1px solid var(--aad-border-color);
            position: sticky;
            top: 22px;
            z-index: 2;
            color: var(--aad-text-heading);
          }

          .AADBTable tr.AADBDataRow {
            background-color: var(--aad-main-bg);
          }

          .AADBTable tr.AADBDataRow:hover {
            background-color: var(--aad-hover-color);
          }

          .dbDefeatLogHint {
            display: inline-block;
            border-bottom: 1px dashed var(--aad-border-color);
            padding: 0 10px;
          }

          .AADBTable tr.AADBSeparatorRow {
            height: 2px;
          }

          .AADBNoData {
            text-align: center;
            padding: 20px;
            color: var(--aad-text-secondary);
          }

          .dbTooltip {
            position: fixed;
            background-color: var(--aad-card-bg);
            color: var(--aad-text-primary);
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            line-height: 1.4;
            z-index: 10000;
            max-width: 320px;
            word-wrap: break-word;
            border: 1px solid var(--aad-border-color);
            box-shadow: 0 2px 8px var(--aad-shadow-color);
            pointer-events: none;
            display: none;
          }

          .dbDefeatLogModal {
            position: fixed;
            inset: 0;
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 10001;
          }

          .dbDefeatLogContent {
            overflow: auto;
            white-space: pre-wrap;
            font-size: 12px;
            line-height: 1.4;
            background-color: var(--aad-main-bg);
            color: var(--aad-text-primary);
            border: 1px solid var(--aad-border-color);
            border-radius: 8px;
            box-shadow: 0 4px 12px var(--aad-shadow-color);
            width: 40%;
            max-width: 560px;
            max-height: 75%;
            padding: 16px;
          }

        `;
      },

    };

AAD.UI.UITools = {
      // 打开URL函数
      openUrl(url, newTab = false) {
        if (newTab) {
          window.open(url, '_blank');
        } else {
          window.location.href = url;
        }
      }
    };

AAD.UI.Preset = {

      initPresetSelector(panel) {
        const selector = panel.querySelector('#presetSelector');
        if (!selector) return;

        selector.innerHTML = '<option value="">选择预设</option>';

        const presets = AAD.Core.Config.getPresetConfigList();
        presets.forEach(preset => {
          const option = AAD.Utils.DOM.cE('option');
          option.value = preset.key;
          option.textContent = preset.name;
          selector.appendChild(option);
        });

        selector.onchange = () => {
          const selectedKey = selector.value;
          const descriptionDiv = panel.querySelector('#presetDescription');
          if (selectedKey && AAD.Core.PRESET_CONFIGS[selectedKey]) {
            descriptionDiv.textContent = AAD.Core.PRESET_CONFIGS[selectedKey].description;
          } else {
            descriptionDiv.textContent = '';
          }
        };
      },
    };


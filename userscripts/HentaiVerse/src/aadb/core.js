// ==================== Global AAD Namespace ====================
const AAD = {
  NAME: "[HV]AAD Modular"
};

AAD.Runtime = {
    pageType: null, // 'battle'(战斗) | 'main'(主世界) | 'isekai'(异世界) | 'riddle'(答题) | 'ehentai'(外部页面)
    initialized: false,
    battleActive: false,

    // 世界检测方法
    isIsekai() {
      return /\/isekai\//.test(window.location.pathname);
    },

    isBattlePage() {
      return this.pageType === 'battle';
    },

    // 页面类型检测方法
    detectPageType() {
      const host = window.location.host;

      if (host === 'e-hentai.org') {
        return 'ehentai';
      }

      if (AAD.Utils.DOM.gE('#riddlecounter')) {
        return 'riddle';
      }

      if (!AAD.Utils.DOM.gE('#navbar')) {
        return 'battle';
      }

      // 世界页面检测（主世界/异世界，基于URL路径精确判断）
      if (this.isIsekai()) {
        return 'isekai';
      } else {
        return 'main';
      }
    },

    // 初始化Runtime状态
    init() {
      this.pageType = this.detectPageType();
      this.initialized = true;
      console.log(`[AAD运行时] 页面类型: ${this.pageType}`);
    },

    // 页面刷新，重新初始化脚本
    refreshPage() {
      window.location.href = window.location;
      setTimeout(() => {
        window.location.href = window.location;
      }, 6000);
    }
  };

// 核心服务层 - 基础设施，按需加载不影响启动性能
AAD.Core = {};

AAD.Core.PRESET_CONFIGS = {
      config1: {
        name: '元素法师',
        description: '基本设置，可用于AR ,40锻造可用于 GF，设置法系后使用',
        config: JSON.parse('{"channelSkillSwitch":true,"buffSkillSwitch":true,"debuffSkillSwitch":true,"scrollSwitch":true,"dataRecordSwitch":true,"autobuylist":"MP,SP,SW,SC,EC","staminaLow":21,"item":{"Cure":true,"FC":true,"HP":true,"HE":true,"MP":true,"ME":true,"SP":true,"SE":true,"LE":true,"ED":true,"HealthGem":true,"ManaGem":true,"SpiritGem":true,"MysticGem":true},"itemCureCondition":{"0":["hp,4,35","roundType,6,\u0027gr\u0027"],"1":["hp,4,45","hp,3,23","roundType,5,\u0027gr\u0027"],"2":["hp,4,48","_isCd_313,5,1","_isCd_11195,5,1"],"3":["hp,4,48","_isCd_313,5,1","roundNow,3,700"],"4":["hp,4,55","hp,3,23","sp,4,45"]},"itemFCCondition":{"0":["hp,4,21"],"1":["hp,4,23","roundType,5,\u0027gr\u0027"]},"itemHPCondition":{"0":["hp,4,30","roundType,6,\u0027gr\u0027"],"1":["hp,4,30","hp,3,23"],"2":["hp,4,25","_isCd_313,5,1"]},"itemHECondition":{"0":["hp,4,21","roundType,6,\u0027gr\u0027"],"1":["hp,4,1"]},"itemMPCondition":{"0":["mp,4,38"],"2":["mp,4,55","roundType,5,\u0027gr\u0027","roundNow,1,500"]},"itemMECondition":{"0":["mp,4,12"],"1":["mp,4,30","_buffTurn_sparklife,5,0"]},"itemSPCondition":{"0":["sp,4,45"],"1":["sp,4,55","roundType,5,\u0027gr\u0027"]},"itemSECondition":{"0":["sp,4,31","_scrollTurn_sparklife,5,0","roundNow,4,800"],"1":["sp,4,16","_scrollTurn_sparklife,6,0"],"2":["sp,4,31","_scrollTurn_sparklife,5,0","_isCd_13221,5,1"]},"itemLECondition":{"0":["sp,4,31","_scrollTurn_sparklife,5,0","roundNow,4,800"],"1":["sp,4,16","_scrollTurn_sparklife,6,0"],"2":["sp,4,31","_scrollTurn_sparklife,5,0","_isCd_13221,5,1"]},"itemEDCondition":{"0":["roundType,5,\u0027gr\u0027","roundNow,5,300"],"1":["roundType,5,\u0027gr\u0027","roundNow,5,600"]},"itemManaGemCondition":{"0":["mp,2,80"]},"channelSkill":{"AF":true,"Re":true},"channelSkillAFCondition":{"0":["_buffTurn_arcanemeditation,2,150"]},"channelSkillReCondition":{"0":["_buffTurn_regen,2,100"]},"buffSkill":{"HD":true,"MD":true,"SD":true,"AF":true,"Re":true},"buffSkillHDCondition":{"0":["hp,2,70"],"1":["hp,2,90","roundType,5,\u0027gr\u0027"]},"buffSkillMDCondition":{"0":["mp,2,80","roundType,6,\u0027ba\u0027"],"1":["mp,2,90","roundType,5,\u0027gr\u0027","roundNow,3,100"]},"buffSkillSDCondition":{"0":["sp,2,70","roundType,6,\u0027ba\u0027"],"1":["sp,2,90","roundType,5,\u0027gr\u0027","roundNow,3,500"]},"buffSkillAFCondition":{"0":["roundAll,6,1","monsterAlive,4,4"],"1":["roundAll,5,1","bossAll,1,1"],"2":["roundAll,6,1","bossAll,2,1","roundNow,5,1"]},"buffSkillReCondition":{"0":["roundAll,6,1","monsterAlive,4,4"],"1":["roundAll,5,1","bossAll,1,1"],"2":["roundAll,6,1","bossAll,2,1","roundNow,5,1"]},"sleepRatio":0,"magnetRatio":0,"debuffSkillAllWeak":true,"weakRatio":1,"debuffSkillallweakCondition":{"0":["roundNow,5,95","roundAll,5,95","roundType,5,\u0027ar\u0027"],"1":["roundNow,5,100","roundAll,5,100","roundType,5,\u0027ar\u0027"],"2":["sp,4,41","roundType,5,\u0027gr\u0027"],"3":["sp,4,51","roundType,5,\u0027gr\u0027","roundNow,3,600"]},"silenceRatio":0,"debuffSkillAllIm":true,"impRatio":1,"debuffSkill":{"Si":true},"debuffSkillSiCondition":{"0":["roundNow,5,100","roundType,5,\u0027ar\u0027"]},"scrollFirst":true,"scroll":{"Pr":true,"Sw":true,"Li":true,"Sh":true},"scrollPrCondition":{"0":["roundType,5,\u0027gr\u0027","roundNow,1,270"]},"scrollSwCondition":{"0":["roundType,5,\u0027gr\u0027","roundNow,1,270"]},"scrollLiCondition":{"0":["sp,2,50"],"1":["_buffTurn_sparklife,5,0","_isCd_11395,5,1","_isCd_313,5,1","_isCd_11195,5,1"]},"scrollShCondition":{"0":["roundType,5,\u0027gr\u0027","roundNow,1,630"]},"presetSelector":"","dbBackupListLast":"","themeSelector":"white","delayReload":true,"pauseButton":true,"itemOrder":["SP","LE","SE","MP","ME","Cure","FC","HP","HE"],"channelSkillOrder":["AF","Re"],"buffSkillOrder":["Re","AF"],"debuffSkillOrder":["Si"]}')
      },
      config2: {
        name: '单手盾',
        description: '重甲单手盾，对塔楼特化',
        config: JSON.parse('{"channelSkillSwitch":true,"buffSkillSwitch":true,"debuffSkillSwitch":true,"skillSwitch":true,"dataRecordSwitch":true,"attackStatus":"0","turnOnSS":true,"turnOnSSCondition":{"0":["roundType,6,\u0027tw\u0027","oc,1,230"],"1":["roundType,5,\u0027tw\u0027","oc,1,230","monsterAll,6,monsterAlive"],"2":["roundType,5,\u0027tw\u0027","oc,1,100","_monHp_20,5,1","monsterAlive,5,1"],"3":["roundType,5,\u0027tw\u0027","oc,1,230","monsterAll,5,monsterAlive","_hasDebuff_silence,5,1"]},"turnOffSS":true,"turnOffSSCondition":{"0":["roundType,5,\u0027tw\u0027","oc,2,100","monsterAlive,5,1","_monHp_90,5,0"]},"ruleOrder":true,"autobuylist":"MD,HD,SD,HP,MP,SP,SW,SM,EC","item":{"Cure":true,"FC":true,"HP":true,"HE":true,"MP":true,"ME":true,"SP":true,"SE":true,"HealthGem":true,"ManaGem":true,"SpiritGem":true,"MysticGem":true},"itemCureCondition":{"0":["hp,4,40"]},"itemFCCondition":{"0":["hp,4,32"]},"itemHPCondition":{"0":["hp,4,31"]},"itemHECondition":{"0":["hp,4,30"]},"itemMPCondition":{"0":["mp,4,21","_isCd_11299,5,1"],"1":["mp,4,50"]},"itemMECondition":{"0":["mp,4,23"]},"itemSPCondition":{"0":["sp,4,50"]},"itemSECondition":{"0":["sp,4,36"],"1":["sp,4,38","roundAll,5,50","roundNow,1,30"]},"itemManaGemCondition":{"0":["mp,2,80"]},"channelSkill":{"He":true,"Re":true},"channelSkillHeCondition":{"0":["_buffTurn_heartseeker,2,150"]},"channelSkillReCondition":{"0":["_buffTurn_regen,2,120"]},"buffSkill":{"HD":true,"MD":true,"SD":true,"He":true,"Re":true},"buffSkillHDCondition":{"0":["hp,2,85"]},"buffSkillMDCondition":{"0":["mp,2,75"],"1":["mp,2,95","roundType,5,\u0027tw\u0027","roundNow,1,15"]},"buffSkillSDCondition":{"0":["sp,2,70"],"1":["sp,2,85","roundType,5,\u0027tw\u0027","roundNow,1,30"]},"buffSkillReCondition":{"0":["hp,2,90"]},"debuffSkillAllSleep":true,"sleepRatio":1,"debuffSkillallsleepCondition":{"0":["roundType,5,\u0027tw\u0027"]},"magnetRatio":0,"debuffSkillAllWeak":true,"weakRatio":1,"debuffSkillallweakCondition":{"0":["roundType,5,\u0027tw\u0027"]},"debuffSkillAllSi":true,"silenceRatio":1,"debuffSkillallsilenceCondition":{"0":["roundType,5,\u0027tw\u0027"]},"impRatio":0,"debuffSkill":{"Im":true},"debuffSkillImCondition":{"0":["_isBoss_,5,1"]},"fightingStyle":"2","skillT2Condition":{"0":["_hasDebuff_stun,5,1","_hasDebuff_imp,5,1","_isBoss_,5,1","_isSsOn_,5,1","_monNowHp_10,5,0"],"1":["_hasDebuff_stun,5,1","_hasDebuff_ap,5,1","roundType,6,\u0027ar\u0027","_isSsOn_,5,1","_monHp_75,5,0"]},"scrollFirst":true,"scroll":{"Pr":true,"Sw":true,"Li":true,"Sh":true},"scrollPrCondition":{"0":["roundType,5,\u0027tw\u0027","monsterAll,5,monsterAlive","monsterAll,1,8","roundNow,1,45"]},"scrollSwCondition":{"0":["roundType,5,\u0027tw\u0027","monsterAll,5,monsterAlive","monsterAll,1,8","roundNow,1,45"]},"scrollLiCondition":{"0":["roundType,5,\u0027tw\u0027","monsterAll,5,monsterAlive","monsterAll,1,7","roundNow,1,40"],"1":["roundType,5,\u0027tw\u0027","monsterAll,5,monsterAlive","monsterAll,1,8","roundNow,1,30"]},"scrollShCondition":{"0":["roundType,5,\u0027tw\u0027","monsterAll,5,monsterAlive","monsterAll,1,8","roundNow,1,45"]},"presetSelector":"","dbBackupListLast":"","delayReload":true,"pauseButton":true,"itemOrder":["SP","SE","MP","ME","Cure","HP","FC","HE"],"channelSkillOrder":["He","Re"],"buffSkillOrder":["He","Re"],"debuffSkillOrder":["Im"],"skillOrder":["T2"]}')
      },
      config3: {
        name: '元素省蓝AR',
        description: '可用于AR ,40锻造可用于 GF',
        config: JSON.parse('{"channelSkillSwitch":true,"buffSkillSwitch":true,"debuffSkillSwitch":true,"scrollSwitch":true,"dataRecordSwitch":true,"middleSkillCondition":{"0":["roundType,6,\\"gr\\"","monsterAlive,1,4","mp,1,70"],"1":["roundType,5,\\"gr\\"","monsterAlive,1,2"]},"highSkillCondition":{"0":["roundType,6,\\"gr\\"","monsterAlive,1,4","mp,1,70"],"1":["roundType,5,\\"gr\\"","monsterAlive,5,monsterAll"]},"turnOnSS":true,"turnOnSSCondition":{"0":["roundType,6,\\"gr\\"","monsterAlive,2,3","sp,1,70","oc,1,220"]},"etherTap":true,"etherTapCondition":{"0":["roundType,5,\\"ar\\"","monsterAlive,2,4","mp,2,95","sp,1,60"],"1":["roundType,5,\\"ar\\"","monsterAlive,5,1","mp,2,95"]},"autoquit":true,"repair":true,"repairValue":65,"autobuy":true,"autobuylist":"SC,SW,EC,MP,SP,HP","item":{"Cure":true,"FC":true,"HP":true,"HE":true,"MP":true,"ME":true,"SP":true,"SE":true,"LE":true,"HealthGem":true,"ManaGem":true,"SpiritGem":true,"MysticGem":true},"itemCureCondition":{"0":["hp,4,35","roundType,6,\u0027gr\u0027"],"1":["hp,4,45","hp,3,23","roundType,5,\u0027gr\u0027"],"2":["hp,4,48","_isCd_313,5,1","_isCd_11195,5,1"],"3":["hp,4,48","_isCd_313,5,1","roundNow,3,700"],"4":["hp,4,55","hp,3,23","sp,4,45"]},"itemFCCondition":{"0":["hp,4,21"],"2":["_buffTurn_sparklife,5,0"]},"itemHPCondition":{"0":["hp,4,35","roundType,6,\\"gr\\""],"1":["hp,4,35","hp,3,23"],"2":["hp,4,33","_isCd_313,5,1"]},"itemHECondition":{"0":["hp,4,21","roundType,6,\\"gr\\""],"1":["_buffTurn_sparklife,5,0","hp,2,51","_isCd_313,5,1"],"2":["hp,4,1"]},"itemMPCondition":{"0":["mp,4,38"]},"itemMECondition":{"0":["mp,4,12"],"1":["mp,4,30","_buffTurn_sparklife,5,0"]},"itemSPCondition":{"0":["sp,4,55","roundType,6,\\"ar\\""],"1":["_buffTurn_sparklife,5,0","_isCd_11195,5,1","_isCd_313,5,1"],"2":["sp,4,45","roundType,5,\\"ar\\""]},"itemSECondition":{"0":["sp,4,31","_buffTurn_sparklife_scroll,5,0","roundNow,4,800"],"1":["sp,4,16","_buffTurn_sparklife_scroll,6,0"],"2":["sp,4,31","_buffTurn_sparklife_scroll,5,0","_isCd_13221,5,1"]},"itemLECondition":{"0":["sp,4,31","_buffTurn_sparklife_scroll,5,0","roundNow,4,800"],"1":["sp,4,16","_buffTurn_sparklife_scroll,6,0"],"2":["sp,4,31","_buffTurn_sparklife_scroll,5,0","_isCd_13221,5,1"]},"itemHealthGemCondition":{"0":["hp,2,85"]},"itemManaGemCondition":{"0":["mp,2,90"]},"channelSkill":{"AF":true,"Re":true},"channelSkillAFCondition":{"0":["_buffTurn_arcanemeditation,4,110"]},"channelSkillReCondition":{"0":["_buffTurn_regen,4,90"]},"buffSkill":{"HD":true,"MD":true,"SD":true,"AF":true,"Re":true},"buffSkillHDCondition":{"0":["hp,2,80","roundType,6,\\"ba\\""],"1":["hp,2,90","roundType,5,\\"gr\\"","roundNow,3,100"]},"buffSkillMDCondition":{"0":["mp,2,60","roundType,6,\\"ba\\""],"1":["mp,2,90","roundType,5,\\"gr\\"","roundNow,3,100"],"2":["hp,2,80",".roundType,5,\\"rb\\""]},"buffSkillSDCondition":{"0":["sp,2,65","roundType,6,\\"ba\\""],"1":["sp,2,90","roundType,5,\\"gr\\"","roundNow,3,500"],"2":["sp,2,70","roundAll,5,95"]},"buffSkillAFCondition":{"0":["roundType,6,\\"ba\\""]},"buffSkillReCondition":{"0":["roundType,6,\\"ba\\""]},"debuffSkillAllWeak":true,"weakRatio":1,"debuffSkillallweakCondition":{"0":["roundNow,5,95","roundAll,5,95","roundType,5,\u0027ar\u0027"],"1":["roundNow,5,100","roundAll,5,100","roundType,5,\u0027ar\u0027"],"2":["sp,4,41","roundType,5,\u0027gr\u0027"],"3":["sp,4,51","roundType,5,\u0027gr\u0027","roundNow,3,600"]},"debuffSkillAllSi":true,"silenceRatio":0.76,"debuffSkillallsilenceCondition":{"0":["roundType,5,\\"ar\\"","roundAll,5,100","roundNow,5,100"]},"debuffSkillAllIm":true,"impRatio":1,"scrollFirst":true,"scroll":{"Go":false,"Av":false,"Pr":true,"Sw":true,"Li":true,"Sh":true,"Ab":false},"scrollPrCondition":{"1":["roundType,5,\\"gr\\"","roundNow,1,270"]},"scrollSwCondition":{"1":["roundType,5,\\"gr\\"","roundNow,1,270"]},"scrollLiCondition":{"0":["roundType,5,\\"gr\\"","sp,2,50"],"1":["roundType,5,\\"gr\\"","_buffTurn_sparklife,5,0","_isCd_313,5,1","_isCd_11195,5,1","_isCd_11395,5,1"]},"scrollShCondition":{"1":["roundType,5,\\"gr\\"","roundNow,1,270"]},"pauseButton":true,"pauseHotkey":true,"itemOrder":["SP","LE","SE","MP","ME","Cure","FC","HP","HE"],"channelSkillOrder":["AF","Re"],"buffSkillOrder":["Re","AF"]}')
      }
      };

AAD.Core.Config = {
      // ==================== 配置管理业务逻辑 ====================
      CONFIG_EXCLUDE_KEYS: [
        'idleArena',
        'idleArenaTime',
        'idleArenaOrder',
        'idleArenaGrTime',
        'autoIW',
        'autoIWTargetLevel',
        'autoIWTasks',
        'personaConfigSwitch',
        'arPersona',
        'arEquip',
        'arConfig',
        'gfPersona',
        'gfEquip',
        'gfConfig',
        'twPersona',
        'twEquip',
        'twConfig',
        'crossWorldArena',
        'encounter',
        'encounterDailyMin',
        'encounterDailyMax',
        'dataRecordSwitch',
        'dataColumns',
        'defeatLogSwitch',
        'resistTooltipSwitch',
        'proficiencyTooltipSwitch'
      ],

      stripExcludedConfig(config) {
        const result = { ...(config || {}) };
        const keys = this.CONFIG_EXCLUDE_KEYS;
        for (let i = 0; i < keys.length; i++) {
          delete result[keys[i]];
        }
        return result;
      },

      mergeConfigWithExclusions(config) {
        const result = { ...(config || {}) };
        const current = AAD.Core.Storage.getValue('option') || {};
        const keys = this.CONFIG_EXCLUDE_KEYS;
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          if (Object.prototype.hasOwnProperty.call(current, key)) {
            result[key] = current[key];
          } else {
            delete result[key];
          }
        }
        return result;
      },

      backupConfig(name) {
        const code = name || AAD.Utils.Common.alert(2, '请输入当前配置代号') || Date.now();
        const backups = AAD.Core.Storage.getValue('backup') || {};
        backups[code] = this.stripExcludedConfig(this.getAll());
        AAD.Core.Storage.setValue('backup', backups);
        return code;
      },

      restoreConfig(code) {
        const backups = AAD.Core.Storage.getValue('backup') || {};
        if (!(code in backups) || !code) return false;
        const merged = this.mergeConfigWithExclusions(backups[code]);
        AAD.Core.Config.applyConfig(merged);
        return true;
      },

      deleteConfig(code) {
        const backups = AAD.Core.Storage.getValue('backup') || {};
        if (!(code in backups) || !code) return false;
        delete backups[code];
        AAD.Core.Storage.setValue('backup', backups);
        AAD.Runtime.refreshPage();
        return true;
      },

      resetConfig() {
        AAD.Core.Storage.delValue('option');
        return true;
      },

      // 获取完整配置
      getAll() {
        return AAD.Core.Storage.getValue('option') || {};
      },

      applyConfig(optionData) {
        AAD.Utils.Condition.validateConfig(optionData);
        AAD.Core.Storage.setValue('option', optionData);
        AAD.Runtime.refreshPage();
      },

      // ==================== 预设配置系统 ====================
      // 获取预设配置列表
      getPresetConfigList() {
        return Object.keys(AAD.Core.PRESET_CONFIGS).map(key => ({
          key: key,
          name: AAD.Core.PRESET_CONFIGS[key].name,
          description: AAD.Core.PRESET_CONFIGS[key].description
        }));
      },

    };

AAD.Core.Storage = {

      // ===== 配置存储 (世界隔离) =====
      // 世界隔离键列表（只有这些键会被按世界隔离）
      ISOLATED_KEYS: new Set([
        'option', 'backup', 'roundType', 'roundNow', 'roundAll',
        'monsterStatus', 'arena', 'dailyReset_arena', 'disabled', 'missanswer',
        'prices', 'page_temp_data', 'iwState', 'arenaAutoStart'
      ]),

      // 世界隔离键映射
      getWorldKey(key) {
        if (this.ISOLATED_KEYS.has(key)) {
          if (AAD.Runtime.isIsekai()) {
            return `isekai_${key}`;
          } else {
            return `main_${key}`;
          }
        }
        return key;
      },

      // ===== 持久化存储接口 =====
      turnOptions: null,
      beginTurn() { this.turnOptions = { value: this.getValue('option') }; },
      endTurn() { this.turnOptions = null; },

      setValue(key, value) {
        const worldKey = this.getWorldKey(key);
        GM_setValue(worldKey, value);
        if (key === 'option' && this.turnOptions) this.turnOptions.value = value;
      },

      getValue(key) {
        if (key === 'option' && this.turnOptions) return this.turnOptions.value;
        const worldKey = this.getWorldKey(key);

        const value = GM_getValue(worldKey, null);
        return value === null ? null : value;
      },

      delValue(item) {
        if (item === 'option') this.endTurn();
        if (typeof item === 'string') {
          const worldKey = this.getWorldKey(item);
          GM_deleteValue(worldKey);
        } else if (typeof item === 'number') {
          // 处理预定义清理组
          if (item === 0) {
            this.delValue('disabled');
            this.delValue('missanswer');
          } else if (item === 1) {
            this.delValue('roundNow');
            this.delValue('roundAll');
            this.delValue('monsterStatus');
          } else if (item === 2) {
            this.delValue('roundType');
            this.delValue(0);
            this.delValue(1);
          }
        }
      },

      // ===== 页面生命周期存储管理器 =====
      PageLifecycle: {
        tempDataKey: null,

        // 临时数据存储键（世界隔离）
        getTempDataKey() {
          if (this.tempDataKey) {
            return this.tempDataKey;
          }
          const baseKey = 'page_temp_data';
          this.tempDataKey = AAD.Core.Storage.getWorldKey(baseKey);
          return this.tempDataKey;
        },

        shouldSaveTempData() {
          // 只有在战斗进行中且未结束时才保存临时数据
          const recorder = AAD.Data.Recorder;
          return recorder.battleStarted &&
                 !recorder.battleEnded &&
                 recorder.combat &&
                 Object.keys(recorder.combat).length > 0;
        },

        // 保存临时数据到存储
        saveTempData() {
          if (!this.shouldSaveTempData()) {
            console.log('[PageLifecycle] 无需保存临时数据');
            return;
          }

          try {
            const tempData = AAD.Data.Recorder.getCurrentState();
            const key = this.getTempDataKey();

            // 记录保存时间用于提示
            tempData.saveTimestamp = Date.now();
            AAD.Core.Storage.setValue(key, tempData);
            console.log('[PageLifecycle] 临时数据已保存到存储');
          } catch (error) {
            console.error('[PageLifecycle] 保存临时数据失败:', error);
          }
        },

        // 从存储恢复临时数据
        restoreTempData() {
          try {
            const key = this.getTempDataKey();
            const tempData = AAD.Core.Storage.getValue(key);

            if (!tempData) {
              console.log('[PageLifecycle] 未找到临时数据');
              return false;
            }

            // 验证数据有效性和完整性
            if (!this.validateDataIntegrity(tempData) || !tempData.combat || !tempData.battleStarted) {
              console.warn('[PageLifecycle] 临时数据无效或不完整，跳过恢复');
              this.delValue(key);
              return false;
            }

            // 恢复数据到记录器
            Object.assign(AAD.Data.Recorder, tempData);

            // 清理临时数据
            this.delValue(key);

            console.log(`[PageLifecycle] 从存储恢复临时数据成功，保存时间: ${new Date(tempData.saveTimestamp).toLocaleString()}`);
            return true;
          } catch (error) {
            console.error('[PageLifecycle] 恢复临时数据失败:', error);
            return false;
          }
        },

        // 删除临时数据
        delValue(key) {
          try {
            AAD.Core.Storage.delValue(key || this.getTempDataKey());
          } catch (error) {
            console.warn('[PageLifecycle] 删除临时数据失败:', error);
          }
        },

        // 初始化页面生命周期管理
        init() {
          // 添加页面卸载事件监听
          window.addEventListener('beforeunload', () => {
            this.saveTempData();
          });

          console.log('[PageLifecycle] 页面生命周期管理器已初始化');

        },

        // 验证数据完整性
        validateDataIntegrity(data) {
          if (!data) return false;
          const requiredFields = ['combat', 'drops', 'timelog', 'isRecording', 'battleStarted', 'battleEnded'];
          return requiredFields.every(field => data.hasOwnProperty(field));
        }
      },



      // ===== 缓存系统 =====
      caches: {
        dom: new Map(),           // DOM元素缓存
        domAll: new Map()        // DOM列表缓存
      },

      cacheConfig: {
        maxSize: 200
      },

      // 初始化存储系统
      init(enablePageLifecycle = false) {
        if (enablePageLifecycle && AAD.Runtime.isBattlePage()) {
          this.PageLifecycle.init();
        }
      },

      // 缓存操作
      getCache(type, key) {
        const cache = this.caches[type];
        if (!cache) return null;

        const item = cache.get(key);
        if (!item) return null;

        // 检查DOM元素连接状态
        if (type === 'dom' && item.value && !item.value.isConnected) {
          cache.delete(key);
          return null;
        }

        if (type === 'domAll' && item.value && item.value.length > 0 && !item.value[0].isConnected) {
          cache.delete(key);
          return null;
        }

        return item.value;
      },

      setCache(type, key, value) {
        const cache = this.caches[type];
        if (!cache) return;

        // 缓存大小限制
        if (cache.size >= this.cacheConfig.maxSize) {
          const firstKey = cache.keys().next().value;
          cache.delete(firstKey);
        }

        cache.set(key, {
          value,
          timestamp: Date.now()
        });
      },

      // DOM缓存接口
      getElement(selector, context = document, useCache = true) {
        if (!useCache) return context.querySelector(selector);

        const cacheKey = selector + (context === document ? '' : '_ctx');
        let element = this.getCache('dom', cacheKey);

        if (element) return element;

        element = context.querySelector(selector);
        if (element) {
          this.setCache('dom', cacheKey, element);
        }

        return element;
      },

      getAllElements(selector, context = document, useCache = false) {
        if (!useCache) return context.querySelectorAll(selector);

        const cacheKey = selector + (context === document ? '' : '_ctx');
        let elements = this.getCache('domAll', cacheKey);

        if (elements) return elements;

        elements = context.querySelectorAll(selector);
        if (elements && elements.length > 0) {
          this.setCache('domAll', cacheKey, elements);
        }

        return elements;
      },



      clearBattleCache() {
        ['dom', 'domAll'].forEach(type => {
          const cache = this.caches[type];
          const battleKeys = Array.from(cache.keys()).filter(key =>
            key.includes('btm') || key.includes('mkey_') || key.includes('battle')
          );
          battleKeys.forEach(key => cache.delete(key));
        });
      },

    };

AAD.Core.Database = {
      dbName: 'AADB',
      dbVersion: 2,
      storeName: 'battles',
      db: null,

      async init() {
        if (this.db) return this.db;
        console.log('[Database] 正在初始化IndexedDB数据库...');

        return new Promise((resolve, reject) => {
          const request = indexedDB.open(this.dbName, this.dbVersion);

          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            this.db = request.result;
            resolve(this.db);
          };

          request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains(this.storeName)) {
              const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
              this._createBattlesIndexes(store);
              console.log('[Database] IndexedDB数据库创建完成');
            }
          };
        });
      },

      // 创建 battles 表的索引
      _createBattlesIndexes(store) {
        // 主索引：isekai + battleType + endTime（覆盖所有查询场景）
        if (!store.indexNames.contains('isekai_type_time')) {
          store.createIndex('isekai_type_time', ['isekai', 'battleType', 'endTime']);
        }

        // 备用索引：isekai + endTime（当不指定 battleType 时）
        if (!store.indexNames.contains('isekai_time')) {
          store.createIndex('isekai_time', ['isekai', 'endTime']);
        }

        // 按天索引：isekai + date（用于按天查询早停）
        if (!store.indexNames.contains('isekai_date')) {
          store.createIndex('isekai_date', ['isekai', 'date']);
        }

        // 按天索引：isekai + battleType + date（用于按天查询早停）
        if (!store.indexNames.contains('isekai_type_date')) {
          store.createIndex('isekai_type_date', ['isekai', 'battleType', 'date']);
        }
      },

      // 保存战斗数据（扁平化结构 + 预聚合）
      async saveBattle(battleData) {
        try {
          const db = await this.init();

          // 保存战斗记录
          const battleRecord = await this._saveBattleRecord(db, battleData);

          return battleRecord;
        } catch (error) {
          console.error('[Database] 保存战斗数据失败:', error);
          throw error;
        }
      },

      async deleteBattleById(recordId) {
        if (!recordId) return false;
        const db = await this.init();
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        return new Promise((resolve, reject) => {
          const request = store.delete(recordId);
          request.onsuccess = () => resolve(true);
          request.onerror = () => reject(request.error);
        });
      },

      // 保存战斗记录（私有方法）
      async _saveBattleRecord(db, battleData) {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);

        const startTime = battleData.timelog.startTime || Date.now();
        const endTime = battleData.timelog.endTime || Date.now();
        const battleType = this.extractBattleType();
        const isekai = AAD.Runtime.isIsekai() ? 1 : 0;
        const worldPrefix = isekai ? 'isk' : 'main';
        const uniqueKey = `${worldPrefix}_${startTime}_${battleType}`;
        const date = new Date(endTime).toISOString().split('T')[0];

        // 计算扁平化字段（一次性完成所有计算）
        const flatData = this._computeFlattenedData(battleData);

        const battleRecord = {
          // 主键和索引字段
          id: uniqueKey,
          isekai: isekai,
          battleType: battleType,
          startTime: startTime,
          endTime: endTime,
          date: date,

          // 基础统计（扁平）
          rounds: flatData.rounds,
          turns: flatData.turns,
          duration: flatData.duration,

          // 财务数据（预计算）
          exp: flatData.exp,
          credit: flatData.credit,
          revenue: flatData.revenue,
          cost: flatData.cost,
          profit: flatData.profit,
          profitWithoutED: flatData.profitWithoutED,

          // 掉落统计（扁平）
          artifacts: flatData.artifacts,
          blood: flatData.blood,
          chaos: flatData.chaos,
          legendary: flatData.legendary,
          peerless: flatData.peerless,

          // 消耗品统计（预计算）
          potions: flatData.potions,
          scrolls: flatData.scrolls,
          gems: flatData.gems,
          others: flatData.others,
          potionNetIncome: flatData.potionNetIncome,
          scrollNetIncome: flatData.scrollNetIncome,

          // 技能统计（预计算）
          attackSpells: flatData.attackSpells,
          supportSpells: flatData.supportSpells,
          healSpells: flatData.healSpells,
          debuffSpells: flatData.debuffSpells,

          // 事件统计
          horse: flatData.horse,
          spark: flatData.spark,

          // 详细数据（压缩存储，仅用于详情查看）
          detailsCompressed: {
            drops: battleData.drops,
            items: battleData.combat.items || {},
            magic: battleData.combat.magic || {},
            proficiency: battleData.combat.proficiency || {},
            resist: battleData.combat.resist || {},
            defeatLog: battleData.combat.stats?.defeatLog || null
          }
        };

        return new Promise((resolve, reject) => {
          const request = store.put(battleRecord);
          request.onsuccess = () => {
            resolve(battleRecord);
          };
          request.onerror = () => reject(request.error);
        });
      },

      // 计算扁平化数据（一次性完成所有统计）
      _computeFlattenedData(battleData) {
        const drops = battleData.drops || {};
        const combat = battleData.combat || {};
        const stats = combat.stats || {};

        // 基础统计
        const rounds = stats.totalRounds || 0;
        const turns = stats.totalTurns || 0;
        const startTime = battleData.timelog.startTime || 0;
        const endTime = battleData.timelog.endTime || 0;
        const durationSeconds = Math.round((endTime - startTime) / 10) / 100;

        // 财务计算
        const revenue = AAD.Data.Finance.calculateRevenue(drops);
        const cost = AAD.Data.Finance.calculateCost(combat);
        const profit = AAD.Utils.Format.fixPrecision(revenue - cost, 2);
        const battleType = this.extractBattleType();
        const profitWithoutED = AAD.Data.Economy.calculateProfitWithoutED(profit, battleType, rounds);
        const potionNetIncome = AAD.Data.Finance.calculatePotionNetIncome(drops, combat);
        const scrollNetIncome = AAD.Data.Finance.calculateScrollNetIncome(drops, combat);

        // 掉落统计
        const exp = drops.EXP || 0;
        const credit = (drops.Credit || 0) + (drops.CreditFromTrash || 0);
        const artifacts = drops['Artifact'] || drops['Precursor Artifact'] || 0;
        const blood = drops.Blood || 0;
        const chaos = drops.Chaos || 0;
        const legendary = drops.Legendary || 0;
        const peerless = drops.Peerless || 0;

        // 消耗品和技能统计（批量计算）
        const batchStats = AAD.Data.Statistics.batchCountItemsAndSpells(combat);

        // 事件统计
        const horse = AAD.Data.Statistics.countHorseEvents(combat);
        const spark = AAD.Data.Statistics.countSparkEvents(combat);

        return {
          rounds,
          turns,
          duration: durationSeconds,
          exp,
          credit,
          revenue,
          cost,
          profit,
          profitWithoutED,
          artifacts,
          blood,
          chaos,
          legendary,
          peerless,
          potions: batchStats.potions,
          scrolls: batchStats.scrolls,
          gems: batchStats.gems,
          others: batchStats.others,
          potionNetIncome,
          scrollNetIncome,
          attackSpells: batchStats.attack_spells,
          supportSpells: batchStats.support_spells,
          healSpells: batchStats.heal_spells,
          debuffSpells: batchStats.debuff_spells,
          horse,
          spark
        };
      },



      // 查询战斗数据（记录级，达到limit后立即停止）
      async queryBattlesLimited(criteria = {}) {
        try {
          const db = await this.init();
          const transaction = db.transaction([this.storeName], 'readonly');
          const store = transaction.objectStore(this.storeName);
          const limitRaw = Number(criteria.limit);
          const limit = Number.isFinite(limitRaw) ? Math.max(0, limitRaw) : 100;

          if (limit <= 0) {
            return [];
          }

          const { index, range, direction } = this._selectBestIndex(store, criteria);

          return new Promise((resolve, reject) => {
            const results = [];
            const request = index.openCursor(range, direction);

            request.onsuccess = (event) => {
              const cursor = event.target.result;
              if (!cursor) {
                resolve(results);
                return;
              }

              const record = cursor.value;
              if (this._matchesCriteria(record, criteria)) {
                results.push(record);
                if (results.length >= limit) {
                  resolve(results);
                  return;
                }
              }

              cursor.continue();
            };

            request.onerror = () => reject(request.error);
          });
        } catch (error) {
          console.error('[Database] 查询战斗数据失败:', error);
          throw error;
        }
      },

      // 按天查询并直接返回日聚合行（达到limitDays后立即停止）
      async queryDailyAggregates(criteria = {}) {
        try {
          const db = await this.init();
          const transaction = db.transaction([this.storeName], 'readonly');
          const store = transaction.objectStore(this.storeName);
          const limitDaysRaw = Number(criteria.limitDays);
          const limitDays = Number.isFinite(limitDaysRaw) ? Math.max(0, limitDaysRaw) : 50;

          if (limitDays <= 0) {
            return [];
          }

          const { index, range, direction, hasBattleType } = this._selectDailyIndex(store, criteria);

          return new Promise((resolve, reject) => {
            const results = [];
            const request = index.openCursor(range, direction);

            request.onsuccess = (event) => {
              const cursor = event.target.result;
              if (!cursor) {
                resolve(results);
                return;
              }

              const dateKey = hasBattleType ? cursor.key[2] : cursor.key[1];
              const dayRange = hasBattleType
                ? IDBKeyRange.only([criteria.isekai, criteria.battleType, dateKey])
                : IDBKeyRange.only([criteria.isekai, dateKey]);
              const dayRequest = index.getAll(dayRange);

              dayRequest.onsuccess = () => {
                const records = (dayRequest.result || []).filter(record => this._matchesCriteria(record, criteria));
                if (records.length > 0) {
                  results.push(this._aggregateDailyRow(dateKey, records));
                  if (results.length >= limitDays) {
                    resolve(results);
                    return;
                  }
                }

                cursor.continue();
              };

              dayRequest.onerror = () => reject(dayRequest.error);
            };

            request.onerror = () => reject(request.error);
          });
        } catch (error) {
          console.error('[Database] 按天查询失败:', error);
          throw error;
        }
      },

      _aggregateDailyRow(dateKey, records) {
        const daily = {
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

        records.forEach(record => {
          daily.rounds += record.rounds || 0;
          daily.turns += record.turns || 0;
          daily.exp += record.exp || 0;
          daily.credit += record.credit || 0;
          daily.revenue += record.revenue || 0;
          daily.cost += record.cost || 0;
          daily.profit += record.profit || 0;
          daily.profit_without_ed += record.profitWithoutED || 0;
          daily.artifacts += record.artifacts || 0;
          daily.blood += record.blood || 0;
          daily.chaos += record.chaos || 0;
          daily.legendary += record.legendary || 0;
          daily.peerless += record.peerless || 0;
          daily.potions += record.potions || 0;
          daily.scrolls += record.scrolls || 0;
          daily.gems += record.gems || 0;
          daily.others += record.others || 0;
          daily.potion_net_income += record.potionNetIncome || 0;
          daily.scroll_net_income += record.scrollNetIncome || 0;
          daily.attack_spells += record.attackSpells || 0;
          daily.support_spells += record.supportSpells || 0;
          daily.heal_spells += record.healSpells || 0;
          daily.debuff_spells += record.debuffSpells || 0;
          daily.horse += record.horse || 0;
          daily.spark += record.spark || 0;
          daily.seconds += record.duration || 0;
          daily.battleCount += 1;

          if (record.detailsCompressed?.drops) {
            AAD.Utils.Aggregation.mergeDataObjects(daily._dropData, record.detailsCompressed.drops, ['Credit', 'CreditFromTrash', 'EXP']);
          }

          AAD.Utils.Aggregation.mergeDataObjects(daily._usageData, {
            items: record.detailsCompressed?.items || {},
            magic: record.detailsCompressed?.magic || {},
            proficiency: record.detailsCompressed?.proficiency || {},
            resist: record.detailsCompressed?.resist || {}
          });
        });

        ['revenue', 'cost', 'profit', 'profit_without_ed'].forEach(field => {
          daily[field] = AAD.Utils.Format.fixPrecision(daily[field], 2);
        });
        daily.duration = daily.seconds > 0 ? AAD.Utils.Format.formatDuration(daily.seconds) : '0s';
        daily.tps = daily.seconds > 0 && daily.turns > 0 ? Math.round((daily.turns / daily.seconds) * 100) / 100 : 0;

        return daily;
      },

      // 选择按天查询索引（查询优化器）
      _selectDailyIndex(store, criteria) {
        const isekai = criteria.isekai;
        const battleType = criteria.battleType;
        const startDateFromTime = criteria.startTime ? AAD.Utils.Time.getUtcDayKey(criteria.startTime) : null;
        const endDateFromTime = criteria.endTime ? AAD.Utils.Time.getUtcDayKey(criteria.endTime) : null;
        let startDate = criteria.startDate || startDateFromTime || '0000-01-01';
        let endDate = criteria.endDate || endDateFromTime || '9999-12-31';
        const direction = criteria.order === 'asc' ? 'nextunique' : 'prevunique';

        if (startDate > endDate) {
          const temp = startDate;
          startDate = endDate;
          endDate = temp;
        }

        if (isekai === undefined || isekai === null) {
          throw new Error('[Database] 按天查询缺少isekai条件，无法选择索引');
        }

        if (battleType) {
          const index = store.index('isekai_type_date');
          const range = IDBKeyRange.bound(
            [isekai, battleType, startDate],
            [isekai, battleType, endDate]
          );
          return { index, range, direction, hasBattleType: true };
        }

        const index = store.index('isekai_date');
        const range = IDBKeyRange.bound(
          [isekai, startDate],
          [isekai, endDate]
        );
        return { index, range, direction, hasBattleType: false };
      },

      // 选择最优索引（查询优化器）
      _selectBestIndex(store, criteria) {
        const isekai = criteria.isekai;
        const battleType = criteria.battleType;
        const startTime = criteria.startTime;
        const endTime = criteria.endTime;
        const direction = criteria.order === 'asc' ? 'next' : 'prev';

        // 场景1: isekai + battleType + time（最常见）
        if (isekai !== undefined && battleType) {
          const index = store.index('isekai_type_time');
          const range = IDBKeyRange.bound(
            [isekai, battleType, startTime || 0],
            [isekai, battleType, endTime || Date.now()]
          );
          return { index, range, direction };
        }

        // 场景2: isekai + time（不指定 battleType）
        if (isekai !== undefined) {
          const index = store.index('isekai_time');
          const range = IDBKeyRange.bound(
            [isekai, startTime || 0],
            [isekai, endTime || Date.now()]
          );
          return { index, range, direction };
        }

        // 未匹配到索引条件，直接中断
        throw new Error('[Database] 查询缺少isekai条件，无法选择索引');
      },

      // 检查记录是否匹配查询条件
      _matchesCriteria(record, criteria) {
        if (criteria.isekai !== undefined && record.isekai !== criteria.isekai) {
          return false;
        }
        if (criteria.battleType && record.battleType !== criteria.battleType) {
          return false;
        }
        if (criteria.startTime !== undefined && criteria.startTime !== null && record.endTime < criteria.startTime) {
          return false;
        }
        if (criteria.endTime !== undefined && criteria.endTime !== null && record.endTime > criteria.endTime) {
          return false;
        }
        return true;
      },

      // 提取战斗类型
      extractBattleType() {
        const roundType = AAD.Core.State.get('roundType');
        if (roundType) {
          return roundType.toLowerCase();
        }
        return 'na';
      }
    };

AAD.Core.DailyReset = {
      timers: new Map(),

      getResetKey(domainKey) {
        return `dailyReset_${domainKey}`;
      },

      computeResetTime(dayKey) {
        const dayStartMs = AAD.Utils.Time.getUtcDayStartMs(dayKey);
        const minMinutes = GAME_MECHANICS.DAILY_RESET_RANDOM_MIN_MINUTES;
        const maxMinutes = GAME_MECHANICS.DAILY_RESET_RANDOM_MAX_MINUTES;
        const minMs = minMinutes * 60 * 1000;
        const maxMs = maxMinutes * 60 * 1000;
        return dayStartMs + minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
      },

      loadState(domainKey) {
        return AAD.Core.Storage.getValue(this.getResetKey(domainKey), true) || {};
      },

      saveState(domainKey, state) {
        AAD.Core.Storage.setValue(this.getResetKey(domainKey), state);
      },

      clearTimer(timerKey) {
        const timerId = this.timers.get(timerKey);
        if (timerId) {
          clearTimeout(timerId);
          this.timers.delete(timerKey);
        }
      },

      getTimerKey(domainKey, scope) {
        if (scope === 'global') {
          return domainKey;
        }
        return `${domainKey}_${AAD.Runtime.isIsekai() ? 'isekai' : 'main'}`;
      },

      ensure(domainKey, scope, isEnabled, onReset) {
        const timerKey = this.getTimerKey(domainKey, scope);
        if (!isEnabled()) {
          this.clearTimer(timerKey);
          return null;
        }

        const now = Date.now();
        const todayKey = AAD.Utils.Time.getUtcDayKey(now);
        let state = this.loadState(domainKey);

        if (state.dayKey !== todayKey) {
          state = {
            dayKey: todayKey,
            resetTime: this.computeResetTime(todayKey),
            hasReset: false
          };
          this.saveState(domainKey, state);
        }

        if (!state.hasReset && now >= state.resetTime) {
          onReset({ dayKey: state.dayKey, resetTime: state.resetTime, now });
          state.hasReset = true;
          this.saveState(domainKey, state);
        }

        const delay = state.hasReset ?
          30 * 60 * 1000 :
          Math.max(1000, state.resetTime - now);

        this.clearTimer(timerKey);
        const timerId = setTimeout(() => {
          this.timers.delete(timerKey);
          this.ensure(domainKey, scope, isEnabled, onReset);
        }, delay);

        this.timers.set(timerKey, timerId);
        return state;
      }
    };

AAD.Core.Network = {
      timeoutMs: 30000,
      getRetries: 2,
      active: new Set(),
      _normalizeUrl(href) {
        let url=href;
        if(window.MAIN_URL && !url.startsWith(window.MAIN_URL))url=window.MAIN_URL+url;
        return window.location.protocol==='https:'?url.replace('http:','https:'):url;
      },
      _handleResponseMessagebox(data, responseType) {
        if(responseType!=='document')return;
        const incoming=AAD.Utils.DOM.gE('#messagebox_outer',data);
        const main=AAD.Utils.DOM.gE('#mainpane');
        if(!incoming||!main)return;
        const existing=AAD.Utils.DOM.gE('#messagebox_outer');
        if(existing)existing.replaceWith(incoming); else main.appendChild(incoming);
      },
      _once(href, parm, type) {
        return new Promise((resolve,reject)=>{
          const xhr=new window.XMLHttpRequest();
          const finish=(error,data)=>{this.active.delete(xhr);error?reject(error):resolve(data);};
          const fail=kind=>{const error=new Error('请求'+kind);error.transient=true;finish(error);};
          this.active.add(xhr);
          try {
            xhr.open(parm?'POST':'GET',this._normalizeUrl(href));
            xhr.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
            xhr.responseType=type||'document';
            xhr.timeout=this.timeoutMs;
            xhr.onerror=()=>fail('网络失败');
            xhr.ontimeout=()=>fail('超时');
            xhr.onabort=()=>finish(new Error('请求已取消'));
            xhr.onload=()=>{
              if(xhr.status<200||xhr.status>=400) {finish(new Error('HTTP '+xhr.status));return;}
              try {this._handleResponseMessagebox(xhr.response,xhr.responseType);finish(null,xhr.response);}
              catch(error){finish(error);}
            };
            xhr.send(parm);
          } catch(error){finish(error);}
        });
      },
      async postPromise(href, parm, type) {
        for(let attempt=0;;attempt++) {
          try{return await this._once(href,parm,type);}
          catch(error) {
            // A failed mutation may already have reached the server. Never replay it.
            if(parm||!error.transient||attempt>=this.getRetries)throw error;
            await new Promise(resolve=>setTimeout(resolve,500*2**attempt));
          }
        }
      },
      postCallback(href, func, parm, type) {
        return this.postPromise(href,parm,type).then(data=>{if(typeof func==='function')func(data);return data;}).catch(error=>{
          console.error('[AADB] 请求失败，已暂停自动战斗:',error);
          AAD.Core.Storage.setValue('disabled',true);
          AAD.Utils.Common.showStatus('请求失败，已暂停。请确认页面状态后继续。');
          return null;
        });
      },
      abortAll() {for(const xhr of this.active)xhr.abort();this.active.clear();},
      getstoken(data) {
        return data.querySelector('input[name="storetoken"]')?.value || null;
      }
    };

AAD.Core.State = {
      // 内部状态存储 - 纯内存状态管理，不涉及持久化
      state: {},
      init() {},

      get(key, defaultValue) {
        if (key === undefined) {
          return this.state;
        }
        return this.state[key] !== undefined ? this.state[key] : defaultValue;
      },

      set(key, value) {
        this.state[key] = value;
      },


    };


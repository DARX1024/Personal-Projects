/* eslint-disable camelcase */

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║                          AAD Modular Architecture                           ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

// ==================== 全局常量和配置 ====================
const GAME_MECHANICS = {
  BUFF_SLOT_LIMIT: 6,              // Buff槽位上限（不要修改）
  DEBUFF_EFFECTIVE_TURNS: 2,       // Debuff有效回合阈值（谨慎修改）
  DAILY_RESET_RANDOM_MIN_MINUTES: 5, // 每日重置延迟最小分钟数
  DAILY_RESET_RANDOM_MAX_MINUTES: 100, // 每日重置延迟最大分钟数
  ENCOUNTER_INTERVAL_MIN_MINUTES: 30, // 遭遇战间隔最小分钟数（不能少于30）
  ENCOUNTER_INTERVAL_MAX_MINUTES: 50, // 遭遇战间隔最大分钟数
  GIFT_MIN_HOURS: 60,              // 自动收礼最小间隔小时
  GIFT_MAX_HOURS: 72,              // 自动收礼最大间隔小时
  BAZAAR_REQUEST_COOLDOWN_MIN_MINUTES: 35, // 购买修理请求最小冷却分钟数
  BAZAAR_REQUEST_COOLDOWN_MAX_MINUTES: 90, // 购买修理请求最大冷却分钟数
  AOE_T3_RANGE_ISEKAI: 9,          // 异世界T3施法范围
};

const IW_TASK_STATUS = Object.freeze({
  WAITING: 'waiting',
  RUNNING: 'running',
  DONE: 'done',
  ERROR: 'error'
});

const IW_TASK_STATUS_LABELS = Object.freeze({
  [IW_TASK_STATUS.WAITING]: '等待',
  [IW_TASK_STATUS.RUNNING]: '进行',
  [IW_TASK_STATUS.DONE]: '完成',
  [IW_TASK_STATUS.ERROR]: '错误'
});

// ==================== 常量定义 ====================
// 统计计算相关的数值字段定义
const STATISTICS_NUMERIC_FIELDS = [
  'rounds', 'turns', 'exp', 'credit', 'revenue', 'cost', 'profit', 'profit_without_ed',
  'artifacts', 'blood', 'chaos', 'legendary', 'peerless', 'potions', 'scrolls', 'gems', 'others', 'horse', 'spark',
  'potion_net_income', 'scroll_net_income', 'attack_spells', 'support_spells', 'heal_spells', 'debuff_spells'
];

// 战斗统计表格列定义
const dbTableColumnsAll = {
  '基础数据': [
    { column_name: '时间', field: 'timestamp', id: 'col_timestamp', default: false },
    { column_name: '类型', field: 'battle_type', id: 'col_battle_type', default: false },
    { column_name: '层数', field: 'rounds', tooltip: 'defeat_log', id: 'col_rounds', default: false },
    { column_name: '回合', field: 'turns', id: 'col_turns', default: false },
    { column_name: '时长', field: 'duration', id: 'col_duration', default: false },
    { column_name: 'TPS', field: 'tps', id: 'col_tps', default: false },
    { column_name: '小马图', field: 'horse', id: 'col_horse', default: false },
    { column_name: '火花', field: 'spark', id: 'col_spark', default: false },
    { column_name: '传说', field: 'legendary', tooltip: 'legendary_details', id: 'col_legendary', default: false },
    { column_name: '无双', field: 'peerless', tooltip: 'peerless_details', id: 'col_peerless', default: false },
    { column_name: '删除', field: 'delete_action', id: 'col_delete', default: false }
  ],
  '收入消耗': [
    { column_name: '经验', field: 'exp', tooltip: 'exp_details', id: 'col_exp', default: false },
    { column_name: 'C', field: 'credit', id: 'col_credit', default: false },
    { column_name: '收入', field: 'revenue', id: 'col_revenue', default: false },
    { column_name: '消耗', field: 'cost', id: 'col_cost', default: false },
    { column_name: '利润', field: 'profit', id: 'col_profit', default: false },
    { column_name: '无ed环利润', field: 'profit_without_ed', id: 'col_profit_without_ed', default: false }
  ],
  '掉落详情': [
    { column_name: '文物', field: 'artifacts', tooltip: null, id: 'col_artifacts', default: false },
    { column_name: '血牌', field: 'blood', tooltip: null, id: 'col_blood', default: false },
    { column_name: '混牌', field: 'chaos', id: 'col_chaos', default: false }
  ],
  '消耗品使用': [
    { column_name: '药水', field: 'potions', tooltip: 'potion_details', id: 'col_potions', default: false },
    { column_name: '卷轴', field: 'scrolls', tooltip: 'scroll_details', id: 'col_scrolls', default: false },
    { column_name: '宝石', field: 'gems', tooltip: 'gem_details', id: 'col_gems', default: false },
    { column_name: '其他', field: 'others', tooltip: 'other_details', id: 'col_others', default: false },
    { column_name: '药水净收入', field: 'potion_net_income', tooltip: 'potion_net_details', id: 'col_potion_net', default: false },
    { column_name: '卷轴净收入', field: 'scroll_net_income', tooltip: 'scroll_net_details', id: 'col_scroll_net', default: false }
  ],
  '技能使用': [
    { column_name: '攻击', field: 'attack_spells', tooltip: 'attack_spell_details', id: 'col_attack_spells', default: false },
    { column_name: '辅助', field: 'support_spells', tooltip: 'support_spell_details', id: 'col_support_spells', default: false },
    { column_name: '治疗', field: 'heal_spells', tooltip: 'heal_spell_details', id: 'col_heal_spells', default: false },
    { column_name: 'Debuff', field: 'debuff_spells', tooltip: 'debuff_spell_details', id: 'col_debuff_spells', default: false }
  ]
};


// 技能列表常量
const SPELL_LISTS = {
  ATTACK: [
    'Paradise Lost', 'Banishment', 'Smite', 'Shockblast', 'Chained Lightning',
    'Wrath of Thor', 'Fiery Blast', 'Inferno', 'Flames of Loki', 'Freeze',
    'Blizzard', 'Fimbulvetr', 'Gale', 'Downburst', 'Storms of Njord',
    'Corruption', 'Disintegrate', 'Ragnarok',
    'FUS RO DAH', 'Orbital Friendship Cannon',
    'Shield Bash', 'Vital Strike', 'Merciful Blow',
    'Great Cleave', 'Rending Blow', 'Shatter Strike',
    'Iris Strike', 'Backstab', 'Frenzied Blows',
    'Skyward Sword',
    'Concussive Strike'
  ],
  SUPPORT: ['Regen', 'Arcane Focus', 'Heartseeker', 'Protection', 'Haste'],
  HEAL: ['Full-Cure', 'Cure'],
  DEBUFF: ['Sleep', 'Blind', 'Slow', 'Imperil', 'Immobilize', 'Silence', 'Drain', 'Weaken', 'Confuse']
};

// 物品列表常量
const ITEM_LISTS = {
  POTIONS: ['Health Potion', 'Mana Potion', 'Spirit Potion',
            'Health Elixir', 'Mana Elixir', 'Spirit Elixir',
            'Health Draught', 'Mana Draught', 'Spirit Draught', 'Last Elixir'],
  SCROLLS: ['Scroll of the Gods', 'Scroll of the Avatar', 'Scroll of Protection',
            'Scroll of Swiftness', 'Scroll of Life', 'Scroll of Shadows', 'Scroll of Absorption'],
  GEMS: ['Health Gem', 'Mana Gem', 'Spirit Gem', 'Mystic Gem'],
  OTHERS: ['Flower Vase', 'Bubble-Gum',
           'Infusion of Flames', 'Infusion of Frost', 'Infusion of Lightning',
           'Infusion of Storms', 'Infusion of Divinity', 'Infusion of Darkness']
};

// 可释放目录（技能/物品）
const CAST_SUPPORT = {
  Pr: { id: '411', img: 'protection' },
  SL: { id: '422', img: 'sparklife' },
  SS: { id: '423', img: 'spiritshield' },
  Ha: { id: '412', img: 'haste' },
  AF: { id: '432', img: 'arcanemeditation' },
  He: { id: '431', img: 'heartseeker' },
  Re: { id: '312', img: 'regen' },
  SV: { id: '413', img: 'shadowveil' },
  Ab: { id: '421', img: 'absorb' }
};

const CAST_BUFF_ITEMS = {
  HD: { id: 11191, img: 'healthpot' },
  MD: { id: 11291, img: 'manapot' },
  SD: { id: 11391, img: 'spiritpot' },
  FV: { id: 19111, img: 'flowers' },
  BG: { id: 19131, img: 'gum' }
};

const CAST_ITEMS = {
  Cure: { id: 311 },
  FC: { id: 313 },
  HP: { id: 11195 },
  HE: { id: 11199 },
  MP: { id: 11295 },
  ME: { id: 11299 },
  SP: { id: 11395 },
  SE: { id: 11399 },
  LE: { id: 11501 },
  ED: { id: 11401 }
};

const CAST_SCROLLS = {
  Go: { id: 13299, buffImgs: ['shadowveil'] },
  Av: { id: 13199, buffImgs: ['haste', 'protection'] },
  Pr: { id: 13111, buffImgs: ['protection'] },
  Sw: { id: 13101, buffImgs: ['haste'] },
  Li: { id: 13221, buffImgs: ['sparklife'] },
  Sh: { id: 13211, buffImgs: ['shadowveil'] },
  Ab: { id: 13201, buffImgs: ['absorb'] }
};

const CAST_INFUSIONS = [null, {
  id: 12101,img: 'fireinfusion'
}, {
  id: 12201,img: 'coldinfusion'
}, {
  id: 12301,img: 'elecinfusion'
}, {
  id: 12401,img: 'windinfusion'
}, {
  id: 12501,img: 'holyinfusion'
}, {
  id: 12601,img: 'darkinfusion'
}];

const TARGET_MODES = {
  CURRENT: 0,
  AOE_T1: 1
};

const SPECIAL_SKILLS = {
  OFC: { id: '1111', oc: 8 },
  FRD: { id: '1101', oc: 4 },
  Cor: { attackStatusOption: 'skillCorType', defaultAttackStatus: 6, tierOption: 'skillCorTier', oc: 0 },
  Smi: { attackStatusOption: 'skillSmiType', defaultAttackStatus: 5, tierOption: 'skillSmiTier', oc: 0 },
  FBl: { attackStatusOption: 'skillFBlType', defaultAttackStatus: 1, tierOption: 'skillFBlTier', oc: 0 },
  T3: { idSuffix: '03', oc: 2 },
  T2: { idSuffix: '02', oc: 2 },
  T1: { idSuffix: '01', oc: 2 }
};

const SPECIAL_SKILL_TARGET_MODES = {
  1: { T1: TARGET_MODES.AOE_T1 },
  2: { T1: TARGET_MODES.CURRENT, T2: TARGET_MODES.CURRENT, T3: TARGET_MODES.CURRENT },
  3: { T1: TARGET_MODES.CURRENT, T2: TARGET_MODES.AOE_T1, T3: TARGET_MODES.AOE_T1 },
  4: { T1: TARGET_MODES.CURRENT, T2: TARGET_MODES.CURRENT, T3: TARGET_MODES.AOE_T1 }
};

// 可释放Debuff目录
const DEBUFF_CAST = {
  Sle: { id: '222', img: 'sleep', conflicts: ['wpn_bleed'] },
  Bl: { id: '231', img: 'blind', conflicts: [] },
  Slo: { id: '221', img: 'slow', conflicts: [] },
  Im: { id: '213', img: 'imperil', conflicts: [] },
  MN: { id: '233', img: 'magnet', conflicts: ['sleep'] },
  Si: { id: '232', img: 'silence', conflicts: ['sleep'] },
  Dr: { id: '211', img: 'drain', conflicts: [] },
  We: { id: '212', img: 'weaken', conflicts: ['sleep'] },
  Co: { id: '223', img: 'confusion', conflicts: [] }
};

const BOSS_MONSTER_IDS = new Set([
  16, 17, 18, 19, 20, 21, 22, 23,
  24, 27, 28, 29, 30, 31, 32,
  8223, 8224, 8225, 154404, 201330,
  261394, 261395, 261396, 261397, 261398,
  261399, 261400, 261793, 262405, 262406,
  262407, 262408, 262409, 262410
]);

// 状态识别目录
const DEBUFF_STATUS = {
  Sle: { img: 'sleep' },
  Bl: { img: 'blind' },
  Slo: { img: 'slow' },
  Im: { img: 'imperil' },
  MN: { img: 'magnet' },
  Si: { img: 'silence' },
  Dr: { img: 'drain' },
  We: { img: 'weaken' },
  Co: { img: 'confusion' },
  CM: { img: 'coalescedmana' },
  Stun: { img: 'wpn_stun' },
  PA: { img: 'wpn_ap' },
  BW: { img: 'wpn_bleed' }
};

// ==================== 数据工具系统 ====================
//物品统计工具
const ItemStatsUtil = {
  _cache: new WeakMap(),

  getUsageData(combatData, type = 'items') {
    let typeCache = this._cache.get(combatData);
    if (!typeCache) {
      typeCache = {};
      this._cache.set(combatData, typeCache);
    }

    if (typeCache[type]) {
      return typeCache[type];
    }

    const data = type === 'magic'
      ? (combatData.magic || {})
      : (combatData.items || {});

    typeCache[type] = data;
    return data;
  },

  countItems(combatData, itemList, type = 'items') {
    const usageData = this.getUsageData(combatData, type);
    let count = 0;
    for (let i = 0; i < itemList.length; i++) {
      count += usageData[itemList[i]] || 0;
    }
    return count;
  },

  getItemDetails(combatData, itemList, type = 'items', nameTransformer = null) {
    const usageData = this.getUsageData(combatData, type);
    const details = [];
    for (let i = 0; i < itemList.length; i++) {
      const item = itemList[i];
      const count = usageData[item];
      if (count > 0) {
        const displayName = nameTransformer ? nameTransformer(item) : item;
        details.push(`${displayName}: ${count}`);
      }
    }
    return details;
  }
};


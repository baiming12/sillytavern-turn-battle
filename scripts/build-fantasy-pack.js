import { writeFile } from 'node:fs/promises';
import { PACK_SCHEMA, REQUEST_SCHEMA, CORE_PACK, collectDefinitions, validatePack, validateBattleRequest } from '../content.js';

const packId = 'fantasy-basic';
const id = name => `${packId}:${name}`;
const T = (side = 'enemy', row = 'front', count = 'single', guard = true) => ({ side, row, count, guard });
const D = (damageType, power, scale = 1) => ({ kind: 'damage', damageType, power, scale });
const S = (name, chance = 100) => ({ kind: 'status', statusId: id(name), chance });
const R = (resource, amount) => ({ kind: 'resource', resource, amount });
const Q = (name, chance = 100) => ({ kind: 'removeStatus', statusId: id(name), chance });
const free = part => ({ kind: 'freePart', part });
const held = (...tags) => ({ kind: 'equippedAnyTag', tags });
const selfLacks = name => ({ kind: 'selfNotStatus', statusId: id(name) });
const targetHas = name => ({ kind: 'targetStatus', statusId: id(name) });
const targetLacks = name => ({ kind: 'targetNotStatus', statusId: id(name) });
const blade = [free('hands'), held('sword', 'axe', 'mace', 'blessed-blade')];
const bow = [free('hands'), held('bow', 'crossbow')];
const knife = [free('hands'), held('dagger', 'shortsword')];
const agileWeapon = [free('hands'), held('bow', 'crossbow', 'dagger', 'shortsword')];
const focus = [free('mouth'), held('staff', 'spellbook', 'holy-symbol', 'blessed-blade')];
const arcane = [free('mouth'), held('staff', 'spellbook')];
const divine = [free('mouth'), held('staff', 'holy-symbol', 'blessed-blade')];
const skill = (key, name, description, pool, tags, cost, target, requirements, effects) => ({
    id: id(key), name, description, pool, tags, cost, target, requirements, effects,
});
const status = (key, name, description, tags, duration, extra = {}) => ({
    id: id(`status/${key}`), name, description, tags, duration, maxStacks: 1, ...extra,
});

const statuses = [
    status('armor-broken', '破甲', '护甲出现破绽，物理防护下降。', ['debuff'], 2, { stats: { pdef: -3 } }),
    status('guarded', '守势', '稳住架势，减轻正面冲击。', ['buff'], 2, { stats: { pdef: 3, mdef: 1 } }),
    status('battle-cry', '战意', '受到战吼鼓舞，出手更有力。', ['buff'], 2, { stats: { patk: 2 } }),
    status('precision', '瞄准', '屏息瞄准，攻击更容易命中。', ['buff'], 2, { accuracyMod: 18 }),
    status('rooted', '缚足', '脚步被牵制，难以移动或突入。', ['debuff'], 2, { blockedTags: ['move'] }),
    status('chilled', '寒意', '寒气侵入四肢，出手变得迟缓。', ['debuff'], 2, { accuracyMod: -12, stats: { patk: -1 } }),
    status('arcane-ward', '奥术护盾', '流动的法术屏障抵御魔法冲击。', ['buff'], 2, { stats: { mdef: 4 } }),
    status('haste', '迅捷', '法术加速动作，下次己方阶段可额外行动一次。', ['buff'], 2, { bonusAp: 1 }),
    status('blessed', '祝福', '圣光鼓舞身心，攻击与防护略有提升。', ['buff'], 2, { stats: { patk: 1, matk: 1, pdef: 1, mdef: 1 } }),
    status('holy-ward', '圣佑', '温暖的圣光环绕，减轻物理与魔法伤害。', ['buff'], 2, { stats: { pdef: 2, mdef: 3 } }),
    status('silenced', '沉默', '喉间的咒语无法成形。', ['debuff'], 2, { blockedTags: ['chant'] }),
    status('weakened', '虚弱', '力量被削弱，攻击威力下降。', ['debuff'], 2, { stats: { patk: -2, matk: -2 } }),
    status('rage', '狂怒', '怒意推动攻击，也使防守露出破绽。', ['buff'], 2, { stats: { patk: 4, pdef: -2 } }),
    status('smoke-veil', '烟幕掩护', '身形藏在烟幕中，更难被击中。', ['buff'], 2, { stats: { evasion: 18 } }),
    status('exposed', '露出破绽', '防守失衡，物理与魔法防护下降。', ['debuff'], 2, { stats: { pdef: -2, mdef: -2 } }),
    status('poisoned', '中毒', '毒性令四肢疲软，攻击能力下降。', ['debuff'], 2, { stats: { patk: -2, matk: -1 } }),
    status('monster-fury', '凶性', '野性被激发，攻击变得猛烈。', ['buff'], 2, { stats: { patk: 2 } }),
    status('warrior-passive', '坚韧', '长期战斗训练带来更稳固的防守。', ['passive'], null, { stats: { pdef: 2 } }),
    status('warrior-training', '兵器训练', '熟练掌握兵器的发力与落点。', ['passive'], null, { accuracyMod: 5 }),
    status('archer-passive', '鹰眼', '长年的瞄准训练提升了命中。', ['passive'], null, { accuracyMod: 8 }),
    status('archer-footwork', '轻足', '善于变换站位，较难被攻击命中。', ['passive'], null, { stats: { evasion: 6 } }),
    status('mage-passive', '奥术亲和', '施法时更容易汇聚奥术力量。', ['passive'], null, { stats: { matk: 2 } }),
    status('mage-discipline', '法术纪律', '严谨的法术训练强化精神防护。', ['passive'], null, { stats: { mdef: 1 } }),
    status('berserker-passive', '狂性', '攻击更凶猛，防护略有减弱。', ['passive'], null, { stats: { patk: 2, pdef: -1 } }),
    status('berserker-instinct', '战斗本能', '混战中依然能抓住敌人的位置。', ['passive'], null, { accuracyMod: 5 }),
    status('priest-passive', '虔诚', '坚定的信念使精神防护更加稳固。', ['passive'], null, { stats: { mdef: 2 } }),
    status('priest-liturgy', '圣言研习', '熟悉圣言的节奏与施法落点。', ['passive'], null, { accuracyMod: 5 }),
    status('paladin-passive', '守护者', '守护誓言强化了自身防护。', ['passive'], null, { stats: { pdef: 1, mdef: 1 } }),
    status('paladin-discipline', '誓约训练', '持剑与祈祷时动作更加稳定。', ['passive'], null, { accuracyMod: 5 }),
    status('assassin-passive', '夜行', '习惯隐匿行动，更难被敌人瞄准。', ['passive'], null, { stats: { evasion: 8 } }),
    status('assassin-reflex', '敏锐反应', '细小破绽也难以逃过双眼。', ['passive'], null, { accuracyMod: 5 }),
];

const skills = [
    // 武器提供的普通攻击。
    skill('weapon/sword-slash', '长剑斩击', '以长剑向前挥出一击。', 'weapon', ['physical', 'hand', 'melee'], {}, T('enemy', 'any'), [free('hands'), held('sword')], [D('physical', 3)]),
    skill('weapon/axe-swing', '战斧劈砍', '抡起战斧向目标劈落。', 'weapon', ['physical', 'hand', 'melee'], {}, T('enemy', 'any'), [free('hands'), held('axe')], [D('physical', 4)]),
    skill('weapon/mace-hit', '钉锤打击', '挥动钉锤重击目标。', 'weapon', ['physical', 'hand', 'melee'], {}, T('enemy', 'any'), [free('hands'), held('mace')], [D('physical', 3)]),
    skill('weapon/bow-shot', '短弓射击', '搭箭射向可见的敌人。', 'weapon', ['physical', 'hand', 'ranged'], {}, T('enemy', 'any'), bow, [D('physical', 3)]),
    skill('weapon/dagger-stab', '匕首刺击', '贴近目标迅速刺出匕首。', 'weapon', ['physical', 'hand', 'melee'], {}, T('enemy', 'any'), knife, [D('physical', 2)]),
    skill('weapon/staff-hit', '法杖敲击', '以法杖近身敲击。', 'weapon', ['physical', 'hand', 'melee'], {}, T('enemy', 'any'), [free('hands'), held('staff')], [D('physical', 2, 0.6)]),
    skill('weapon/symbol-hit', '圣徽拍击', '以手持圣徽近身击打。', 'weapon', ['physical', 'hand', 'melee'], {}, T('enemy', 'any'), [free('hands'), held('holy-symbol')], [D('physical', 1, 0.6)]),

    // 战士、狂战士、圣骑士共用武技。
    skill('martial/power-strike', '强力打击', '蓄力后挥出沉重的一击。', 'martial', ['physical', 'hand', 'melee'], { sp: 2 }, T(), blade, [D('physical', 5, 1.2)]),
    skill('martial/cleave', '横扫', '横向挥动武器，攻击敌方前排。', 'martial', ['physical', 'hand', 'melee'], { sp: 4 }, T('enemy', 'front', 'all'), blade, [D('physical', 2, 0.75)]),
    skill('martial/armor-break', '破甲斩', '瞄准护甲接缝，留下明显破绽。', 'martial', ['physical', 'hand', 'melee'], { sp: 4 }, T(), blade, [D('physical', 3, 0.8), S('status/armor-broken', 75)]),
    skill('martial/disarm', '缴械打击', '击向握持武器的手，试图使武器脱落。', 'martial', ['physical', 'hand', 'melee'], { sp: 4 }, T(), [...blade, { kind: 'targetEquipped', slot: 'weapon' }], [D('physical', 2, 0.7), { kind: 'disarm', chance: 45 }]),
    skill('martial/guard', '防御架势', '稳住身形，准备承受下一轮攻势。', 'martial', ['physical', 'hand'], { sp: 3 }, T('self', 'any', 'single', false), [selfLacks('status/guarded')], [S('status/guarded')]),
    skill('martial/battle-cry', '战吼', '高声鼓舞同伴，提升整队战意。', 'martial', ['physical', 'mouth'], { sp: 4 }, T('ally', 'any', 'all', false), [free('mouth'), targetLacks('status/battle-cry')], [S('status/battle-cry')]),
    skill('martial/finish', '破绽追击', '抓住敌人护甲破绽补上重击。', 'martial', ['physical', 'hand', 'melee'], { sp: 5 }, T(), [...blade, targetHas('status/armor-broken')], [D('physical', 7, 1.35)]),
    skill('martial/recover', '调息', '稳住呼吸，恢复少量精力。', 'martial', ['physical'], {}, T('self', 'any', 'single', false), [], [R('sp', 6)]),

    // 射手与刺客可学习的敏捷技巧。
    skill('agile/quick-attack', '迅捷一击', '抓住空隙迅速出手。', 'agile', ['physical', 'hand'], { sp: 2 }, T('enemy', 'front'), agileWeapon, [D('physical', 2, 0.9)]),
    skill('agile/disorient', '扰乱', '虚晃一击，使目标露出破绽。', 'agile', ['physical', 'hand'], { sp: 3 }, T('enemy', 'front'), agileWeapon, [S('status/exposed', 70)]),
    skill('agile/hamstring', '阻行打击', '攻击目标腿部，试图限制移动。', 'agile', ['physical', 'hand'], { sp: 4 }, T('enemy', 'front'), agileWeapon, [D('physical', 2, 0.7), S('status/rooted', 55)]),
    skill('agile/recover', '调整呼吸', '暂缓出手，恢复少量精力。', 'agile', ['physical'], {}, T('self', 'any', 'single', false), [], [R('sp', 5)]),
    skill('agile/decisive-attack', '破绽一击', '精准攻击已经失去平衡的目标。', 'agile', ['physical', 'hand'], { sp: 4 }, T('enemy', 'front'), [...agileWeapon, targetHas('status/exposed')], [D('physical', 5, 1.1)]),

    // 通用法术池；职业模板只列出当前已学的法术。
    skill('spell/magic-bolt', '魔力弹', '聚成一束魔力，越过遮挡击中敌人。', 'spell-common', ['magic', 'mouth', 'chant'], { mp: 2 }, T('enemy', 'any', 'single', false), focus, [D('magic', 3, 0.8)]),
    skill('spell/ward', '防护结界', '在同伴身上覆上一层微光屏障。', 'spell-common', ['magic', 'mouth', 'chant'], { mp: 4 }, T('ally', 'any', 'single', false), [...focus, targetLacks('status/arcane-ward')], [S('status/arcane-ward')]),
    skill('spell/haste', '迅捷术', '加快同伴动作，使其下一阶段多行动一次。', 'spell-common', ['magic', 'mouth', 'chant'], { mp: 7 }, T('ally', 'any', 'single', false), [...focus, targetLacks('status/haste')], [S('status/haste')]),
    skill('spell/bind', '束缚术', '魔力缠住目标双脚，限制移动。', 'spell-common', ['magic', 'mouth', 'chant'], { mp: 5 }, T('enemy', 'any', 'single', false), focus, [S('status/rooted', 70)]),
    skill('spell/mana-recover', '魔力回涌', '稍作凝神，重新汇聚法力。', 'spell-common', ['magic', 'mouth', 'chant'], {}, T('self', 'any', 'single', false), [free('mouth')], [R('mp', 5)]),
    skill('spell/fireball', '火球术', '咏唱凝聚火球，飞向指定目标。', 'spell-arcane', ['magic', 'mouth', 'chant'], { mp: 5 }, T('enemy', 'any', 'single', false), arcane, [D('magic', 6)]),
    skill('spell/fire-rain', '火雨术', '召来火雨，覆盖敌方前后排。', 'spell-arcane', ['magic', 'mouth', 'chant'], { mp: 10 }, T('enemy', 'any', 'all', false), arcane, [D('magic', 4, 0.8)]),
    skill('spell/ice-lance', '冰枪术', '锐利寒冰穿向目标，并留下寒意。', 'spell-arcane', ['magic', 'mouth', 'chant'], { mp: 5 }, T('enemy', 'any', 'single', false), arcane, [D('magic', 4), S('status/chilled', 70)]),
    skill('spell/frost-wave', '寒潮', '寒气席卷敌阵，令动作变得迟缓。', 'spell-arcane', ['magic', 'mouth', 'chant'], { mp: 8 }, T('enemy', 'any', 'all', false), arcane, [D('magic', 2, 0.65), S('status/chilled', 60)]),
    skill('spell/lightning', '雷击术', '一道雷光直击指定目标。', 'spell-arcane', ['magic', 'mouth', 'chant'], { mp: 7 }, T('enemy', 'any', 'single', false), arcane, [D('magic', 8, 1.1)]),
    skill('spell/thunderstorm', '雷暴', '多道雷光在敌阵中同时落下。', 'spell-arcane', ['magic', 'mouth', 'chant'], { mp: 12 }, T('enemy', 'any', 'all', false), arcane, [D('magic', 5)]),
    skill('spell/arcane-shield', '奥术护甲', '为自己织出抵挡魔法的护盾。', 'spell-arcane', ['magic', 'mouth', 'chant'], { mp: 4 }, T('self', 'any', 'single', false), [...arcane, selfLacks('status/arcane-ward')], [S('status/arcane-ward')]),
    skill('spell/holy-bolt', '圣光弹', '聚集圣光射向指定敌人。', 'spell-divine', ['magic', 'mouth', 'chant'], { mp: 4 }, T('enemy', 'any', 'single', false), divine, [D('magic', 5)]),
    skill('spell/heal', '治疗术', '以温暖圣光治疗一名同伴。', 'spell-divine', ['magic', 'mouth', 'chant'], { mp: 5 }, T('ally', 'any', 'single', false), divine, [R('hp', 15)]),
    skill('spell/group-heal', '群体治疗', '圣光同时照向全队，缓解伤势。', 'spell-divine', ['magic', 'mouth', 'chant'], { mp: 9 }, T('ally', 'any', 'all', false), divine, [R('hp', 9)]),
    skill('spell/bless', '祝福术', '为全队送上短暂的战斗祝福。', 'spell-divine', ['magic', 'mouth', 'chant'], { mp: 7 }, T('ally', 'any', 'all', false), [...divine, targetLacks('status/blessed')], [S('status/blessed')]),
    skill('spell/sanctuary', '圣佑术', '圣光保护一名同伴。', 'spell-divine', ['magic', 'mouth', 'chant'], { mp: 5 }, T('ally', 'any', 'single', false), [...divine, targetLacks('status/holy-ward')], [S('status/holy-ward')]),
    skill('spell/purify', '净化祷言', '驱散常见的寒意、束足、沉默和毒性。', 'spell-divine', ['magic', 'mouth', 'chant'], { mp: 6 }, T('ally', 'any', 'single', false), divine, [Q('status/chilled'), Q('status/rooted'), Q('status/silenced'), Q('status/poisoned'), Q('status/weakened')]),
    skill('spell/radiance', '光辉之环', '圣光环绕敌阵，压制黑暗气息。', 'spell-divine', ['magic', 'mouth', 'chant'], { mp: 10 }, T('enemy', 'any', 'all', false), divine, [D('magic', 4, 0.8), S('status/weakened', 45)]),

    // 各职业专属技能。
    skill('warrior/steel-strike', '钢铁重斩', '沉稳蓄力后斩向敌人。', 'warrior', ['physical', 'hand', 'melee'], { sp: 4 }, T(), blade, [D('physical', 7, 1.25)]),
    skill('warrior/shield-wall', '坚守阵线', '让同伴暂时保持严密防守。', 'warrior', ['physical', 'mouth'], { sp: 6 }, T('ally', 'any', 'all', false), [free('mouth'), targetLacks('status/guarded')], [S('status/guarded')]),
    skill('warrior/double-slash', '双重斩', '接连挥出两记较轻的斩击。', 'warrior', ['physical', 'hand', 'melee'], { sp: 5 }, T(), blade, [D('physical', 2, 0.65), D('physical', 2, 0.65)]),
    skill('warrior/press-attack', '压制打击', '迫使目标失去稳固架势。', 'warrior', ['physical', 'hand', 'melee'], { sp: 4 }, T(), blade, [D('physical', 3, 0.8), S('status/exposed', 75)]),
    skill('warrior/unyielding', '不屈之势', '重新收紧防线并恢复少量精力。', 'warrior', ['physical'], { sp: 2 }, T('self', 'any', 'single', false), [selfLacks('status/guarded')], [S('status/guarded'), R('sp', 5)]),
    skill('archer/aim', '凝神瞄准', '稳定呼吸，准备一记更准确的射击。', 'archer', ['physical', 'hand'], { sp: 2 }, T('self', 'any', 'single', false), [selfLacks('status/precision')], [S('status/precision')]),
    skill('archer/piercing-shot', '穿透箭', '抓住空隙，让箭矢越过前排。', 'archer', ['physical', 'hand', 'ranged'], { sp: 4 }, T('enemy', 'any', 'single', false), bow, [D('physical', 5, 1.1)]),
    skill('archer/double-shot', '连珠箭', '短时间内连续射出两箭。', 'archer', ['physical', 'hand', 'ranged'], { sp: 5 }, T('enemy', 'any'), bow, [D('physical', 2, 0.65), D('physical', 2, 0.65)]),
    skill('archer/arrow-rain', '箭雨', '箭矢从上方落向敌方全员。', 'archer', ['physical', 'hand', 'ranged'], { sp: 8 }, T('enemy', 'any', 'all', false), bow, [D('physical', 2, 0.7)]),
    skill('archer/pinning-arrow', '束足箭', '箭矢钉住目标衣物或脚边，限制移动。', 'archer', ['physical', 'hand', 'ranged'], { sp: 4 }, T('enemy', 'any'), bow, [D('physical', 3, 0.8), S('status/rooted', 65)]),
    skill('mage/arcane-focus', '奥术增幅', '集中精神，让法术威力暂时增强。', 'mage', ['magic', 'mouth', 'chant'], { mp: 5 }, T('self', 'any', 'single', false), [...arcane, selfLacks('status/arcane-focus')], [S('status/arcane-focus')]),
    skill('mage/mana-burst', '魔力爆发', '将积蓄的魔力向敌阵释放。', 'mage', ['magic', 'mouth', 'chant'], { mp: 9 }, T('enemy', 'any', 'all', false), arcane, [D('magic', 5, 0.9)]),
    skill('mage/silence', '静默咒', '暂时压住目标的咏唱之声。', 'mage', ['magic', 'mouth', 'chant'], { mp: 6 }, T('enemy', 'any', 'single', false), arcane, [S('status/silenced', 70)]),
    skill('mage/mana-drain', '法力抽离', '扰乱目标体内的法力流动。', 'mage', ['magic', 'mouth', 'chant'], { mp: 4 }, T('enemy', 'any', 'single', false), arcane, [D('magic', 2, 0.5), R('mp', -6)]),
    skill('mage/twin-bolt', '双生魔矢', '接连发出两道魔力飞矢。', 'mage', ['magic', 'mouth', 'chant'], { mp: 7 }, T('enemy', 'any', 'single', false), arcane, [D('magic', 2, 0.7), D('magic', 2, 0.7)]),
    skill('berserker/rage', '狂怒', '放弃一部分防守，换取更猛烈的攻击。', 'berserker', ['physical', 'mouth'], { sp: 4 }, T('self', 'any', 'single', false), [free('mouth'), selfLacks('status/rage')], [S('status/rage')]),
    skill('berserker/whirlwind', '旋风斩', '抡起武器攻击敌方前排全员。', 'berserker', ['physical', 'hand', 'melee'], { sp: 7 }, T('enemy', 'front', 'all'), blade, [D('physical', 4, 0.95)]),
    skill('berserker/bone-breaker', '碎骨重击', '猛力击打目标，使其防御松动。', 'berserker', ['physical', 'hand', 'melee'], { sp: 5 }, T(), blade, [D('physical', 6, 1.1), S('status/armor-broken', 70)]),
    skill('berserker/frenzied-assault', '狂乱连斩', '在狂怒中连续攻击同一目标。', 'berserker', ['physical', 'hand', 'melee'], { sp: 6 }, T(), [...blade, { kind: 'selfStatus', statusId: id('status/rage') }], [D('physical', 3, 0.8), D('physical', 3, 0.8)]),
    skill('berserker/surge', '暴烈冲势', '催动战意，争取再行动一次。', 'berserker', ['physical', 'mouth'], { sp: 6 }, T('self', 'any', 'single', false), [free('mouth'), { kind: 'selfStatus', statusId: id('status/rage') }], [{ kind: 'actionPoints', amount: 1 }]),
    skill('priest/healing-prayer', '疗愈祷词', '以祷词治疗一名伤势较重的同伴。', 'priest', ['magic', 'mouth', 'chant'], { mp: 8 }, T('ally', 'any', 'single', false), divine, [R('hp', 24)]),
    skill('priest/group-prayer', '群体祈祷', '祈祷为全队降下祝福与少量治疗。', 'priest', ['magic', 'mouth', 'chant'], { mp: 11 }, T('ally', 'any', 'all', false), divine, [R('hp', 6), S('status/blessed')]),
    skill('priest/holy-word', '圣言', '以坚定圣言削弱敌人的攻击意志。', 'priest', ['magic', 'mouth', 'chant'], { mp: 6 }, T('enemy', 'any', 'single', false), divine, [D('magic', 3, 0.7), S('status/weakened', 70)]),
    skill('priest/mercy-ward', '慈悲庇护', '为一名同伴加上圣佑并恢复少量生命。', 'priest', ['magic', 'mouth', 'chant'], { mp: 8 }, T('ally', 'any', 'single', false), divine, [R('hp', 6), S('status/holy-ward')]),
    skill('priest/clarity', '澄明祷告', '驱散同伴身上的沉默与虚弱。', 'priest', ['magic', 'mouth', 'chant'], { mp: 4 }, T('ally', 'any', 'single', false), divine, [Q('status/silenced'), Q('status/weakened')]),
    skill('paladin/holy-smite', '圣光斩', '利刃与圣光一同击中眼前的敌人。', 'paladin', ['physical', 'hand', 'melee'], { sp: 3, mp: 3 }, T(), [free('hands'), held('blessed-blade')], [D('physical', 4, 0.85), D('magic', 2, 0.55)]),
    skill('paladin/guard-oath', '守护誓言', '立下守护誓言，圣光庇护一名同伴。', 'paladin', ['magic', 'mouth', 'chant'], { mp: 5 }, T('ally', 'any', 'single', false), [...divine, targetLacks('status/holy-ward')], [S('status/holy-ward')]),
    skill('paladin/lay-on-hands', '圣疗之手', '触碰同伴，将圣光注入伤处。', 'paladin', ['magic', 'hand'], { mp: 7 }, T('ally', 'any', 'single', false), [free('hands')], [R('hp', 19)]),
    skill('paladin/judgment', '裁决之刃', '抓住护甲破绽，以圣力重击敌人。', 'paladin', ['physical', 'hand', 'melee'], { sp: 4, mp: 4 }, T(), [...blade, targetHas('status/armor-broken')], [D('physical', 6, 1.1), D('magic', 3, 0.6)]),
    skill('paladin/radiant-sweep', '辉光横斩', '带着圣光横扫敌方前排。', 'paladin', ['physical', 'hand', 'melee'], { sp: 5, mp: 4 }, T('enemy', 'front', 'all'), [free('hands'), held('blessed-blade')], [D('physical', 3, 0.75), D('magic', 1, 0.4)]),
    skill('assassin/gale-thrust', '疾风刺', '借敌方前排空位突入，刺向目标。', 'assassin', ['physical', 'hand', 'move', 'melee'], { sp: 5 }, T('enemy', 'any', 'single', false), [...knife, free('feet'), { kind: 'enemyFrontEmpty' }], [{ kind: 'infiltrate', returnAt: 'phaseEnd' }, D('physical', 4, 1)]),
    skill('assassin/feint', '佯攻', '诱使目标误判攻势，露出防守空隙。', 'assassin', ['physical', 'hand', 'melee'], { sp: 3 }, T(), knife, [D('physical', 2, 0.6), S('status/exposed', 80)]),
    skill('assassin/sneak-strike', '破绽背刺', '抓住已暴露的破绽刺向要害。', 'assassin', ['physical', 'hand', 'melee'], { sp: 5 }, T('enemy', 'any', 'single', false), [...knife, targetHas('status/exposed')], [D('physical', 8, 1.35)]),
    skill('assassin/smoke', '烟幕', '撒出烟雾，遮掩自己的行动。', 'assassin', ['physical', 'hand'], { sp: 3 }, T('self', 'any', 'single', false), [free('hands'), selfLacks('status/smoke-veil')], [S('status/smoke-veil')]),
    skill('assassin/throat-cut', '封喉刺', '精准刺向发声要处，干扰施法。', 'assassin', ['physical', 'hand', 'melee'], { sp: 5 }, T(), knife, [D('physical', 4, 1), S('status/silenced', 65)]),
    skill('assassin/poison-blade', '毒刃', '匕首上的毒性令目标四肢无力。', 'assassin', ['physical', 'hand', 'melee'], { sp: 4 }, T(), knife, [D('physical', 3, 0.8), S('status/poisoned', 70)]),

    // 怪物通用技能；模板和 AI 策略只选择其中一部分。
    skill('monster/claw', '爪击', '以利爪向前扑抓。', 'monster', ['physical', 'hand', 'melee'], {}, T(), [], [D('physical', 3)]),
    skill('monster/bite', '撕咬', '咬住目标，令其动作变得虚弱。', 'monster', ['physical', 'melee'], { sp: 2 }, T(), [], [D('physical', 4), S('status/weakened', 40)]),
    skill('monster/heavy-blow', '蛮力重击', '以沉重力量击向面前的敌人。', 'monster', ['physical', 'melee'], { sp: 3 }, T(), [], [D('physical', 6, 1.2)]),
    skill('monster/sweep', '巨力横扫', '横扫敌方前排全员。', 'monster', ['physical', 'melee'], { sp: 5 }, T('enemy', 'front', 'all'), [], [D('physical', 3, 0.8)]),
    skill('monster/rock', '投石', '抓起石块投向可见目标。', 'monster', ['physical', 'ranged'], {}, T('enemy', 'any'), [], [D('physical', 3, 0.8)]),
    skill('monster/net', '撒网', '试图用绳网限制目标脚步。', 'monster', ['physical', 'ranged'], { sp: 3 }, T('enemy', 'front'), [targetLacks('status/rooted')], [S('status/rooted', 65)]),
    skill('monster/dark-bolt', '暗影弹', '放出一道阴冷的魔法飞弹。', 'monster', ['magic', 'mouth', 'chant'], { mp: 3 }, T('enemy', 'any', 'single', false), [free('mouth')], [D('magic', 4)]),
    skill('monster/curse', '衰弱诅咒', '以低语削弱目标的攻击能力。', 'monster', ['magic', 'mouth', 'chant'], { mp: 4 }, T('enemy', 'any', 'single', false), [free('mouth'), targetLacks('status/weakened')], [S('status/weakened', 75)]),
    skill('monster/howl', '凶性咆哮', '以咆哮激起同伴的凶性。', 'monster', ['physical', 'mouth'], { sp: 3 }, T('ally', 'any', 'all', false), [free('mouth'), selfLacks('status/monster-fury')], [S('status/monster-fury')]),
    skill('monster/acid-spit', '酸液喷吐', '酸液飞向指定目标，侵蚀防护。', 'monster', ['magic', 'ranged'], { mp: 4 }, T('enemy', 'any', 'single', false), [], [D('magic', 3, 0.7), S('status/armor-broken', 60)]),
    skill('monster/flame-breath', '烈焰吐息', '火焰覆盖敌方前后排。', 'monster', ['magic', 'ranged'], { mp: 8 }, T('enemy', 'any', 'all', false), [], [D('magic', 5, 0.8)]),
    skill('monster/shadow-veil', '暗影遮蔽', '阴影遮掩身形，使敌人难以瞄准。', 'monster', ['magic'], { mp: 4 }, T('self', 'any', 'single', false), [selfLacks('status/smoke-veil')], [S('status/smoke-veil')]),
];

statuses.push(status('arcane-focus', '奥术增幅', '奥术力量暂时聚集，魔法攻击提高。', ['buff'], 2, { stats: { matk: 3 } }));

const equipment = [
    { id: id('gear/sword'), name: '制式长剑', description: '结实可靠的钢制长剑。', slot: 'weapon', tags: ['sword'], stats: { patk: 2 }, skills: [id('weapon/sword-slash')] },
    { id: id('gear/axe'), name: '双刃战斧', description: '斧刃宽重，适合猛烈劈砍。', slot: 'weapon', tags: ['axe'], stats: { patk: 3, pdef: -1 }, skills: [id('weapon/axe-swing')] },
    { id: id('gear/mace'), name: '钉锤', description: '沉重的锤头适合击碎护甲。', slot: 'weapon', tags: ['mace'], stats: { patk: 2 }, skills: [id('weapon/mace-hit')] },
    { id: id('gear/bow'), name: '猎弓', description: '一把适于远距离射击的长弓。', slot: 'weapon', tags: ['bow'], stats: { patk: 2 }, skills: [id('weapon/bow-shot')] },
    { id: id('gear/dagger'), name: '锋利匕首', description: '窄刃匕首，便于近身突刺。', slot: 'weapon', tags: ['dagger'], stats: { patk: 1, accuracy: 5 }, skills: [id('weapon/dagger-stab')] },
    { id: id('gear/staff'), name: '奥术法杖', description: '法杖上的纹路在施法时微亮。', slot: 'weapon', tags: ['staff'], stats: { matk: 2 }, skills: [id('weapon/staff-hit')] },
    { id: id('gear/holy-symbol'), name: '持握圣徽', description: '掌心大小的圣徽，能够引导祈祷。', slot: 'weapon', tags: ['holy-symbol'], stats: { matk: 2, mdef: 1 }, skills: [id('weapon/symbol-hit')] },
    { id: id('gear/blessed-sword'), name: '祝圣长剑', description: '剑身刻有守护誓文。', slot: 'weapon', tags: ['sword', 'blessed-blade'], stats: { patk: 2, matk: 1 }, skills: [id('weapon/sword-slash')] },
    { id: id('gear/chainmail'), name: '锁子甲', description: '细密的金属环保护躯干。', slot: 'outer', stats: { pdef: 3 } },
    { id: id('gear/leather'), name: '皮甲', description: '轻便耐磨，适合快速行动。', slot: 'outer', stats: { pdef: 1 } },
    { id: id('gear/robe'), name: '法袍', description: '绣有简洁符文的长袍。', slot: 'outer', stats: { mdef: 2 } },
];

const items = [
    { id: id('item/heal-potion'), name: '治疗药剂', description: '喝下后缓解伤势。', target: T('ally', 'any', 'single', false), requirements: [free('hands')], effects: [R('hp', 15)] },
    { id: id('item/mana-potion'), name: '法力药剂', description: '喝下后恢复少量法力。', target: T('ally', 'any', 'single', false), requirements: [free('hands')], effects: [R('mp', 10)] },
];

const resources = (hp, sp, mp) => ({ hp: { current: hp, max: hp }, sp: { current: sp, max: sp }, mp: { current: mp, max: mp } });
const secondPassives = { 'warrior-passive': 'warrior-training', 'archer-passive': 'archer-footwork', 'mage-passive': 'mage-discipline', 'berserker-passive': 'berserker-instinct', 'priest-passive': 'priest-liturgy', 'paladin-passive': 'paladin-discipline', 'assassin-passive': 'assassin-reflex' };
const unit = (key, name, row, stats, hp, sp, mp, skillIds, weapon, outer, passive, extra = {}) => ({
    id: id(key), name, row, col: 1, stats, resources: resources(hp, sp, mp),
    skills: skillIds.map(id), equipment: { weapon: id(`gear/${weapon}`), outer: id(`gear/${outer}`) },
    accessories: [], restraints: [], statuses: passive ? [id(`status/${passive}`), id(`status/${secondPassives[passive]}`)] : [], ...extra,
});
const allies = [
    unit('ally/warrior', '见习战士', 'front', { patk: 9, matk: 0, pdef: 6, mdef: 3, accuracy: 5 }, 52, 28, 0, ['martial/power-strike', 'martial/armor-break', 'martial/guard', 'martial/finish', 'warrior/steel-strike', 'warrior/shield-wall'], 'sword', 'chainmail', 'warrior-passive'),
    unit('ally/archer', '见习射手', 'back', { patk: 10, matk: 0, pdef: 2, mdef: 2, accuracy: 6 }, 40, 30, 0, ['agile/disorient', 'archer/aim', 'archer/piercing-shot', 'archer/double-shot', 'archer/arrow-rain', 'archer/pinning-arrow'], 'bow', 'leather', 'archer-passive'),
    unit('ally/mage', '见习法师', 'back', { patk: 2, matk: 11, pdef: 1, mdef: 4 }, 34, 12, 36, ['spell/magic-bolt', 'spell/fireball', 'spell/fire-rain', 'spell/ice-lance', 'spell/ward', 'mage/arcane-focus'], 'staff', 'robe', 'mage-passive'),
    unit('ally/berserker', '见习狂战士', 'front', { patk: 11, matk: 0, pdef: 3, mdef: 2 }, 56, 30, 0, ['martial/power-strike', 'martial/cleave', 'martial/armor-break', 'berserker/rage', 'berserker/whirlwind', 'berserker/frenzied-assault'], 'axe', 'leather', 'berserker-passive'),
    unit('ally/priest', '见习牧师', 'back', { patk: 2, matk: 8, pdef: 2, mdef: 5 }, 42, 14, 32, ['spell/magic-bolt', 'spell/holy-bolt', 'spell/heal', 'spell/group-heal', 'spell/bless', 'spell/purify', 'priest/holy-word'], 'holy-symbol', 'robe', 'priest-passive'),
    unit('ally/paladin', '见习圣骑士', 'front', { patk: 8, matk: 6, pdef: 5, mdef: 4 }, 52, 23, 22, ['martial/power-strike', 'martial/guard', 'martial/armor-break', 'spell/holy-bolt', 'paladin/holy-smite', 'paladin/guard-oath'], 'blessed-sword', 'chainmail', 'paladin-passive'),
    unit('ally/assassin', '见习刺客', 'front', { patk: 9, matk: 0, pdef: 2, mdef: 2, accuracy: 7, evasion: 5 }, 38, 32, 0, ['agile/recover', 'assassin/gale-thrust', 'assassin/feint', 'assassin/sneak-strike', 'assassin/smoke', 'assassin/throat-cut', 'assassin/poison-blade'], 'dagger', 'leather', 'assassin-passive'),
];

const aiProfiles = [
    { id: id('ai/beast'), name: '野兽 AI', skillPriority: [id('monster/howl'), id('monster/bite'), id('monster/claw')], itemPriority: [], useItems: false },
    { id: id('ai/raider'), name: '劫掠者 AI', skillPriority: [id('monster/net'), id('monster/rock'), id('monster/heavy-blow')], itemPriority: [], useItems: false },
    { id: id('ai/cultist'), name: '邪教徒 AI', skillPriority: [id('monster/shadow-veil'), id('monster/curse'), id('monster/dark-bolt')], itemPriority: [], useItems: false },
    { id: id('ai/brute'), name: '巨怪 AI', skillPriority: [id('monster/sweep'), id('monster/heavy-blow')], itemPriority: [], useItems: false },
    { id: id('ai/drake'), name: '幼龙 AI', skillPriority: [id('monster/flame-breath'), id('monster/acid-spit'), id('monster/claw')], itemPriority: [], useItems: false },
];
const enemies = [
    unit('enemy/wolf', '荒原狼', 'front', { patk: 7, matk: 0, pdef: 2, mdef: 1 }, 29, 16, 0, ['monster/howl', 'monster/claw', 'monster/bite'], 'dagger', 'leather', null, { equipment: {}, aiProfile: id('ai/beast'), items: {} }),
    unit('enemy/goblin', '哥布林掠夺者', 'front', { patk: 7, matk: 0, pdef: 3, mdef: 1 }, 32, 18, 0, ['monster/net', 'monster/rock', 'monster/heavy-blow'], 'mace', 'leather', null, { aiProfile: id('ai/raider'), items: {} }),
    unit('enemy/cultist', '邪教徒', 'back', { patk: 2, matk: 8, pdef: 1, mdef: 3 }, 27, 10, 22, ['monster/curse', 'monster/dark-bolt', 'monster/shadow-veil'], 'staff', 'robe', null, { aiProfile: id('ai/cultist'), items: {} }),
    unit('enemy/ogre', '山地食人魔', 'front', { patk: 11, matk: 0, pdef: 5, mdef: 2 }, 70, 24, 0, ['monster/sweep', 'monster/heavy-blow', 'monster/rock'], 'mace', 'leather', null, { aiProfile: id('ai/brute'), items: {} }),
    unit('enemy/drake', '幼年火龙', 'front', { patk: 9, matk: 8, pdef: 5, mdef: 4 }, 66, 20, 20, ['monster/flame-breath', 'monster/acid-spit', 'monster/claw'], 'dagger', 'leather', null, { equipment: {}, aiProfile: id('ai/drake'), items: {} }),
];

const pack = {
    schema: PACK_SCHEMA, id: packId, name: '基础西幻职业与怪物技能包', version: '1.0.0',
    description: '七职业、通用武技与法术池、怪物通用技能。技能附有可结算的 Buff / Debuff。',
    skills, statuses, equipment, items, allies, enemies, aiProfiles,
};

const battleActor = (template, actorId, row = template.row, col = template.col) => ({ ...structuredClone(template), id: actorId, side: template.id.includes(':ally/') ? 'ally' : 'enemy', row, col });
const sample = {
    schema: REQUEST_SCHEMA, scene: '边境道路：战士、射手和牧师遭遇荒原狼、掠夺者与邪教徒',
    actors: [battleActor(allies[0], 'hero-warrior', 'front', 1), battleActor(allies[1], 'hero-archer', 'back', 1), battleActor(allies[4], 'hero-priest', 'back', 2), battleActor(enemies[0], 'foe-wolf', 'front', 1), battleActor(enemies[1], 'foe-goblin', 'front', 2), battleActor(enemies[2], 'foe-cultist', 'back', 1)],
    bag: { [id('item/heal-potion')]: 2, [id('item/mana-potion')]: 1 },
};
const packErrors = validatePack(pack, [CORE_PACK]);
const requestErrors = validateBattleRequest(sample, collectDefinitions([CORE_PACK, pack]), { allyFront: 2, allyBack: 2, enemyFront: 2, enemyBack: 2 });
if (packErrors.length || requestErrors.length) throw new Error([...packErrors, ...requestErrors].join('\n'));
await writeFile(new URL('../examples/基础西幻职业技能包.json', import.meta.url), `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
await writeFile(new URL('../examples/基础西幻开战快照.json', import.meta.url), `${JSON.stringify(sample, null, 2)}\n`, 'utf8');
const poolNames = { weapon: '武器普通攻击', martial: '战士／狂战士／圣骑士共用武技', agile: '射手／刺客共用技巧', 'spell-common': '通用法术', 'spell-arcane': '元素奥术', 'spell-divine': '神圣法术', warrior: '战士专属', archer: '射手专属', mage: '法师专属', berserker: '狂战士专属', priest: '牧师专属', paladin: '圣骑士专属', assassin: '刺客专属', monster: '怪物通用' };
const statusRules = value => [
    ...Object.entries(value.stats || {}).map(([key, amount]) => `${key}${amount >= 0 ? '+' : ''}${amount}`),
    ...(value.accuracyMod ? [`命中${value.accuracyMod >= 0 ? '+' : ''}${value.accuracyMod}`] : []),
    ...(value.bonusAp ? [`行动点+${value.bonusAp}`] : []),
    ...(value.blockedTags?.length ? [`封锁标签 ${value.blockedTags.join('、')}`] : []),
].join('，') || '无数值修正';
const guide = ['# 基础西幻职业技能目录', '', `内容包：\`${packId}\`，${skills.length} 个技能、${statuses.length} 个状态、${allies.length} 个我方职业模板、${enemies.length} 个怪物模板。`, '', '角色只会在战斗菜单里看到本次快照已经学会的技能和装备授予的普通攻击。剧情中新学的技能仍需把对应 ID 写入下一场快照。', ''];
for (const [pool, label] of Object.entries(poolNames)) {
    guide.push(`## ${label}`, '');
    for (const entry of skills.filter(value => value.pool === pool)) guide.push(`- **${entry.name}**（\`${entry.id}\`）：${entry.description}${entry.effects.filter(effect => effect.kind === 'status').map(effect => ` → ${statuses.find(value => value.id === effect.statusId)?.name || effect.statusId}${effect.chance < 100 ? `（基础成功率 ${effect.chance}%）` : ''}`).join('')}`);
    guide.push('');
}
guide.push('## Buff、Debuff 与被动', '');
for (const entry of statuses) {
    const sources = skills.filter(value => value.effects.some(effect => effect.kind === 'status' && effect.statusId === entry.id)).map(value => value.name);
    guide.push(`- **${entry.name}**（\`${entry.id}\`，${entry.duration === null ? '永久' : `${entry.duration} 阶段`}，${entry.tags.join('／')}）：${statusRules(entry)}。${sources.length ? `来源：${sources.join('、')}。` : entry.tags.includes('passive') ? '职业模板自带。' : ''}`);
}
guide.push('', '## 当前规则范围', '', '- 伤害按技能威力、物攻／魔攻倍率和目标防御确定，不使用骰子表达式；命中与状态施加使用明确的百分比。', '- Buff / Debuff 的属性变化、命中修正、技能封锁与额外行动点由插件计算。持续两阶段的状态通常覆盖目标下一次行动，随后到期。', '- 中毒当前降低攻击属性，不会每回合自动扣血。治疗为固定恢复量；自动触发、反击和通用标签净化尚未加入规则引擎。', '- 每名职业模板有两项永久被动状态，开战快照中的 `statuses` 负责携带。');
await writeFile(new URL('../examples/西幻技能目录.md', import.meta.url), `${guide.join('\n')}\n`, 'utf8');
console.log(`Generated ${skills.length} skills, ${statuses.length} statuses, ${allies.length} ally templates, ${enemies.length} enemy templates.`);

import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_PACK, collectDefinitions, validateBattleRequest, validatePack, parseBattleRequest } from '../content.js';
import { createBattle, availableSkills, legalTargets, executeAction, endAllyPhase, battleReport } from '../engine.js';
import { generateWriterWorldbook } from '../worldbook.js';

const limits = { allyFront: 2, allyBack: 2, enemyFront: 2, enemyBack: 2 };
const actor = (id, side, row, col, extra = {}) => ({
    id, name: id, side, row, col,
    stats: { patk: 10, matk: 10, pdef: 0, mdef: 0 },
    resources: { hp: { current: 30, max: 30 }, sp: { current: 20, max: 20 }, mp: { current: 20, max: 20 } },
    skills: [], equipment: {}, accessories: [], restraints: [], statuses: [], items: {}, ...extra,
});
const request = (...actors) => ({ schema: 'turn-battle-request/v1', scene: '测试', actors, bag: {} });

test('内容包、开战格式、世界书可校验', () => {
    assert.deepEqual(validatePack(CORE_PACK), []);
    const data = request(actor('a', 'ally', 'front', 1), actor('e', 'enemy', 'front', 1));
    assert.deepEqual(validateBattleRequest(data, collectDefinitions([CORE_PACK]), limits), []);
    assert.deepEqual(parseBattleRequest(`剧情停在这里\n<!-- TURN_BATTLE_REQUEST\n${JSON.stringify(data)}\n-->`).data, data);
    const book = generateWriterWorldbook();
    assert.ok(book.entries['0'].constant);
    assert.ok(JSON.parse(JSON.stringify(book)).entries['5'].content.includes('TURN_BATTLE_REQUEST'));
});

test('预览发现错误栏位、超量饰品、未知拘束', () => {
    const a = actor('a', 'ally', 'front', 1, { equipment: { weapon: 'core:rope' }, accessories: Array(6).fill('core:staff'), restraints: ['missing:rope'] });
    const errors = validateBattleRequest(request(a, actor('e', 'enemy', 'front', 1)), collectDefinitions([CORE_PACK]), limits);
    assert.ok(errors.some(x => x.includes('weapon')));
    assert.ok(errors.some(x => x.includes('超过 5')));
    assert.ok(errors.some(x => x.includes('拘束')));
});

test('整条前排遮挡后排；火球和火雨无视遮挡', () => {
    const mage = actor('mage', 'ally', 'back', 1, { equipment: { weapon: 'core:staff' }, skills: ['core:fireball', 'core:fire-rain', 'core:unarmed'] });
    const state = createBattle(request(mage, actor('front', 'enemy', 'front', 1), actor('back', 'enemy', 'back', 1)), [CORE_PACK], limits, 1);
    const defs = collectDefinitions([CORE_PACK]);
    assert.deepEqual(legalTargets(state, state.actors[0], defs.skills.get('core:unarmed'), defs).map(x => x.id), ['front']);
    assert.deepEqual(legalTargets(state, state.actors[0], defs.skills.get('core:fireball'), defs).map(x => x.id), ['front', 'back']);
    const after = executeAction(state, { type: 'skill', actorId: 'mage', id: 'core:fire-rain' });
    assert.ok(after.actors.find(x => x.id === 'front').resources.hp.current < 30);
    assert.ok(after.actors.find(x => x.id === 'back').resources.hp.current < 30);
    assert.equal(after.actors[0].resources.mp.current, 10);
});

test('疾风刺需要空位，突入后可继续近战攻击后排，阶段末返回', () => {
    const rogue = actor('rogue', 'ally', 'front', 1, { equipment: { weapon: 'core:dagger' }, skills: ['core:gale-thrust', 'core:unarmed'] });
    const state = createBattle(request(rogue, actor('guard', 'enemy', 'front', 1), actor('rear', 'enemy', 'back', 1)), [CORE_PACK], limits, 2);
    state.actors[0].ap = 2;
    const entered = executeAction(state, { type: 'skill', actorId: 'rogue', id: 'core:gale-thrust', targetId: 'rear', landingCol: 2 });
    assert.equal(entered.actors[0].zone, 'enemy');
    assert.equal(entered.actors[0].ap, 1);
    assert.ok(legalTargets(entered, entered.actors[0], collectDefinitions([CORE_PACK]).skills.get('core:unarmed'), collectDefinitions([CORE_PACK])).some(x => x.id === 'rear'));
    const attacked = executeAction(entered, { type: 'skill', actorId: 'rogue', id: 'core:unarmed', targetId: 'rear' });
    const ended = endAllyPhase(attacked);
    assert.equal(ended.actors[0].zone, 'ally');
    assert.equal(ended.actors[0].row, 'front');
    const full = createBattle(request(rogue, actor('g1', 'enemy', 'front', 1), actor('g2', 'enemy', 'front', 2), actor('rear', 'enemy', 'back', 1)), [CORE_PACK], limits, 2);
    assert.deepEqual(legalTargets(full, full.actors[0], collectDefinitions([CORE_PACK]).skills.get('core:gale-thrust'), collectDefinitions([CORE_PACK])), []);
});

test('拘束封锁手部技能，挣扎成功移除拘束', () => {
    const rope = structuredClone(CORE_PACK);
    rope.equipment.find(x => x.id === 'core:rope').escapeChance = 100;
    const hero = actor('hero', 'ally', 'front', 1, { skills: ['core:unarmed'], restraints: ['core:rope'] });
    const state = createBattle(request(hero, actor('enemy', 'enemy', 'front', 1)), [rope], limits, 3);
    const defs = collectDefinitions([rope]);
    assert.deepEqual(legalTargets(state, state.actors[0], defs.skills.get('core:unarmed'), defs), []);
    assert.throws(() => executeAction(state, { type: 'move', actorId: 'hero', row: 'back', col: 1 }), /禁止移动/);
    assert.deepEqual(legalTargets(state, state.actors[0], defs.items.get('core:lime'), defs), []);
    const released = executeAction(state, { type: 'struggle', actorId: 'hero', restraintInstanceId: state.actors[0].restraints[0].instanceId });
    assert.equal(released.actors[0].restraints.length, 0);
    assert.equal(released.actors[0].resources.sp.current, 15);
});

test('报告包含结算资源、掉落和共用背包', () => {
    const hero = actor('hero', 'ally', 'front', 1, { skills: ['core:disarm'], equipment: { weapon: 'core:staff' } });
    const foe = actor('foe', 'enemy', 'front', 1, { equipment: { weapon: 'core:sword' } });
    const pack = structuredClone(CORE_PACK);
    pack.skills.find(x => x.id === 'core:disarm').effects[0].chance = 100;
    const initial = request(hero, foe); initial.bag = { 'core:potion': 2 };
    const state = createBattle(initial, [pack], limits, 4);
    const next = executeAction(state, { type: 'skill', actorId: 'hero', id: 'core:disarm', targetId: 'foe' });
    assert.equal(next.actors[1].equipment.weapon, null);
    assert.equal(next.drops[0].id, 'core:sword');
    const report = battleReport(next, true);
    assert.match(report, /core:sword/);
    assert.match(report, /core:potion×2/);
});

test('被动状态增加行动点，敌方规则 AI 按策略使用个人道具', () => {
    const pack = structuredClone(CORE_PACK);
    pack.statuses.push({ id: 'core:quick', name: '迅捷', duration: 2, bonusAp: 1 });
    pack.aiProfiles.push({ id: 'core:thrower', name: '投掷手', itemPriority: ['core:lime'], useItems: true });
    const hero = actor('hero', 'ally', 'front', 1, { statuses: ['core:quick'] });
    const foe = actor('foe', 'enemy', 'front', 1, { aiProfile: 'core:thrower', items: { 'core:lime': 1 } });
    const initial = createBattle(request(hero, foe), [pack], limits, 5);
    assert.equal(initial.actors[0].ap, 2);
    const after = endAllyPhase(initial);
    assert.equal(after.actors[1].items['core:lime'], 0);
    assert.ok(after.log.some(entry => entry.text.includes('石灰粉')));
});

test('技能可封锁或卸除装备，并在相应阶段后恢复封锁', () => {
    const pack = structuredClone(CORE_PACK);
    pack.skills.push({ id: 'core:seal-weapon', name: '封印武器', tags: ['magic'], cost: {}, target: { side: 'enemy', row: 'any', count: 'single', guard: false }, requirements: [{ kind: 'targetEquipped', slot: 'weapon' }], effects: [{ kind: 'disableEquipment', slot: 'weapon', duration: 2 }] });
    pack.skills.push({ id: 'core:strip-weapon', name: '击落装备', tags: ['magic'], cost: {}, target: { side: 'enemy', row: 'any', count: 'single', guard: false }, requirements: [{ kind: 'targetEquipped', slot: 'weapon' }], effects: [{ kind: 'removeEquipment', slot: 'weapon' }] });
    assert.deepEqual(validatePack(pack), []);
    const hero = actor('hero', 'ally', 'front', 1, { skills: ['core:seal-weapon', 'core:strip-weapon'] });
    hero.resources.hp = { current: 100, max: 100 };
    const foe = actor('foe', 'enemy', 'front', 1, { equipment: { weapon: 'core:sword' } });
    const initial = createBattle(request(hero, foe), [pack], limits, 6);
    const sealed = executeAction(initial, { type: 'skill', actorId: 'hero', id: 'core:seal-weapon', targetId: 'foe' });
    assert.ok(!availableSkills(sealed.actors[1], collectDefinitions([pack])).some(x => x.id === 'core:sword-strike'));
    const afterEnemy = endAllyPhase(sealed);
    assert.equal(afterEnemy.actors[1].disabledEquipment.weapon, 1);
    const next = endAllyPhase(afterEnemy);
    assert.equal(next.actors[1].disabledEquipment.weapon, undefined);
    const stripped = executeAction(initial, { type: 'skill', actorId: 'hero', id: 'core:strip-weapon', targetId: 'foe' });
    assert.equal(stripped.actors[1].equipment.weapon, null);
    assert.equal(stripped.drops[0].id, 'core:sword');
});

test('自定义资源可增减；束手允许口部魔法，堵嘴禁止咏唱', () => {
    const pack = structuredClone(CORE_PACK);
    pack.skills.push({ id: 'core:drain-focus', name: '削弱专注', tags: ['magic'], cost: {}, target: { side: 'enemy', row: 'any', count: 'single', guard: false }, effects: [{ kind: 'resource', resource: 'focus', amount: -4 }] });
    const mage = actor('mage', 'ally', 'front', 1, { equipment: { weapon: 'core:staff' }, skills: ['core:fireball', 'core:drain-focus'], restraints: ['core:rope'] });
    const foe = actor('foe', 'enemy', 'front', 1, { restraints: ['core:gag'] });
    foe.resources.focus = { current: 6, max: 10 };
    const state = createBattle(request(mage, foe), [pack], limits, 7);
    const defs = collectDefinitions([pack]);
    assert.ok(legalTargets(state, state.actors[0], defs.skills.get('core:fireball'), defs).length);
    const lowered = executeAction(state, { type: 'skill', actorId: 'mage', id: 'core:drain-focus', targetId: 'foe' });
    assert.equal(lowered.actors[1].resources.focus.current, 2);
    const gaggedMage = actor('gagged', 'ally', 'front', 1, { equipment: { weapon: 'core:staff' }, skills: ['core:fireball'], restraints: ['core:gag'] });
    const gagged = createBattle(request(gaggedMage, actor('target', 'enemy', 'front', 1)), [pack], limits, 7);
    assert.deepEqual(legalTargets(gagged, gagged.actors[0], defs.skills.get('core:fireball'), defs), []);
});

test('预览拦截写错的自定义资源 ID', () => {
    const pack = structuredClone(CORE_PACK);
    pack.skills.push({ id: 'core:drain-focus', name: '削弱专注', tags: ['magic'], cost: {}, target: { side: 'enemy', row: 'any', count: 'single', guard: false }, effects: [{ kind: 'resource', resource: 'focus', amount: -4 }] });
    const data = request(actor('mage', 'ally', 'front', 1, { skills: ['core:drain-focus'] }), actor('foe', 'enemy', 'front', 1));
    const errors = validateBattleRequest(data, collectDefinitions([pack]), limits);
    assert.ok(errors.some(message => message.includes('focus')));
});

test('玩家前排可占据空出的敌方前排，持续遮蔽我方后排并可花行动返回', () => {
    const front = actor('front', 'ally', 'front', 1, { skills: ['core:unarmed'] });
    const second = actor('second', 'ally', 'front', 2);
    const rear = actor('rear', 'ally', 'back', 1);
    const enemy = actor('enemy', 'enemy', 'back', 1, { skills: ['core:unarmed'] });
    const state = createBattle(request(front, second, rear, enemy), [CORE_PACK], limits, 8);
    const entered = executeAction(state, { type: 'move', actorId: 'front', zone: 'enemy', row: 'front', col: 1 });
    assert.equal(entered.actors[0].zone, 'enemy');
    assert.equal(entered.actors[0].ap, 0);
    const defs = collectDefinitions([CORE_PACK]);
    assert.deepEqual(legalTargets(entered, entered.actors[3], defs.skills.get('core:unarmed'), defs).map(x => x.id), ['front', 'second']);
    assert.throws(() => executeAction(entered, { type: 'move', actorId: 'second', zone: 'enemy', row: 'back', col: 2 }), /只能进入敌方前排/);
    const joined = executeAction(entered, { type: 'move', actorId: 'second', zone: 'enemy', row: 'front', col: 2 });
    assert.deepEqual(legalTargets(joined, joined.actors[3], defs.skills.get('core:unarmed'), defs).map(x => x.id), ['front', 'second']);
    const next = endAllyPhase(joined);
    assert.equal(next.actors[0].zone, 'enemy');
    assert.equal(next.actors[1].zone, 'enemy');
    const returned = executeAction(next, { type: 'move', actorId: 'front', zone: 'ally', row: 'front', col: 1 });
    assert.equal(returned.actors[0].zone, 'ally');
});

test('敌方前排仍有人时不能占据，玩家占据后敌方后排不能前移或突入', () => {
    const pack = structuredClone(CORE_PACK);
    pack.skills.push({ id: 'core:enemy-leap', name: '突入', tags: [], cost: {}, target: { side: 'enemy', row: 'any', count: 'single', guard: false }, effects: [{ kind: 'infiltrate', returnAt: 'phaseEnd' }] });
    const data = request(actor('hero', 'ally', 'front', 1), actor('guard', 'enemy', 'front', 1), actor('mage', 'enemy', 'back', 1, { skills: ['core:enemy-leap'] }));
    const initial = createBattle(data, [pack], limits, 9);
    assert.throws(() => executeAction(initial, { type: 'move', actorId: 'hero', zone: 'enemy', row: 'front', col: 2 }), /敌方前排无人/);
    data.actors[1].resources.hp.current = 0;
    const cleared = createBattle(data, [pack], limits, 9);
    const entered = executeAction(cleared, { type: 'move', actorId: 'hero', zone: 'enemy', row: 'front', col: 1 });
    entered.phase = 'enemy';
    entered.actors[2].ap = 1;
    assert.throws(() => executeAction(entered, { type: 'move', actorId: 'mage', row: 'front', col: 2 }), /无法离开后排/);
    assert.deepEqual(legalTargets(entered, entered.actors[2], collectDefinitions([pack]).skills.get('core:enemy-leap'), collectDefinitions([pack])), []);
    assert.throws(() => executeAction(entered, { type: 'skill', actorId: 'mage', id: 'core:enemy-leap', targetId: 'hero' }), /没有合法目标/);
});

test('Buff 可授予及封锁指定技能，结束后恢复技能列表', () => {
    const pack = structuredClone(CORE_PACK);
    pack.skills.push({ id: 'core:bound-trick', name: '束缚反制', tags: ['mouth'], cost: {}, target: { side: 'self', row: 'any', count: 'single', guard: false }, effects: [{ kind: 'resource', resource: 'sp', amount: 1 }] });
    pack.statuses.push({ id: 'core:replacement', name: '受困', duration: 1, skills: ['core:bound-trick'], suppressedSkills: ['core:sword-strike'] });
    assert.deepEqual(validatePack(pack), []);
    const hero = actor('hero', 'ally', 'front', 1, { equipment: { weapon: 'core:sword' }, statuses: ['core:replacement'] });
    const foe = actor('foe', 'enemy', 'front', 1);
    const state = createBattle(request(hero, foe), [pack], limits, 10);
    const defs = collectDefinitions([pack]);
    assert.deepEqual(availableSkills(state.actors[0], defs).map(x => x.id), ['core:bound-trick']);
    const next = endAllyPhase(state);
    assert.deepEqual(availableSkills(next.actors[0], defs).map(x => x.id), ['core:sword-strike']);
    pack.statuses[pack.statuses.length - 1].skills = ['core:unknown'];
    assert.ok(validatePack(pack).some(message => message.includes('引用不存在的技能')));
});

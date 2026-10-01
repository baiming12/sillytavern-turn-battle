import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_PACK, collectDefinitions, validatePack, validateBattleRequest } from '../content.js';
import { createBattle, executeAction, endAllyPhase, stat, battleReport } from '../engine.js';
import { generateWriterWorldbook } from '../worldbook.js';

const pack = JSON.parse(readFileSync(new URL('../examples/基础西幻职业技能包.json', import.meta.url), 'utf8'));
const request = JSON.parse(readFileSync(new URL('../examples/基础西幻开战快照.json', import.meta.url), 'utf8'));
const limits = { allyFront: 2, allyBack: 2, enemyFront: 2, enemyBack: 2 };

test('写卡助手世界书包含完整技能、Buff 和装备规则，且可按名称或 ID 查找', () => {
    const book = generateWriterWorldbook([pack]);
    const entries = Object.values(book.entries);
    assert.ok(entries.some(value => value.comment === '已启用内容包索引' && value.constant && value.content.includes(pack.id)));
    assert.equal(entries.length, 8 + ['skills', 'statuses', 'equipment', 'items', 'allies', 'enemies', 'aiProfiles'].reduce((sum, type) => sum + pack[type].length, 0));
    for (const [type, id] of [['skills', 'fantasy-basic:martial/armor-break'], ['statuses', 'fantasy-basic:status/armor-broken'], ['equipment', 'fantasy-basic:gear/sword']]) {
        const definition = pack[type].find(value => value.id === id);
        const detail = entries.find(value => value.key.includes(id));
        assert.ok(detail.key.includes(definition.name));
        assert.ok(detail.content.includes(JSON.stringify(definition)));
    }
    assert.match(entries[0].content, /世界书由插件从通过校验的同一份内容包导出/);
});

test('西幻职业包与示例战斗可直接导入和预览', () => {
    assert.deepEqual(validatePack(pack, [CORE_PACK]), []);
    assert.deepEqual(validateBattleRequest(request, collectDefinitions([CORE_PACK, pack]), limits), []);
    assert.equal(pack.skills.length, 87);
    assert.equal(pack.allies.length, 7);
    assert.equal(pack.enemies.length, 5);
    assert.ok(pack.skills.some(value => value.pool === 'martial'));
    assert.ok(pack.skills.some(value => value.pool === 'spell-common'));
    assert.ok(pack.skills.some(value => value.pool === 'agile'));
    for (const ally of pack.allies) {
        assert.equal(ally.statuses.length, 2);
        assert.ok(ally.statuses.every(id => pack.statuses.find(value => value.id === id)?.tags.includes('passive')));
    }
    const state = createBattle(request, [CORE_PACK, pack], limits, 42);
    assert.equal(state.actors.length, 6);
    assert.equal(state.status, 'active');
    assert.equal(stat(state.actors.find(value => value.id === 'hero-warrior'), 'pdef', collectDefinitions([CORE_PACK, pack])), 11);
});

test('职业技能实际施加破甲、祝福，牧师能够净化负面状态', () => {
    const assured = structuredClone(pack);
    assured.skills.find(value => value.id === 'fantasy-basic:martial/armor-break').effects[1].chance = 100;
    const defs = collectDefinitions([CORE_PACK, assured]);
    const battle = createBattle(request, [CORE_PACK, assured], limits, 7);
    const wolf = battle.actors.find(value => value.id === 'foe-wolf');
    const defense = stat(wolf, 'pdef', defs);
    const broken = executeAction(battle, { type: 'skill', actorId: 'hero-warrior', id: 'fantasy-basic:martial/armor-break', targetId: 'foe-wolf' });
    const woundedWolf = broken.actors.find(value => value.id === 'foe-wolf');
    assert.ok(woundedWolf.statuses.some(value => value.id === 'fantasy-basic:status/armor-broken'));
    assert.equal(stat(woundedWolf, 'pdef', defs), Math.max(0, defense - 3));
    assert.match(battleReport(broken), /破甲（fantasy-basic:status\/armor-broken）：护甲出现破绽/);

    const blessed = executeAction(battle, { type: 'skill', actorId: 'hero-priest', id: 'fantasy-basic:spell/bless' });
    assert.ok(blessed.actors.filter(value => value.side === 'ally').every(value => value.statuses.some(status => status.id === 'fantasy-basic:status/blessed')));

    const poisonedRequest = structuredClone(request);
    poisonedRequest.actors[0].statuses.push('fantasy-basic:status/poisoned');
    const poisoned = createBattle(poisonedRequest, [CORE_PACK, assured], limits, 8);
    const purified = executeAction(poisoned, { type: 'skill', actorId: 'hero-priest', id: 'fantasy-basic:spell/purify', targetId: 'hero-warrior' });
    assert.ok(!purified.actors.find(value => value.id === 'hero-warrior').statuses.some(value => value.id === 'fantasy-basic:status/poisoned'));
    assert.ok(purified.log.some(value => value.text.includes('解除中毒')));
});

test('迅捷 Buff 在下一轮提供额外行动点', () => {
    const acceleratedRequest = structuredClone(request);
    acceleratedRequest.actors.find(value => value.id === 'hero-priest').skills.push('fantasy-basic:spell/haste');
    const initial = createBattle(acceleratedRequest, [CORE_PACK, pack], limits, 13);
    const cast = executeAction(initial, { type: 'skill', actorId: 'hero-priest', id: 'fantasy-basic:spell/haste', targetId: 'hero-warrior' });
    const nextRound = endAllyPhase(cast);
    assert.equal(nextRound.round, 2);
    assert.equal(nextRound.actors.find(value => value.id === 'hero-warrior').ap, 2);
});

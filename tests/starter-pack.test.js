import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_PACK, collectDefinitions, validatePack, validateBattleRequest, catalogText } from '../content.js';
import { createBattle, executeAction, endAllyPhase, lootableEnemyItems } from '../engine.js';

const pack = JSON.parse(readFileSync(new URL('../examples/基础测试内容包.json', import.meta.url), 'utf8'));
const request = JSON.parse(readFileSync(new URL('../examples/基础测试开战快照.json', import.meta.url), 'utf8'));
const limits = { allyFront: 2, allyBack: 2, enemyFront: 2, enemyBack: 2 };

test('基础测试包与示例开战快照可直接导入', () => {
    assert.deepEqual(validatePack(pack, [CORE_PACK]), []);
    assert.equal(pack.allies.length, 2);
    assert.match(catalogText([pack]), /allies starter-test:warrior 测试战士/);
    assert.match(catalogText([pack]), /skills starter-test:fireball 火球术：咏唱后凝出火球/);
    assert.match(catalogText([pack]), /equipment starter-test:sword 练习长剑：训练用长剑/);
    assert.deepEqual(validateBattleRequest(request, collectDefinitions([CORE_PACK, pack]), limits), []);
    const state = createBattle(request, [CORE_PACK, pack], limits, 42);
    assert.equal(state.actors.length, 5);
    assert.equal(state.actors[0].ap, 2);
    assert.equal(state.actors[0].accessories.length, 5);
    const first = executeAction(state, { type: 'skill', actorId: 'hero', id: 'starter-test:wind-first', targetId: 'enemy-guard' });
    const second = executeAction(first, { type: 'skill', actorId: 'hero', id: 'starter-test:wind-first', targetId: 'enemy-guard' });
    assert.equal(second.actors.find(actor => actor.id === 'enemy-guard').resources.hp.current, 0);
    assert.equal(second.status, 'active');
    assert.equal(second.result, null);
    const secondRound = endAllyPhase(second);
    assert.equal(secondRound.round, 2);
    assert.deepEqual(lootableEnemyItems(secondRound).map(x => x.id), ['starter-test:healing-potion']);
    const duelRequest = structuredClone(request);
    duelRequest.actors = duelRequest.actors.filter(actor => ['hero', 'enemy-guard'].includes(actor.id));
    const duel = createBattle(duelRequest, [CORE_PACK, pack], limits, 42);
    const victory = executeAction(executeAction(duel, { type: 'skill', actorId: 'hero', id: 'starter-test:wind-first', targetId: 'enemy-guard' }), { type: 'skill', actorId: 'hero', id: 'starter-test:wind-first', targetId: 'enemy-guard' });
    assert.equal(victory.result, '玩家胜利');
    const after = endAllyPhase(state);
    assert.ok(after.log.some(entry => entry.phase === 'enemy'));
});

test('我方角色预设校验装备、资源和共用背包规则', () => {
    const invalid = structuredClone(pack);
    invalid.allies[0].equipment.weapon = 'starter-test:coat';
    invalid.allies[0].resources.hp.current = 100;
    invalid.allies[0].items = { 'starter-test:healing-potion': 1 };
    const errors = validatePack(invalid, [CORE_PACK]);
    assert.ok(errors.some(error => error.includes('不能放在 weapon 栏')));
    assert.ok(errors.some(error => error.includes('资源 hp 无效')));
    assert.ok(errors.some(error => error.includes('共用背包')));
});

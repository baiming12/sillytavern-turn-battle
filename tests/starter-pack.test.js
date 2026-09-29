import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_PACK, collectDefinitions, validatePack, validateBattleRequest } from '../content.js';
import { createBattle, executeAction, endAllyPhase } from '../engine.js';

const pack = JSON.parse(readFileSync(new URL('../examples/基础测试内容包.json', import.meta.url), 'utf8'));
const request = JSON.parse(readFileSync(new URL('../examples/基础测试开战快照.json', import.meta.url), 'utf8'));
const limits = { allyFront: 2, allyBack: 2, enemyFront: 2, enemyBack: 2 };

test('基础测试包与示例开战快照可直接导入', () => {
    assert.deepEqual(validatePack(pack, [CORE_PACK]), []);
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
    const duelRequest = structuredClone(request);
    duelRequest.actors = duelRequest.actors.filter(actor => ['hero', 'enemy-guard'].includes(actor.id));
    const duel = createBattle(duelRequest, [CORE_PACK, pack], limits, 42);
    const victory = executeAction(executeAction(duel, { type: 'skill', actorId: 'hero', id: 'starter-test:wind-first', targetId: 'enemy-guard' }), { type: 'skill', actorId: 'hero', id: 'starter-test:wind-first', targetId: 'enemy-guard' });
    assert.equal(victory.result, '玩家胜利');
    const after = endAllyPhase(state);
    assert.ok(after.log.some(entry => entry.phase === 'enemy'));
});

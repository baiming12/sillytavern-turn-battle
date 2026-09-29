import { collectDefinitions, validateBattleRequest } from './content.js';

const clone = value => structuredClone(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const alive = actor => actor.resources.hp.current > 0;
const tagSet = value => new Set(value || []);
const actorName = actor => actor?.name || actor?.id || '未知单位';

function randomInt(state, max = 100) {
    let x = state.randomState >>> 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    state.randomState = x >>> 0;
    return (state.randomState % max) + 1;
}

function roll(state, chance) {
    const value = randomInt(state);
    return { success: value <= clamp(chance, 0, 100), value, chance: clamp(chance, 0, 100) };
}

function equipmentEntries(actor, defs) {
    const ids = [...Object.entries(actor.equipment || {}).filter(([slot]) => !(actor.disabledEquipment?.[slot] > 0)).flatMap(([, value]) => value), ...(actor.disabledEquipment?.accessory > 0 ? [] : actor.accessories || []), ...(actor.restraints || []).map(x => typeof x === 'string' ? x : x.id)];
    return ids.filter(Boolean).map(id => defs.equipment.get(id)).filter(Boolean);
}

export function stat(actor, key, defs) {
    let value = Number(actor.stats?.[key] || 0);
    for (const eq of equipmentEntries(actor, defs)) value += Number(eq.stats?.[key] || 0);
    for (const status of actor.statuses || []) value += Number(defs.statuses.get(status.id)?.stats?.[key] || 0) * (status.stacks || 1);
    return Math.max(0, value);
}

function statusIds(actor, defs) {
    return [...(actor.statuses || []).map(x => x.id), ...equipmentEntries(actor, defs).flatMap(eq => eq.statuses || [])];
}

function blockedTags(actor, defs) {
    const tags = new Set();
    for (const id of statusIds(actor, defs)) for (const tag of defs.statuses.get(id)?.blockedTags || []) tags.add(tag);
    return tags;
}

function phaseActionPoints(actor, defs, cap) {
    const equipmentBonus = equipmentEntries(actor, defs).reduce((sum, eq) => sum + Number(eq.bonusAp || 0), 0);
    const statusBonus = statusIds(actor, defs).reduce((sum, id) => sum + Number(defs.statuses.get(id)?.bonusAp || 0), 0);
    return clamp(1 + equipmentBonus + statusBonus, 0, cap);
}

function hasFreePart(actor, part, defs) {
    return !(actor.restraints || []).some(instance => {
        const eq = defs.equipment.get(instance.id);
        return eq?.parts?.includes(part);
    });
}

function slotHasEquipment(actor, slot) {
    return slot === 'accessory' ? Boolean(actor.accessories?.length) : Boolean(actor.equipment?.[slot]);
}

function hasEquipmentId(actor, id) {
    return Object.values(actor.equipment || {}).includes(id) || (actor.accessories || []).includes(id) || (actor.restraints || []).some(value => value.id === id);
}

export function availableSkills(actor, defs) {
    const ids = new Set(actor.skills || []);
    for (const eq of equipmentEntries(actor, defs)) for (const id of eq.skills || []) ids.add(id);
    if (!actor.equipment?.weapon) ids.add('core:unarmed');
    return [...ids].map(id => defs.skills.get(id)).filter(Boolean);
}

function occupants(state, zone, row = null) {
    return state.actors.filter(a => alive(a) && (a.zone || a.side) === zone && (!row || a.row === row));
}

export function emptyFrontColumns(state, targetSide) {
    const max = state.limits[`${targetSide}Front`];
    const taken = new Set(occupants(state, targetSide, 'front').map(a => a.col));
    return Array.from({ length: max }, (_, i) => i + 1).filter(col => !taken.has(col));
}

function meetsRequirements(state, actor, skill, target, defs) {
    const blocked = blockedTags(actor, defs);
    if ((skill.tags || []).some(tag => blocked.has(tag))) return '状态禁止使用此技能';
    for (const req of skill.requirements || []) {
        if (req.kind === 'freePart' && !hasFreePart(actor, req.part, defs)) return `需要${req.part}自由`;
        if (req.kind === 'equippedTag' && !equipmentEntries(actor, defs).some(eq => eq.tags?.includes(req.tag))) return `需要装备 ${req.tag}`;
        if (req.kind === 'equippedAnyTag' && !equipmentEntries(actor, defs).some(eq => (req.tags || []).some(tag => eq.tags?.includes(tag)))) return `需要装备 ${req.tags?.join('或')}`;
        if (req.kind === 'enemyFrontEmpty' && !emptyFrontColumns(state, actor.side === 'ally' ? 'enemy' : 'ally').length) return '敌方前排没有空位';
        if (req.kind === 'targetEquipped' && target && !slotHasEquipment(target, req.slot)) return '目标没有对应装备';
        if (req.kind === 'targetNotEquipped' && target && slotHasEquipment(target, req.slot)) return '目标仍装备对应栏位';
        if (req.kind === 'selfNotEquipped' && slotHasEquipment(actor, req.slot)) return '自身仍装备对应栏位';
        if (req.kind === 'selfEquipment' && !hasEquipmentId(actor, req.equipmentId)) return '自身缺少所需装备';
        if (req.kind === 'targetEquipment' && target && !hasEquipmentId(target, req.equipmentId)) return '目标缺少所需装备';
        if (req.kind === 'selfNotEquipment' && hasEquipmentId(actor, req.equipmentId)) return '自身持有禁止装备';
        if (req.kind === 'targetNotEquipment' && target && hasEquipmentId(target, req.equipmentId)) return '目标持有禁止装备';
        if (req.kind === 'selfStatus' && !statusIds(actor, defs).includes(req.statusId)) return '缺少所需状态';
        if (req.kind === 'targetStatus' && target && !statusIds(target, defs).includes(req.statusId)) return '目标缺少所需状态';
        if (req.kind === 'selfNotStatus' && statusIds(actor, defs).includes(req.statusId)) return '自身已有禁止状态';
        if (req.kind === 'targetNotStatus' && target && statusIds(target, defs).includes(req.statusId)) return '目标已有禁止状态';
    }
    for (const [key, amount] of Object.entries(skill.cost || {})) if ((actor.resources[key]?.current || 0) < amount) return `${key}不足`;
    return null;
}

export function legalTargets(state, actor, skill, defs) {
    const rule = skill.target || { side: 'enemy', row: 'any', count: 'single', guard: true };
    const side = rule.side === 'self' ? actor.side : rule.side === 'ally' ? actor.side : actor.side === 'ally' ? 'enemy' : 'ally';
    const guarded = rule.side === 'enemy' && rule.guard !== false && occupants(state, side, 'front').some(a => a.side === side);
    const infiltrated = (actor.zone || actor.side) === side;
    return state.actors.filter(target => {
        if (!alive(target) || target.side !== side) return false;
        if (rule.side === 'self' && target.id !== actor.id) return false;
        if (rule.row && rule.row !== 'any' && target.row !== rule.row) return false;
        if (target.row === 'back' && guarded && !infiltrated) return false;
        if ((skill.effects || []).some(effect => effect.kind === 'resource' && !target.resources?.[effect.resource])) return false;
        if (meetsRequirements(state, actor, skill, target, defs)) return false;
        return true;
    });
}

function log(state, text, details = null) {
    state.log.push({ round: state.round, phase: state.phase, text, details });
}

function addStatus(target, id, defs, source) {
    const def = defs.statuses.get(id);
    if (!def) return;
    const prior = target.statuses.find(status => status.id === id && status.source === source);
    if (prior) { prior.remaining = def.duration ?? null; prior.stacks = Math.min(def.maxStacks || 1, prior.stacks + 1); }
    else target.statuses.push({ id, remaining: def.duration ?? null, stacks: 1, source });
}

function returnInfiltrator(state, actor) {
    if (!actor.infiltration || !alive(actor)) return;
    const home = actor.infiltration.home;
    actor.zone = actor.side; actor.row = home.row; actor.col = home.col;
    actor.infiltration = null;
    log(state, `${actorName(actor)}返回原位`);
}

function applyEffect(state, actor, targets, effect, defs, action) {
    if (effect.kind === 'infiltrate') {
        const targetSide = actor.side === 'ally' ? 'enemy' : 'ally';
        const col = action.landingCol || emptyFrontColumns(state, targetSide)[0];
        if (!emptyFrontColumns(state, targetSide).includes(col)) throw new Error('突入落点无效');
        actor.infiltration = { home: { row: actor.row, col: actor.col }, returnAt: effect.returnAt || 'skillEnd' };
        actor.zone = targetSide; actor.row = 'front'; actor.col = col;
        log(state, `${actorName(actor)}突入${targetSide === 'ally' ? '玩家' : '敌方'}前排 ${col}`);
        return;
    }
    if (effect.kind === 'actionPoints') {
        actor.ap = clamp(actor.ap + Number(effect.amount || 0), 0, state.actionPointCap);
        log(state, `${actorName(actor)}行动点变化为 ${actor.ap}`);
        return;
    }
    for (const target of targets) {
        if (!alive(target) && effect.kind !== 'resource') continue;
        const accuracyMod = statusIds(actor, defs).reduce((sum, id) => sum + Number(defs.statuses.get(id)?.accuracyMod || 0), 0);
        const chance = effect.kind !== 'damage' && target.side !== actor.side ? clamp((effect.chance ?? 100) + accuracyMod, 0, 100) : effect.chance ?? 100;
        if (chance < 100) {
            const result = roll(state, chance);
            if (!result.success) { log(state, `${actorName(actor)}对${actorName(target)}的效果失败（${result.value}/${result.chance}）`); continue; }
        }
        if (effect.kind === 'damage') {
            const accuracy = clamp((effect.accuracy ?? 100) + stat(actor, 'accuracy', defs) - stat(target, 'evasion', defs) + accuracyMod, 0, 100);
            if (accuracy < 100) {
                const hit = roll(state, accuracy);
                if (!hit.success) { log(state, `${actorName(actor)}攻击${actorName(target)}未命中（${hit.value}/${hit.chance}）`); continue; }
            }
            const magic = effect.damageType === 'magic';
            const attack = stat(actor, magic ? 'matk' : 'patk', defs);
            const defense = stat(target, magic ? 'mdef' : 'pdef', defs);
            const amount = Math.max(1, Math.floor((Number(effect.power || 0) + attack * Number(effect.scale ?? 1)) * 100 / (100 + defense)));
            const old = target.resources.hp.current;
            target.resources.hp.current = Math.max(0, old - amount);
            log(state, `${actorName(actor)}对${actorName(target)}造成${amount}点${magic ? '魔法' : '物理'}伤害（生命 ${old}→${target.resources.hp.current}）`);
            if (old > 0 && !alive(target)) log(state, `${actorName(target)}倒下`);
        } else if (effect.kind === 'resource') {
            const resource = target.resources[effect.resource];
            if (!resource) continue;
            const old = resource.current;
            resource.current = clamp(old + Number(effect.amount || 0), 0, resource.max);
            log(state, `${actorName(target)}的${effect.resource} ${old}→${resource.current}`);
        } else if (effect.kind === 'status') {
            addStatus(target, effect.statusId, defs, actor.id);
            log(state, `${actorName(target)}获得${defs.statuses.get(effect.statusId)?.name || effect.statusId}`);
        } else if (effect.kind === 'removeStatus') {
            target.statuses = target.statuses.filter(x => x.id !== effect.statusId);
            log(state, `${actorName(target)}解除${defs.statuses.get(effect.statusId)?.name || effect.statusId}`);
        } else if (effect.kind === 'equipRestraint') {
            const eq = defs.equipment.get(effect.equipmentId);
            if (!eq || eq.slot !== 'restraint') continue;
            const instance = { id: eq.id, instanceId: `r-${state.nextInstance++}` };
            target.restraints.push(instance);
            log(state, `${actorName(target)}被施加${eq.name}`);
        } else if (effect.kind === 'removeRestraint') {
            const before = target.restraints.length;
            target.restraints = target.restraints.filter(x => effect.equipmentId ? x.id !== effect.equipmentId : action.restraintInstanceId ? x.instanceId !== action.restraintInstanceId : false);
            if (target.restraints.length < before) log(state, `${actorName(target)}解除一件拘束用具`);
        } else if (effect.kind === 'disarm') {
            const weapon = target.equipment?.weapon;
            if (!weapon) continue;
            state.drops.push({ id: weapon, zone: target.zone || target.side, row: target.row, col: target.col, ownerId: target.id, instanceId: `d-${state.nextInstance++}` });
            target.equipment.weapon = null;
            log(state, `${actorName(target)}的${defs.equipment.get(weapon)?.name || weapon}掉落在${target.row}${target.col}`);
        } else if (effect.kind === 'removeEquipment') {
            const slot = effect.slot;
            const id = slot === 'accessory' ? target.accessories.shift() : target.equipment?.[slot];
            if (!id) continue;
            if (slot !== 'accessory') target.equipment[slot] = null;
            state.drops.push({ id, zone: target.zone || target.side, row: target.row, col: target.col, ownerId: target.id, instanceId: `d-${state.nextInstance++}` });
            log(state, `${actorName(target)}的${defs.equipment.get(id)?.name || id}被卸除并掉落`);
        } else if (effect.kind === 'disableEquipment') {
            const slot = effect.slot;
            if (!target.equipment?.[slot] && !(slot === 'accessory' && target.accessories.length)) continue;
            target.disabledEquipment ||= {};
            target.disabledEquipment[slot] = Math.max(target.disabledEquipment[slot] || 0, effect.duration);
            log(state, `${actorName(target)}的${slot}栏装备暂时失效 ${effect.duration} 阶段`);
        }
    }
}

function outcome(state) {
    const ally = state.actors.some(a => a.side === 'ally' && alive(a));
    const enemy = state.actors.some(a => a.side === 'enemy' && alive(a));
    if (!ally && !enemy) return '平局';
    if (!ally) return '玩家失败';
    if (!enemy) return '玩家胜利';
    return null;
}

export function createBattle(request, packs, limits, seed = Date.now()) {
    const defs = collectDefinitions(packs);
    const errors = validateBattleRequest(request, defs, limits);
    if (errors.length) throw new Error(errors.join('；'));
    const state = {
        schema: 'turn-battle-state/v1', id: `battle-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        scene: request.scene || '', round: 1, phase: 'ally', status: 'active', result: null,
        limits: clone(limits), randomState: (seed >>> 0) || 1, nextInstance: 1, actionPointCap: 4,
        actors: clone(request.actors).map(actor => ({ ...actor, zone: actor.side, ap: 1, actionsTaken: 0, disabledEquipment: {}, statuses: (actor.statuses || []).map(status => typeof status === 'string' ? { id: status, remaining: defs.statuses.get(status)?.duration ?? null, stacks: 1, source: 'initial' } : status), restraints: (actor.restraints || []).map((value, index) => typeof value === 'string' ? { id: value, instanceId: `r-initial-${actor.id}-${index}` } : { ...value, instanceId: value.instanceId || `r-initial-${actor.id}-${index}` }), equipment: actor.equipment || {}, accessories: actor.accessories || [], items: actor.items || {} })),
        bag: clone(request.bag || {}), gearBag: {}, drops: [], log: [],
        definitions: packs.map(pack => clone(pack)),
    };
    for (const actor of state.actors) actor.ap = alive(actor) ? phaseActionPoints(actor, defs, state.actionPointCap) : 0;
    log(state, `战斗开始：${state.scene || '未命名遭遇'}`);
    return state;
}

function executeMutable(state, action) {
    if (state.status !== 'active') throw new Error('战斗已经结束');
    const defs = collectDefinitions(state.definitions);
    const actor = state.actors.find(x => x.id === action.actorId);
    if (!actor || !alive(actor) || actor.side !== state.phase || actor.ap < 1 || actor.actionsTaken >= state.actionPointCap) throw new Error('当前单位无法行动');
    if (action.type === 'rest') {
        actor.ap -= 1;
        for (const key of ['sp', 'mp']) actor.resources[key].current = clamp(actor.resources[key].current + 3, 0, actor.resources[key].max);
        log(state, `${actorName(actor)}休息，恢复精力和法力`);
    } else if (action.type === 'move') {
        const zone = actor.side;
        if (blockedTags(actor, defs).has('move') || !hasFreePart(actor, 'feet', defs)) throw new Error('当前拘束或状态禁止移动');
        if (actor.infiltration || !['front', 'back'].includes(action.row) || !Number.isInteger(action.col) || action.col < 1 || action.col > state.limits[`${zone}${action.row === 'front' ? 'Front' : 'Back'}`]) throw new Error('移动目标无效');
        if (occupants(state, zone, action.row).some(x => x.col === action.col) || state.actors.some(x => x.infiltration && x.side === zone && x.infiltration.home.row === action.row && x.infiltration.home.col === action.col)) throw new Error('目标位置已占据');
        actor.ap -= 1; actor.row = action.row; actor.col = action.col;
        log(state, `${actorName(actor)}移动到${action.row}${action.col}`);
    } else if (action.type === 'pickup') {
        if (!hasFreePart(actor, 'hands', defs) || blockedTags(actor, defs).has('hand')) throw new Error('手部受限，无法拾取');
        if (actor.equipment.weapon) throw new Error('武器栏非空');
        const index = state.drops.findIndex(x => x.instanceId === action.dropId && x.zone === (actor.zone || actor.side) && x.row === actor.row && x.col === actor.col);
        if (index < 0) throw new Error('当前位置没有这件掉落武器');
        const [drop] = state.drops.splice(index, 1);
        actor.equipment.weapon = drop.id; actor.ap -= 1;
        log(state, `${actorName(actor)}拾取${defs.equipment.get(drop.id)?.name || drop.id}`);
    } else if (action.type === 'struggle') {
        const instance = actor.restraints.find(x => x.instanceId === action.restraintInstanceId);
        if (!instance) throw new Error('拘束用具不存在');
        const eq = defs.equipment.get(instance.id);
        for (const [key, amount] of Object.entries(eq?.escapeCost || {})) if ((actor.resources[key]?.current || 0) < amount) throw new Error(`${key}不足`);
        for (const [key, amount] of Object.entries(eq?.escapeCost || {})) actor.resources[key].current -= amount;
        actor.ap -= 1;
        const result = roll(state, Number(eq.escapeChance ?? 50) + stat(actor, 'escape', defs));
        if (result.success) { actor.restraints = actor.restraints.filter(x => x.instanceId !== instance.instanceId); log(state, `${actorName(actor)}挣脱${eq.name}成功（${result.value}/${result.chance}）`); }
        else log(state, `${actorName(actor)}挣脱${eq.name}失败（${result.value}/${result.chance}）`);
    } else if (action.type === 'skill' || action.type === 'item') {
        let definition;
        if (action.type === 'skill') {
            definition = availableSkills(actor, defs).find(x => x.id === action.id);
            if (!definition) throw new Error('未拥有此技能');
        } else {
            definition = defs.items.get(action.id);
            if (!definition) throw new Error('道具不存在');
            const stock = actor.side === 'ally' ? state.bag : actor.items;
            if (!stock[action.id]) throw new Error('道具数量不足');
        }
        const targetList = legalTargets(state, actor, definition, defs);
        if (!targetList.length) throw new Error('没有合法目标');
        const selected = definition.target?.count === 'all' ? targetList : [targetList.find(x => x.id === action.targetId)];
        if (selected.some(x => !x)) throw new Error('目标不合法');
        const reason = meetsRequirements(state, actor, definition, selected[0], defs);
        if (reason) throw new Error(reason);
        for (const [key, amount] of Object.entries(definition.cost || {})) actor.resources[key].current -= amount;
        if (action.type === 'item') (actor.side === 'ally' ? state.bag : actor.items)[action.id] -= 1;
        actor.ap -= 1;
        log(state, `${actorName(actor)}使用${definition.name}${selected.length === 1 ? `，目标${actorName(selected[0])}` : `，目标${selected.length}名单位`}`);
        for (const effect of definition.effects || []) applyEffect(state, actor, selected, effect, defs, action);
        if (actor.infiltration?.returnAt === 'skillEnd') returnInfiltrator(state, actor);
    } else throw new Error('未知行动');
    actor.actionsTaken += 1;
    actor.ap = Math.min(actor.ap, state.actionPointCap - actor.actionsTaken);
    const result = outcome(state);
    if (result) { state.status = 'ended'; state.result = result; log(state, `战斗结束：${result}`); }
    return state;
}

export function executeAction(state, action) {
    const next = clone(state);
    return executeMutable(next, action);
}

function tickStatuses(state, side) {
    for (const actor of state.actors.filter(x => x.side === side)) {
        for (const status of actor.statuses) if (status.remaining !== null && status.remaining !== undefined) status.remaining -= 1;
        actor.statuses = actor.statuses.filter(status => status.remaining === null || status.remaining === undefined || status.remaining > 0);
        for (const [slot, remaining] of Object.entries(actor.disabledEquipment || {})) {
            if (remaining <= 1) delete actor.disabledEquipment[slot];
            else actor.disabledEquipment[slot] = remaining - 1;
        }
    }
}

export function endAllyPhase(state) {
    const next = clone(state);
    if (next.phase !== 'ally' || next.status !== 'active') throw new Error('当前不能结束玩家阶段');
    for (const actor of next.actors.filter(x => x.side === 'ally' && x.infiltration?.returnAt === 'phaseEnd')) returnInfiltrator(next, actor);
    tickStatuses(next, 'ally');
    next.phase = 'enemy';
    const defs = collectDefinitions(next.definitions);
    for (const actor of next.actors.filter(x => x.side === 'enemy')) { actor.ap = alive(actor) ? phaseActionPoints(actor, defs, next.actionPointCap) : 0; actor.actionsTaken = 0; }
    const enemyOrder = next.actors.filter(x => x.side === 'enemy' && alive(x)).sort((a, b) => stat(b, 'speed', defs) - stat(a, 'speed', defs) || (a.row === 'front' ? 0 : 1) - (b.row === 'front' ? 0 : 1) || a.col - b.col);
    for (const enemy of enemyOrder) {
        let guard = 0;
        while (enemy.ap > 0 && next.status === 'active' && guard++ < next.actionPointCap + 2) {
            let chosen = null;
            const profile = defs.aiProfiles.get(enemy.aiProfile) || {};
            const itemChoices = profile.useItems === false ? [] : Object.entries(enemy.items || {}).filter(([, count]) => count > 0).flatMap(([id]) => {
                const item = defs.items.get(id);
                const targets = item ? legalTargets(next, enemy, item, defs) : [];
                const heals = item?.effects?.some(effect => effect.kind === 'resource' && effect.resource === 'hp' && effect.amount > 0);
                if (heals) targets.sort((a, b) => a.resources.hp.current / a.resources.hp.max - b.resources.hp.current / b.resources.hp.max);
                return targets.length ? [{ type: 'item', actorId: enemy.id, id, targetId: targets[0].id }] : [];
            });
            if (enemy.resources.hp.current <= enemy.resources.hp.max / 2) chosen = itemChoices.find(choice => defs.items.get(choice.id)?.effects?.some(effect => effect.kind === 'resource' && effect.resource === 'hp' && effect.amount > 0));
            if (!chosen && profile.itemPriority?.length) chosen = profile.itemPriority.map(id => itemChoices.find(choice => choice.id === id)).find(Boolean);
            const priority = profile.skillPriority || [];
            const rank = id => priority.includes(id) ? priority.indexOf(id) : priority.length;
            const skills = availableSkills(enemy, defs).sort((a, b) => rank(a.id) - rank(b.id));
            for (const skill of chosen ? [] : skills) {
                const targets = legalTargets(next, enemy, skill, defs);
                if (targets.length) { chosen = { type: 'skill', actorId: enemy.id, id: skill.id, targetId: targets[0].id }; break; }
            }
            if (!chosen) chosen = itemChoices[0];
            if (!chosen && enemy.restraints?.length) chosen = { type: 'struggle', actorId: enemy.id, restraintInstanceId: enemy.restraints[0].instanceId };
            if (!chosen) chosen = { type: 'rest', actorId: enemy.id };
            try { executeMutable(next, chosen); }
            catch { executeMutable(next, { type: 'rest', actorId: enemy.id }); }
        }
    }
    if (next.status === 'active') {
        for (const actor of next.actors.filter(x => x.side === 'enemy' && x.infiltration?.returnAt === 'phaseEnd')) returnInfiltrator(next, actor);
        tickStatuses(next, 'enemy');
        next.round += 1; next.phase = 'ally';
        for (const actor of next.actors.filter(x => x.side === 'ally')) { actor.ap = alive(actor) ? phaseActionPoints(actor, defs, next.actionPointCap) : 0; actor.actionsTaken = 0; }
        log(next, `第 ${next.round} 轮开始`);
    }
    return next;
}

export function finishBattle(state, result = '中断') {
    const next = clone(state);
    if (next.status !== 'ended') { next.status = 'ended'; next.result = result; log(next, `战斗结束：${result}`); }
    return next;
}

export function battleReport(state, full = false) {
    const actorLines = state.actors.map(actor => `${actor.name}（${actor.side === 'ally' ? '玩家方' : '敌方'}）${Object.entries(actor.resources).map(([id, value]) => `${id} ${value.current}/${value.max}`).join('，')}，武器 ${actor.equipment.weapon || '无'}，拘束 ${(actor.restraints || []).map(x => x.id).join('、') || '无'}`);
    const lines = state.log.filter(entry => full || /造成|倒下|获得|解除|掉落|拾取|挣脱|突入|战斗结束/.test(entry.text)).map(entry => `第${entry.round}轮${entry.phase === 'ally' ? '玩家' : '敌方'}：${entry.text}`);
    const finalSnapshot = {
        result: state.result,
        actors: state.actors.map(({ id, name, side, row, col, zone, stats, resources, skills, equipment, accessories, restraints, statuses, disabledEquipment, items }) => ({ id, name, side, row, col, zone, stats, resources, skills, equipment, accessories, restraints, statuses, disabledEquipment, items })),
        bag: state.bag, gearBag: state.gearBag || {}, drops: state.drops,
    };
    return [`【战斗报告】`, `场景：${state.scene || '未命名遭遇'}`, `结果：${state.result || '进行中'}`, ...lines, `【最终状态】`, ...actorLines, `玩家共用背包：${Object.entries(state.bag).map(([id, count]) => `${id}×${count}`).join('、') || '空'}`, `战后拾取装备：${Object.entries(state.gearBag || {}).map(([id, count]) => `${id}×${count}`).join('、') || '无'}`, `未拾取武器：${state.drops.map(x => x.id).join('、') || '无'}`, `【供剧情变量同步的完整状态 JSON】`, JSON.stringify(finalSnapshot), `请按战斗顺序续写剧情，生命归零视为倒下，不自动死亡。同步最终资源、装备、状态、道具和拾取结果，不改写战斗结算。`].join('\n');
}

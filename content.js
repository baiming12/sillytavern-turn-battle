export const PACK_SCHEMA = 'turn-battle-pack/v1';
export const REQUEST_SCHEMA = 'turn-battle-request/v1';
export const CONTENT_TYPES = ['skills', 'statuses', 'equipment', 'items', 'enemies', 'aiProfiles'];
const EQUIPMENT_SLOTS = new Set(['weapon', 'outer', 'middle', 'underwear', 'legs', 'feet', 'accessory', 'restraint']);
const REQUIREMENT_KINDS = new Set(['freePart', 'equippedTag', 'equippedAnyTag', 'enemyFrontEmpty', 'targetEquipped', 'targetNotEquipped', 'selfNotEquipped', 'selfEquipment', 'targetEquipment', 'selfNotEquipment', 'targetNotEquipment', 'selfStatus', 'targetStatus', 'selfNotStatus', 'targetNotStatus']);
const EFFECT_KINDS = new Set(['damage', 'resource', 'status', 'removeStatus', 'equipRestraint', 'removeRestraint', 'disarm', 'removeEquipment', 'disableEquipment', 'infiltrate', 'actionPoints']);
const ID_RE = /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_/-]*$/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const asArray = value => Array.isArray(value) ? value : [];

export const CORE_PACK = {
    schema: PACK_SCHEMA,
    id: 'core',
    name: '基础规则示例包',
    version: '1.0.0',
    skills: [
        { id: 'core:unarmed', name: '徒手攻击', tags: ['physical', 'hand', 'melee'], cost: {}, target: { side: 'enemy', row: 'any', count: 'single', guard: true }, requirements: [{ kind: 'freePart', part: 'hands' }], effects: [{ kind: 'damage', damageType: 'physical', power: 2, scale: 1 }] },
        { id: 'core:sword-strike', name: '剑击', tags: ['physical', 'hand', 'melee'], cost: {}, target: { side: 'enemy', row: 'any', count: 'single', guard: true }, requirements: [{ kind: 'equippedTag', tag: 'sword' }, { kind: 'freePart', part: 'hands' }], effects: [{ kind: 'damage', damageType: 'physical', power: 4, scale: 1 }] },
        { id: 'core:clear-wind-first', name: '拂柳', description: '清风剑法第一式：以轻快剑路拨开敌方防线。', tags: ['physical', 'hand', 'melee'], cost: { sp: 3 }, target: { side: 'enemy', row: 'front', count: 'single', guard: true }, requirements: [{ kind: 'equippedTag', tag: 'sword' }, { kind: 'freePart', part: 'hands' }], effects: [{ kind: 'damage', damageType: 'physical', power: 6, scale: 1 }] },
        { id: 'core:dagger-strike', name: '匕首刺击', tags: ['physical', 'hand', 'melee'], cost: {}, target: { side: 'enemy', row: 'any', count: 'single', guard: true }, requirements: [{ kind: 'equippedTag', tag: 'dagger' }, { kind: 'freePart', part: 'hands' }], effects: [{ kind: 'damage', damageType: 'physical', power: 3, scale: 1 }] },
        { id: 'core:shortsword-strike', name: '短剑刺击', tags: ['physical', 'hand', 'melee'], cost: {}, target: { side: 'enemy', row: 'any', count: 'single', guard: true }, requirements: [{ kind: 'equippedTag', tag: 'shortsword' }, { kind: 'freePart', part: 'hands' }], effects: [{ kind: 'damage', damageType: 'physical', power: 4, scale: 1 }] },
        { id: 'core:staff-strike', name: '法杖敲击', tags: ['physical', 'hand', 'melee'], cost: {}, target: { side: 'enemy', row: 'any', count: 'single', guard: true }, requirements: [{ kind: 'equippedTag', tag: 'staff' }, { kind: 'freePart', part: 'hands' }], effects: [{ kind: 'damage', damageType: 'physical', power: 2, scale: 0.6 }] },
        { id: 'core:book-strike', name: '法术书拍击', tags: ['physical', 'hand', 'melee'], cost: {}, target: { side: 'enemy', row: 'any', count: 'single', guard: true }, requirements: [{ kind: 'equippedTag', tag: 'spellbook' }, { kind: 'freePart', part: 'hands' }], effects: [{ kind: 'damage', damageType: 'physical', power: 1, scale: 0.6 }] },
        { id: 'core:fireball', name: '火球术', tags: ['magic', 'mouth', 'chant'], cost: { mp: 5 }, target: { side: 'enemy', row: 'any', count: 'single', guard: false }, requirements: [{ kind: 'freePart', part: 'mouth' }, { kind: 'equippedAnyTag', tags: ['staff', 'spellbook'] }], effects: [{ kind: 'damage', damageType: 'magic', power: 6, scale: 1 }] },
        { id: 'core:fire-rain', name: '火雨术', tags: ['magic', 'mouth', 'chant'], cost: { mp: 10 }, target: { side: 'enemy', row: 'any', count: 'all', guard: false }, requirements: [{ kind: 'freePart', part: 'mouth' }, { kind: 'equippedAnyTag', tags: ['staff', 'spellbook'] }], effects: [{ kind: 'damage', damageType: 'magic', power: 4, scale: 0.8 }] },
        { id: 'core:disarm', name: '除你武器', tags: ['magic', 'mouth', 'chant'], cost: { mp: 5 }, target: { side: 'enemy', row: 'any', count: 'single', guard: false }, requirements: [{ kind: 'freePart', part: 'mouth' }, { kind: 'equippedAnyTag', tags: ['staff', 'spellbook'] }, { kind: 'targetEquipped', slot: 'weapon' }], effects: [{ kind: 'disarm', chance: 50 }] },
        { id: 'core:gale-thrust', name: '疾风刺', tags: ['physical', 'hand', 'move', 'melee'], cost: { sp: 5 }, target: { side: 'enemy', row: 'any', count: 'single', guard: false }, requirements: [{ kind: 'freePart', part: 'hands' }, { kind: 'freePart', part: 'feet' }, { kind: 'equippedAnyTag', tags: ['dagger', 'shortsword'] }, { kind: 'enemyFrontEmpty' }], effects: [{ kind: 'infiltrate', returnAt: 'phaseEnd' }, { kind: 'damage', damageType: 'physical', power: 3, scale: 1 }] },
    ],
    statuses: [
        { id: 'core:blind', name: '失明', duration: 2, accuracyMod: -30, tags: ['debuff'] },
        { id: 'core:bound-hands', name: '手部束缚', duration: null, blockedTags: ['hand', 'move'], tags: ['debuff', 'bound'] },
        { id: 'core:gagged', name: '堵嘴', duration: null, blockedTags: ['chant', 'mouth'], tags: ['debuff', 'gagged'] },
    ],
    equipment: [
        { id: 'core:sword', name: '长剑', slot: 'weapon', tags: ['sword'], stats: { patk: 2 }, skills: ['core:sword-strike'] },
        { id: 'core:staff', name: '法杖', slot: 'weapon', tags: ['staff'], stats: { matk: 2 }, skills: ['core:staff-strike'] },
        { id: 'core:spellbook', name: '法术书', slot: 'weapon', tags: ['spellbook'], stats: { matk: 2 }, skills: ['core:book-strike'] },
        { id: 'core:dagger', name: '匕首', slot: 'weapon', tags: ['dagger'], stats: { patk: 1 }, skills: ['core:dagger-strike'] },
        { id: 'core:shortsword', name: '短剑', slot: 'weapon', tags: ['shortsword'], stats: { patk: 1 }, skills: ['core:shortsword-strike'] },
        { id: 'core:rope', name: '绳索', slot: 'restraint', parts: ['hands'], tags: ['restraint'], statuses: ['core:bound-hands'], escapeChance: 60, escapeCost: { sp: 5 }, recoverable: false },
        { id: 'core:gag', name: '口枷', slot: 'restraint', parts: ['mouth'], tags: ['restraint'], statuses: ['core:gagged'], escapeChance: 35, escapeCost: { sp: 5 }, recoverable: true },
    ],
    items: [
        { id: 'core:potion', name: '治疗药剂', target: { side: 'ally', row: 'any', count: 'single', guard: false }, requirements: [{ kind: 'freePart', part: 'hands' }], effects: [{ kind: 'resource', resource: 'hp', amount: 15 }] },
        { id: 'core:lime', name: '石灰粉', target: { side: 'enemy', row: 'front', count: 'single', guard: false }, requirements: [{ kind: 'freePart', part: 'hands' }], effects: [{ kind: 'status', statusId: 'core:blind', chance: 70 }] },
        { id: 'core:rope-item', name: '套绳', target: { side: 'enemy', row: 'any', count: 'single', guard: false }, requirements: [{ kind: 'freePart', part: 'hands' }], effects: [{ kind: 'equipRestraint', equipmentId: 'core:rope', chance: 70 }] },
        { id: 'core:fire-scroll', name: '火球卷轴', target: { side: 'enemy', row: 'any', count: 'single', guard: false }, requirements: [{ kind: 'freePart', part: 'mouth' }], effects: [{ kind: 'damage', damageType: 'magic', power: 10, scale: 0.5 }] },
    ],
    enemies: [],
    aiProfiles: [],
};

export function collectDefinitions(packs, enabledIds = null) {
    const types = Object.fromEntries(CONTENT_TYPES.map(type => [type, new Map()]));
    const ids = enabledIds ? new Set(enabledIds) : null;
    for (const pack of packs || []) {
        if (ids && !ids.has(pack.id)) continue;
        for (const type of CONTENT_TYPES) for (const entry of asArray(pack[type]).filter(isObject)) if (entry.id) types[type].set(entry.id, entry);
    }
    return types;
}

export function validatePack(pack, existingPacks = []) {
    const errors = [];
    if (!isObject(pack) || pack.schema !== PACK_SCHEMA) return ['格式版本必须是 turn-battle-pack/v1'];
    if (!/^[a-z][a-z0-9_-]*$/.test(pack.id || '')) errors.push('内容包 ID 只能使用小写字母、数字、横线和下划线');
    if (!pack.name || typeof pack.name !== 'string') errors.push('缺少内容包名称');
    if (!pack.version || typeof pack.version !== 'string') errors.push('缺少版本号');
    const all = [...existingPacks.filter(p => p.id !== pack.id), pack];
    const seen = new Set();
    for (const type of CONTENT_TYPES) {
        if (pack[type] !== undefined && !Array.isArray(pack[type])) { errors.push(`${type} 必须是数组`); continue; }
        for (const entry of pack[type] || []) {
            if (!isObject(entry) || !ID_RE.test(entry.id || '') || !entry.id.startsWith(`${pack.id}:`)) { errors.push(`${type} 存在无效 ID`); continue; }
            if (seen.has(entry.id)) errors.push(`重复 ID：${entry.id}`);
            seen.add(entry.id);
            if (!entry.name || typeof entry.name !== 'string') errors.push(`${entry.id} 缺少名称`);
            if (type === 'skills' || type === 'items') {
                if (!Array.isArray(entry.effects) || !entry.effects.length) errors.push(`${entry.id} 缺少效果块`);
                if (entry.requirements !== undefined && !Array.isArray(entry.requirements)) errors.push(`${entry.id} 的 requirements 必须是数组`);
                if (!isObject(entry.target)) errors.push(`${entry.id} 缺少目标规则`);
                else if (!['enemy', 'ally', 'self'].includes(entry.target.side) || !['front', 'back', 'any'].includes(entry.target.row) || !['single', 'all'].includes(entry.target.count)) errors.push(`${entry.id} 目标规则无效`);
                for (const req of asArray(entry.requirements)) {
                    if (!isObject(req)) { errors.push(`${entry.id} 含无效条件块`); continue; }
                    if (!REQUIREMENT_KINDS.has(req.kind)) errors.push(`${entry.id} 包含未知条件：${req.kind}`);
                    if (['selfEquipment', 'targetEquipment', 'selfNotEquipment', 'targetNotEquipment'].includes(req.kind) && !req.equipmentId) errors.push(`${entry.id} 装备条件缺少 equipmentId`);
                    if (['selfStatus', 'targetStatus', 'selfNotStatus', 'targetNotStatus'].includes(req.kind) && !req.statusId) errors.push(`${entry.id} 状态条件缺少 statusId`);
                    if (['targetEquipped', 'targetNotEquipped', 'selfNotEquipped'].includes(req.kind) && !EQUIPMENT_SLOTS.has(req.slot)) errors.push(`${entry.id} 装备栏位条件无效`);
                }
                for (const effect of asArray(entry.effects)) {
                    if (!isObject(effect)) { errors.push(`${entry.id} 含无效效果块`); continue; }
                    if (!EFFECT_KINDS.has(effect.kind)) errors.push(`${entry.id} 包含未知效果：${effect.kind}`);
                    if (effect.kind === 'damage' && (!['physical', 'magic'].includes(effect.damageType) || !finite(effect.power) || effect.power < 0)) errors.push(`${entry.id} 伤害参数无效`);
                    if ((effect.kind === 'resource' || effect.kind === 'actionPoints') && !finite(effect.amount)) errors.push(`${entry.id} 资源或行动点数值无效`);
                    if (effect.kind === 'actionPoints' && (!Number.isInteger(effect.amount) || effect.amount < 0)) errors.push(`${entry.id} 行动点必须是非负整数`);
                    if (effect.kind === 'resource' && !effect.resource) errors.push(`${entry.id} 缺少资源 ID`);
                    if (['status', 'removeStatus'].includes(effect.kind) && !effect.statusId) errors.push(`${entry.id} 状态效果缺少 statusId`);
                    if (effect.kind === 'equipRestraint' && !effect.equipmentId) errors.push(`${entry.id} 拘束效果缺少 equipmentId`);
                    if (['removeEquipment', 'disableEquipment'].includes(effect.kind) && !EQUIPMENT_SLOTS.has(effect.slot)) errors.push(`${entry.id} 装备效果缺少合法栏位`);
                    if (effect.kind === 'disableEquipment' && (!Number.isInteger(effect.duration) || effect.duration < 1)) errors.push(`${entry.id} 装备封锁时长无效`);
                }
                for (const [resource, amount] of Object.entries(entry.cost || {})) if (!resource || !finite(amount) || amount < 0) errors.push(`${entry.id} 的消耗 ${resource} 无效`);
            }
            if (type === 'equipment' && !EQUIPMENT_SLOTS.has(entry.slot)) errors.push(`${entry.id} 装备栏位无效`);
            if (type === 'equipment' && entry.escapeChance !== undefined && (!finite(entry.escapeChance) || entry.escapeChance < 0 || entry.escapeChance > 100)) errors.push(`${entry.id} 挣脱概率无效`);
            if ((type === 'equipment' || type === 'statuses') && entry.bonusAp !== undefined && (!Number.isInteger(entry.bonusAp) || entry.bonusAp < 0 || entry.bonusAp > 3)) errors.push(`${entry.id} 额外行动点必须为 0–3`);
        }
    }
    const defs = collectDefinitions(all);
    for (const eq of asArray(pack.equipment).filter(isObject)) {
        for (const id of asArray(eq.skills)) if (!defs.skills.has(id)) errors.push(`${eq.id} 引用不存在的技能 ${id}`);
        for (const id of asArray(eq.statuses)) if (!defs.statuses.has(id)) errors.push(`${eq.id} 引用不存在的状态 ${id}`);
    }
    for (const entry of [...asArray(pack.skills), ...asArray(pack.items)].filter(isObject)) for (const effect of asArray(entry.effects).filter(isObject)) {
        if (effect.statusId && !defs.statuses.has(effect.statusId)) errors.push(`${entry.id} 引用不存在的状态 ${effect.statusId}`);
        if (effect.equipmentId && !defs.equipment.has(effect.equipmentId)) errors.push(`${entry.id} 引用不存在的装备 ${effect.equipmentId}`);
        if (effect.chance !== undefined && (!finite(effect.chance) || effect.chance < 0 || effect.chance > 100)) errors.push(`${entry.id} 概率必须在 0-100`);
    }
    for (const entry of [...asArray(pack.skills), ...asArray(pack.items)].filter(isObject)) for (const req of asArray(entry.requirements).filter(isObject)) {
        if (req.statusId && !defs.statuses.has(req.statusId)) errors.push(`${entry.id} 条件引用不存在的状态 ${req.statusId}`);
        if (req.equipmentId && !defs.equipment.has(req.equipmentId)) errors.push(`${entry.id} 条件引用不存在的装备 ${req.equipmentId}`);
    }
    for (const enemy of asArray(pack.enemies).filter(isObject)) {
        for (const id of asArray(enemy.skills)) if (!defs.skills.has(id)) errors.push(`${enemy.id} 引用不存在的技能 ${id}`);
        for (const id of Object.values(enemy.equipment || {}).flat()) if (id && !defs.equipment.has(id)) errors.push(`${enemy.id} 引用不存在的装备 ${id}`);
        if (enemy.aiProfile && !defs.aiProfiles.has(enemy.aiProfile)) errors.push(`${enemy.id} 引用不存在的 AI 策略 ${enemy.aiProfile}`);
    }
    for (const profile of asArray(pack.aiProfiles).filter(isObject)) {
        for (const id of asArray(profile.skillPriority)) if (!defs.skills.has(id)) errors.push(`${profile.id} 引用不存在的技能 ${id}`);
        for (const id of asArray(profile.itemPriority)) if (!defs.items.has(id)) errors.push(`${profile.id} 引用不存在的道具 ${id}`);
    }
    return errors;
}

export function parseBattleRequest(message) {
    const match = String(message || '').match(/<!--\s*TURN_BATTLE_REQUEST\s*([\s\S]*?)-->/i);
    if (!match) return null;
    try { return { data: JSON.parse(match[1].trim()), error: null }; }
    catch (error) { return { data: null, error: `战斗请求 JSON 无法解析：${error.message}` }; }
}

export function validateBattleRequest(request, definitions, limits = { allyFront: 2, allyBack: 2, enemyFront: 2, enemyBack: 2 }) {
    const errors = [];
    if (!isObject(request) || request.schema !== REQUEST_SCHEMA) return ['战斗请求格式版本错误'];
    if (!Array.isArray(request.actors) || !request.actors.length) return ['缺少参战者'];
    const used = new Set();
    const names = new Set();
    for (const actor of request.actors) {
        if (!isObject(actor)) { errors.push('参战者数据无效'); continue; }
        for (const field of ['skills', 'accessories', 'restraints', 'statuses']) if (actor[field] !== undefined && !Array.isArray(actor[field])) errors.push(`${actor.name || actor.id} 的 ${field} 必须是数组`);
        for (const field of ['resources', 'stats', 'equipment', 'items']) if (actor[field] !== undefined && !isObject(actor[field])) errors.push(`${actor.name || actor.id} 的 ${field} 必须是对象`);
        if (!actor.id || names.has(actor.id)) errors.push(`参战者 ID 缺失或重复：${actor.id || '?'}`);
        names.add(actor.id);
        if (!['ally', 'enemy'].includes(actor.side) || !['front', 'back'].includes(actor.row) || !Number.isInteger(actor.col)) errors.push(`${actor.name || actor.id} 站位无效`);
        else {
            const max = limits[`${actor.side}${actor.row === 'front' ? 'Front' : 'Back'}`];
            if (actor.col < 1 || actor.col > max) errors.push(`${actor.name || actor.id} 超出站位上限`);
            const slot = `${actor.side}/${actor.row}/${actor.col}`;
            if (used.has(slot)) errors.push(`站位重复：${slot}`);
            used.add(slot);
        }
        for (const key of ['hp', 'sp', 'mp']) {
            const resource = actor.resources?.[key];
            if (!isObject(resource) || !finite(resource.current) || !finite(resource.max) || resource.max < 0 || resource.current < 0 || resource.current > resource.max) errors.push(`${actor.name || actor.id} 的 ${key} 资源无效`);
        }
        for (const [key, resource] of Object.entries(actor.resources || {})) if (!isObject(resource) || !finite(resource.current) || !finite(resource.max) || resource.current < 0 || resource.max < 0 || resource.current > resource.max) errors.push(`${actor.name || actor.id} 的 ${key} 资源无效`);
        for (const [key, value] of Object.entries(actor.stats || {})) if (!finite(value)) errors.push(`${actor.name || actor.id} 的属性 ${key} 不是数字`);
        for (const id of Array.isArray(actor.skills) ? actor.skills : []) if (!definitions.skills.has(id)) errors.push(`${actor.name || actor.id} 引用未知技能 ${id}`);
        if (Array.isArray(actor.accessories) && actor.accessories.length > 5) errors.push(`${actor.name || actor.id} 饰品超过 5 件`);
        for (const [slot, id] of Object.entries(actor.equipment || {})) {
            if (id && !definitions.equipment.has(id)) errors.push(`${actor.name || actor.id} 引用未知装备 ${id}`);
            else if (id && definitions.equipment.get(id)?.slot !== slot) errors.push(`${actor.name || actor.id} 的 ${id} 不能放在 ${slot} 栏`);
        }
        for (const id of Array.isArray(actor.accessories) ? actor.accessories : []) if (id && definitions.equipment.get(id)?.slot !== 'accessory') errors.push(`${actor.name || actor.id} 的饰品 ${id} 无效`);
        for (const value of Array.isArray(actor.restraints) ? actor.restraints : []) {
            const id = typeof value === 'string' ? value : value?.id;
            if (!id || definitions.equipment.get(id)?.slot !== 'restraint') errors.push(`${actor.name || actor.id} 的拘束 ${id || '?'} 无效`);
        }
        for (const status of Array.isArray(actor.statuses) ? actor.statuses : []) if (!definitions.statuses.has(typeof status === 'string' ? status : status?.id)) errors.push(`${actor.name || actor.id} 引用未知状态`);
        for (const [id, count] of Object.entries(actor.items || {})) if (!definitions.items.has(id) || !Number.isInteger(count) || count < 0) errors.push(`${actor.name || actor.id} 的道具 ${id} 无效`);
        if (actor.aiProfile && !definitions.aiProfiles.has(actor.aiProfile)) errors.push(`${actor.name || actor.id} 引用未知 AI 策略 ${actor.aiProfile}`);
    }
    for (const [id, count] of Object.entries(request.bag || {})) if (!definitions.items.has(id) || !Number.isInteger(count) || count < 0) errors.push(`共用背包的道具 ${id} 无效`);
    if (!request.actors.some(a => a?.side === 'ally' && a.resources?.hp?.current > 0) || !request.actors.some(a => a?.side === 'enemy' && a.resources?.hp?.current > 0)) errors.push('双方都至少需要一名尚未倒下的参战者');
    if (errors.length) return errors;
    for (const actor of request.actors) {
        const gearSkills = [...Object.values(actor.equipment || {}), ...(actor.accessories || [])].filter(Boolean).flatMap(id => definitions.equipment.get(id)?.skills || []);
        const actionIds = [...new Set([...(actor.skills || []), ...gearSkills])];
        const itemIds = actor.side === 'ally' ? Object.keys(request.bag || {}) : Object.keys(actor.items || {});
        for (const definition of [...actionIds.map(id => definitions.skills.get(id)), ...itemIds.map(id => definitions.items.get(id))].filter(Boolean)) {
            const side = definition.target?.side === 'enemy' ? actor.side === 'ally' ? 'enemy' : 'ally' : actor.side;
            const candidates = request.actors.filter(target => target.side === side && (definition.target?.side !== 'self' || target.id === actor.id) && (definition.target?.row === 'any' || target.row === definition.target?.row));
            for (const effect of definition.effects || []) if (effect.kind === 'resource' && candidates.length && !candidates.some(target => target.resources?.[effect.resource])) errors.push(`${actor.name || actor.id} 的${definition.name}引用资源 ${effect.resource}，但目标方没有该资源`);
        }
    }
    return errors;
}

export function catalogText(packs) {
    return packs.map(pack => `${pack.name} (${pack.id}):\n${CONTENT_TYPES.map(type => (pack[type] || []).map(item => `- ${type} ${item.id} ${item.name}${item.description ? `：${item.description}` : ''}${type === 'enemies' ? `；建议模板 ${JSON.stringify({ stats: item.stats, resources: item.resources, skills: item.skills, equipment: item.equipment, aiProfile: item.aiProfile })}` : ''}`).join('\n')).filter(Boolean).join('\n')}`).join('\n\n');
}

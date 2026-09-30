import { CORE_PACK, CONTENT_TYPES, PACK_SCHEMA, collectDefinitions, validatePack, validateBattleRequest, parseBattleRequest, catalogText } from './content.js';
import { createBattle, availableSkills, legalTargets, emptyFrontColumns, executeAction, endAllyPhase, finishBattle, battleReport, lootableEnemyItems } from './engine.js';
import { generateWriterWorldbook, buildStoryPrompt } from './worldbook.js';

const MODULE = 'turn_battle';
const EXT_PATH = 'third-party/sillytavern-turn-battle';
const DEFAULT_LIMITS = { allyFront: 2, allyBack: 2, enemyFront: 2, enemyBack: 2 };
const CONTENT_TYPE_NAMES = { skills: '技能', statuses: '状态', equipment: '装备', items: '道具', allies: '我方角色', enemies: '敌人', aiProfiles: '敌方 AI' };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const context = () => SillyTavern.getContext();
let panel;
let tab = 'battle';
let importDraft = '';
let importErrors = [];
let importData = null;
let editorType = 'skills';
let editorPackId = null;
let editorEntryId = '';
let selectedActorId = null;
let selectedAction = null;
let selectedTargetId = null;
let actionMenu = 'skills';
let previewRequest = null;
let previewKey = null;
let previewPacks = null;
let interruptPending = false;

function settings() {
    const ctx = context();
    if (!ctx.extensionSettings[MODULE]) ctx.extensionSettings[MODULE] = { packs: [structuredClone(CORE_PACK)], limits: structuredClone(DEFAULT_LIMITS), fallbackBinding: { core: { mode: 'all' } } };
    const value = ctx.extensionSettings[MODULE];
    value.packs ||= [structuredClone(CORE_PACK)];
    value.limits ||= structuredClone(DEFAULT_LIMITS);
    value.fallbackBinding ||= { core: { mode: 'all' } };
    return value;
}

function saveSettings() { context().saveSettingsDebounced(); }

function currentCard() {
    const ctx = context();
    return Number.isInteger(ctx.characterId) ? ctx.characters?.[ctx.characterId] : null;
}

function binding() {
    const card = currentCard();
    return structuredClone(card?.data?.extensions?.[MODULE]?.binding || settings().fallbackBinding);
}

async function saveBinding(value) {
    const ctx = context();
    if (Number.isInteger(ctx.characterId) && ctx.writeExtensionField) {
        await ctx.writeExtensionField(ctx.characterId, MODULE, { binding: value });
    } else {
        settings().fallbackBinding = value;
        saveSettings();
    }
}

function resolveActive() {
    const all = settings().packs;
    const profile = binding();
    const direct = new Set();
    for (const pack of all) {
        const rule = profile[pack.id];
        if (!rule) continue;
        for (const type of CONTENT_TYPES) for (const entry of pack[type] || []) {
            if (rule.mode === 'all' || (rule.mode === 'categories' && (rule.categories || []).includes(type)) || (rule.mode === 'entries' && (rule.entries || []).includes(entry.id))) direct.add(entry.id);
        }
    }
    const allDefs = collectDefinitions(all);
    const needed = new Set(direct);
    if (allDefs.skills.has('core:unarmed')) needed.add('core:unarmed');
    const queue = [...direct];
    while (queue.length) {
        const id = queue.pop();
        const definition = CONTENT_TYPES.map(type => allDefs[type].get(id)).find(Boolean);
        if (!definition) continue;
        const refs = [...(definition.skills || []), ...(definition.suppressedSkills || []), ...(definition.statuses || []).map(value => typeof value === 'string' ? value : value.id), ...(definition.skillPriority || []), ...(definition.itemPriority || []), ...Object.values(definition.equipment || {}), ...(definition.accessories || []), ...(definition.restraints || []).map(value => typeof value === 'string' ? value : value.id), ...Object.keys(definition.items || {}), ...(definition.effects || []).flatMap(effect => [effect.statusId, effect.equipmentId]), ...(definition.requirements || []).flatMap(req => [req.statusId, req.equipmentId]), definition.aiProfile].filter(Boolean);
        for (const ref of refs) if (!needed.has(ref)) { needed.add(ref); queue.push(ref); }
    }
    const packs = all.map(pack => ({ ...pack, ...Object.fromEntries(CONTENT_TYPES.map(type => [type, (pack[type] || []).filter(entry => needed.has(entry.id))])) })).filter(pack => CONTENT_TYPES.some(type => pack[type].length));
    const visiblePacks = all.map(pack => ({ ...pack, ...Object.fromEntries(CONTENT_TYPES.map(type => [type, (pack[type] || []).filter(entry => direct.has(entry.id))])) })).filter(pack => CONTENT_TYPES.some(type => pack[type].length));
    return { packs, visiblePacks, selectableIds: direct };
}

function hash(text) {
    let value = 2166136261;
    for (const char of text) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619); }
    return (value >>> 0).toString(16);
}

function messageKey(index, message) { return `${index}-${hash(message?.mes || '')}`; }

function records() {
    const ctx = context();
    if (!ctx.chatMetadata) return {};
    ctx.chatMetadata[MODULE] ||= { records: {} };
    ctx.chatMetadata[MODULE].records ||= {};
    return ctx.chatMetadata[MODULE].records;
}

function activeRecordKey() { return context().chatMetadata?.[MODULE]?.activeKey; }

async function saveRecord(key, record) {
    records()[key] = record;
    context().chatMetadata[MODULE].activeKey = key;
    await context().saveMetadata?.();
}

function currentRecord() {
    const active = activeRecordKey();
    const chat = context().chat || [];
    if (active && records()[active] && (active.startsWith('manual-') || chat.some((message, index) => messageKey(index, message) === active))) return { key: active, ...records()[active] };
    for (let index = chat.length - 1; index >= 0; index--) {
        const key = messageKey(index, chat[index]);
        if (records()[key]) return { key, ...records()[key] };
    }
    return null;
}

function snapshotDifferences(request) {
    const prior = currentRecord()?.state;
    if (!prior || prior.status !== 'ended') return [];
    const changes = [];
    for (const actor of Array.isArray(request.actors) ? request.actors : []) {
        if (!actor || typeof actor !== 'object') continue;
        const old = prior.actors.find(x => x.id === actor.id);
        if (!old) { changes.push(`新增参战者：${actor.name || actor.id}`); continue; }
        for (const [id, resource] of Object.entries(actor.resources || {})) {
            const before = old.resources?.[id];
            if (before && resource && (before.current !== resource.current || before.max !== resource.max)) changes.push(`${actor.name || actor.id} ${id}：上次 ${before.current}/${before.max} → 本次 ${resource.current}/${resource.max}`);
        }
        for (const [field, label] of [['stats', '属性'], ['skills', '技能'], ['equipment', '装备'], ['accessories', '饰品'], ['restraints', '拘束'], ['statuses', '状态'], ['items', '个人道具'], ['row', '排位'], ['col', '位置'], ['side', '阵营']]) {
            if (JSON.stringify(old[field] || null) !== JSON.stringify(actor[field] || null)) changes.push(`${actor.name || actor.id} 的${label}与上次结算不同`);
        }
    }
    for (const old of prior.actors) if (!(Array.isArray(request.actors) ? request.actors : []).some(actor => actor?.id === old.id)) changes.push(`未参战：${old.name}`);
    if (JSON.stringify(prior.bag || {}) !== JSON.stringify(request.bag || {})) changes.push('共用背包与上次结算不同');
    return changes;
}

function validateEnabled(request, ids) {
    const errors = [];
    if (!request || typeof request !== 'object') return errors;
    const check = (id, place) => { if (id && !ids.has(id)) errors.push(`${place} 引用了此角色卡未启用的内容：${id}`); };
    for (const actor of Array.isArray(request.actors) ? request.actors : []) {
        if (!actor || typeof actor !== 'object') continue;
        for (const id of actor.skills || []) check(id, actor.name);
        check(actor.aiProfile, actor.name);
        for (const id of Object.values(actor.equipment || {}).flat()) check(id, actor.name);
        for (const id of actor.accessories || []) check(id, actor.name);
        for (const value of actor.restraints || []) check(typeof value === 'string' ? value : value.id, actor.name);
        for (const value of actor.statuses || []) check(typeof value === 'string' ? value : value.id, actor.name);
        for (const id of Object.keys(actor.items || {})) check(id, actor.name);
    }
    for (const id of Object.keys(request.bag || {})) check(id, '共用背包');
    return errors;
}

function requestErrors(request) {
    const active = previewPacks
        ? { packs: previewPacks, selectableIds: new Set(previewPacks.flatMap(pack => CONTENT_TYPES.flatMap(type => (pack[type] || []).map(entry => entry.id)))) }
        : resolveActive();
    const errors = validateBattleRequest(request, collectDefinitions(active.packs), settings().limits);
    return errors.length ? errors : validateEnabled(request, active.selectableIds);
}

function download(name, data, type = 'application/json') {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(value) {
    await navigator.clipboard.writeText(value);
    notice('已复制');
}

function notice(value) {
    const element = panel?.querySelector('.tb-notice');
    if (element) { element.textContent = value; setTimeout(() => { if (element.textContent === value) element.textContent = ''; }, 4000); }
}

function showPanel(nextTab = tab) {
    tab = nextTab;
    panel ||= document.createElement('div');
    panel.id = 'tb-panel';
    panel.popover = 'manual';
    if (!panel.isConnected) document.body.append(panel);
    panel.hidden = false;
    panel.style?.setProperty('z-index', '2147483647', 'important');
    try {
        if (typeof panel.showPopover === 'function' && !panel.matches(':popover-open')) panel.showPopover();
    } catch (error) { console.warn('回合战斗面板无法使用顶层显示，改用普通浮层', error); }
    try { render(); }
    catch (error) {
        console.error('回合战斗面板打开失败', error);
        panel.innerHTML = `<div class="tb-shell"><header><strong>回合战斗</strong><button class="tb-close" data-action="close">×</button></header><main><h2>面板打开失败</h2><p>${escapeHtml(error.message || String(error))}</p></main></div>`;
    }
}

function hidePanel() {
    if (!panel) return;
    if (typeof panel.hidePopover === 'function' && panel.matches(':popover-open')) panel.hidePopover();
    panel.hidden = true;
    interruptPending = false;
}

function render() {
    if (!panel || panel.hidden) return;
    const tabs = [['battle', '战斗'], ['packs', '内容包'], ['binding', '角色卡绑定'], ['import', '批量导入'], ['editor', '可视化编辑'], ['settings', '设置与提示词']];
    panel.innerHTML = `<div class="tb-shell"><header><strong>回合战斗</strong><span class="tb-notice" aria-live="polite"></span><button class="tb-close" data-action="close">×</button></header><nav>${tabs.map(([id, label]) => `<button data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`).join('')}</nav><main>${tab === 'battle' ? renderBattle() : tab === 'packs' ? renderPacks() : tab === 'binding' ? renderBinding() : tab === 'import' ? renderImport() : tab === 'editor' ? renderEditor() : renderSettings()}</main></div>`;
}

function resourceBars(actor) {
    return Object.entries(actor.resources || {}).map(([id, resource]) => `<span class="tb-resource">${escapeHtml(id)} ${escapeHtml(resource?.current)}/${escapeHtml(resource?.max)}</span>`).join('');
}

function renderBattle() {
    if (previewRequest) return renderPreview();
    const record = currentRecord();
    if (!record) return `<div class="tb-empty">当前聊天还没有战斗。剧情 AI 输出战斗请求后，点击消息下方的“开始战斗”。<p><button data-action="sample-preview">载入示例战斗并预览</button><button data-action="manual-preview">手动粘贴战斗请求</button></p></div>`;
    const state = record.state;
    const defs = collectDefinitions(state.definitions);
    const actor = state.actors.find(x => x.id === selectedActorId && x.side === 'ally' && x.ap > 0 && x.resources.hp.current > 0) || state.actors.find(x => x.side === 'ally' && x.ap > 0 && x.resources.hp.current > 0);
    selectedActorId = actor?.id || null;
    const actorOptions = state.actors.filter(x => x.side === 'ally' && x.resources.hp.current > 0 && x.ap > 0).map(x => `<option value="${escapeHtml(x.id)}" ${x.id === selectedActorId ? 'selected' : ''}>${escapeHtml(x.name)}（行动点 ${x.ap}）</option>`).join('');
    let actions = '';
    if (actor && state.status === 'active') {
        const choiceButton = (value, label, detail = '') => `<button type="button" class="tb-choice ${selectedAction === value ? 'active' : ''}" data-choice="${escapeHtml(value)}" aria-pressed="${selectedAction === value}"><strong>${escapeHtml(label)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</button>`;
        const skills = availableSkills(actor, defs).map(skill => choiceButton(`skill|${skill.id}`, skill.name, Object.entries(skill.cost || {}).map(([id, amount]) => `${id} ${amount}`).join(' · ') || '无消耗')).join('');
        const items = Object.entries(state.bag).filter(([id, count]) => count > 0 && defs.items.has(id)).map(([id, count]) => choiceButton(`item|${id}`, defs.items.get(id).name, `剩余 ${count}`)).join('');
        const restraints = (actor.restraints || []).map(x => choiceButton(`struggle|${x.instanceId}`, `挣扎：${defs.equipment.get(x.id)?.name || x.id}`)).join('');
        const drops = state.drops.filter(x => x.zone === (actor.zone || actor.side) && x.row === actor.row && x.col === actor.col).map(x => choiceButton(`pickup|${x.instanceId}`, `拾取：${defs.equipment.get(x.id)?.name || x.id}`)).join('');
        const choiceList = actionMenu === 'skills' ? skills || '<p>当前没有可选技能。</p>' : actionMenu === 'items' ? items || '<p>共用背包中没有可用道具。</p>' : actionMenu === 'move' ? '<p>移动消耗 1 次行动。</p>' : `${choiceButton('rest', '休息', '恢复精力与法力')}${restraints}${drops}`;
        const current = selectedAction || '';
        const actionDefinition = current.startsWith('skill|') ? defs.skills.get(current.slice(6)) : current.startsWith('item|') ? defs.items.get(current.slice(5)) : null;
        const targets = actionDefinition ? legalTargets(state, actor, actionDefinition, defs) : [];
        const targetChosen = targets.some(x => x.id === selectedTargetId);
        const targetControl = actionDefinition?.target?.count === 'all' ? `<p>目标：${targets.map(x => escapeHtml(x.name)).join('、') || '无合法目标'}</p>` : actionDefinition ? `<div><b>选择目标</b><div class="tb-target-grid">${targets.map(x => `<button type="button" class="tb-target-choice ${selectedTargetId === x.id ? 'active' : ''}" data-target-id="${escapeHtml(x.id)}" aria-pressed="${selectedTargetId === x.id}">${escapeHtml(x.name)}<small>HP ${x.resources.hp.current}/${x.resources.hp.max}</small></button>`).join('') || '<p>无合法目标</p>'}</div></div>` : '';
        const landing = actionDefinition?.effects?.some(x => x.kind === 'infiltrate') ? `<label>突入落点 <select id="tb-landing">${emptyFrontColumns(state, actor.side === 'ally' ? 'enemy' : 'ally').map(col => `<option value="${col}">敌方前排 ${col}</option>`).join('')}</select></label>` : '';
        const canEnterEnemyFront = actor.row === 'front' && !actor.infiltration && !state.actors.some(x => x.side === 'enemy' && (x.zone || x.side) === 'enemy' && x.row === 'front' && x.resources.hp.current > 0) && emptyFrontColumns(state, 'enemy').length > 0;
        const moveDestinations = [['ally', 'front', '我方前排'], ['ally', 'back', '我方后排'], ...(canEnterEnemyFront ? [['enemy', 'front', '敌方前排']] : [])];
        const moveOptions = actor.infiltration ? [] : moveDestinations.flatMap(([zone, row, label]) => Array.from({ length: state.limits[`${zone}${row === 'front' ? 'Front' : 'Back'}`] }, (_, index) => index + 1).filter(col => !state.actors.some(x => x.resources.hp.current > 0 && (x.zone || x.side) === zone && x.row === row && x.col === col) && !state.actors.some(x => x.infiltration && x.side === zone && x.infiltration.home.row === row && x.infiltration.home.col === col)).map(col => `<option value="${zone}:${row}:${col}">${label} ${col}</option>`));
        const moves = current === 'move' ? `<label>目的地 <select id="tb-move-destination">${moveOptions.join('')}</select></label><p>移动消耗 1 次行动。进入敌方前排后，可用近战技能攻击敌方后排；返回我方需再次移动。</p>` : '';
        const menus = [['skills', '技能'], ['items', '道具'], ['move', '移动'], ['other', '其他']].map(([id, label]) => `<button type="button" data-menu="${id}" class="${actionMenu === id ? 'active' : ''}" aria-pressed="${actionMenu === id}">${label}</button>`).join('');
        const canExecute = Boolean(current) && (current !== 'move' || moveOptions.length > 0) && (!actionDefinition || (targets.length > 0 && (actionDefinition.target?.count === 'all' || targetChosen)));
        actions = `<section class="tb-command"><label>行动者 <select id="tb-actor">${actorOptions}</select></label><div class="tb-command-grid">${menus}</div><div class="tb-choice-grid">${choiceList}</div>${targetControl}${landing}${moves}<button data-action="execute" class="tb-execute" ${canExecute ? '' : 'disabled'}>确认行动</button></section>`;
    }
    if (state.status === 'active' && state.phase === 'ally') actions += `<section class="tb-phase-controls">${actor ? '' : '<p>玩家方本阶段已无行动点，请结束阶段让敌方行动。</p>'}<button data-action="end-phase">结束玩家阶段，让敌方行动</button></section>`;
    const combatants = ['ally', 'enemy'].map(side => `<div class="tb-side"><h3>${side === 'ally' ? '玩家方' : '敌方'}</h3>${['front', 'back'].map(row => `<div class="tb-row"><b>${row === 'front' ? '前排' : '后排'}</b>${Array.from({ length: state.limits[`${side}${row === 'front' ? 'Front' : 'Back'}`] }, (_, i) => { const x = state.actors.find(a => (a.zone || a.side) === side && a.row === row && a.col === i + 1 && a.resources.hp.current > 0); return `<div class="tb-slot">${x ? `<strong>${escapeHtml(x.name)}</strong>${resourceBars(x)}<small>AP ${x.ap} · ${(x.statuses || []).map(s => escapeHtml(defs.statuses.get(s.id)?.name || s.id)).join('、')}${(x.restraints || []).map(r => escapeHtml(defs.equipment.get(r.id)?.name || r.id)).join('、')}</small>` : '空位'}</div>`; }).join('')}</div>`).join('')}</div>`).join('');
    const livingEnemies = state.actors.filter(x => x.side === 'enemy' && x.resources.hp.current > 0).length;
    const report = state.status === 'ended'
        ? `<section class="tb-report"><h3>战斗结束：${escapeHtml(state.result)}</h3><button data-action="copy-short">复制简要报告</button><button data-action="copy-full">复制完整报告</button><button data-action="close">返回聊天</button><textarea readonly>${escapeHtml(battleReport(state, false))}</textarea>${renderLoot(state, defs)}<button data-action="sample-preview" class="tb-secondary">重新试玩示例战斗</button></section>`
        : `<section class="tb-end-options"><p>敌方仍有 ${livingEnemies} 名单位未倒下。全部倒下后会自动判定胜利。</p>${interruptPending ? '<p>提前中断会立即结束战斗并生成“中断”报告，即使敌人仍有生命。</p><button data-action="confirm-interrupt">确认中断战斗</button><button data-action="cancel-interrupt" class="tb-secondary">继续战斗</button>' : '<details><summary>提前结束这场战斗</summary><button data-action="request-interrupt" class="tb-secondary">中断并生成报告</button></details>'}</section>`;
    const roster = state.actors.filter(x => x.side === 'enemy').map(x => `<span>${escapeHtml(x.name)} ${x.resources.hp.current}/${x.resources.hp.max}</span>`).join('');
    const battlefield = `<details class="tb-battlefield"><summary>查看双方站位与资源</summary><div class="tb-field">${combatants}</div></details>`;
    const log = `<details class="tb-log"><summary>查看战斗记录</summary>${state.log.slice(-20).map(x => `<div>第${x.round}轮：${escapeHtml(x.text)}</div>`).join('')}</details>`;
    return `<div class="tb-battle"><h2>${escapeHtml(state.scene || '战斗')} · 第 ${state.round} 轮 · ${state.phase === 'ally' ? '玩家阶段' : '敌方阶段'}</h2>${state.status === 'active' ? `<div class="tb-roster">敌方：${roster}</div>${actions}${report}${battlefield}${log}` : `${report}${battlefield}${log}`}</div>`;
}

function renderLoot(state, defs) {
    const enemyItems = lootableEnemyItems(state);
    if (!state.drops.length && !enemyItems.length) return '<p>没有可拾取物品。</p>';
    return `<div class="tb-loot"><h4>战后手动拾取</h4><p>可拾取战场掉落武器和已倒下敌人剩余的道具。</p>${state.drops.map(drop => `<label><input type="checkbox" class="tb-loot-check" value="${escapeHtml(drop.instanceId)}">${escapeHtml(defs.equipment.get(drop.id)?.name || drop.id)}（${escapeHtml(drop.row)} ${drop.col}）</label>`).join('')}${enemyItems.map(({ actor, id, count }) => `<label><input type="checkbox" class="tb-loot-item-check" data-actor="${escapeHtml(actor.id)}" value="${escapeHtml(id)}">${escapeHtml(actor.name)}的${escapeHtml(defs.items.get(id)?.name || id)} ×${count}</label>`).join('')}<button data-action="settle-loot">确认拾取所选物品</button></div>`;
}

function renderPreview() {
    const request = previewRequest && typeof previewRequest === 'object' ? previewRequest : {};
    const errors = requestErrors(request);
    const differences = snapshotDifferences(request);
    const actors = (Array.isArray(request.actors) ? request.actors : []).filter(x => x && typeof x === 'object').map(x => `<div class="tb-preview-actor"><b>${escapeHtml(x.name)} · ${x.side === 'ally' ? '玩家方' : '敌方'} ${escapeHtml(x.row)} ${escapeHtml(x.col)}</b>${resourceBars(x)}<small>属性：${escapeHtml(JSON.stringify(x.stats || {}))}<br>技能：${escapeHtml((Array.isArray(x.skills) ? x.skills : []).join('、') || '无')}<br>装备：${escapeHtml(JSON.stringify(x.equipment || {}))}<br>饰品：${escapeHtml(JSON.stringify(x.accessories || []))}<br>拘束：${escapeHtml(JSON.stringify(x.restraints || []))}<br>状态：${escapeHtml(JSON.stringify(x.statuses || []))}<br>个人道具：${escapeHtml(JSON.stringify(x.items || {}))}</small></div>`).join('');
    return `<div><h2>开战预览</h2><p>${escapeHtml(request.scene || '')}</p>${previewPacks ? '<p>示例战斗已临时载入基础测试包，不修改当前角色卡绑定。</p>' : ''}<div class="tb-preview-list">${actors}</div><p>玩家共用背包：${escapeHtml(JSON.stringify(request.bag || {}))}</p>${differences.length ? `<section class="tb-pack"><h3>与上次结算不同 · 本次 AI 快照将覆盖</h3>${differences.map(x => `<div>${escapeHtml(x)}</div>`).join('')}</section>` : ''}${errors.length ? `<div class="tb-errors">${errors.map(x => `<div>${escapeHtml(x)}</div>`).join('')}</div>` : '<p class="tb-ok">初始快照校验通过</p>'}<details><summary>编辑完整初始快照 JSON</summary><textarea id="tb-preview-json">${escapeHtml(JSON.stringify(request, null, 2))}</textarea><button data-action="apply-preview-json">应用修改</button></details><button data-action="confirm-battle" ${errors.length ? 'disabled' : ''}>确认开战</button><button data-action="cancel-preview" class="tb-secondary">取消</button></div>`;
}

function renderPacks() {
    const packs = settings().packs;
    return `<div><h2>内容包</h2><p>内容包在全局安装，角色卡可分别启用整包或部分条目。</p>${packs.map(pack => `<div class="tb-pack"><h3>${escapeHtml(pack.name)} <small>${escapeHtml(pack.id)} · ${escapeHtml(pack.version)}</small></h3><p>${CONTENT_TYPES.map(type => `${CONTENT_TYPE_NAMES[type]} ${(pack[type] || []).length}`).join(' · ')}</p><button data-action="export-pack" data-pack="${escapeHtml(pack.id)}">导出 JSON</button>${pack.id !== 'core' ? `<button data-action="remove-pack" data-pack="${escapeHtml(pack.id)}" class="tb-secondary">移除</button>` : ''}</div>`).join('')}<p><button data-action="load-sample-pack">载入基础测试包并预览</button><button data-tab="import">批量导入</button><button data-tab="editor">可视化创建</button></p></div>`;
}

function renderBinding() {
    const card = currentCard();
    const profile = binding();
    return `<div><h2>角色卡绑定</h2><p>当前：${escapeHtml(card?.name || '未选择单人角色卡（使用本地默认绑定）')}</p>${settings().packs.map(pack => { const rule = profile[pack.id] || { mode: 'off' }; return `<div class="tb-pack" data-bind-pack="${escapeHtml(pack.id)}"><h3>${escapeHtml(pack.name)}</h3><label>启用范围 <select class="tb-bind-mode" data-pack="${escapeHtml(pack.id)}"><option value="off" ${rule.mode === 'off' ? 'selected' : ''}>关闭</option><option value="all" ${rule.mode === 'all' ? 'selected' : ''}>整包</option><option value="categories" ${rule.mode === 'categories' ? 'selected' : ''}>按类别</option><option value="entries" ${rule.mode === 'entries' ? 'selected' : ''}>逐条目</option></select></label><div class="tb-bind-options">${CONTENT_TYPES.map(type => `<div><label><input type="checkbox" class="tb-bind-category" data-pack="${escapeHtml(pack.id)}" value="${type}" ${(rule.categories || []).includes(type) ? 'checked' : ''}>${CONTENT_TYPE_NAMES[type]}</label>${(pack[type] || []).map(entry => `<label class="tb-inline"><input type="checkbox" class="tb-bind-entry" data-pack="${escapeHtml(pack.id)}" value="${escapeHtml(entry.id)}" ${(rule.entries || []).includes(entry.id) ? 'checked' : ''}>${escapeHtml(entry.name)}</label>`).join('')}</div>`).join('')}</div></div>`; }).join('')}<button data-action="save-binding">保存此角色卡绑定</button><button data-action="copy-catalog">复制可用内容目录</button></div>`;
}

function renderImport() {
    const errors = importErrors.map(error => `<div>${escapeHtml(error)}</div>`).join('');
    const currentPack = settings().packs.find(pack => pack.id === importData?.id);
    const entryStatus = (type, entry) => { const old = (currentPack?.[type] || []).find(value => value.id === entry?.id); return !old ? '新增' : JSON.stringify(old) === JSON.stringify(entry) ? '未变' : '更新'; };
    const summary = importData ? `<div class="tb-import-summary"><h3>暂存预览：${escapeHtml(importData.name || importData.id)}</h3>${CONTENT_TYPES.map(type => { const entries = Array.isArray(importData[type]) ? importData[type] : []; return `<div><b>${CONTENT_TYPE_NAMES[type]}：${entries.length}</b>${entries.map(entry => `<div>${escapeHtml(entry?.id || '?')} · ${escapeHtml(entry?.name || '?')} · ${entryStatus(type, entry)}</div>`).join('')}</div>`; }).join('')}<p><label>同 ID 处理 <select id="tb-import-mode"><option value="replace">更新现有内容包</option><option value="skip">跳过同 ID 内容包</option></select></label></p><button data-action="commit-import" ${importErrors.length ? 'disabled' : ''}>确认整批导入</button></div>` : '';
    return `<div><h2>批量导入</h2><p>写卡助手可按导出的世界书生成 <code>${PACK_SCHEMA}</code> JSON。先校验，确认后整包导入。</p><label>上传 JSON 文件 <input type="file" id="tb-import-file" accept=".json,application/json"></label><textarea id="tb-import-text" placeholder="粘贴内容包 JSON">${escapeHtml(importDraft)}</textarea><button data-action="check-import">校验并预览</button>${errors ? `<div class="tb-errors">${errors}</div>` : ''}${summary}</div>`;
}

const EDITOR_TYPES = [['skills', '技能'], ['items', '道具'], ['equipment', '装备'], ['statuses', 'Buff / Debuff'], ['allies', '我方角色预设'], ['enemies', '敌人预设'], ['aiProfiles', '敌方 AI 策略']];
const SLOT_NAMES = { weapon: '武器', outer: '外衣', middle: '里衣', underwear: '内衣', legs: '腿部', feet: '足部', accessory: '饰品', restraint: '拘束' };
const UNIT_EQUIPMENT_SLOTS = ['weapon', 'outer', 'middle', 'underwear', 'legs', 'feet'];
const PART_NAMES = { hands: '手部', mouth: '嘴巴', feet: '足部' };
const CONDITION_NAMES = { freePart: '部位自由', equippedTag: '装备标签', equippedAnyTag: '装备任一标签', enemyFrontEmpty: '敌方前排有空位', targetEquipped: '目标装备栏非空', targetNotEquipped: '目标装备栏为空', selfNotEquipped: '自己装备栏为空', selfEquipment: '自己有指定装备', targetEquipment: '目标有指定装备', selfNotEquipment: '自己没有指定装备', targetNotEquipment: '目标没有指定装备', selfStatus: '自己有状态', targetStatus: '目标有状态', selfNotStatus: '自己没有状态', targetNotStatus: '目标没有状态' };
const EFFECT_NAMES = { damage: '伤害', resource: '资源变化', status: '施加状态', removeStatus: '解除状态', equipRestraint: '施加拘束装备', removeRestraint: '移除拘束装备', disarm: '击落武器', removeEquipment: '卸除装备', disableEquipment: '暂时封锁装备', infiltrate: '突入', actionPoints: '增加行动点' };
const option = (value, label, selected) => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
const inputValue = value => escapeHtml(value ?? '');
const formatStats = stats => Object.entries(stats || {}).map(([key, value]) => `${key}=${value}`).join('\n');
const formatResources = resources => Object.entries(resources || {}).map(([key, value]) => `${key}=${value.current}/${value.max}`).join('\n');
const instanceIds = values => (values || []).map(value => typeof value === 'string' ? value : value.id);
const preserveInstances = (ids, previous = []) => ids.map(id => previous.find(value => typeof value === 'object' && value?.id === id) || id);

function editorPack() { return settings().packs.find(pack => pack.id === editorPackId) || settings().packs[0]; }
function editorEntry() { return (editorPack()?.[editorType] || []).find(entry => entry.id === editorEntryId) || null; }

function namedEntries(type, filter = () => true) {
    return settings().packs.flatMap(pack => (pack[type] || []).filter(filter).map(entry => ({ ...entry, displayName: `${entry.name} · ${pack.name}` })));
}

function namedSelect(type, selected = '', filter = () => true, optional = false, elementId = '') {
    const entries = namedEntries(type, filter);
    const options = [option('', optional ? '不选择' : '请选择', selected), ...entries.map(entry => option(entry.id, entry.displayName, selected))];
    if (selected && !entries.some(entry => entry.id === selected)) options.push(option(selected, `未知引用：${selected}`, selected));
    return `<select ${elementId ? `id="${elementId}"` : ''} class="tb-ref">${options.join('')}</select>`;
}

function namedChecklist(id, label, type, selected = [], filter = () => true) {
    const selectedIds = instanceIds(selected);
    const chosen = new Set(selectedIds);
    const order = new Map(selectedIds.map((value, index) => [value, index]));
    const entries = namedEntries(type, filter).sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
    return `<fieldset class="tb-reference-list" id="${id}"><legend>${label}</legend>${entries.length ? entries.map(entry => `<label><input type="checkbox" value="${escapeHtml(entry.id)}" ${chosen.has(entry.id) ? 'checked' : ''}>${escapeHtml(entry.displayName)}</label>`).join('') : '<p>还没有可选条目，请先创建或导入内容。</p>'}</fieldset>`;
}

function simpleSelect(values, selected = '') { return `<select class="tb-ref">${Object.entries(values).map(([value, label]) => option(value, label, selected)).join('')}${selected && !Object.hasOwn(values, selected) ? option(selected, `自定义：${selected}`, selected) : ''}</select>`; }

function referenceControl(section, kind, value = '') {
    if (section === 'condition') {
        if (kind === 'enemyFrontEmpty') return '';
        if (kind === 'freePart') return simpleSelect(PART_NAMES, value || 'hands');
        if (['targetEquipped', 'targetNotEquipped', 'selfNotEquipped'].includes(kind)) return simpleSelect(SLOT_NAMES, value || 'weapon');
        if (['selfEquipment', 'targetEquipment', 'selfNotEquipment', 'targetNotEquipment'].includes(kind)) return namedSelect('equipment', value);
        if (['selfStatus', 'targetStatus', 'selfNotStatus', 'targetNotStatus'].includes(kind)) return namedSelect('statuses', value);
        return `<input class="tb-ref" value="${inputValue(value)}" placeholder="装备标签，多个用逗号分隔">`;
    }
    if (['status', 'removeStatus'].includes(kind)) return namedSelect('statuses', value);
    if (['equipRestraint', 'removeRestraint'].includes(kind)) return namedSelect('equipment', value, entry => entry.slot === 'restraint');
    if (['removeEquipment', 'disableEquipment'].includes(kind)) return simpleSelect(SLOT_NAMES, value || 'weapon');
    if (kind === 'resource') return `<input class="tb-ref" value="${inputValue(value || 'hp')}" placeholder="资源 ID，如 hp、sp、mp">`;
    return '';
}

function conditionReference(condition = {}) {
    if (condition.part) return condition.part;
    if (condition.slot) return condition.slot;
    if (condition.equipmentId) return condition.equipmentId;
    if (condition.statusId) return condition.statusId;
    if (condition.tags) return condition.tags.join(',');
    return condition.tag || '';
}

function effectReference(effect = {}) { return effect.statusId || effect.equipmentId || effect.slot || effect.resource || ''; }

function renderConditionBlock(condition = {}, index = null) {
    const kind = condition.kind || 'freePart';
    return `<div class="tb-block tb-condition" ${index === null ? '' : `data-source-index="${index}"`}><select class="tb-kind">${Object.entries(CONDITION_NAMES).map(([id, name]) => option(id, name, kind)).join('')}</select><span class="tb-ref-host">${referenceControl('condition', kind, conditionReference(condition))}</span><button type="button" class="tb-remove-block">×</button></div>`;
}

function renderEffectBlock(effect = {}, index = null) {
    const kind = effect.kind || 'damage';
    const amount = kind === 'damage' ? effect.power : kind === 'disableEquipment' ? effect.duration : effect.amount;
    const extra = kind === 'damage' ? effect.damageType : kind === 'infiltrate' ? effect.returnAt : 'physical';
    return `<div class="tb-block tb-effect" ${index === null ? '' : `data-source-index="${index}"`}><select class="tb-kind">${Object.entries(EFFECT_NAMES).map(([id, name]) => option(id, name, kind)).join('')}</select><span class="tb-ref-host">${referenceControl('effect', kind, effectReference(effect))}</span><input class="tb-amount" type="number" value="${inputValue(amount ?? 0)}" title="数值/威力/封锁时长"><input class="tb-chance" type="number" min="0" max="100" value="${inputValue(effect.chance ?? 100)}" title="成功率"><select class="tb-extra">${option('physical', '物理 / 技能结束返回', extra)}${option('magic', '魔法', extra)}${option('phaseEnd', '己方阶段结束返回', extra)}</select><button type="button" class="tb-remove-block">×</button></div>`;
}

function renderEditor() {
    const pack = editorPack();
    if (!pack) return '<p>没有内容包，请先导入内容包。</p>';
    editorPackId = pack.id;
    const entry = editorEntry();
    const packOptions = settings().packs.map(value => option(value.id, value.name, pack.id)).join('');
    const entries = pack[editorType] || [];
    return `<div><h2>可视化编辑</h2><p>可切换内容包、类别和已有条目；引用直接按名称选择。切换条目前请先保存当前修改。</p><div class="tb-grid"><label>内容包 <select id="tb-editor-pack">${packOptions}</select></label><label>类别 <select id="tb-editor-type">${EDITOR_TYPES.map(([value, label]) => option(value, label, editorType)).join('')}</select></label><label>选择已有条目 <select id="tb-editor-entry">${option('', '＋ 新建条目', editorEntryId)}${entries.map(value => option(value.id, value.name, editorEntryId)).join('')}</select></label></div><div class="tb-form"><label>ID 后缀 <input id="tb-editor-id" value="${inputValue(entry ? entry.id.slice(pack.id.length + 1) : '')}" placeholder="fireball" ${entry ? 'readonly' : ''}></label><label>名称 <input id="tb-editor-name" value="${inputValue(entry?.name)}" placeholder="火球术"></label><label>说明 <input id="tb-editor-description" value="${inputValue(entry?.description)}"></label>${editorType === 'skills' || editorType === 'items' ? renderActionEditorFields(entry) : editorType === 'equipment' ? renderEquipmentEditorFields(entry) : editorType === 'statuses' ? renderStatusEditorFields(entry) : editorType === 'allies' || editorType === 'enemies' ? renderUnitEditorFields(entry, editorType) : renderAiEditorFields(entry)}<button data-action="save-editor">${entry ? '校验并更新条目' : '校验并保存新条目'}</button></div></div>`;
}

function renderActionEditorFields(entry) {
    const target = entry?.target || {};
    return `<div class="tb-grid"><label>目标阵营 <select id="tb-ed-side">${option('enemy', '敌方', target.side || 'enemy')}${option('ally', '友方', target.side)}${option('self', '自己', target.side)}</select></label><label>目标排 <select id="tb-ed-row">${option('any', '前后排', target.row || 'any')}${option('front', '前排', target.row)}${option('back', '后排', target.row)}</select></label><label>目标数量 <select id="tb-ed-count">${option('single', '单体', target.count || 'single')}${option('all', '全体', target.count)}</select></label><label><input id="tb-ed-ignore-guard" type="checkbox" ${target.guard === false ? 'checked' : ''}>无视前排遮挡</label></div><div class="tb-grid"><label>精力消耗 <input id="tb-ed-sp" type="number" min="0" value="${inputValue(entry?.cost?.sp ?? 0)}"></label><label>法力消耗 <input id="tb-ed-mp" type="number" min="0" value="${inputValue(entry?.cost?.mp ?? 0)}"></label><label>标签（逗号分隔）<input id="tb-ed-tags" value="${inputValue((entry?.tags || []).join(','))}" placeholder="magic,mouth,chant"></label></div><h3>释放条件</h3><div id="tb-ed-conditions">${(entry?.requirements || []).map(renderConditionBlock).join('')}</div><button type="button" data-action="add-condition">添加条件</button><h3>效果块（按顺序执行）</h3><div id="tb-ed-effects">${(entry?.effects || []).map(renderEffectBlock).join('')}</div><button type="button" data-action="add-effect">添加效果</button>`;
}

function renderEquipmentEditorFields(entry) {
    return `<div class="tb-grid"><label>栏位 <select id="tb-ed-slot">${Object.entries(SLOT_NAMES).map(([id, name]) => option(id, name, entry?.slot || 'weapon')).join('')}</select></label><label>标签（逗号分隔）<input id="tb-ed-tags" value="${inputValue((entry?.tags || []).join(','))}"></label><label>额外行动点 <input id="tb-ed-bonus-ap" type="number" min="0" max="3" value="${inputValue(entry?.bonusAp ?? 0)}"></label><label>覆盖部位（拘束，逗号分隔）<input id="tb-ed-parts" value="${inputValue((entry?.parts || []).join(','))}" placeholder="hands,mouth"></label><label>挣脱成功率 <input id="tb-ed-escape" type="number" min="0" max="100" value="${inputValue(entry?.escapeChance ?? 50)}"></label></div>${namedChecklist('tb-ed-skills', '授予技能', 'skills', entry?.skills)}${namedChecklist('tb-ed-statuses', '被动状态', 'statuses', entry?.statuses)}<label>属性加成（每行 属性=数值）<textarea id="tb-ed-stats" placeholder="patk=2">${escapeHtml(formatStats(entry?.stats))}</textarea></label>`;
}

function renderStatusEditorFields(entry) {
    return `<div class="tb-grid"><label>持续行动阶段（留空为永久）<input id="tb-ed-duration" type="number" min="1" value="${inputValue(entry?.duration)}"></label><label>叠加上限 <input id="tb-ed-max-stacks" type="number" min="1" value="${inputValue(entry?.maxStacks ?? 1)}"></label><label>命中率修正 <input id="tb-ed-accuracy" type="number" value="${inputValue(entry?.accuracyMod ?? 0)}"></label><label>额外行动点 <input id="tb-ed-bonus-ap" type="number" min="0" max="3" value="${inputValue(entry?.bonusAp ?? 0)}"></label><label>封锁标签（如 hand、chant、move）<input id="tb-ed-blocked" value="${inputValue((entry?.blockedTags || []).join(','))}"></label><label>标签（逗号分隔）<input id="tb-ed-tags" value="${inputValue((entry?.tags || []).join(','))}"></label></div>${namedChecklist('tb-ed-skills', '授予技能', 'skills', entry?.skills)}${namedChecklist('tb-ed-suppressed-skills', '封锁指定技能（可选）', 'skills', entry?.suppressedSkills)}<label>属性加成（每行 属性=数值）<textarea id="tb-ed-stats">${escapeHtml(formatStats(entry?.stats))}</textarea></label>`;
}

function renderUnitEditorFields(entry, type) {
    const ally = type === 'allies';
    const resources = entry?.resources || { hp: { current: 30, max: 30 }, sp: { current: 20, max: 20 }, mp: { current: 0, max: 0 } };
    const equipment = UNIT_EQUIPMENT_SLOTS.map(slot => `<label>${SLOT_NAMES[slot]} ${namedSelect('equipment', entry?.equipment?.[slot], value => value.slot === slot, true, `tb-ed-eq-${slot}`)}</label>`).join('');
    const enemyFields = ally ? '<p>我方道具使用战斗快照中的共用背包，不给单个角色设置个人道具。</p>' : `<label>敌方 AI 策略 ${namedSelect('aiProfiles', entry?.aiProfile, () => true, true, 'tb-ed-ai-profile')}</label><fieldset class="tb-reference-list" id="tb-ed-items"><legend>个人道具数量</legend>${namedEntries('items').map(item => `<label>${escapeHtml(item.displayName)} <input class="tb-item-count" data-id="${escapeHtml(item.id)}" type="number" min="0" value="${inputValue(entry?.items?.[item.id] ?? 0)}"></label>`).join('') || '<p>还没有可选道具。</p>'}</fieldset>`;
    return `<p>${ally ? '我方角色' : '敌人'}预设提供建议初始值；每场实际资源和装备仍由剧情 AI 提交并在开战预览中确认。</p><div class="tb-grid"><label>建议排位 <select id="tb-ed-unit-row">${option('front', '前排', entry?.row || 'front')}${option('back', '后排', entry?.row)}</select></label><label>建议位置 <input id="tb-ed-unit-col" type="number" min="1" value="${inputValue(entry?.col ?? 1)}"></label></div><label>属性（每行 属性=数值）<textarea id="tb-ed-stats" placeholder="patk=8">${escapeHtml(formatStats(entry?.stats))}</textarea></label><label>资源（每行 资源=当前/上限）<textarea id="tb-ed-resources">${escapeHtml(formatResources(resources))}</textarea></label>${namedChecklist('tb-ed-skills', '固有技能', 'skills', entry?.skills)}<details class="tb-unit-details" open><summary>装备、饰品、拘束与状态</summary><div class="tb-grid">${equipment}</div>${namedChecklist('tb-ed-accessories', '饰品（最多 5 件）', 'equipment', entry?.accessories, value => value.slot === 'accessory')}${namedChecklist('tb-ed-restraints', '初始拘束', 'equipment', entry?.restraints, value => value.slot === 'restraint')}${namedChecklist('tb-ed-unit-statuses', '初始 Buff / Debuff', 'statuses', entry?.statuses)}</details>${enemyFields}`;
}

function renderAiEditorFields(entry) {
    return `${namedChecklist('tb-ed-skills', '技能优先顺序（按列表从上到下）', 'skills', entry?.skillPriority)}${namedChecklist('tb-ed-items', '优先使用道具', 'items', entry?.itemPriority)}<label><input id="tb-ed-use-items" type="checkbox" ${entry?.useItems === false ? '' : 'checked'}>允许使用个人道具</label>`;
}

function renderSettings() {
    const limits = settings().limits;
    return `<div><h2>设置与提示词</h2><div class="tb-grid">${Object.entries(limits).map(([key, value]) => `<label>${escapeHtml(key)} <input class="tb-limit" data-key="${key}" type="number" min="1" max="12" value="${value}"></label>`).join('')}</div><button data-action="save-limits">保存位置上限</button><h3>剧情 AI 开战提示词</h3><p>把下方提示词放进当前剧情预设；内容目录来自此角色卡绑定。</p><textarea readonly id="tb-story-prompt">${escapeHtml(buildStoryPrompt(catalogText(resolveActive().visiblePacks)))}</textarea><button data-action="copy-prompt">复制提示词</button><h3>写卡助手世界书</h3><p>按照当前导入格式生成可导入酒馆的 World Info JSON。</p><button data-action="export-worldbook">导出世界书 JSON</button><button data-action="copy-worldbook">复制世界书 JSON</button><h3>手动开战</h3><button data-action="sample-preview">载入示例战斗并预览</button><button data-action="manual-preview">粘贴初始快照并预览</button></div>`;
}

function list(value) { return String(value || '').split(/[,，\n]/).map(x => x.trim()).filter(Boolean); }
function checkedValues(selector) { return [...panel.querySelectorAll(`${selector} input[type="checkbox"]:checked`)].map(input => input.value); }

function parseStats(value) {
    const stats = {};
    for (const line of String(value || '').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const [key, raw] = line.split('=');
        if (!key || raw === undefined || !Number.isFinite(Number(raw))) throw new Error(`属性行无效：${line}`);
        stats[key.trim()] = Number(raw);
    }
    return stats;
}

function parseResources(value) {
    const resources = {};
    for (const line of String(value || '').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const match = line.trim().match(/^([^=\s]+)\s*=\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
        if (!match) throw new Error(`资源行无效：${line}，应写成 hp=30/30`);
        const current = Number(match[2]); const max = Number(match[3]);
        if (current < 0 || max < 0 || current > max) throw new Error(`资源数值无效：${line}`);
        if (resources[match[1]]) throw new Error(`资源重复：${match[1]}`);
        resources[match[1]] = { current, max };
    }
    for (const key of ['hp', 'sp', 'mp']) if (!resources[key]) throw new Error(`角色预设缺少 ${key} 资源`);
    return resources;
}

function addCondition() {
    const root = panel.querySelector('#tb-ed-conditions');
    if (!root) return;
    root.insertAdjacentHTML('beforeend', renderConditionBlock());
}

function addEffect() {
    const root = panel.querySelector('#tb-ed-effects');
    if (!root) return;
    root.insertAdjacentHTML('beforeend', renderEffectBlock());
}

function readEditorEntry() {
    const value = selector => panel.querySelector(selector)?.value || '';
    const previous = editorEntry();
    const id = previous?.id || `${value('#tb-editor-pack')}:${value('#tb-editor-id').trim().toLowerCase().replace(/\s+/g, '-')}`;
    const name = value('#tb-editor-name').trim();
    if (!name || id.endsWith(':')) throw new Error('需要 ID 后缀和名称');
    const entry = { ...(previous ? structuredClone(previous) : {}), id, name, description: value('#tb-editor-description').trim() };
    if (editorType === 'skills' || editorType === 'items') {
        entry.tags = list(value('#tb-ed-tags'));
        entry.target = { ...(previous?.target || {}), side: value('#tb-ed-side'), row: value('#tb-ed-row'), count: value('#tb-ed-count'), guard: !panel.querySelector('#tb-ed-ignore-guard')?.checked };
        if (editorType === 'skills') {
            entry.cost = { ...(previous?.cost || {}) };
            delete entry.cost.sp; delete entry.cost.mp;
            for (const key of ['sp', 'mp']) { const amount = Number(value(`#tb-ed-${key}`)); if (amount > 0) entry.cost[key] = amount; }
        }
        entry.requirements = [...panel.querySelectorAll('.tb-condition')].map(row => {
            const kind = row.querySelector('.tb-kind').value;
            const ref = row.querySelector('.tb-ref')?.value.trim() || '';
            const original = previous?.requirements?.[Number(row.dataset.sourceIndex)];
            const base = original?.kind === kind ? structuredClone(original) : {};
            if (kind === 'freePart') return { ...base, kind, part: ref || 'hands' };
            if (kind === 'equippedTag') return { ...base, kind, tag: ref };
            if (kind === 'equippedAnyTag') return { ...base, kind, tags: list(ref) };
            if (kind === 'enemyFrontEmpty') return { ...base, kind };
            if (['targetEquipped', 'targetNotEquipped', 'selfNotEquipped'].includes(kind)) return { ...base, kind, slot: ref || 'weapon' };
            if (['selfEquipment', 'targetEquipment', 'selfNotEquipment', 'targetNotEquipment'].includes(kind)) return { ...base, kind, equipmentId: ref };
            return { ...base, kind, statusId: ref };
        });
        entry.effects = [...panel.querySelectorAll('.tb-effect')].map(row => {
            const kind = row.querySelector('.tb-kind').value;
            const ref = row.querySelector('.tb-ref')?.value.trim() || '';
            const amount = Number(row.querySelector('.tb-amount').value);
            const chance = Number(row.querySelector('.tb-chance').value);
            const extra = row.querySelector('.tb-extra').value;
            const original = previous?.effects?.[Number(row.dataset.sourceIndex)];
            const base = original?.kind === kind ? structuredClone(original) : {};
            if (kind === 'damage') return { ...base, kind, damageType: extra === 'magic' ? 'magic' : 'physical', power: amount, scale: base.scale ?? 1, chance };
            if (kind === 'resource') return { ...base, kind, resource: ref || 'hp', amount, chance };
            if (kind === 'status' || kind === 'removeStatus') return { ...base, kind, statusId: ref, chance };
            if (kind === 'equipRestraint' || kind === 'removeRestraint') return { ...base, kind, equipmentId: ref, chance };
            if (kind === 'removeEquipment' || kind === 'disableEquipment') return { ...base, kind, slot: ref || 'weapon', ...(kind === 'disableEquipment' ? { duration: amount || 1 } : {}), chance };
            if (kind === 'infiltrate') return { ...base, kind, returnAt: extra === 'phaseEnd' ? 'phaseEnd' : 'skillEnd' };
            if (kind === 'actionPoints') return { ...base, kind, amount };
            return { ...base, kind, chance };
        });
        if (!entry.effects.length) throw new Error('至少添加一个效果块');
    } else if (editorType === 'equipment') {
        entry.slot = value('#tb-ed-slot'); entry.tags = list(value('#tb-ed-tags'));
        entry.skills = checkedValues('#tb-ed-skills'); entry.statuses = checkedValues('#tb-ed-statuses');
        entry.parts = list(value('#tb-ed-parts')); entry.stats = parseStats(value('#tb-ed-stats')); entry.bonusAp = Number(value('#tb-ed-bonus-ap'));
        if (entry.slot === 'restraint') { entry.escapeChance = Number(value('#tb-ed-escape')); entry.escapeCost ||= { sp: 5 }; }
    } else if (editorType === 'statuses') {
        entry.duration = value('#tb-ed-duration') ? Number(value('#tb-ed-duration')) : null;
        entry.maxStacks = Number(value('#tb-ed-max-stacks'));
        entry.accuracyMod = Number(value('#tb-ed-accuracy')); entry.blockedTags = list(value('#tb-ed-blocked'));
        entry.skills = checkedValues('#tb-ed-skills'); entry.suppressedSkills = checkedValues('#tb-ed-suppressed-skills');
        entry.tags = list(value('#tb-ed-tags')); entry.stats = parseStats(value('#tb-ed-stats')); entry.bonusAp = Number(value('#tb-ed-bonus-ap'));
    } else if (editorType === 'allies' || editorType === 'enemies') {
        entry.row = value('#tb-ed-unit-row'); entry.col = Number(value('#tb-ed-unit-col'));
        entry.stats = parseStats(value('#tb-ed-stats')); entry.resources = parseResources(value('#tb-ed-resources'));
        entry.skills = checkedValues('#tb-ed-skills');
        entry.equipment = { ...(previous?.equipment || {}) };
        for (const slot of UNIT_EQUIPMENT_SLOTS) entry.equipment[slot] = value(`#tb-ed-eq-${slot}`) || null;
        entry.accessories = checkedValues('#tb-ed-accessories');
        entry.restraints = preserveInstances(checkedValues('#tb-ed-restraints'), previous?.restraints);
        entry.statuses = preserveInstances(checkedValues('#tb-ed-unit-statuses'), previous?.statuses);
        if (editorType === 'enemies') {
            entry.aiProfile = value('#tb-ed-ai-profile') || null;
            const items = [...panel.querySelectorAll('.tb-item-count')].map(input => [input.dataset.id, Number(input.value)]);
            if (items.some(([, count]) => !Number.isInteger(count) || count < 0)) throw new Error('个人道具数量必须是非负整数');
            entry.items = Object.fromEntries(items.filter(([, count]) => count > 0));
        } else delete entry.items;
    } else {
        entry.skillPriority = checkedValues('#tb-ed-skills');
        entry.itemPriority = checkedValues('#tb-ed-items');
        entry.useItems = panel.querySelector('#tb-ed-use-items')?.checked ?? true;
    }
    return entry;
}

async function saveEditorEntry() {
    const entry = readEditorEntry();
    const packId = panel.querySelector('#tb-editor-pack').value;
    const pack = settings().packs.find(x => x.id === packId);
    if (!pack) throw new Error('内容包不存在');
    const next = structuredClone(pack);
    next[editorType] ||= [];
    const index = next[editorType].findIndex(x => x.id === entry.id);
    if (index >= 0 && editorEntryId !== entry.id) throw new Error('此 ID 已存在，请选择该条目后修改');
    if (index >= 0) next[editorType][index] = entry; else next[editorType].push(entry);
    const errors = validatePack(next, settings().packs);
    if (errors.length) throw new Error(errors.join('；'));
    settings().packs = settings().packs.map(x => x.id === packId ? next : x);
    saveSettings();
    editorEntryId = entry.id;
    render(); notice(`已保存 ${entry.name}`);
}

function checkImport() {
    const raw = panel.querySelector('#tb-import-text')?.value || '';
    importDraft = raw;
    try {
        const clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        importData = JSON.parse(clean);
        importErrors = validatePack(importData, settings().packs);
    } catch (error) { importData = null; importErrors = [`JSON 无法解析：${error.message}`]; }
    render();
}

async function loadSamplePack() {
    const response = await fetch(new URL('./examples/基础测试内容包.json', import.meta.url));
    if (!response.ok) throw new Error(`测试包加载失败：HTTP ${response.status}`);
    importData = await response.json();
    importDraft = JSON.stringify(importData, null, 2);
    importErrors = validatePack(importData, settings().packs);
    tab = 'import'; render();
}

async function loadSampleBattle() {
    const [packResponse, requestResponse] = await Promise.all([
        fetch(new URL('./examples/基础测试内容包.json', import.meta.url)),
        fetch(new URL('./examples/基础测试开战快照.json', import.meta.url)),
    ]);
    if (!packResponse.ok) throw new Error(`测试包加载失败：HTTP ${packResponse.status}`);
    if (!requestResponse.ok) throw new Error(`示例快照加载失败：HTTP ${requestResponse.status}`);
    const [pack, request] = await Promise.all([packResponse.json(), requestResponse.json()]);
    const errors = validatePack(pack, [CORE_PACK]);
    if (errors.length) throw new Error(`测试包无效：${errors.join('；')}`);
    previewPacks = [CORE_PACK, pack];
    previewRequest = request;
    previewKey = `manual-${Date.now()}`;
    tab = 'battle'; render();
}

function commitImport() {
    if (!importData || importErrors.length) throw new Error('请先通过校验');
    const mode = panel.querySelector('#tb-import-mode')?.value || 'replace';
    const exists = settings().packs.some(pack => pack.id === importData.id);
    if (exists && mode === 'skip') { notice('已跳过同 ID 内容包'); return; }
    settings().packs = [...settings().packs.filter(pack => pack.id !== importData.id), structuredClone(importData)];
    saveSettings();
    importData = null; importDraft = ''; importErrors = [];
    tab = 'packs'; render(); notice('内容包已导入');
}

function getBindingFromUi() {
    const result = {};
    for (const pack of settings().packs) {
        const mode = panel.querySelector(`.tb-bind-mode[data-pack="${CSS.escape(pack.id)}"]`)?.value || 'off';
        if (mode === 'off') continue;
        result[pack.id] = { mode, categories: [...panel.querySelectorAll(`.tb-bind-category[data-pack="${CSS.escape(pack.id)}"]:checked`)].map(x => x.value), entries: [...panel.querySelectorAll(`.tb-bind-entry[data-pack="${CSS.escape(pack.id)}"]:checked`)].map(x => x.value) };
    }
    return result;
}

function scanBattleButtons() {
    const chat = context().chat || [];
    chat.forEach((message, index) => {
        if (message.is_user) return;
        const parsed = parseBattleRequest(message.mes);
        if (!parsed) return;
        const element = document.querySelector(`.mes[mesid="${index}"] .mes_text`) || document.querySelector(`.mes[data-message-id="${index}"] .mes_text`);
        if (!element) return;
        const existing = element.querySelector('.tb-start-button');
        if (existing) { existing.textContent = records()[messageKey(index, message)] ? '查看战斗' : parsed.error ? '修复战斗请求' : '开始战斗'; return; }
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'tb-start-button menu_button';
        button.textContent = records()[messageKey(index, message)] ? '查看战斗' : parsed.error ? '修复战斗请求' : '开始战斗';
        button.addEventListener('click', () => {
            const key = messageKey(index, message);
            if (records()[key]) { context().chatMetadata[MODULE].activeKey = key; void context().saveMetadata?.(); previewRequest = null; previewPacks = null; showPanel('battle'); return; }
            previewKey = key;
            previewPacks = null;
            previewRequest = parsed.data || { schema: 'turn-battle-request/v1', scene: '', actors: [], bag: {} };
            showPanel('battle');
            if (parsed.error) notice(parsed.error);
        });
        element.append(button);
    });
}

async function handlePanelClick(event) {
    const button = event.target.closest('button');
    if (!button || !panel.contains(button)) return;
    if (button.dataset.tab) { tab = button.dataset.tab; render(); return; }
    if (button.dataset.menu) { actionMenu = button.dataset.menu; selectedAction = actionMenu === 'move' ? 'move' : null; selectedTargetId = null; render(); return; }
    if (button.dataset.choice) { selectedAction = button.dataset.choice; selectedTargetId = null; render(); return; }
    if (button.dataset.targetId) { selectedTargetId = button.dataset.targetId; render(); return; }
    const action = button.dataset.action;
    if (!action) return;
    try {
        if (action === 'close') hidePanel();
        else if (action === 'copy-prompt') await copy(buildStoryPrompt(catalogText(resolveActive().visiblePacks)));
        else if (action === 'export-worldbook' || action === 'copy-worldbook') {
            const data = JSON.stringify(generateWriterWorldbook(catalogText(resolveActive().visiblePacks)), null, 2);
            if (action === 'copy-worldbook') await copy(data); else download('回合战斗-写卡助手世界书.json', data);
        } else if (action === 'save-limits') {
            for (const input of panel.querySelectorAll('.tb-limit')) settings().limits[input.dataset.key] = Math.max(1, Math.min(12, Number(input.value) || 1));
            saveSettings(); notice('位置上限已保存');
        } else if (action === 'export-pack') {
            const pack = settings().packs.find(x => x.id === button.dataset.pack);
            if (pack) download(`${pack.id}-${pack.version}.json`, JSON.stringify(pack, null, 2));
        } else if (action === 'remove-pack') {
            settings().packs = settings().packs.filter(x => x.id !== button.dataset.pack); saveSettings(); render();
        } else if (action === 'save-binding') { await saveBinding(getBindingFromUi()); render(); notice('角色卡绑定已保存'); }
        else if (action === 'copy-catalog') await copy(catalogText(resolveActive().visiblePacks));
        else if (action === 'check-import') checkImport();
        else if (action === 'load-sample-pack') await loadSamplePack();
        else if (action === 'sample-preview') await loadSampleBattle();
        else if (action === 'commit-import') commitImport();
        else if (action === 'add-condition') addCondition();
        else if (action === 'add-effect') addEffect();
        else if (action === 'save-editor') await saveEditorEntry();
        else if (action === 'manual-preview') { previewKey = `manual-${Date.now()}`; previewPacks = null; previewRequest = { schema: 'turn-battle-request/v1', scene: '', actors: [], bag: {} }; tab = 'battle'; render(); }
        else if (action === 'cancel-preview') { previewRequest = null; previewKey = null; previewPacks = null; render(); }
        else if (action === 'apply-preview-json') { previewRequest = JSON.parse(panel.querySelector('#tb-preview-json').value); render(); }
        else if (action === 'confirm-battle') {
            const errors = requestErrors(previewRequest);
            if (errors.length) throw new Error(errors.join('；'));
            const state = createBattle(previewRequest, previewPacks || resolveActive().packs, settings().limits);
            await saveRecord(previewKey, { state, messageKey: previewKey });
            previewRequest = null; previewKey = null; previewPacks = null; interruptPending = false; selectedActorId = null; selectedAction = null; selectedTargetId = null; actionMenu = 'skills'; render(); scanBattleButtons();
        } else if (action === 'execute') await performAction();
        else if (action === 'end-phase') await updateBattle(endAllyPhase);
        else if (action === 'request-interrupt') { interruptPending = true; render(); }
        else if (action === 'cancel-interrupt') { interruptPending = false; render(); }
        else if (action === 'confirm-interrupt') {
            if (!interruptPending) throw new Error('请先选择提前结束战斗');
            await updateBattle(state => finishBattle(state, '中断'));
        }
        else if (action === 'copy-short' || action === 'copy-full') { const record = currentRecord(); if (record) await copy(battleReport(record.state, action === 'copy-full')); }
        else if (action === 'settle-loot') await settleLoot();
    } catch (error) { notice(error.message || String(error)); }
}

async function updateBattle(transform) {
    const record = currentRecord();
    if (!record) throw new Error('当前没有战斗');
    const state = transform(record.state);
    await saveRecord(record.key, { state, messageKey: record.key });
    selectedAction = null; selectedTargetId = null; interruptPending = false; render();
}

async function performAction() {
    const record = currentRecord();
    if (!record) throw new Error('当前没有战斗');
    const actorId = panel.querySelector('#tb-actor')?.value;
    const choice = selectedAction;
    if (!choice) throw new Error('请选择行动');
    const [type, id] = choice.split('|');
    const action = { type, actorId };
    if (id) action.id = id;
    if (type === 'skill' || type === 'item') {
        const definition = type === 'skill' ? collectDefinitions(record.state.definitions).skills.get(id) : collectDefinitions(record.state.definitions).items.get(id);
        if (definition?.target?.count !== 'all' && !selectedTargetId) throw new Error('请选择目标');
        action.targetId = selectedTargetId;
        action.landingCol = Number(panel.querySelector('#tb-landing')?.value) || undefined;
    } else if (type === 'struggle') action.restraintInstanceId = id;
    else if (type === 'pickup') action.dropId = id;
    else if (type === 'move') { const [zone, row, col] = (panel.querySelector('#tb-move-destination')?.value || '').split(':'); action.zone = zone; action.row = row; action.col = Number(col); }
    await updateBattle(state => executeAction(state, action));
}

async function settleLoot() {
    const selected = new Set([...panel.querySelectorAll('.tb-loot-check:checked')].map(x => x.value));
    const selectedItems = [...panel.querySelectorAll('.tb-loot-item-check:checked')].map(x => ({ actorId: x.dataset.actor, id: x.value }));
    await updateBattle(state => {
        const next = structuredClone(state);
        if (next.status !== 'ended') throw new Error('战斗未结束，不能拾取战利品');
        next.gearBag ||= {};
        for (const drop of next.drops.filter(x => selected.has(x.instanceId))) next.gearBag[drop.id] = (next.gearBag[drop.id] || 0) + 1;
        next.drops = next.drops.filter(x => !selected.has(x.instanceId));
        let itemCount = 0;
        for (const choice of selectedItems) {
            const enemy = lootableEnemyItems(next).find(x => x.actor.id === choice.actorId && x.id === choice.id)?.actor;
            const count = enemy?.items?.[choice.id] || 0;
            if (!count) continue;
            next.bag[choice.id] = (next.bag[choice.id] || 0) + count;
            enemy.items[choice.id] = 0;
            itemCount += count;
        }
        if (selected.size || itemCount) next.log.push({ round: next.round, phase: next.phase, text: `战后拾取 ${selected.size} 件装备、${itemCount} 件道具` });
        return next;
    });
}

function handlePanelChange(event) {
    if (event.target.id === 'tb-editor-pack') { editorPackId = event.target.value; editorEntryId = ''; render(); }
    else if (event.target.id === 'tb-editor-type') { editorType = event.target.value; editorEntryId = ''; render(); }
    else if (event.target.id === 'tb-editor-entry') { editorEntryId = event.target.value; render(); }
    else if (event.target.classList?.contains('tb-kind')) {
        const row = event.target.closest('.tb-block');
        const host = row?.querySelector('.tb-ref-host');
        if (host) host.innerHTML = referenceControl(row.classList.contains('tb-condition') ? 'condition' : 'effect', event.target.value);
    }
    else if (event.target.id === 'tb-actor') { selectedActorId = event.target.value; selectedAction = null; selectedTargetId = null; render(); }
}

async function init() {
    settings();
    const ctx = context();
    const html = await ctx.renderExtensionTemplateAsync(EXT_PATH, 'settings');
    document.querySelector('#extensions_settings2')?.insertAdjacentHTML('beforeend', html);
    document.addEventListener('click', event => {
        if (!event.target?.closest?.('#tb-open')) return;
        event.preventDefault();
        showPanel('battle');
    }, true);
    panel = document.createElement('div'); panel.id = 'tb-panel'; panel.hidden = true; document.body.append(panel);
    panel.addEventListener('click', event => { if (event.target.classList.contains('tb-remove-block')) event.target.closest('.tb-block').remove(); else void handlePanelClick(event); });
    panel.addEventListener('change', handlePanelChange);
    panel.addEventListener('change', async event => {
        if (event.target.id !== 'tb-import-file') return;
        const file = event.target.files?.[0];
        if (!file) return;
        importDraft = await file.text(); importData = null; importErrors = [];
        render();
    });
    const events = ctx.event_types || ctx.eventTypes || {};
    for (const name of ['CHARACTER_MESSAGE_RENDERED', 'CHAT_CHANGED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED']) if (events[name]) ctx.eventSource.on(events[name], () => setTimeout(() => { scanBattleButtons(); if (panel && !panel.hidden) render(); }, 100));
    scanBattleButtons();
}

const ctx = context();
const ready = (ctx.event_types || ctx.eventTypes || {}).APP_READY;
if (ready) ctx.eventSource.on(ready, init); else window.addEventListener('load', init, { once: true });

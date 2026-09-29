import { CORE_PACK, CONTENT_TYPES, PACK_SCHEMA, collectDefinitions, validatePack, validateBattleRequest, parseBattleRequest, catalogText } from './content.js';
import { createBattle, availableSkills, legalTargets, emptyFrontColumns, executeAction, endAllyPhase, finishBattle, battleReport } from './engine.js';
import { generateWriterWorldbook, buildStoryPrompt } from './worldbook.js';

const MODULE = 'turn_battle';
const EXT_PATH = 'third-party/sillytavern-turn-battle';
const DEFAULT_LIMITS = { allyFront: 2, allyBack: 2, enemyFront: 2, enemyBack: 2 };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const context = () => SillyTavern.getContext();
let panel;
let tab = 'battle';
let importDraft = '';
let importErrors = [];
let importData = null;
let editorType = 'skills';
let selectedActorId = null;
let selectedAction = null;
let previewRequest = null;
let previewKey = null;

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
        const refs = [...(definition.skills || []), ...(definition.statuses || []), ...(definition.skillPriority || []), ...(definition.itemPriority || []), ...(definition.effects || []).flatMap(effect => [effect.statusId, effect.equipmentId]), ...(definition.requirements || []).flatMap(req => [req.statusId, req.equipmentId]), definition.aiProfile].filter(Boolean);
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
    const active = resolveActive();
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
    const actorOptions = state.actors.filter(x => x.side === 'ally' && x.resources.hp.current > 0).map(x => `<option value="${escapeHtml(x.id)}" ${x.id === selectedActorId ? 'selected' : ''}>${escapeHtml(x.name)}（行动点 ${x.ap}）</option>`).join('');
    let actions = '';
    if (actor && state.status === 'active') {
        const skills = availableSkills(actor, defs).map(skill => `<option value="skill|${escapeHtml(skill.id)}">技能：${escapeHtml(skill.name)}</option>`).join('');
        const items = Object.entries(state.bag).filter(([, count]) => count > 0).map(([id, count]) => `<option value="item|${escapeHtml(id)}">道具：${escapeHtml(defs.items.get(id)?.name || id)} ×${count}</option>`).join('');
        const restraints = (actor.restraints || []).map(x => `<option value="struggle|${escapeHtml(x.instanceId)}">挣扎：${escapeHtml(defs.equipment.get(x.id)?.name || x.id)}</option>`).join('');
        const drops = state.drops.filter(x => x.zone === actor.side && x.row === actor.row && x.col === actor.col).map(x => `<option value="pickup|${escapeHtml(x.instanceId)}">拾取：${escapeHtml(defs.equipment.get(x.id)?.name || x.id)}</option>`).join('');
        const choices = `<option value="">选择行动</option>${skills}${items}${restraints}${drops}<option value="rest">休息</option><option value="move">移动</option>`;
        const current = selectedAction || '';
        const actionDefinition = current.startsWith('skill|') ? defs.skills.get(current.slice(6)) : current.startsWith('item|') ? defs.items.get(current.slice(5)) : null;
        const targets = actionDefinition ? legalTargets(state, actor, actionDefinition, defs) : [];
        const targetControl = actionDefinition?.target?.count === 'all' ? `<p>目标：${targets.map(x => escapeHtml(x.name)).join('、') || '无合法目标'}</p>` : actionDefinition ? `<label>目标 <select id="tb-target">${targets.map(x => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join('')}</select></label>` : '';
        const landing = actionDefinition?.effects?.some(x => x.kind === 'infiltrate') ? `<label>突入落点 <select id="tb-landing">${emptyFrontColumns(state, actor.side === 'ally' ? 'enemy' : 'ally').map(col => `<option value="${col}">敌方前排 ${col}</option>`).join('')}</select></label>` : '';
        const moves = current === 'move' ? `<label>排 <select id="tb-move-row"><option value="front">前排</option><option value="back">后排</option></select></label><label>位置 <input id="tb-move-col" type="number" min="1" value="1"></label>` : '';
        actions = `<section class="tb-action-form"><label>行动者 <select id="tb-actor">${actorOptions}</select></label><label>行动 <select id="tb-action">${choices.replace(`value="${escapeHtml(current)}"`, `value="${escapeHtml(current)}" selected`)}</select></label>${targetControl}${landing}${moves}<button data-action="execute" ${actionDefinition && !targets.length ? 'disabled' : ''}>执行行动</button><button data-action="end-phase">结束玩家阶段</button></section>`;
    }
    const combatants = ['ally', 'enemy'].map(side => `<div class="tb-side"><h3>${side === 'ally' ? '玩家方' : '敌方'}</h3>${['front', 'back'].map(row => `<div class="tb-row"><b>${row === 'front' ? '前排' : '后排'}</b>${Array.from({ length: state.limits[`${side}${row === 'front' ? 'Front' : 'Back'}`] }, (_, i) => { const x = state.actors.find(a => (a.zone || a.side) === side && a.row === row && a.col === i + 1 && a.resources.hp.current > 0); return `<div class="tb-slot">${x ? `<strong>${escapeHtml(x.name)}</strong>${resourceBars(x)}<small>AP ${x.ap} · ${(x.statuses || []).map(s => escapeHtml(defs.statuses.get(s.id)?.name || s.id)).join('、')}${(x.restraints || []).map(r => escapeHtml(defs.equipment.get(r.id)?.name || r.id)).join('、')}</small>` : '空位'}</div>`; }).join('')}</div>`).join('')}</div>`).join('');
    const report = state.status === 'ended' ? `<section class="tb-report"><h3>战斗结束：${escapeHtml(state.result)}</h3><button data-action="copy-short">复制简要报告</button><button data-action="copy-full">复制完整报告</button><textarea readonly>${escapeHtml(battleReport(state, false))}</textarea>${renderLoot(state, defs)}</section>` : `<button data-action="interrupt" class="tb-secondary">中断并生成报告</button>`;
    return `<div class="tb-battle"><h2>${escapeHtml(state.scene || '战斗')} · 第 ${state.round} 轮 · ${state.phase === 'ally' ? '玩家阶段' : '敌方阶段'}</h2><div class="tb-field">${combatants}</div>${actions}<section class="tb-log"><h3>战斗记录</h3>${state.log.slice(-20).map(x => `<div>第${x.round}轮：${escapeHtml(x.text)}</div>`).join('')}</section>${report}</div>`;
}

function renderLoot(state, defs) {
    const enemyItems = state.actors.filter(actor => actor.side === 'enemy').flatMap(actor => Object.entries(actor.items || {}).filter(([, count]) => count > 0).map(([id, count]) => ({ actor, id, count })));
    if (!state.drops.length && !enemyItems.length) return '<p>没有可拾取物品。</p>';
    return `<div class="tb-loot"><h4>战后手动拾取</h4>${state.drops.map(drop => `<label><input type="checkbox" class="tb-loot-check" value="${escapeHtml(drop.instanceId)}">${escapeHtml(defs.equipment.get(drop.id)?.name || drop.id)}（${escapeHtml(drop.row)} ${drop.col}）</label>`).join('')}${enemyItems.map(({ actor, id, count }) => `<label><input type="checkbox" class="tb-loot-item-check" data-actor="${escapeHtml(actor.id)}" value="${escapeHtml(id)}">${escapeHtml(actor.name)}的${escapeHtml(defs.items.get(id)?.name || id)} ×${count}</label>`).join('')}<button data-action="settle-loot">确认拾取所选物品</button></div>`;
}

function renderPreview() {
    const request = previewRequest && typeof previewRequest === 'object' ? previewRequest : {};
    const errors = requestErrors(request);
    const differences = snapshotDifferences(request);
    const actors = (Array.isArray(request.actors) ? request.actors : []).filter(x => x && typeof x === 'object').map(x => `<div class="tb-preview-actor"><b>${escapeHtml(x.name)} · ${x.side === 'ally' ? '玩家方' : '敌方'} ${escapeHtml(x.row)} ${escapeHtml(x.col)}</b>${resourceBars(x)}<small>属性：${escapeHtml(JSON.stringify(x.stats || {}))}<br>技能：${escapeHtml((Array.isArray(x.skills) ? x.skills : []).join('、') || '无')}<br>装备：${escapeHtml(JSON.stringify(x.equipment || {}))}<br>饰品：${escapeHtml(JSON.stringify(x.accessories || []))}<br>拘束：${escapeHtml(JSON.stringify(x.restraints || []))}<br>状态：${escapeHtml(JSON.stringify(x.statuses || []))}<br>个人道具：${escapeHtml(JSON.stringify(x.items || {}))}</small></div>`).join('');
    return `<div><h2>开战预览</h2><p>${escapeHtml(request.scene || '')}</p><div class="tb-preview-list">${actors}</div><p>玩家共用背包：${escapeHtml(JSON.stringify(request.bag || {}))}</p>${differences.length ? `<section class="tb-pack"><h3>与上次结算不同 · 本次 AI 快照将覆盖</h3>${differences.map(x => `<div>${escapeHtml(x)}</div>`).join('')}</section>` : ''}${errors.length ? `<div class="tb-errors">${errors.map(x => `<div>${escapeHtml(x)}</div>`).join('')}</div>` : '<p class="tb-ok">初始快照校验通过</p>'}<details><summary>编辑完整初始快照 JSON</summary><textarea id="tb-preview-json">${escapeHtml(JSON.stringify(request, null, 2))}</textarea><button data-action="apply-preview-json">应用修改</button></details><button data-action="confirm-battle" ${errors.length ? 'disabled' : ''}>确认开战</button><button data-action="cancel-preview" class="tb-secondary">取消</button></div>`;
}

function renderPacks() {
    const packs = settings().packs;
    return `<div><h2>内容包</h2><p>内容包在全局安装，角色卡可分别启用整包或部分条目。</p>${packs.map(pack => `<div class="tb-pack"><h3>${escapeHtml(pack.name)} <small>${escapeHtml(pack.id)} · ${escapeHtml(pack.version)}</small></h3><p>${CONTENT_TYPES.map(type => `${type} ${(pack[type] || []).length}`).join(' · ')}</p><button data-action="export-pack" data-pack="${escapeHtml(pack.id)}">导出 JSON</button>${pack.id !== 'core' ? `<button data-action="remove-pack" data-pack="${escapeHtml(pack.id)}" class="tb-secondary">移除</button>` : ''}</div>`).join('')}<p><button data-action="load-sample-pack">载入基础测试包并预览</button><button data-tab="import">批量导入</button><button data-tab="editor">可视化创建</button></p></div>`;
}

function renderBinding() {
    const card = currentCard();
    const profile = binding();
    return `<div><h2>角色卡绑定</h2><p>当前：${escapeHtml(card?.name || '未选择单人角色卡（使用本地默认绑定）')}</p>${settings().packs.map(pack => { const rule = profile[pack.id] || { mode: 'off' }; return `<div class="tb-pack" data-bind-pack="${escapeHtml(pack.id)}"><h3>${escapeHtml(pack.name)}</h3><label>启用范围 <select class="tb-bind-mode" data-pack="${escapeHtml(pack.id)}"><option value="off" ${rule.mode === 'off' ? 'selected' : ''}>关闭</option><option value="all" ${rule.mode === 'all' ? 'selected' : ''}>整包</option><option value="categories" ${rule.mode === 'categories' ? 'selected' : ''}>按类别</option><option value="entries" ${rule.mode === 'entries' ? 'selected' : ''}>逐条目</option></select></label><div class="tb-bind-options">${CONTENT_TYPES.map(type => `<div><label><input type="checkbox" class="tb-bind-category" data-pack="${escapeHtml(pack.id)}" value="${type}" ${(rule.categories || []).includes(type) ? 'checked' : ''}>${type}</label>${(pack[type] || []).map(entry => `<label class="tb-inline"><input type="checkbox" class="tb-bind-entry" data-pack="${escapeHtml(pack.id)}" value="${escapeHtml(entry.id)}" ${(rule.entries || []).includes(entry.id) ? 'checked' : ''}>${escapeHtml(entry.name)}</label>`).join('')}</div>`).join('')}</div></div>`; }).join('')}<button data-action="save-binding">保存此角色卡绑定</button><button data-action="copy-catalog">复制可用内容目录</button></div>`;
}

function renderImport() {
    const errors = importErrors.map(error => `<div>${escapeHtml(error)}</div>`).join('');
    const currentPack = settings().packs.find(pack => pack.id === importData?.id);
    const entryStatus = (type, entry) => { const old = (currentPack?.[type] || []).find(value => value.id === entry?.id); return !old ? '新增' : JSON.stringify(old) === JSON.stringify(entry) ? '未变' : '更新'; };
    const summary = importData ? `<div class="tb-import-summary"><h3>暂存预览：${escapeHtml(importData.name || importData.id)}</h3>${CONTENT_TYPES.map(type => { const entries = Array.isArray(importData[type]) ? importData[type] : []; return `<div><b>${type}：${entries.length}</b>${entries.map(entry => `<div>${escapeHtml(entry?.id || '?')} · ${escapeHtml(entry?.name || '?')} · ${entryStatus(type, entry)}</div>`).join('')}</div>`; }).join('')}<p><label>同 ID 处理 <select id="tb-import-mode"><option value="replace">更新现有内容包</option><option value="skip">跳过同 ID 内容包</option></select></label></p><button data-action="commit-import" ${importErrors.length ? 'disabled' : ''}>确认整批导入</button></div>` : '';
    return `<div><h2>批量导入</h2><p>写卡助手可按导出的世界书生成 <code>${PACK_SCHEMA}</code> JSON。先校验，确认后整包导入。</p><label>上传 JSON 文件 <input type="file" id="tb-import-file" accept=".json,application/json"></label><textarea id="tb-import-text" placeholder="粘贴内容包 JSON">${escapeHtml(importDraft)}</textarea><button data-action="check-import">校验并预览</button>${errors ? `<div class="tb-errors">${errors}</div>` : ''}${summary}</div>`;
}

function renderEditor() {
    const packOptions = settings().packs.map(pack => `<option value="${escapeHtml(pack.id)}">${escapeHtml(pack.name)}</option>`).join('');
    const types = [['skills', '技能'], ['items', '道具'], ['equipment', '装备'], ['statuses', 'Buff / Debuff'], ['enemies', '敌人预设'], ['aiProfiles', '敌方 AI 策略']];
    return `<div><h2>可视化创建</h2><p>常用字段以表单填写；复杂条件和效果可逐块添加。创建后仍要经过与批量导入相同的校验。</p><label>保存到内容包 <select id="tb-editor-pack">${packOptions}</select></label><label>类别 <select id="tb-editor-type">${types.map(([value, label]) => `<option value="${value}" ${editorType === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div class="tb-form"><label>ID 后缀 <input id="tb-editor-id" placeholder="fireball"></label><label>名称 <input id="tb-editor-name" placeholder="火球术"></label><label>说明 <input id="tb-editor-description"></label>${editorType === 'skills' || editorType === 'items' ? renderActionEditorFields() : editorType === 'equipment' ? renderEquipmentEditorFields() : editorType === 'statuses' ? renderStatusEditorFields() : editorType === 'enemies' ? renderEnemyEditorFields() : renderAiEditorFields()}<button data-action="save-editor">校验并保存条目</button></div></div>`;
}

function renderActionEditorFields() {
    return `<div class="tb-grid"><label>目标阵营 <select id="tb-ed-side"><option value="enemy">敌方</option><option value="ally">友方</option><option value="self">自己</option></select></label><label>目标排 <select id="tb-ed-row"><option value="any">前后排</option><option value="front">前排</option><option value="back">后排</option></select></label><label>目标数量 <select id="tb-ed-count"><option value="single">单体</option><option value="all">全体</option></select></label><label><input id="tb-ed-ignore-guard" type="checkbox">无视前排遮挡</label></div><div class="tb-grid"><label>精力消耗 <input id="tb-ed-sp" type="number" min="0" value="0"></label><label>法力消耗 <input id="tb-ed-mp" type="number" min="0" value="0"></label><label>标签（逗号分隔）<input id="tb-ed-tags" placeholder="magic,mouth,chant"></label></div><h3>释放条件</h3><div id="tb-ed-conditions"></div><button type="button" data-action="add-condition">添加条件</button><h3>效果块（按顺序执行）</h3><div id="tb-ed-effects"></div><button type="button" data-action="add-effect">添加效果</button>`;
}

function renderEquipmentEditorFields() {
    return `<div class="tb-grid"><label>栏位 <select id="tb-ed-slot"><option value="weapon">武器</option><option value="outer">外衣</option><option value="middle">里衣</option><option value="underwear">内衣</option><option value="legs">腿部</option><option value="feet">足部</option><option value="accessory">饰品</option><option value="restraint">拘束</option></select></label><label>标签（逗号分隔）<input id="tb-ed-tags"></label><label>授予技能 ID（逗号分隔）<input id="tb-ed-skills"></label><label>被动状态 ID（逗号分隔）<input id="tb-ed-statuses"></label><label>额外行动点 <input id="tb-ed-bonus-ap" type="number" min="0" max="3" value="0"></label><label>覆盖部位（拘束，逗号分隔）<input id="tb-ed-parts" placeholder="hands,mouth"></label><label>挣脱成功率 <input id="tb-ed-escape" type="number" min="0" max="100" value="50"></label></div><label>属性加成（每行 属性=数值）<textarea id="tb-ed-stats" placeholder="patk=2"></textarea></label>`;
}

function renderStatusEditorFields() {
    return `<div class="tb-grid"><label>持续行动阶段（留空为永久）<input id="tb-ed-duration" type="number" min="1"></label><label>命中率修正 <input id="tb-ed-accuracy" type="number" value="0"></label><label>额外行动点 <input id="tb-ed-bonus-ap" type="number" min="0" max="3" value="0"></label><label>禁用技能标签（逗号分隔）<input id="tb-ed-blocked"></label><label>标签（逗号分隔）<input id="tb-ed-tags"></label></div><label>属性加成（每行 属性=数值）<textarea id="tb-ed-stats"></textarea></label>`;
}

function renderEnemyEditorFields() {
    return `<p>敌人预设提供建议默认值，本场状态仍由剧情 AI 提交。</p><label>固有技能 ID（逗号分隔）<input id="tb-ed-skills"></label><label>武器 ID <input id="tb-ed-weapon"></label><label>建议属性（每行 属性=数值）<textarea id="tb-ed-stats"></textarea></label>`;
}

function renderAiEditorFields() {
    return `<label>技能优先顺序（ID，逗号分隔）<input id="tb-ed-skills"></label><label>优先使用道具（ID，逗号分隔）<input id="tb-ed-items"></label><label><input id="tb-ed-use-items" type="checkbox" checked>允许使用个人道具</label>`;
}

function renderSettings() {
    const limits = settings().limits;
    return `<div><h2>设置与提示词</h2><div class="tb-grid">${Object.entries(limits).map(([key, value]) => `<label>${escapeHtml(key)} <input class="tb-limit" data-key="${key}" type="number" min="1" max="12" value="${value}"></label>`).join('')}</div><button data-action="save-limits">保存位置上限</button><h3>剧情 AI 开战提示词</h3><p>把下方提示词放进当前剧情预设；内容目录来自此角色卡绑定。</p><textarea readonly id="tb-story-prompt">${escapeHtml(buildStoryPrompt(catalogText(resolveActive().visiblePacks)))}</textarea><button data-action="copy-prompt">复制提示词</button><h3>写卡助手世界书</h3><p>按照当前导入格式生成可导入酒馆的 World Info JSON。</p><button data-action="export-worldbook">导出世界书 JSON</button><button data-action="copy-worldbook">复制世界书 JSON</button><h3>手动开战</h3><button data-action="sample-preview">载入示例战斗并预览</button><button data-action="manual-preview">粘贴初始快照并预览</button></div>`;
}

function list(value) { return String(value || '').split(/[,，\n]/).map(x => x.trim()).filter(Boolean); }

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

function addCondition() {
    const root = panel.querySelector('#tb-ed-conditions');
    if (!root) return;
    root.insertAdjacentHTML('beforeend', `<div class="tb-block tb-condition"><select class="tb-kind"><option value="freePart">部位自由</option><option value="equippedTag">装备标签</option><option value="equippedAnyTag">装备任一标签</option><option value="enemyFrontEmpty">敌方前排有空位</option><option value="targetEquipped">目标装备栏非空</option><option value="targetNotEquipped">目标装备栏为空</option><option value="selfNotEquipped">自己装备栏为空</option><option value="selfEquipment">自己有指定装备</option><option value="targetEquipment">目标有指定装备</option><option value="selfNotEquipment">自己没有指定装备</option><option value="targetNotEquipment">目标没有指定装备</option><option value="selfStatus">自己有状态</option><option value="targetStatus">目标有状态</option><option value="selfNotStatus">自己没有状态</option><option value="targetNotStatus">目标没有状态</option></select><input class="tb-ref" placeholder="hands / weapon / 状态或装备ID"><button type="button" class="tb-remove-block">×</button></div>`);
}

function addEffect() {
    const root = panel.querySelector('#tb-ed-effects');
    if (!root) return;
    root.insertAdjacentHTML('beforeend', `<div class="tb-block tb-effect"><select class="tb-kind"><option value="damage">伤害</option><option value="resource">资源变化</option><option value="status">施加状态</option><option value="removeStatus">解除状态</option><option value="equipRestraint">施加拘束装备</option><option value="removeRestraint">移除拘束装备</option><option value="disarm">击落武器</option><option value="removeEquipment">卸除装备</option><option value="disableEquipment">暂时封锁装备</option><option value="infiltrate">突入</option><option value="actionPoints">增加行动点</option></select><input class="tb-ref" placeholder="资源ID / 状态ID / 装备ID / 装备栏位"><input class="tb-amount" type="number" value="0" title="数值/威力/封锁时长"><input class="tb-chance" type="number" min="0" max="100" value="100" title="成功率"><select class="tb-extra"><option value="physical">物理 / 技能结束返回</option><option value="magic">魔法</option><option value="phaseEnd">己方阶段结束返回</option></select><button type="button" class="tb-remove-block">×</button></div>`);
}

function readEditorEntry() {
    const value = selector => panel.querySelector(selector)?.value || '';
    const id = `${value('#tb-editor-pack')}:${value('#tb-editor-id').trim().toLowerCase().replace(/\s+/g, '-')}`;
    const name = value('#tb-editor-name').trim();
    if (!name || id.endsWith(':')) throw new Error('需要 ID 后缀和名称');
    const entry = { id, name, description: value('#tb-editor-description').trim() };
    if (editorType === 'skills' || editorType === 'items') {
        entry.tags = list(value('#tb-ed-tags'));
        entry.target = { side: value('#tb-ed-side'), row: value('#tb-ed-row'), count: value('#tb-ed-count'), guard: !panel.querySelector('#tb-ed-ignore-guard')?.checked };
        if (editorType === 'skills') {
            entry.cost = {};
            for (const key of ['sp', 'mp']) { const amount = Number(value(`#tb-ed-${key}`)); if (amount > 0) entry.cost[key] = amount; }
        }
        entry.requirements = [...panel.querySelectorAll('.tb-condition')].map(row => {
            const kind = row.querySelector('.tb-kind').value;
            const ref = row.querySelector('.tb-ref').value.trim();
            if (kind === 'freePart') return { kind, part: ref || 'hands' };
            if (kind === 'equippedTag') return { kind, tag: ref };
            if (kind === 'equippedAnyTag') return { kind, tags: list(ref) };
            if (kind === 'enemyFrontEmpty') return { kind };
            if (['targetEquipped', 'targetNotEquipped', 'selfNotEquipped'].includes(kind)) return { kind, slot: ref || 'weapon' };
            if (['selfEquipment', 'targetEquipment', 'selfNotEquipment', 'targetNotEquipment'].includes(kind)) return { kind, equipmentId: ref };
            return { kind, statusId: ref };
        });
        entry.effects = [...panel.querySelectorAll('.tb-effect')].map(row => {
            const kind = row.querySelector('.tb-kind').value;
            const ref = row.querySelector('.tb-ref').value.trim();
            const amount = Number(row.querySelector('.tb-amount').value);
            const chance = Number(row.querySelector('.tb-chance').value);
            const extra = row.querySelector('.tb-extra').value;
            if (kind === 'damage') return { kind, damageType: extra === 'magic' ? 'magic' : 'physical', power: amount, scale: 1, chance };
            if (kind === 'resource') return { kind, resource: ref || 'hp', amount, chance };
            if (kind === 'status' || kind === 'removeStatus') return { kind, statusId: ref, chance };
            if (kind === 'equipRestraint') return { kind, equipmentId: ref, chance };
            if (kind === 'removeRestraint') return { kind, equipmentId: ref, chance };
            if (kind === 'removeEquipment') return { kind, slot: ref || 'weapon', chance };
            if (kind === 'disableEquipment') return { kind, slot: ref || 'weapon', duration: amount || 1, chance };
            if (kind === 'infiltrate') return { kind, returnAt: extra === 'phaseEnd' ? 'phaseEnd' : 'skillEnd' };
            if (kind === 'actionPoints') return { kind, amount };
            return { kind, chance };
        });
        if (!entry.effects.length) throw new Error('至少添加一个效果块');
    } else if (editorType === 'equipment') {
        entry.slot = value('#tb-ed-slot'); entry.tags = list(value('#tb-ed-tags'));
        entry.skills = list(value('#tb-ed-skills')); entry.statuses = list(value('#tb-ed-statuses'));
        entry.parts = list(value('#tb-ed-parts')); entry.stats = parseStats(value('#tb-ed-stats')); entry.bonusAp = Number(value('#tb-ed-bonus-ap'));
        if (entry.slot === 'restraint') { entry.escapeChance = Number(value('#tb-ed-escape')); entry.escapeCost = { sp: 5 }; }
    } else if (editorType === 'statuses') {
        entry.duration = value('#tb-ed-duration') ? Number(value('#tb-ed-duration')) : null;
        entry.accuracyMod = Number(value('#tb-ed-accuracy')); entry.blockedTags = list(value('#tb-ed-blocked'));
        entry.tags = list(value('#tb-ed-tags')); entry.stats = parseStats(value('#tb-ed-stats')); entry.bonusAp = Number(value('#tb-ed-bonus-ap'));
    } else if (editorType === 'enemies') {
        entry.skills = list(value('#tb-ed-skills')); entry.equipment = { weapon: value('#tb-ed-weapon') || null }; entry.stats = parseStats(value('#tb-ed-stats'));
    } else {
        entry.skillPriority = list(value('#tb-ed-skills'));
        entry.itemPriority = list(value('#tb-ed-items'));
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
    if (next[editorType].some(x => x.id === entry.id)) throw new Error('此 ID 已存在，请更换 ID 或用批量导入更新');
    next[editorType].push(entry);
    const errors = validatePack(next, settings().packs);
    if (errors.length) throw new Error(errors.join('；'));
    settings().packs = settings().packs.map(x => x.id === packId ? next : x);
    saveSettings();
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
    const response = await fetch(new URL('./examples/基础测试开战快照.json', import.meta.url));
    if (!response.ok) throw new Error(`示例快照加载失败：HTTP ${response.status}`);
    previewRequest = await response.json();
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
            if (records()[key]) { context().chatMetadata[MODULE].activeKey = key; void context().saveMetadata?.(); previewRequest = null; showPanel('battle'); return; }
            previewKey = key;
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
        else if (action === 'manual-preview') { previewKey = `manual-${Date.now()}`; previewRequest = { schema: 'turn-battle-request/v1', scene: '', actors: [], bag: {} }; tab = 'battle'; render(); }
        else if (action === 'cancel-preview') { previewRequest = null; previewKey = null; render(); }
        else if (action === 'apply-preview-json') { previewRequest = JSON.parse(panel.querySelector('#tb-preview-json').value); render(); }
        else if (action === 'confirm-battle') {
            const errors = requestErrors(previewRequest);
            if (errors.length) throw new Error(errors.join('；'));
            const state = createBattle(previewRequest, resolveActive().packs, settings().limits);
            await saveRecord(previewKey, { state, messageKey: previewKey });
            previewRequest = null; previewKey = null; selectedActorId = null; selectedAction = null; render(); scanBattleButtons();
        } else if (action === 'execute') await performAction();
        else if (action === 'end-phase') await updateBattle(endAllyPhase);
        else if (action === 'interrupt') await updateBattle(state => finishBattle(state, '中断'));
        else if (action === 'copy-short' || action === 'copy-full') { const record = currentRecord(); if (record) await copy(battleReport(record.state, action === 'copy-full')); }
        else if (action === 'settle-loot') await settleLoot();
    } catch (error) { notice(error.message || String(error)); }
}

async function updateBattle(transform) {
    const record = currentRecord();
    if (!record) throw new Error('当前没有战斗');
    const state = transform(record.state);
    await saveRecord(record.key, { state, messageKey: record.key });
    selectedAction = null; render();
}

async function performAction() {
    const record = currentRecord();
    if (!record) throw new Error('当前没有战斗');
    const actorId = panel.querySelector('#tb-actor')?.value;
    const choice = panel.querySelector('#tb-action')?.value;
    if (!choice) throw new Error('请选择行动');
    const [type, id] = choice.split('|');
    const action = { type, actorId };
    if (id) action.id = id;
    if (type === 'skill' || type === 'item') {
        action.targetId = panel.querySelector('#tb-target')?.value;
        action.landingCol = Number(panel.querySelector('#tb-landing')?.value) || undefined;
    } else if (type === 'struggle') action.restraintInstanceId = id;
    else if (type === 'pickup') action.dropId = id;
    else if (type === 'move') { action.row = panel.querySelector('#tb-move-row')?.value; action.col = Number(panel.querySelector('#tb-move-col')?.value); }
    await updateBattle(state => executeAction(state, action));
}

async function settleLoot() {
    const selected = new Set([...panel.querySelectorAll('.tb-loot-check:checked')].map(x => x.value));
    const selectedItems = [...panel.querySelectorAll('.tb-loot-item-check:checked')].map(x => ({ actorId: x.dataset.actor, id: x.value }));
    await updateBattle(state => {
        const next = structuredClone(state);
        next.gearBag ||= {};
        for (const drop of next.drops.filter(x => selected.has(x.instanceId))) next.gearBag[drop.id] = (next.gearBag[drop.id] || 0) + 1;
        next.drops = next.drops.filter(x => !selected.has(x.instanceId));
        let itemCount = 0;
        for (const choice of selectedItems) {
            const enemy = next.actors.find(x => x.id === choice.actorId && x.side === 'enemy');
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
    if (event.target.id === 'tb-editor-type') { editorType = event.target.value; render(); }
    else if (event.target.id === 'tb-actor') { selectedActorId = event.target.value; selectedAction = null; render(); }
    else if (event.target.id === 'tb-action') { selectedAction = event.target.value; render(); }
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

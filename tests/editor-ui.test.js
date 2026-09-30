import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_PACK } from '../content.js';

test('可视化编辑可切换并更新已有敌人，引用控件显示名称并保存对应 ID', async () => {
    const events = new Map();
    const panelListeners = new Map();
    const documentListeners = new Map();
    const fields = new Map();
    const selectedRows = new Map();
    const sample = JSON.parse(readFileSync(new URL('../examples/基础测试内容包.json', import.meta.url), 'utf8'));
    const saved = { packs: [structuredClone(CORE_PACK), sample], limits: { allyFront: 2, allyBack: 2, enemyFront: 2, enemyBack: 2 }, fallbackBinding: {} };
    let panel;
    globalThis.document = {
        body: { append(node) { node.isConnected = true; } },
        createElement() {
            panel = {
                hidden: false, isConnected: false, innerHTML: '', popoverOpen: false,
                style: { setProperty() {} },
                addEventListener(name, listener) { panelListeners.set(name, [...(panelListeners.get(name) || []), listener]); },
                contains() { return true; },
                querySelector(selector) { return fields.get(selector) || null; },
                querySelectorAll(selector) { return selectedRows.get(selector) || []; },
                matches(selector) { return selector === ':popover-open' && this.popoverOpen; },
                showPopover() { this.popoverOpen = true; },
                hidePopover() { this.popoverOpen = false; },
            };
            return panel;
        },
        querySelector(selector) { return selector === '#extensions_settings2' ? { insertAdjacentHTML() {} } : null; },
        addEventListener(name, listener) { documentListeners.set(name, listener); },
    };
    const context = {
        extensionSettings: { turn_battle: saved },
        event_types: { APP_READY: 'app-ready' },
        eventSource: { on(name, listener) { events.set(name, listener); } },
        renderExtensionTemplateAsync: async () => '<button id="tb-open">打开面板</button>',
        saveSettingsDebounced() {},
        chat: [], chatMetadata: {},
    };
    globalThis.SillyTavern = { getContext: () => context };
    try {
        await import(`../index.js?editor-ui=${Date.now()}`);
        await events.get('app-ready')();
        documentListeners.get('click')({ target: { closest: selector => selector === '#tb-open' ? {} : null }, preventDefault() {} });
        panelListeners.get('click')[0]({ target: { classList: { contains: () => false }, closest: () => ({ dataset: { tab: 'editor' } }) } });
        const change = (id, value) => panelListeners.get('change').forEach(listener => listener({ target: { id, value, classList: { contains: () => false } } }));
        change('tb-editor-pack', 'starter-test');
        change('tb-editor-type', 'enemies');
        change('tb-editor-entry', 'starter-test:guard');
        assert.match(panel.innerHTML, /训练守卫/);
        assert.match(panel.innerHTML, /拂柳 · 基础战斗测试包/);
        assert.match(panel.innerHTML, /练习长剑 · 基础战斗测试包/);
        assert.match(panel.innerHTML, /id="tb-editor-id" value="guard"[^>]*readonly/);

        change('tb-editor-type', 'skills');
        assert.match(panel.innerHTML, /<option value="starter-test" selected>基础战斗测试包/);
        const host = { innerHTML: '' };
        const row = { querySelector: () => host, classList: { contains: () => false } };
        panelListeners.get('change').forEach(listener => listener({ target: { id: '', value: 'equipRestraint', classList: { contains: value => value === 'tb-kind' }, closest: () => row } }));
        assert.match(host.innerHTML, /绳索/);
        assert.match(host.innerHTML, /value="starter-test:rope"/);
        assert.doesNotMatch(host.innerHTML, />starter-test:rope</);

        change('tb-editor-type', 'items');
        change('tb-editor-entry', 'starter-test:rope-item');
        assert.match(panel.innerHTML, /<option value="starter-test:rope" selected>[^<]*绳索/);

        change('tb-editor-type', 'enemies');
        change('tb-editor-entry', 'starter-test:guard');
        for (const [selector, value] of Object.entries({
            '#tb-editor-pack': 'starter-test', '#tb-editor-id': 'guard', '#tb-editor-name': '守卫改名',
            '#tb-editor-description': '', '#tb-ed-weapon': 'starter-test:sword', '#tb-ed-stats': 'patk=9',
        })) fields.set(selector, { value });
        selectedRows.set('#tb-ed-skills input[type="checkbox"]:checked', [{ value: 'starter-test:wind-first' }]);
        panelListeners.get('click')[0]({ target: { classList: { contains: () => false }, closest: () => ({ dataset: { action: 'save-editor' } }) } });
        for (let i = 0; i < 10 && saved.packs[1].enemies.find(value => value.id === 'starter-test:guard').name !== '守卫改名'; i++) await new Promise(resolve => setImmediate(resolve));
        const guard = saved.packs[1].enemies.find(value => value.id === 'starter-test:guard');
        assert.equal(guard.name, '守卫改名');
        assert.equal(guard.stats.patk, 9);
        assert.equal(guard.equipment.weapon, 'starter-test:sword');
        assert.equal(guard.equipment.outer, 'starter-test:coat');
        assert.equal(guard.resources.hp.max, 35);
        assert.equal(guard.items['starter-test:healing-potion'], 1);

        change('tb-editor-type', 'skills');
        change('tb-editor-entry', 'starter-test:fire-rain');
        for (const [selector, value] of Object.entries({
            '#tb-editor-pack': 'starter-test', '#tb-editor-id': 'fire-rain', '#tb-editor-name': '火雨改名',
            '#tb-editor-description': '', '#tb-ed-side': 'enemy', '#tb-ed-row': 'any', '#tb-ed-count': 'all',
            '#tb-ed-sp': '0', '#tb-ed-mp': '10', '#tb-ed-tags': 'magic,mouth,chant',
        })) fields.set(selector, { value });
        fields.set('#tb-ed-ignore-guard', { checked: true });
        const block = (index, values) => ({ dataset: { sourceIndex: String(index) }, querySelector(selector) { return values[selector] === undefined ? null : { value: values[selector] }; } });
        selectedRows.set('.tb-condition', [
            block(0, { '.tb-kind': 'freePart', '.tb-ref': 'mouth' }),
            block(1, { '.tb-kind': 'equippedAnyTag', '.tb-ref': 'staff,spellbook' }),
        ]);
        selectedRows.set('.tb-effect', [block(0, { '.tb-kind': 'damage', '.tb-amount': '4', '.tb-chance': '100', '.tb-extra': 'magic' })]);
        panelListeners.get('click')[0]({ target: { classList: { contains: () => false }, closest: () => ({ dataset: { action: 'save-editor' } }) } });
        for (let i = 0; i < 10 && saved.packs[1].skills.find(value => value.id === 'starter-test:fire-rain').name !== '火雨改名'; i++) await new Promise(resolve => setImmediate(resolve));
        const fireRain = saved.packs[1].skills.find(value => value.id === 'starter-test:fire-rain');
        assert.equal(fireRain.name, '火雨改名');
        assert.equal(fireRain.effects[0].scale, 0.8);
        assert.deepEqual(fireRain.requirements[1].tags, ['staff', 'spellbook']);
    } finally {
        delete globalThis.document;
        delete globalThis.SillyTavern;
    }
});

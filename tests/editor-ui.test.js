import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_PACK } from '../content.js';

test('可视化编辑可切换我方和敌方角色，引用显示名称并保存对应 ID', async () => {
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
        panelListeners.get('click')[0]({ target: { classList: { contains: () => false }, closest: () => ({ dataset: { tab: 'binding' } }) } });
        assert.match(panel.innerHTML, /value="allies"[^>]*>我方角色/);
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
            '#tb-editor-description': '', '#tb-ed-unit-row': 'front', '#tb-ed-unit-col': '1',
            '#tb-ed-stats': 'patk=9\nmatk=0\npdef=4\nmdef=2\nspeed=2',
            '#tb-ed-resources': 'hp=35/35\nsp=15/15\nmp=0/0\nfocus=8/8',
            '#tb-ed-eq-weapon': 'starter-test:sword', '#tb-ed-eq-outer': 'starter-test:coat',
            '#tb-ed-eq-legs': 'starter-test:trousers', '#tb-ed-ai-profile': 'starter-test:guard-ai',
        })) fields.set(selector, { value });
        selectedRows.set('#tb-ed-skills input[type="checkbox"]:checked', [{ value: 'starter-test:wind-first' }]);
        selectedRows.set('.tb-item-count', [{ dataset: { id: 'starter-test:healing-potion' }, value: '1' }]);
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

        change('tb-editor-type', 'allies');
        change('tb-editor-entry', 'starter-test:warrior');
        assert.match(panel.innerHTML, /测试战士/);
        assert.match(panel.innerHTML, /红宝石戒指 · 基础战斗测试包/);
        for (const [selector, value] of Object.entries({
            '#tb-editor-pack': 'starter-test', '#tb-editor-id': 'warrior', '#tb-editor-name': '战士改名',
            '#tb-editor-description': '', '#tb-ed-unit-row': 'front', '#tb-ed-unit-col': '1',
            '#tb-ed-stats': 'patk=11\nmatk=2\npdef=5\nmdef=3\nspeed=3',
            '#tb-ed-resources': 'hp=60/60\nsp=25/25\nmp=5/5\nfocus=8/8',
            '#tb-ed-eq-weapon': 'starter-test:sword', '#tb-ed-eq-outer': 'starter-test:coat',
            '#tb-ed-eq-middle': 'starter-test:shirt', '#tb-ed-eq-underwear': 'starter-test:underwear',
            '#tb-ed-eq-legs': 'starter-test:trousers', '#tb-ed-eq-feet': 'starter-test:boots',
        })) fields.set(selector, { value });
        selectedRows.set('#tb-ed-skills input[type="checkbox"]:checked', [{ value: 'starter-test:wind-first' }]);
        selectedRows.set('#tb-ed-accessories input[type="checkbox"]:checked', ['ruby-ring', 'sapphire-ring', 'guard-charm', 'swift-charm', 'focus-charm'].map(id => ({ value: `starter-test:${id}` })));
        selectedRows.set('#tb-ed-unit-statuses input[type="checkbox"]:checked', [{ value: 'starter-test:haste' }]);
        panelListeners.get('click')[0]({ target: { classList: { contains: () => false }, closest: () => ({ dataset: { action: 'save-editor' } }) } });
        for (let i = 0; i < 10 && saved.packs[1].allies.find(value => value.id === 'starter-test:warrior').name !== '战士改名'; i++) await new Promise(resolve => setImmediate(resolve));
        const warrior = saved.packs[1].allies.find(value => value.id === 'starter-test:warrior');
        assert.equal(warrior.name, '战士改名');
        assert.equal(warrior.stats.patk, 11);
        assert.equal(warrior.resources.focus.max, 8);
        assert.equal(warrior.accessories.length, 5);
        assert.deepEqual(warrior.statuses, ['starter-test:haste']);
        assert.equal(warrior.items, undefined);

        change('tb-editor-entry', '');
        for (const [selector, value] of Object.entries({
            '#tb-editor-pack': 'starter-test', '#tb-editor-id': 'new-ally', '#tb-editor-name': '新队友',
            '#tb-editor-description': '', '#tb-ed-unit-row': 'back', '#tb-ed-unit-col': '2',
            '#tb-ed-stats': 'matk=7', '#tb-ed-resources': 'hp=20/20\nsp=10/10\nmp=12/12',
            '#tb-ed-eq-weapon': 'starter-test:staff', '#tb-ed-eq-outer': '', '#tb-ed-eq-middle': '',
            '#tb-ed-eq-underwear': '', '#tb-ed-eq-legs': '', '#tb-ed-eq-feet': '',
        })) fields.set(selector, { value });
        selectedRows.set('#tb-ed-skills input[type="checkbox"]:checked', [{ value: 'starter-test:fireball' }]);
        selectedRows.set('#tb-ed-accessories input[type="checkbox"]:checked', [{ value: 'starter-test:sapphire-ring' }]);
        selectedRows.set('#tb-ed-unit-statuses input[type="checkbox"]:checked', []);
        panelListeners.get('click')[0]({ target: { classList: { contains: () => false }, closest: () => ({ dataset: { action: 'save-editor' } }) } });
        for (let i = 0; i < 10 && !saved.packs[1].allies.some(value => value.id === 'starter-test:new-ally'); i++) await new Promise(resolve => setImmediate(resolve));
        const newAlly = saved.packs[1].allies.find(value => value.id === 'starter-test:new-ally');
        assert.equal(newAlly.name, '新队友');
        assert.equal(newAlly.row, 'back');
        assert.equal(newAlly.col, 2);
        assert.deepEqual(newAlly.skills, ['starter-test:fireball']);
        assert.equal(newAlly.equipment.weapon, 'starter-test:staff');
    } finally {
        delete globalThis.document;
        delete globalThis.SillyTavern;
    }
});

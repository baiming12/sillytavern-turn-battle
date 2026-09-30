import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('手机设置页重绘后，打开面板按钮仍可唤起战斗界面', async () => {
    const events = new Map();
    const documentListeners = new Map();
    const panelListeners = new Map();
    const nodes = [];
    let selectedLoot = [];
    const originalFetch = globalThis.fetch;
    globalThis.document = {
        body: { append(node) { node.isConnected = true; nodes.push(node); } },
        createElement() {
            return {
                id: '', hidden: false, isConnected: false, innerHTML: '', popoverOpen: false,
                style: { setProperty() {} }, addEventListener(name, listener) { panelListeners.set(name, listener); },
                contains() { return true; },
                querySelector(selector) { return selector === '#tb-actor' ? { value: 'hero' } : null; },
                querySelectorAll(selector) { return selector === '.tb-loot-item-check:checked' ? selectedLoot : []; },
                matches(selector) { return selector === ':popover-open' && this.popoverOpen; },
                showPopover() { this.popoverOpen = true; },
                hidePopover() { this.popoverOpen = false; },
            };
        },
        querySelector(selector) { return selector === '#extensions_settings2' ? { insertAdjacentHTML() {} } : null; },
        addEventListener(name, listener) { documentListeners.set(name, listener); },
    };
    const context = {
        extensionSettings: {},
        event_types: { APP_READY: 'app-ready' },
        eventSource: { on(name, listener) { events.set(name, listener); } },
        renderExtensionTemplateAsync: async () => '<button id="tb-open">打开面板</button>',
        chat: [],
        chatMetadata: {},
    };
    globalThis.SillyTavern = { getContext: () => context };
    globalThis.fetch = async url => ({ ok: true, json: async () => JSON.parse(readFileSync(url, 'utf8')) });
    try {
        await import(`../index.js?ui-smoke=${Date.now()}`);
        await events.get('app-ready')();
        assert.equal(nodes.length, 1);
        assert.equal(nodes[0].hidden, true);
        let prevented = false;
        documentListeners.get('click')({
            target: { closest: selector => selector === '#tb-open' ? {} : null },
            preventDefault() { prevented = true; },
        });
        assert.equal(prevented, true);
        assert.equal(nodes[0].hidden, false);
        assert.equal(nodes[0].popoverOpen, true);
        assert.match(nodes[0].innerHTML, /载入示例战斗并预览/);

        const clickButton = dataset => panelListeners.get('click')({
            target: {
                classList: { contains: () => false },
                closest: () => ({ dataset }),
            },
        });
        const clickAction = action => clickButton({ action });
        const waitFor = async pattern => {
            for (let i = 0; i < 20 && !pattern.test(nodes[0].innerHTML); i++) await new Promise(resolve => setImmediate(resolve));
            assert.match(nodes[0].innerHTML, pattern);
        };
        clickAction('fantasy-preview');
        await waitFor(/基础西幻职业与怪物技能包/);
        assert.match(nodes[0].innerHTML, /初始快照校验通过/);
        clickAction('cancel-preview');
        clickAction('load-fantasy-pack');
        await waitFor(/暂存预览：基础西幻职业与怪物技能包/);
        assert.doesNotMatch(nodes[0].innerHTML, /class="tb-errors"/);
        clickAction('sample-preview');
        await waitFor(/初始快照校验通过/);
        assert.doesNotMatch(nodes[0].innerHTML, /引用未知|无效/);
        clickAction('confirm-battle');
        await waitFor(/第 1 轮/);
        assert.match(nodes[0].innerHTML, /测试战士/);
        assert.match(nodes[0].innerHTML, /data-menu="skills"/);
        assert.match(nodes[0].innerHTML, /data-menu="items"/);
        clickButton({ choice: 'skill|starter-test:wind-first' });
        assert.match(nodes[0].innerHTML, /选择目标/);
        clickButton({ targetId: 'enemy-guard' });
        clickAction('execute');
        await waitFor(/训练守卫 17\/35/);
        const battleKey = context.chatMetadata.turn_battle.activeKey;
        const battle = context.chatMetadata.turn_battle.records[battleKey].state;
        for (const actor of battle.actors.filter(actor => actor.side === 'ally')) actor.ap = 0;
        clickAction('request-interrupt');
        assert.match(nodes[0].innerHTML, /确认中断战斗/);
        assert.match(nodes[0].innerHTML, /结束玩家阶段，让敌方行动/);
        clickAction('cancel-interrupt');
        assert.equal(battle.status, 'active');
        clickAction('end-phase');
        await waitFor(/第 2 轮/);
        const nextState = context.chatMetadata.turn_battle.records[battleKey].state;
        nextState.actors.find(actor => actor.id === 'enemy-guard').resources.hp.current = 0;
        nextState.actors.find(actor => actor.id === 'enemy-guard').items['starter-test:healing-potion'] = 1;
        nextState.actors.find(actor => actor.id === 'enemy-rogue').items['starter-test:lime'] = 1;
        nextState.actors.find(actor => actor.id === 'enemy-mage').items['starter-test:mana-potion'] = 1;
        clickAction('request-interrupt');
        clickAction('confirm-interrupt');
        await waitFor(/战斗结束：中断/);
        assert.match(nodes[0].innerHTML, /训练守卫的治疗药剂/);
        assert.doesNotMatch(nodes[0].innerHTML, /训练刺客的石灰粉|训练法师的法力药剂/);
        selectedLoot = [
            { dataset: { actor: 'enemy-guard' }, value: 'starter-test:healing-potion' },
            { dataset: { actor: 'enemy-rogue' }, value: 'starter-test:lime' },
        ];
        const bagBefore = context.chatMetadata.turn_battle.records[battleKey].state.bag['starter-test:healing-potion'];
        clickAction('settle-loot');
        await waitFor(/战后拾取 0 件装备、1 件道具/);
        const settled = context.chatMetadata.turn_battle.records[battleKey].state;
        assert.equal(settled.bag['starter-test:healing-potion'], bagBefore + 1);
        assert.equal(settled.actors.find(actor => actor.id === 'enemy-rogue').items['starter-test:lime'], 1);
        assert.match(nodes[0].innerHTML, /返回聊天/);
        clickAction('close');
        assert.equal(nodes[0].hidden, true);
    } finally {
        delete globalThis.document;
        delete globalThis.SillyTavern;
        globalThis.fetch = originalFetch;
    }
});

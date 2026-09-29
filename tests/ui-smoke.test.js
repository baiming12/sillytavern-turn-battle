import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('手机设置页重绘后，打开面板按钮仍可唤起战斗界面', async () => {
    const events = new Map();
    const documentListeners = new Map();
    const panelListeners = new Map();
    const nodes = [];
    const originalFetch = globalThis.fetch;
    globalThis.document = {
        body: { append(node) { node.isConnected = true; nodes.push(node); } },
        createElement() {
            return {
                id: '', hidden: false, isConnected: false, innerHTML: '', popoverOpen: false,
                style: { setProperty() {} }, addEventListener(name, listener) { panelListeners.set(name, listener); },
                contains() { return true; }, querySelector() { return null; },
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

        const clickAction = action => panelListeners.get('click')({
            target: {
                classList: { contains: () => false },
                closest: () => ({ dataset: { action } }),
            },
        });
        const waitFor = async pattern => {
            for (let i = 0; i < 20 && !pattern.test(nodes[0].innerHTML); i++) await new Promise(resolve => setImmediate(resolve));
            assert.match(nodes[0].innerHTML, pattern);
        };
        clickAction('sample-preview');
        await waitFor(/初始快照校验通过/);
        assert.doesNotMatch(nodes[0].innerHTML, /引用未知|无效/);
        clickAction('confirm-battle');
        await waitFor(/第 1 轮/);
        assert.match(nodes[0].innerHTML, /测试战士/);
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
        clickAction('request-interrupt');
        clickAction('confirm-interrupt');
        await waitFor(/战斗结束：中断/);
        assert.match(nodes[0].innerHTML, /返回聊天/);
        clickAction('close');
        assert.equal(nodes[0].hidden, true);
    } finally {
        delete globalThis.document;
        delete globalThis.SillyTavern;
        globalThis.fetch = originalFetch;
    }
});

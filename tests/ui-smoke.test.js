import test from 'node:test';
import assert from 'node:assert/strict';

test('手机设置页重绘后，打开面板按钮仍可唤起战斗界面', async () => {
    const events = new Map();
    const documentListeners = new Map();
    const nodes = [];
    globalThis.document = {
        body: { append(node) { node.isConnected = true; nodes.push(node); } },
        createElement() {
            return {
                id: '', hidden: false, isConnected: false, innerHTML: '', popoverOpen: false,
                style: { setProperty() {} }, addEventListener() {},
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
    } finally {
        delete globalThis.document;
        delete globalThis.SillyTavern;
    }
});

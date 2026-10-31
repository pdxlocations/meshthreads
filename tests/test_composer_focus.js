const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/js/board.js'), 'utf8');
const code = ['preserveComposerFocus', 'moveBoardComposer'].map(name => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
function fixture(focused = true) {
    const document = {activeElement: null};
    const input = {selectionStart: 4, selectionEnd: 9, selectionDirection: 'backward', scrollTop: 20,
        isConnected: true, disabled: false, closest: () => null,
        focus(options) { this.focusOptions = options; document.activeElement = this; },
        setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }};
    const composer = {isConnected: true};
    document.activeElement = focused ? input : {};
    document.getElementById = id => id === 'messageInput' ? input : composer;
    const c = {document}; vm.createContext(c); vm.runInContext(code, c);
    return {c, document, input, composer};
}
test('background reply rerender retains focus, selection direction and textarea scroll', () => {
    const {c, document, input} = fixture();
    c.preserveComposerFocus(() => {
        document.activeElement = {};
        input.selectionStart = input.selectionEnd = 0;
        input.scrollTop = 0;
    });
    assert.equal(document.activeElement, input);
    assert.deepEqual([input.selectionStart, input.selectionEnd, input.selectionDirection], [4, 9, 'backward']);
    assert.equal(input.scrollTop, 20);
    assert.equal(input.focusOptions.preventScroll, true);
});
test('background refresh does not steal focus from another control', () => {
    const {c, document, input} = fixture(false);
    const control = document.activeElement;
    c.preserveComposerFocus(() => {});
    assert.equal(document.activeElement, control);
    assert.equal(input.focusOptions, undefined);
});
test('a hidden or disabled composer is not refocused', () => {
    for (const hidden of [true, false]) {
        const {c, document, input} = fixture();
        c.preserveComposerFocus(() => {
            document.activeElement = {};
            if (hidden) input.closest = () => ({}); else input.disabled = true;
        });
        assert.notEqual(document.activeElement, input);
    }
});
test('composer uses a state-preserving move and avoids redundant reparenting', () => {
    const {c, composer} = fixture();
    let moves = 0;
    const parent = {isConnected: true, moveBefore(node, before) { assert.equal(node, composer); assert.equal(before, null); moves++; node.parentNode = this; }};
    c.moveBoardComposer(parent);
    c.moveBoardComposer(parent);
    assert.equal(moves, 1);
});
test('composer supports browsers without state-preserving moves', () => {
    const {c, composer} = fixture();
    const parent = {append(node) { assert.equal(node, composer); node.parentNode = this; }};
    c.moveBoardComposer(parent);
    assert.equal(composer.parentNode, parent);
});

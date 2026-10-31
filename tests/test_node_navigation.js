const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/js/board.js'), 'utf8');
const code = ['jumpToDirectoryNode', 'boardClick'].map(name => source.match(new RegExp(`async function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
test('node navigation clears directory search, opens directory, then focuses and scrolls to the exact node', async () => {
    const calls = [];
    const card = {focus: options => calls.push(['focus', options.preventScroll]), scrollIntoView: options => calls.push(['scroll', options.block])};
    const c = {nodeSearchQuery: 'old search',
        openNodesInbox: async () => { assert.equal(c.nodeSearchQuery, ''); calls.push(['open']); },
        document: {querySelector: selector => { calls.push(['find', selector]); return card; }}};
    vm.createContext(c); vm.runInContext(code, c);
    await c.jumpToDirectoryNode('131');
    assert.deepEqual(calls, [['open'], ['find', '[data-directory-node="131"]'], ['focus', true], ['scroll', 'center']]);
});
test('rail node clicks navigate while DM and star buttons retain their own actions', async () => {
    const calls = [];
    const c = {jumpToDirectoryNode: async n => calls.push(['node', Number(n)]),
        setActiveChatTab: tab => calls.push(['tab', tab]), setActiveDmTarget: n => calls.push(['dm', n]),
        toggleNodeFavorite: async n => calls.push(['star', n])};
    vm.createContext(c); vm.runInContext(source.match(/async function boardClick\([^]*?\n\}/)[0], c);
    const row = {dataset: {boardNode: '7'}};
    for (const attr of [null, 'data-board-node', 'data-board-dm', 'data-board-favorite']) {
        const button = attr ? {dataset: {boardNode: '7', boardDm: '7', boardFavorite: '7'}, hasAttribute: name => name === attr} : null;
        await c.boardClick({target: {closest: selector => selector === 'button' ? button : row}});
    }
    assert.deepEqual(calls, [['node', 7], ['node', 7], ['tab', 'dm'], ['dm', 7], ['star', 7]]);
});

test('clicking node header text or whitespace toggles details while action buttons stay independent', async () => {
    let toggles = 0;
    const actions = [];
    const header = {querySelector: () => ({click: () => toggles++})};
    const c = {toggleNodeFavorite: async n => actions.push(n)};
    vm.createContext(c); vm.runInContext(source.match(/async function boardClick\([^]*?\n\}/)[0], c);
    await c.boardClick({target: {closest: selector => selector === '.node-roster-summary' ? header : null}});
    assert.equal(toggles, 1);
    const button = {hasAttribute: name => name === 'data-board-favorite', dataset: {boardFavorite: '7'}};
    await c.boardClick({target: {closest: selector => selector === 'button' ? button : selector === '.node-roster-summary' ? header : null}});
    assert.equal(toggles, 1);
    assert.deepEqual(actions, [7]);
});

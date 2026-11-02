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

test('map popup node ID navigates directly despite Leaflet stopping document click events', () => {
    const template = fs.readFileSync(require('node:path').join(__dirname, '../templates/index.html'), 'utf8');
    let click, destination, prevented = false, stopped = false;
    const content = {innerHTML:'', querySelector:()=>({addEventListener:(event,handler)=>{click=handler;}})};
    const c = {document:{createElement:()=>content}, getNodeDisplayLabel:n=>n.long_name,
        escapeHtml:v=>String(v).replace(/</g,'&lt;').replace(/"/g,'&quot;'), formatPositionTime:v=>v,
        jumpToDirectoryNode:number=>{destination=number;}};
    vm.createContext(c);vm.runInContext(template.match(/function createNodeMapPopup\([^]*?\n\}/)[0],c);
    c.createNodeMapPopup({node_num:7,node_id:'!00000007',long_name:'Cedar',position_timestamp:'today'});
    click({preventDefault:()=>{prevented=true;},stopPropagation:()=>{stopped=true;}});
    assert.equal(destination,7);assert.equal(prevented,true);assert.equal(stopped,true);
    assert.match(content.innerHTML,/!00000007/);assert.match(content.innerHTML,/Open Cedar in node directory/);
});

test('chat sender names produce accessible node links with numeric or hex identities',()=>{
    const template=fs.readFileSync(require('node:path').join(__dirname,'../templates/index.html'),'utf8');
    const c={getMessageSenderNodeId:m=>m?.sender || '',escapeHtml:v=>String(v).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))};
    vm.createContext(c);vm.runInContext(template.match(/function renderMessageSenderLink\([^]*?\n\}/)[0],c);
    for (const message of [{sender_num:7},{sender:'!00000007'}]) {
        const html=c.renderMessageSenderLink(message,'<Cedar>','board-post-author');
        assert.match(html,/type="button"/);
        assert.match(html,/data-board-node="7"/);
        assert.match(html,/View &lt;Cedar&gt; in node directory/);
        assert.ok(!html.includes('<Cedar>'));
    }
    for(const message of [{},{sender:'Unknown'},{sender_num:0xffffffff},{sender:'!00000007xyz'}]) {
        assert.ok(!c.renderMessageSenderLink(message,'Unknown','board-post-author').includes('data-board-node'));
    }
});

test('chat sender clicks use the same directory jump as node-list links',async()=>{
    let destination;
    const c={jumpToDirectoryNode:async n=>{destination=Number(n);}};
    vm.createContext(c);vm.runInContext(source.match(/async function boardClick\([^]*?\n\}/)[0],c);
    const sender={dataset:{boardNode:'7'},hasAttribute:name=>name==='data-board-node'};
    await c.boardClick({target:{closest:selector=>selector==='button'||selector==='[data-board-node]' ? sender : null}});
    assert.equal(destination,7);
});

test('a directory jump expands the exact matching node before scrolling',async()=>{
    const calls=[];
    const c={openNodesInbox:async()=>calls.push('nodes'),document:{querySelector:()=>({
        querySelector:()=>({getAttribute:()=> 'false',click:()=>calls.push('expand')}),
        focus:()=>calls.push('focus'),scrollIntoView:()=>calls.push('scroll'),
    })}};
    vm.createContext(c);vm.runInContext(source.match(/async function jumpToDirectoryNode\([^]*?\n\}/)[0],c);
    await c.jumpToDirectoryNode(7);
    assert.deepEqual(calls,['nodes','expand','focus','scroll']);
});

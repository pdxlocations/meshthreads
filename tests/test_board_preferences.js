const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/js/board.js'), 'utf8');
const functions = ['sortFavoriteNodes','activeDmPeerLabel','renderNodeFavorite'].map(name => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
function fixture() {
    const c = {favoriteNodeNums:new Set([2]), pendingNodeFavorites:new Set(),
        dmTargets:[{node_num:7,label:'Riverbank'},{node_num:8,label:'Cedar'}], activeDmTargetNodeNum:7,
        meshNodes: [],
        getNodeDisplayLabel:n => typeof n === 'object' ? n.long_name : `!${n.toString(16).padStart(8,'0')}`,
        escapeHtml:s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
    };
    c.getNodeByNum = n => c.meshNodes.find(node => Number(node.node_num) === Number(n));
    vm.createContext(c); vm.runInContext(functions,c); return c;
}
test('starred nodes come first without disturbing relative order or mutating input', () => {
    const c = fixture(); const nodes = [1,3,2,4].map(node_num => ({node_num}));
    assert.deepEqual(Array.from(c.sortFavoriteNodes(nodes), n => n.node_num), [2,1,3,4]);
    assert.deepEqual(nodes.map(n=>n.node_num),[1,3,2,4]);
});
test('DM header resolves the current peer and updates when conversations change', () => {
    const c = fixture(); assert.equal(c.activeDmPeerLabel(),'Riverbank');
    c.activeDmTargetNodeNum=8; assert.equal(c.activeDmPeerLabel(),'Cedar');
    c.activeDmTargetNodeNum=9; assert.equal(c.activeDmPeerLabel(),'!00000009');
});
test('star controls expose accessible toggle state and prevent duplicate requests', () => {
    const c=fixture(); c.pendingNodeFavorites.add(2);
    const html=c.renderNodeFavorite({node_num:2,long_name:'Cedar'});
    assert.match(html,/aria-pressed="true"/); assert.match(html,/Unstar Cedar/);
    assert.match(html,/disabled/); assert.match(html,/★/);
});

test('DM header replaces a cached node ID as soon as NodeInfo supplies a long name', () => {
    const c = fixture();
    c.dmTargets[0].label = '!00000007';
    assert.equal(c.activeDmPeerLabel(), '!00000007');
    c.meshNodes.push({node_num: 7, long_name: 'pdxlocs tracker', short_name: 'PDX'});
    assert.equal(c.activeDmPeerLabel(), 'pdxlocs tracker');
    c.meshNodes[0].long_name = 'Updated tracker';
    assert.equal(c.activeDmPeerLabel(), 'Updated tracker');
});

test('NodeInfo replaces stale DM targets and polling refreshes the active composer', () => {
    const template = fs.readFileSync(require('node:path').join(__dirname, '../templates/index.html'), 'utf8');
    const names = ['getNodeByNum', 'getNodeDisplayLabel', 'getPeerLabel', 'upsertDmTarget', 'syncDmTargetsFromMessages', 'applyNodeUpdate'];
    const code = names.map(name => template.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
    const c = {meshNodes: [], dmTargets: [{node_num: 7, label: '!00000007'}], channelMessages: [], dmMessages: [],
        getManagedProfileByNodeNum: () => null, renders: 0, composerUpdates: 0};
    c.renderActiveMessages = () => c.renders++;
    c.updateComposerState = () => c.composerUpdates++;
    vm.createContext(c); vm.runInContext(code, c);
    c.applyNodeUpdate({node: {node_num: 7, node_id: '!00000007', long_name: 'pdxlocs tracker'}});
    assert.equal(c.getPeerLabel({}, 7), 'pdxlocs tracker');
    assert.equal(c.dmTargets[0].label, 'pdxlocs tracker');
    assert.equal(c.renders, 1);
    assert.equal(c.composerUpdates, 1);
    // A stale conversation cache must not outrank the freshly loaded node list.
    c.dmTargets[0].label = '!00000007';
    assert.equal(c.getPeerLabel({}, 7), 'pdxlocs tracker');
    c.syncDmTargetsFromMessages();
    assert.equal(c.dmTargets[0].label, 'pdxlocs tracker');
});

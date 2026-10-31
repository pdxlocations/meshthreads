const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/js/board.js'), 'utf8');
const code = ['renderSavedTraceroute', 'cacheTracerouteResult'].map(name => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
function fixture() {
    const node = {node_num: 7, long_name: 'Cedar'};
    const panel = {innerHTML: ''};
    const c = {currentProfile: {id: 'mine', node_id: '!0000002a'}, getNodeByNum: num => Number(num) === 7 ? node : null,
        getNodeDisplayLabel: n => n.long_name, parseNodeId: id => parseInt(id.slice(1),16),
        escapeHtml: text => String(text).replace(/</g, '&lt;').replace(/"/g, '&quot;'),
        formatDateTime: text => text, renderTraceroutePath: hops => hops.map(h => h.label).join(' → '),
        document: {getElementById: id => id === 'savedTraceroute-7' ? panel : null}};
    vm.createContext(c); vm.runInContext(code,c); return {c, node, panel};
}
const result = () => ({owner_profile_id:'mine', from_node_num:7, to_node_num:42, request_id:11, received_at:'2026-10-31T07:00:00+00:00', route_towards:[{node_num:7,label:'!00000007'}],route_back:[]});
test('live results update node details without replacing the composer or toggling expanded rows', () => {
    const {c, node, panel} = fixture();
    c.cacheTracerouteResult(result());
    assert.equal(node.latest_traceroute.request_id,11);
    assert.match(panel.innerHTML,/Latest traceroute/);
    assert.match(panel.innerHTML,/Cedar/);
    assert.match(panel.innerHTML,/2026-10-31T07:00:00/);
    assert.match(panel.innerHTML,/Towards destination/);
    assert.match(panel.innerHTML,/Back to us/);
});
test('other profiles, incoming requests, and results for another identity do not replace the saved route', () => {
    const {c, node} = fixture();
    for (const values of [{owner_profile_id:'other'}, {request_id:0}, {to_node_num:43}]) c.cacheTracerouteResult({...result(),...values});
    assert.equal(node.latest_traceroute, undefined);
});
test('node details explain when no traceroute has been saved yet', () => {
    const {c, node} = fixture();
    assert.match(c.renderSavedTraceroute(node),/No saved traceroute yet/);
});

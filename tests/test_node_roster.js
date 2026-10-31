const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/js/board.js'), 'utf8');
const code = ['directoryNodeKey', 'sortedDirectoryNodes', 'renderNodeExtraInfo'].map(name => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]).join('\n') + '\n' + ['renderNodeListResults', 'renderNodeCardHtml'].map(name => source.match(new RegExp(`${name} = function\\([^]*?\\n\\};`))[0]).join('\n');
const nodes = [{node_num: 7, node_id: '!00000007', long_name: 'Cedar', hops_away: 3, last_seen: '2026-10-31T04:00:00Z'}, {node_num: 8, node_id: '!00000008', long_name: 'Riverbank', hops_away: 0, last_seen: '2026-10-31T05:00:00Z'}, {node_num: 9, long_name: 'Alder', hops_away: null}];
function fixture() {
    const c = {NodePanels: {render: () => ''}, currentProfile: {id: 'profile-a'}, nodeDirectoryFilter: 'all', nodeDirectorySort: 'heard', favoriteNodeNums: new Set([7]), expandedDirectoryNodes: new Set(),
        getNodeDisplayLabel: node => node.long_name, getProfileChannels: () => [{name: 'MeshOregon', channel_number: 15}], formatDateTime: value => value, parseTimestampValue: value => value ? new Date(value) : null,
        escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
        renderSavedTraceroute: () => '', formatNodeLastSeen: value => value || 'Unknown', boardIcon: () => '', renderNodeFavorite: () => '<button>star</button>'};
    vm.createContext(c); vm.runInContext(code, c); return c;
}
test('roster groups starred nodes first, respects search results and filters starred nodes', () => {
    const c = fixture();
    const html = c.renderNodeListResults(nodes);
    assert.ok(html.indexOf('Starred') < html.indexOf('Cedar'));
    assert.ok(html.indexOf('Cedar') < html.indexOf('Other nodes'));
    assert.ok(html.indexOf('Riverbank') < html.indexOf('Alder'));
    c.nodeDirectoryFilter = 'starred';
    const favorites = c.renderNodeListResults(nodes);
    assert.match(favorites, /Cedar/); assert.doesNotMatch(favorites, /Riverbank|Other nodes/);
    assert.match(c.renderNodeListResults([nodes[1]]), /No nodes match/);
});
test('name and hop sorting preserve data and put unknown hop counts last', () => {
    const c = fixture(); c.nodeDirectorySort = 'name';
    assert.deepEqual(Array.from(c.sortedDirectoryNodes(nodes), n => n.node_num), [9, 7, 8]);
    c.nodeDirectorySort = 'hops';
    assert.deepEqual(Array.from(c.sortedDirectoryNodes(nodes), n => n.node_num), [8, 7, 9]);
    assert.deepEqual(nodes.map(n => n.node_num), [7, 8, 9]);
});
test('expanded node details survive renders, are scoped by profile, and expose existing actions', () => {
    const c = fixture(); c.expandedDirectoryNodes.add(c.directoryNodeKey(7));
    const html = c.renderNodeCardHtml({...nodes[0], long_name: '<script>test</script>'});
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /id="nodeDetails-7" >|id="nodeDetails-7"\s*>/);
    assert.match(html, /&lt;script>test&lt;\/script>/);
    assert.match(html, /node-dm-trigger/); assert.match(html, /data-board-invite="7"/);
    assert.match(html, /node-nodeinfo-trigger/); assert.match(html, /node-traceroute-trigger/);
    c.currentProfile = {id: 'profile-b'};
    assert.match(c.renderNodeCardHtml(nodes[0]), /id="nodeDetails-7" hidden/);
});

test('expanded info adds useful reported data without repeating the summary fields', () => {
    const c = fixture();
    const html = c.renderNodeExtraInfo({...nodes[0], snr: 0, public_key: 'available', channel_numbers: [15], latitude: 45.5, longitude: -122.6, altitude: 0, position_timestamp: '2026-10-31T07:00:00Z'});
    assert.match(html, /Received SNR/); assert.match(html, /0.0 dB/);
    assert.match(html, /MeshOregon/); assert.match(html, /Public key/); assert.match(html, /Received/);
    assert.doesNotMatch(html, /Reported position|Altitude|Position updated/); // These belong with the map.
    assert.doesNotMatch(html, /Short name|Long name|Node ID|Hardware|Hops away|Last heard|<dt>Role/);
});
test('missing position and signal data are omitted without inventing zeros', () => {
    const c = fixture();
    const html = c.renderNodeExtraInfo({snr: null, latitude: null, longitude: null});
    assert.match(html, /Not received yet/);
    assert.doesNotMatch(html, /Received SNR|Reported position|Altitude|Position updated/);
});

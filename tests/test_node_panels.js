const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(require('node:path').join(__dirname, '../static/js/node-panels.js'), 'utf8');
function fixture() {
    const node = {node_num:7, long_name:'Cedar', latitude:null, longitude:null};
    const panel = {innerHTML:'', querySelector:()=>null, insertAdjacentHTML(_, html) {this.innerHTML += html;}};
    const c = {currentProfile:{id:'p'}, getNodeByNum:()=>node, getNodeDisplayLabel:n=>n.long_name,
        escapeHtml:v=>String(v).replace(/</g,'&lt;').replace(/"/g,'&quot;'), formatDateTime:v=>v,
        hasRenderableLocation:n=>n.latitude !== null && n.longitude !== null && Number.isFinite(Number(n.latitude)) && Number.isFinite(Number(n.longitude)),
        document:{getElementById:id=>id.startsWith('nodePanels-')?panel:null}};
    vm.createContext(c); vm.runInContext(code,c);
    return {c,node,panel,api:vm.runInContext('NodePanels',c)};
}
test('metrics preserve zeros, use correct units, and interpret powered battery and scaled host load', () => {
    const {api} = fixture();
    assert.equal(api.metric('battery_level',0)[1], '0%');
    assert.equal(api.metric('battery_level',101)[1], 'External power');
    assert.equal(api.metric('temperature',0)[1], '0 °C');
    assert.equal(api.metric('gas_resistance',3)[1], '3 MΩ');
    assert.equal(api.metric('load1',125)[1], '1.25');
    assert.equal(api.metric('voltage',null),null);
    assert.equal(api.metric('voltage',Infinity),null);
});
test('telemetry shows only reported values with per-category update times', () => {
    const {api} = fixture();
    const html=api.telemetryHtml({device:{updated_at:'2026-10-31T07:00:00Z',values:{battery_level:0, voltage:3.7}}});
    assert.match(html,/0%/); assert.match(html,/3.7 V/); assert.match(html,/2026-10-31/);
    assert.doesNotMatch(html,/Channel utilization|Humidity/);
    assert.match(api.telemetryHtml({}),/No telemetry received/);
});
test('map appears only for valid coordinates and is labelled as last reported position', () => {
    const {api,node} = fixture();
    assert.match(api.render(node),/No position received/);
    Object.assign(node,{latitude:45.5,longitude:-122.6,position_timestamp:'2026-10-31T07:00:00Z'});
    assert.match(api.render(node),/nodeDetailMap-7/); assert.match(api.render(node),/Last reported position/);
    assert.equal(api.validPosition({...node,latitude:91}),false);
});
test('on-demand details update telemetry and ignore responses after changing profile', async () => {
    const {api,c,node,panel} = fixture();
    c.fetch=async()=>({ok:true,json:async()=>({telemetry:{device:{updated_at:'today',values:{voltage:4.1}}}})});
    await api.load(7);
    assert.equal(node.telemetry.device.values.voltage,4.1); assert.match(panel.innerHTML,/4.1 V/);
    c.fetch=async()=>({ok:true,json:async()=>{c.currentProfile={id:'other'};return {telemetry:{device:{values:{voltage:2}}}};}});
    await api.load(7);
    assert.equal(node.telemetry.device.values.voltage,4.1);
});

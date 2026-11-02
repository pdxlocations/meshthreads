const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/js/admin.js'),'utf8');
function fixture() {
    const elements = {};
    const element=id=>elements[id] ||= {value:'',textContent:'',innerHTML:'',open:false,
        addEventListener(){},querySelectorAll(){return [];},reset(){},showModal(){this.open=true;},close(){this.open=false;}};
    const calls=[];
    const context={document:{getElementById:element,querySelector:()=>({content:'csrf'})},
        window:{confirm:()=>true,location:{assign(){}}},setInterval(){},
        fetch:async(url,options)=>{calls.push({url,...options});return {ok:true,json:async()=>({ok:true})};}};
    const code=source.replace(/    refresh\(\);\n\}\)\(\);\s*$/,`    globalThis.admin = {renderUsers, openEditor, saveEditor, deleteEntry, refresh, setOverview(value) { overview=value; }};\n})();`);
    vm.createContext(context);vm.runInContext(code,context);
    const profile={id:'p',long_name:'Radio',short_name:'RAD',node_id:'!00000007',messages_in:3,messages_out:2,
        channels:[{index:0,name:'<Public>',key_bytes:1},{index:1,name:'Private',key_bytes:32}],channel_revision:'revision-1'};
    const user={id:'bob',username:'Bob',is_admin:false,created_at:'2026-01-01',sessions:[],active_sessions:0,profiles:[profile]};
    context.admin.setOverview({users:[user],transport:{running:false}});
    return {context,elements,element,calls,profile,user,admin:context.admin};
}
test('admin roster lists escaped room names and key sizes without key values',()=>{
    const f=fixture();f.admin.renderUsers();
    const html=f.element('adminUsers').innerHTML;
    assert.match(html,/# &lt;Public&gt;/);assert.doesNotMatch(html,/# <Public>/);
    assert.match(html,/Public · 1-byte key/);assert.match(html,/32-byte key/);
    assert.match(html,/data-edit-channel="p" data-index="1"/);
    assert.match(html,/data-delete-user="bob"/);
});
test('room editor submits a revision and blank key while leaving current key private',async()=>{
    const f=fixture();f.admin.openEditor({type:'channel',profile:f.profile,channel:f.profile.channels[1]});
    assert.equal(f.element('adminChannelName').value,'Private');
    assert.equal(f.element('adminUserFields').hidden,true);
    f.element('adminChannelName').value='Renamed';
    f.element('adminChannelKey').value='';
    f.element('adminEditor').close=()=>{f.element('adminEditor').open=true;}; // Skip the subsequent dashboard fetch.
    await f.admin.saveEditor({preventDefault(){}});
    assert.equal(f.calls[0].url,'/api/admin/profiles/p/channels/1');
    assert.deepEqual(JSON.parse(f.calls[0].body),{name:'Renamed',key:'',revision:'revision-1'});
    assert.equal(f.calls[0].headers['X-CSRF-Token'],'csrf');
});
test('automatic refresh pauses while an editor is open',async()=>{
    const f=fixture();f.element('adminEditor').open=true;
    await f.admin.refresh();assert.equal(f.calls.length,0);
});
test('canceling account deletion sends no request',async()=>{
    const f=fixture();f.context.window.confirm=()=>false;
    await f.admin.deleteEntry({dataset:{deleteUser:'bob'}});
    assert.equal(f.calls.length,0);
});
test('save errors stay in the editor without discarding entered values',async()=>{
    const f=fixture();f.admin.openEditor({type:'user',user:f.user});
    f.element('adminUsername').value='Taken';f.element('adminPassword').value='new-password';
    f.context.fetch=async()=>({ok:false,json:async()=>({error:'Username already exists'})});
    await f.admin.saveEditor({preventDefault(){}});
    assert.equal(f.element('adminEditor').open,true);
    assert.equal(f.element('adminUsername').value,'Taken');
    assert.equal(f.element('adminEditorError').textContent,'Username already exists');
    assert.equal(f.element('adminEditorSave').disabled,false);
});

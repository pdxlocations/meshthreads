const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const template = fs.readFileSync(require('node:path').join(__dirname, '../templates/index.html'), 'utf8');
const code = ['renderProfileSetupGuide', 'renderProfilesView', 'renderManagedProfileCard', 'createManagedProfile']
    .map(name => template.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0]).join('\n');

function fixture(open = true) {
    const shell = {open};
    const input = {value:'My new node', selectionStart:3, selectionEnd:7};
    const form = {shell, input, channels:[{name:'Local',key:'AQ=='},{name:'',key:''}]};
    const cards = {}, guide = {};
    const document = {activeElement:input};
    const container = {
        querySelector(selector) {
            return {'#createProfileForm':form, '#profilesList':cards, '#profileSetupGuide':guide}[selector];
        },
        set innerHTML(_) { throw new Error('A background refresh replaced the creation form'); },
    };
    const c = {document, managedProfiles:{a:{long_name:'First node'}}, currentProfile:null,
        escapeHtml:String, syncNotificationToggleUi(){}, console:{error(){}}, alert(){}};
    vm.createContext(c); vm.runInContext(code,c);
    return {c,container,shell,input,form,cards,guide,document};
}

test('repeated live updates preserve the open creation form, draft channels and input selection',()=>{
    const f=fixture();
    for (let i=0;i<5;i++) f.c.renderProfilesView(f.container);
    assert.equal(f.shell.open,true);
    assert.equal(f.document.activeElement,f.input);
    assert.equal(f.input.value,'My new node');
    assert.deepEqual([f.input.selectionStart,f.input.selectionEnd],[3,7]);
    assert.deepEqual(f.form.channels,[{name:'Local',key:'AQ=='},{name:'',key:''}]);
    assert.match(f.cards.innerHTML,/First node/);
});

test('background updates keep a manually closed form closed and still update profile cards and guidance',()=>{
    const f=fixture(false);
    f.c.renderProfilesView(f.container);
    assert.match(f.guide.innerHTML,/Activate a profile/);
    f.c.managedProfiles.a.long_name='Updated node';
    f.c.currentProfile={id:'a'};
    f.c.renderProfilesView(f.container);
    assert.equal(f.shell.open,false);
    assert.match(f.cards.innerHTML,/Updated node/);
    assert.match(f.cards.innerHTML,/Deactivate/);
    assert.equal(f.guide.innerHTML,'');
});

test('first-time setup guidance updates after the profile list changes without resetting the draft',()=>{
    const f=fixture();f.c.managedProfiles={};
    f.c.renderProfilesView(f.container);
    assert.match(f.guide.innerHTML,/FIRST-TIME SETUP/);
    f.c.managedProfiles={new:{long_name:'Created node'}};
    f.c.renderProfilesView(f.container);
    assert.doesNotMatch(f.guide.innerHTML,/FIRST-TIME SETUP/);
    assert.equal(f.input.value,'My new node');
});

for (const ok of [true,false]) {
    test(`profile creation ${ok ? 'success clears' : 'failure preserves'} the creation form`,async()=>{
        const f=fixture();let removed=false, rendered=false;
        f.c.document={
            getElementById:id=>({value:{newHopLimit:'3',newLongName:'My new node',newShortName:'New'}[id]}),
            querySelector:selector=>selector.includes('csrf') ? {content:'csrf'} : {remove(){removed=true;}},
        };
        Object.assign(f.c,{
            collectProfileChannels:()=>[{name:'Local',key:'AQ=='}],
            validateProfileIdentityFields:()=>null,validateNewChannelKeys:()=>null,
            fetch:async()=>({ok,status:400,json:async()=>({error:'Failed'})}),
            loadManagedProfiles:async()=>{},renderActiveMessages(){rendered=true;},
        });
        await f.c.createManagedProfile({preventDefault(){}});
        assert.equal(removed,ok);
        assert.equal(rendered,ok);
    });
}

const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const template = fs.readFileSync(require('node:path').join(__dirname, '../templates/index.html'), 'utf8');
const code = ['showFirstProfileChannel', 'setProfile'].map(name => template.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
function fixture(profileId, active) {
    const button = {disabled:false, dataset:{setProfileId:profileId}};
    const requests = [];
    let profilePage = 0;
    const c = {currentProfile:active ? {id:active} : null,
        document:{querySelector:()=>({content:'csrf'})},
        fetch:async(url,options)=>{requests.push([url,JSON.parse(options.body)]);throw new Error('Simulated request failure');},
        openProfilesInbox:async()=>{profilePage++;},console:{error(){}},alert(){}};
    vm.createContext(c);vm.runInContext(code,c);
    return {c,button,requests,get profilePage(){return profilePage;}};
}
test('profile card deactivates its active profile and restores its label after a failed request', async()=>{
    const {c,button,requests}=fixture('a','a');
    await c.setProfile({target:button});
    assert.deepEqual(requests,[['/api/current-profile',{profile_id:null}]]);
    assert.equal(button.disabled,false);
    assert.equal(button.textContent,'Deactivate');
});
test('another profile card activates the requested profile',async()=>{
    const {c,button,requests}=fixture('b','a');
    await c.setProfile({target:button});
    assert.equal(requests[0][1].profile_id,'b');
    assert.equal(button.textContent,'Activate');
});
test('a missing profile id opens Profiles without sending a blank activation',async()=>{
    const f=fixture('','a');
    await f.c.setProfile({target:f.button});
    assert.equal(f.requests.length,0);
    assert.equal(f.profilePage,1);
});
test('a busy profile card cannot send a second activation request',async()=>{
    const {c,button,requests}=fixture('b','a');
    button.disabled=true;
    await c.setProfile({target:button});
    assert.equal(requests.length,0);
});
test('profile card makes Activate the accent action and Edit neutral',()=>{
    const {c}=fixture('b','a');c.escapeHtml=String;
    vm.runInContext(template.match(/function renderManagedProfileCard\([^]*?\n\}/)[0],c);
    const html=c.renderManagedProfileCard('b',{long_name:'Other profile'});
    assert.match(html,/class="btn btn-primary btn-sm"[^>]*data-set-profile-id="b">Activate/);
    assert.match(html,/class="btn btn-outline-secondary btn-sm"[^>]*data-edit-profile-id="b">Edit/);
    assert.match(c.renderManagedProfileCard('a',{}),/data-set-profile-id="a">Deactivate/);
});
test('successful profile activation opens its first channel and clears stale conversation state',async()=>{
    const {c,button}=fixture('b','a');let selectedTab;
    Object.assign(c,{
        activeChatTab:'profiles',activeChannelIndex:2,pendingChannelIndex:2,pendingDmTargetNodeNum:7,activeDmTargetNodeNum:7,replyingToPacketId:99,
        socket:null,getProfileChannels:()=>[{name:'First'},{name:'Second'}],setActiveChatTab:tab=>{selectedTab=tab;},
        fetch:async()=>({ok:true,json:async()=>({profile:{id:'b'},selected_channel_index:0,channel_number:15,interface_status:'stopped'})}),
        leaveCurrentChannelRoom(){},leaveCurrentProfileRoom(){},applyUnreadState(){},
        loadDmTargets:async()=>{},loadNodes:async()=>{},applyPendingChatContext:async()=>{throw new Error('Stale chat context');},
        updateInterfaceStatus(){},renderActiveMessages(){},
    });
    await c.setProfile({target:button});
    assert.equal(c.currentProfile.id,'b');assert.equal(selectedTab,'channel');assert.equal(c.activeChannelIndex,0);
    assert.equal(c.activeDmTargetNodeNum,null);assert.equal(c.pendingDmTargetNodeNum,null);assert.equal(c.pendingChannelIndex,null);assert.equal(c.replyingToPacketId,null);
    assert.equal(button.textContent,'Deactivate');
});

const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const template = fs.readFileSync(require('node:path').join(__dirname, '../templates/index.html'), 'utf8');
const code = ['selectedProfileIsActive', 'updateProfileActivationButton', 'handleProfileSelectionChange', 'showFirstProfileChannel', 'setProfile'].map(name => template.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
function fixture(selected, active) {
    const button = {id: 'setProfileBtn', disabled: false, dataset: {}};
    const select = {value: selected};
    const requests = [];
    const c = {currentProfile: active ? {id: active} : null,
        document: {getElementById: id => id === 'profileSelect' ? select : button, querySelector: () => ({content: 'csrf'})},
        fetch: async (url, options) => {requests.push([url, JSON.parse(options.body)]); throw new Error('Simulated request failure');},
        console: {error() {}}, alert() {}};
    vm.createContext(c); vm.runInContext(code, c);
    return {c, button, select, requests};
}
test('activation label follows selected profile and preserves the busy label', () => {
    const {c, button, select} = fixture('a', 'a');
    c.updateProfileActivationButton(); assert.equal(button.textContent, 'Deactivate');
    select.value = 'b'; c.updateProfileActivationButton(); assert.equal(button.textContent, 'Activate');
    button.disabled = true; button.dataset.profileBusy = 'true'; button.textContent = 'Activating…';
    c.updateProfileActivationButton(); assert.equal(button.textContent, 'Activating…');
});
test('clicking the active profile deactivates through the existing API and recovers on failure', async () => {
    const {c, button, requests} = fixture('a', 'a');
    await c.setProfile({target: button});
    assert.deepEqual(requests, [['/api/current-profile', {profile_id: null}]]);
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, 'Deactivate');
});
test('selecting another profile activates it instead of deactivating the current profile', async () => {
    const {c, button, requests} = fixture('b', 'a');
    await c.setProfile({target: button});
    assert.equal(requests[0][1].profile_id, 'b');
    assert.equal(button.textContent, 'Activate');
});

test('placeholder opens Profiles without unsetting the active profile or posting an activation', async () => {
    for (const active of [null, 'a']) {
        const {c, button, select, requests} = fixture('', active);
        let opened = 0;
        c.openProfilesInbox = async () => opened++;
        await c.handleProfileSelectionChange();
        assert.equal(opened, 1);
        assert.equal(button.disabled, true);
        assert.equal(c.currentProfile?.id || null, active);
        await c.setProfile({target: button});
        assert.equal(opened, 2);
        assert.equal(requests.length, 0);
        select.value = 'b'; c.updateProfileActivationButton();
        assert.equal(button.disabled, false);
        assert.equal(button.textContent, 'Activate');
    }
});

test('profile cards can deactivate the active identity after removing the sidebar picker', async () => {
    const {c, requests} = fixture('a', 'a');
    const button = {id: '', dataset: {setProfileId: 'a'}, disabled: false};
    await c.setProfile({target: button});
    assert.equal(requests[0][1].profile_id, null);
    assert.equal(button.textContent, 'Deactivate'); // Failed request restores its real state.
});
test('Activate is primary and Edit is neutral on profile cards', () => {
    const {c} = fixture('a', 'a');
    c.escapeHtml = String;
    vm.runInContext(template.match(/function renderManagedProfileCard\([^]*?\n\}/)[0], c);
    const html = c.renderManagedProfileCard('b', {long_name:'Other profile'});
    assert.match(html, /class="btn btn-primary btn-sm"[^>]*data-set-profile-id="b">Activate/);
    assert.match(html, /class="btn btn-outline-secondary btn-sm"[^>]*data-edit-profile-id="b">Edit/);
    assert.match(c.renderManagedProfileCard('a', {}), /data-set-profile-id="a">Deactivate/);
});

test('successful profile activation opens first channel instead of preserving Profiles, a DM, or a later room', async () => {
    const {c, button} = fixture('b', 'a');
    let selectedTab;
    Object.assign(c, {
        activeChatTab:'profiles', activeChannelIndex:2, pendingChannelIndex:2, pendingDmTargetNodeNum:7, activeDmTargetNodeNum:7, replyingToPacketId:99,
        socket:null, getProfileChannels:()=>[{name:'First'},{name:'Second'}], setActiveChatTab:tab=>{selectedTab=tab;},
        fetch:async()=>({ok:true,json:async()=>({profile:{id:'b'},selected_channel_index:0,channel_number:15,interface_status:'stopped'})}),
        leaveCurrentChannelRoom(){},leaveCurrentProfileRoom(){},applyUnreadState(){},updateProfileBanner(){},syncProfileSelectors(){},
        loadDmTargets:async()=>{},loadNodes:async()=>{},applyPendingChatContext:async()=>{throw new Error('Old chat context should not be restored');},
        updateInterfaceStatus(){},renderActiveMessages(){},closeProfileSelector(){},
    });
    await c.setProfile({target:button});
    assert.equal(c.currentProfile.id,'b');
    assert.equal(selectedTab,'channel');
    assert.equal(c.activeChannelIndex,0);
    assert.equal(c.activeDmTargetNodeNum,null);
    assert.equal(c.pendingDmTargetNodeNum,null);
    assert.equal(c.pendingChannelIndex,null);
    assert.equal(c.replyingToPacketId,null);
});

const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const template = fs.readFileSync(require('node:path').join(__dirname, '../templates/index.html'), 'utf8');
const code = ['selectedProfileIsActive', 'updateProfileActivationButton', 'handleProfileSelectionChange', 'setProfile'].map(name => template.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
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

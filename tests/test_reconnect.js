const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../templates/index.html'), 'utf8');
const initialize = source.match(/function initializeSocket\([^]*?\n\}/)[0];
for (const profile of [null, {id:'mine'}]) {
    test(`socket connect ${profile ? 'recovers history for the active profile' : 'does not request history before profile selection'}`, () => {
        const handlers = {};
        let refreshes = 0;
        const joined = [];
        const context = {socket:null, currentProfile:profile, currentChannelRoom:15, currentProfileRoom:profile?.id,
            io:() => ({on:(name, handler) => {handlers[name] = handler;}}),
            updateConnectionStatus() {}, joinChannelRoom() {}, joinProfileRoom:id => joined.push(id),
            refreshThreadStateSnapshot:async () => {refreshes++;},
            console:{error(){}},
        };
        vm.createContext(context);
        vm.runInContext(initialize, context);
        context.initializeSocket();
        handlers.connect();
        assert.equal(refreshes, profile ? 1 : 0);
        assert.deepEqual(joined, profile ? ['mine'] : []);
    });
}

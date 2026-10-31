const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../templates/base.html'), 'utf8');
const handler = source.match(/form\.addEventListener\('submit', (async function\(event\) \{[^]*?)\n              \}\);/)[1] + '\n}';
test('shared credentials submit to the chosen login or registration endpoint, with CSRF', async () => {
    for (const action of [null, '/register']) {
        const fields = {username: 'local-user', password: 'example-password', csrf_token: 'csrf'};
        const form = {action: '/login', method: 'post', getAttribute: () => null};
        const button = {innerHTML: action ? 'Create Account' : 'Sign In', getAttribute: () => action};
        let submitted;
        let redirected;
        const c = {form, FormData: class {constructor(actual) { assert.equal(actual, form); Object.assign(this, fields); }},
            fetch: async (url, options) => {
                submitted = {url, options};
                return {ok: true, headers: {get: () => 'application/json'}, json: async () => ({redirect_url: '/'})};
            },
            window: {location: {assign: url => {redirected = url;}}}, console};
        vm.createContext(c);
        const submit = vm.runInContext(`(${handler})`, c);
        await submit({preventDefault() {}, submitter: button});
        assert.equal(submitted.url, action || '/login');
        assert.deepEqual({...submitted.options.body}, fields);
        assert.equal(submitted.options.method, 'POST');
        assert.equal(redirected, '/');
        assert.equal(button.disabled, false);
    }
});

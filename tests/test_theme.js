const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/js/theme.js'), 'utf8');
function fixture(saved = null, unavailable = false) {
    const element = () => ({attrs:{}, setAttribute(k,v){this.attrs[k]=v;}, getAttribute(k){return this.attrs[k];}});
    const root=element(), body=element(), button=element(), icon={innerHTML:''}, meta=element(), events={}, storage={};
    if (saved !== null) storage['meshthreads.harbor.theme']=saved;
    button.addEventListener=(name,fn)=>{events[name]=fn;};
    const c={document:{documentElement:root,body,getElementById:id=>id==='themeToggle'?button:icon,querySelector:()=>meta},
        localStorage:{getItem:k=>{if(unavailable)throw Error();return storage[k]||null;},setItem:(k,v)=>{if(unavailable)throw Error();storage[k]=v;}},
        window:{addEventListener(){}},
    };
    vm.runInNewContext(source,c);
    return {root,body,button,icon,meta,storage,click:()=>events.click()};
}
test('Harbor starts in light mode with an accessible dark-mode control',()=>{
    const c=fixture(); assert.equal(c.root.attrs['data-bs-theme'],'light');
    assert.equal(c.button.attrs['aria-label'],'Switch to dark mode');
    assert.equal(c.button.attrs['aria-pressed'],'false');
});
test('toggle updates root, body, icon label and browser theme color',()=>{
    const c=fixture(); c.click();
    assert.equal(c.root.attrs['data-bs-theme'],'dark'); assert.equal(c.body.attrs['data-bs-theme'],'dark');
    assert.equal(c.button.attrs['aria-label'],'Switch to light mode'); assert.equal(c.meta.attrs.content,'#121d24');
    c.click(); assert.equal(c.body.attrs['data-bs-theme'],'light');
});
test('saved dark preference is restored after a reload',()=>{
    const c=fixture();c.click();
    const reloaded=fixture(c.storage['meshthreads.harbor.theme']);
    assert.equal(reloaded.body.attrs['data-bs-theme'],'dark');
});
test('invalid preferences fall back to light',()=>assert.equal(fixture('invalid').body.attrs['data-bs-theme'],'light'));
test('mode switching works when browser storage is unavailable',()=>{
    const c=fixture(null,true);assert.doesNotThrow(()=>c.click());
    assert.equal(c.body.attrs['data-bs-theme'],'dark');
});

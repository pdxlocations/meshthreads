const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/js/board.js'), 'utf8');
const code = ['setMobileNavigation', 'handleMobileNavigationKey'].map(name => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
function fixture() {
    const attrs = new Map(); let opened = false;
    const toggle = {setAttribute:(key,value)=>attrs.set(key,value),getAttribute:key=>attrs.get(key),focus:()=>{document.activeElement=toggle;}};
    const first = {getClientRects:()=>[1], focus:()=>{document.activeElement=first;}};
    const last = {getClientRects:()=>[1], focus:()=>{document.activeElement=last;}};
    const sidebar = {setAttribute:(key,value)=>attrs.set(key,value), removeAttribute:key=>attrs.delete(key), querySelector:()=>first, querySelectorAll:()=>[first,last]};
    const shell={inert:false}, backdrop={hidden:true}, grid={classList:{toggle:(_,value)=>{opened=value;}}};
    const document={activeElement:toggle,getElementById:id=>id==='mobileNavToggle'?toggle:sidebar,querySelector:selector=>selector==='.mesh-layout'?grid:selector==='.mobile-nav-backdrop'?backdrop:shell};
    const c={BoardUnread:{resume(){}},document,window:{matchMedia:()=>({matches:true})}};
    vm.createContext(c);vm.runInContext(code,c);
    return {c,document,attrs,toggle,first,last,shell,backdrop,get opened(){return opened;}};
}
test('mobile drawer opens with focus, blocks background interaction and closes with restored focus',()=>{
    const f=fixture();f.c.setMobileNavigation(true);
    assert.equal(f.opened,true);assert.equal(f.shell.inert,true);assert.equal(f.backdrop.hidden,false);
    assert.equal(f.attrs.get('aria-modal'),'true');assert.equal(f.document.activeElement,f.first);
    f.c.setMobileNavigation(false);
    assert.equal(f.opened,false);assert.equal(f.shell.inert,false);assert.equal(f.backdrop.hidden,true);
    assert.equal(f.attrs.has('aria-modal'),false);assert.equal(f.document.activeElement,f.toggle);
});
test('Tab stays in the open drawer and Escape closes it',()=>{
    const f=fixture();f.c.setMobileNavigation(true);f.document.activeElement=f.last;
    let prevented=0;
    f.c.handleMobileNavigationKey({key:'Tab',shiftKey:false,preventDefault:()=>prevented++});
    assert.equal(f.document.activeElement,f.first);
    f.c.handleMobileNavigationKey({key:'Tab',shiftKey:true,preventDefault:()=>prevented++});
    assert.equal(f.document.activeElement,f.last);
    f.c.handleMobileNavigationKey({key:'Escape',preventDefault:()=>prevented++});
    assert.equal(prevented,3);assert.equal(f.opened,false);
});

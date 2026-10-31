const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(require('node:path').join(__dirname, '../static/js/board-unread.js'), 'utf8');
const messages = [{id:'a',timestamp:1,direction:'received'},{id:'own',timestamp:2,direction:'sent'},{id:'b',timestamp:3,direction:'received'}];
function fixture() {
    let callback, timer, reads = 0;
    const c = {currentProfile:{id:'p'},activeChatTab:'channel',activeChannelIndex:0,
        getChannelNumberByIndex:()=>15, parseTimestampValue:n=>new Date(n*1000),
        document:{visibilityState:'visible',hasFocus:()=>true,addEventListener(){}},window:{addEventListener(){}},
        setTimeout:fn=>{timer=fn;return 1;},clearTimeout(){},markCurrentChannelRead:async()=>{reads++;},
        IntersectionObserver:class {constructor(fn){callback=fn;}observe(){}disconnect(){}},
    };
    vm.createContext(c);vm.runInContext(code,c);
    return {c, api:vm.runInContext('BoardUnread',c), enter:entries=>callback(entries), flush:()=>timer(),get reads(){return reads;}};
}
const element=id=>({dataset:{unreadPost:id},isConnected:true,closest:()=>null});
const visible=target=>({target,isIntersecting:true,intersectionRatio:1});
test('unread selection excludes own messages and zero counts return no unread posts',()=>{
    const {api}=fixture();
    assert.equal(api.select(messages,0).length,0);
    assert.deepEqual(Array.from(api.select(messages,1),m=>m.id),['b']);
    api.begin(messages,2);assert.equal(api.countUnread(messages),2);assert.equal(api.isUnread(messages[1]),false);
});
test('offscreen or collapsed unread replies keep the conversation unread until viewed',async()=>{
    const f=fixture(), a=element('a'), b=element('b');
    f.api.begin(messages,2);f.api.observe({querySelectorAll:()=>[a,b]});
    f.enter([visible(a)]);f.flush();assert.equal(f.reads,0);assert.equal(f.api.countUnread(messages),1);
    b.closest=()=>({});f.enter([visible(b)]);f.flush();assert.equal(f.reads,0);
    b.closest=()=>null;f.enter([visible(b)]);f.flush();assert.equal(f.reads,1);
});
test('background or unfocused tabs do not mark messages read',()=>{
    const f=fixture(), a=element('a');f.api.begin([messages[0]],1);f.api.observe({querySelectorAll:()=>[a]});
    f.enter([visible(a)]);f.c.document.visibilityState='hidden';f.flush();assert.equal(f.reads,0);
    f.c.document.visibilityState='visible';f.c.document.hasFocus=()=>false;f.flush();assert.equal(f.reads,0);
});
test('switching profile or incomplete history cannot mark an entire channel read',()=>{
    const f=fixture(), a=element('a');f.api.begin([messages[0]],2);f.api.observe({querySelectorAll:()=>[a]});
    f.enter([visible(a)]);f.flush();assert.equal(f.reads,0);
    f.api.begin([messages[0]],1);f.api.observe({querySelectorAll:()=>[a]});f.enter([visible(a)]);
    f.c.currentProfile={id:'different'};f.flush();assert.equal(f.reads,0);
});

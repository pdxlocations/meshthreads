const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/js/board.js'),'utf8');
const functions=['boardScrollKey','withBoardScrollPosition'].map(name=>source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
function fixture() {
    const container={scrollTop:0,scrollHeight:5000};
    const c={currentProfile:{id:'p'},activeChatTab:'channel',activeChannelIndex:0,activeDmTargetNodeNum:null,
        document:{getElementById:()=>container},updateNodesBackToTopVisibility(){},
        getActiveChannel:()=>c.activeChannelIndex===null?null:{name:`Room ${c.activeChannelIndex}`,channel_number:10+c.activeChannelIndex},
    };
    vm.createContext(c);vm.runInContext('const boardViewScrollPositions=new Map(); let renderedBoardScrollKey=null;\n'+functions,c);
    const render=()=>c.withBoardScrollPosition(()=>{container.scrollTop=3000;});
    return {c,container,render};
}
test('switching from a deep node directory restores chat and later restores the directory',()=>{
    const {c,container,render}=fixture();render();container.scrollTop=125;
    c.activeChatTab='nodes';render();assert.equal(container.scrollTop,0);
    container.scrollTop=2400;c.activeChatTab='channel';render();assert.equal(container.scrollTop,125);
    c.activeChatTab='nodes';render();assert.equal(container.scrollTop,2400);
});
test('each room and the room chooser keep independent positions',()=>{
    const {c,container,render}=fixture();render();container.scrollTop=400;
    c.activeChannelIndex=1;render();assert.equal(container.scrollTop,0);container.scrollTop=900;
    c.activeChannelIndex=null;render();assert.equal(container.scrollTop,0);container.scrollTop=70;
    c.activeChannelIndex=0;render();assert.equal(container.scrollTop,400);
    c.activeChannelIndex=1;render();assert.equal(container.scrollTop,900);
    c.activeChannelIndex=null;render();assert.equal(container.scrollTop,70);
});
test('live renders retain the current position even if the renderer scrolls to the bottom',()=>{
    const {container,render}=fixture();render();container.scrollTop=230;
    render();assert.equal(container.scrollTop,230);container.scrollTop=600;
    render();assert.equal(container.scrollTop,600);
});
test('new DMs start at the bottom while returning DMs keep their own reading position',()=>{
    const {c,container,render}=fixture();render();container.scrollTop=15;
    c.activeChatTab='dm';c.activeDmTargetNodeNum=7;render();assert.equal(container.scrollTop,5000);
    container.scrollTop=350;c.activeDmTargetNodeNum=8;render();assert.equal(container.scrollTop,5000);
    container.scrollTop=650;c.activeDmTargetNodeNum=7;render();assert.equal(container.scrollTop,350);
    c.activeChatTab='channel';render();assert.equal(container.scrollTop,15);
});
test('profiles, maps, and separate virtual profiles do not share offsets',()=>{
    const {c,container,render}=fixture();render();container.scrollTop=250;
    c.activeChatTab='profiles';render();assert.equal(container.scrollTop,0);container.scrollTop=750;
    c.activeChatTab='map';render();assert.equal(container.scrollTop,0);
    c.activeChatTab='profiles';render();assert.equal(container.scrollTop,750);
    c.activeChatTab='channel';c.currentProfile={id:'other'};render();assert.equal(container.scrollTop,0);
    c.currentProfile={id:'p'};render();assert.equal(container.scrollTop,250);
});
test('explicit node jumps and other deliberate scrolling become the saved reading position',()=>{
    const {c,container,render}=fixture();c.activeChatTab='nodes';render();
    container.scrollTop=1800; // A node link deliberately scrolls to its expanded entry.
    c.activeChatTab='channel';render();c.activeChatTab='nodes';render();
    assert.equal(container.scrollTop,1800);
});

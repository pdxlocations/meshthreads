const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const template = fs.readFileSync(path.join(__dirname,'../templates/index.html'),'utf8');
const board = fs.readFileSync(path.join(__dirname,'../static/js/board.js'),'utf8');
const pendingCode=template.match(/async function applyPendingChatContext\([^]*?\n\}/)[0];
function pendingFixture(index=1) {
    const selected=[];
    const c={pendingDmTargetNodeNum:null,pendingChannelIndex:null,activeChatTab:'channel',activeChannelIndex:index,
        currentProfile:{id:'p',selected_channel_index:1},
        getProfileChannels:()=>[{name:'First'},{name:'Saved room'}],
        setActiveChatTab:tab=>selected.push([tab,c.activeChannelIndex]),
        setActiveChannel:async index=>{c.activeChannelIndex=index;selected.push(['explicit',index]);},
    };
    vm.createContext(c);vm.runInContext(pendingCode,c);
    return {c,selected};
}
test('returning to messages retains a restored room for a multi-channel profile',async()=>{
    const {c,selected}=pendingFixture(1);await c.applyPendingChatContext();
    assert.equal(c.activeChannelIndex,1);assert.deepEqual(selected,[['channel',1]]);
});
test('startup falls back to saved room, or first room if saved index no longer exists',async()=>{
    const {c}=pendingFixture(null);await c.applyPendingChatContext();assert.equal(c.activeChannelIndex,1);
    c.activeChannelIndex=90;await c.applyPendingChatContext();assert.equal(c.activeChannelIndex,0);
});
test('explicit room URLs take precedence over the restored selection',async()=>{
    const {c,selected}=pendingFixture(1);c.pendingChannelIndex=0;
    await c.applyPendingChatContext();assert.equal(c.activeChannelIndex,0);assert.equal(c.pendingChannelIndex,null);
    assert.deepEqual(selected,[['explicit',0]]);
});
test('profiles with no channels retain an empty selection',async()=>{
    const {c}=pendingFixture();c.getProfileChannels=()=>[];
    await c.applyPendingChatContext();assert.equal(c.activeChannelIndex,null);
});
function boardFixture() {
    const nodes={boardRoomTitle:{},boardDescription:{},boardNotice:{hidden:true,dataset:{},classList:{toggle(){}}}};
    const buttons=[{hidden:false},{hidden:false}];
    const channels=[{name:'First'},{name:'Other'}];
    const c={currentProfile:{id:'p'},activeChatTab:'channel',activeChannelIndex:null,activeDmTargetNodeNum:null,
        document:{getElementById:id=>nodes[id],querySelectorAll:()=>buttons},
        getActiveChannel:()=>channels[c.activeChannelIndex]||null,activeDmPeerLabel:()=> 'Friend',
    };
    const code=['boardNotice','boardContextKey','updateBoardHeading'].map(name=>board.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
    vm.createContext(c);vm.runInContext(code,c);
    return {c,nodes,buttons};
}
test('room chooser hides conversation-only actions and shows chooser instructions',()=>{
    const {c,nodes,buttons}=boardFixture();c.updateBoardHeading();
    assert.equal(nodes.boardRoomTitle.textContent,'Your rooms');
    assert.equal(buttons.every(button=>button.hidden),true);
    assert.match(nodes.boardDescription.textContent,/Choose a room/);
    c.activeChannelIndex=1;c.updateBoardHeading();
    assert.equal(nodes.boardRoomTitle.textContent,'# Other');assert.equal(buttons.every(button=>!button.hidden),true);
});
test('opening a room clears the chooser warning; background renders keep current errors visible',()=>{
    const {c,nodes}=boardFixture();c.boardNotice('Open a room first.',true);
    c.updateBoardHeading();assert.equal(nodes.boardNotice.hidden,false);
    c.activeChannelIndex=1;c.updateBoardHeading();assert.equal(nodes.boardNotice.hidden,true);
    assert.equal(nodes.boardNotice.textContent,'');
    c.boardNotice('Send failed',true);c.updateBoardHeading();assert.equal(nodes.boardNotice.hidden,false);
    c.activeChatTab='dm';c.activeDmTargetNodeNum=7;c.updateBoardHeading();assert.equal(nodes.boardNotice.hidden,true);
});
test('changing profiles also clears notices even if the same room index stays selected',()=>{
    const {c,nodes}=boardFixture();c.activeChannelIndex=0;c.boardNotice('Old profile warning',true);
    c.currentProfile={id:'new'};c.updateBoardHeading();assert.equal(nodes.boardNotice.hidden,true);
});

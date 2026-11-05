const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const reactions = require('../static/js/reactions.js');
const threads = require('../static/js/threads.js');
const msg = (packet_id, content, reply_packet_id, extra={}) => ({id:String(packet_id), packet_id,content,reply_packet_id,timestamp:packet_id,...extra});

test('single emoji sequences include flags skin tones ZWJ and keycaps',()=>{
    for (const value of ['😀','❤️','👍🏽','🇺🇸','👨‍👩‍👧‍👦','1️⃣','🏳️‍🌈',' ☀️ ']) assert.equal(reactions.singleEmoji(value),true,value);
    for (const value of ['😀😀','hello 😀','1','','abc',':)','👍 ❤️']) assert.equal(reactions.singleEmoji(value),false,value);
    assert.equal(reactions.isReaction(msg(2,'😀')),false);
    assert.equal(reactions.isReaction(msg(2,'👍👍',1,{is_emoji:true})),true);
});
test('reactions attach to the exact nested message and do not count as reply rows',()=>{
    const messages=[msg(1,'Root'),msg(2,'Reply',1),msg(3,'😀',2),msg(4,'❤️',1,{is_emoji:true})];
    const group=threads.groupThreads(messages)[0], tree=threads.replyTree(group);
    assert.equal(group.messages.length,4);
    assert.equal(tree.children.length,1);
    assert.equal(tree.reactions[0].packet_id,4);
    assert.equal(tree.children[0].reactions[0].packet_id,3);
    assert.equal(tree.children[0].children.length,0);
});
test('reaction activity bumps its entire original thread',()=>{
    const groups=threads.groupThreads([msg(1,'Older'),msg(2,'Newer'),msg(3,'👍',1)]);
    assert.equal(groups[0].root.packet_id,1);
});
test('aggregation merges presentation variants and deduplicates senders without losing unread packets',()=>{
    const groups=reactions.aggregate([msg(2,'❤',1,{sender_num:7}),msg(3,'❤️',1,{sender_num:8}),msg(4,'❤️',1,{sender_num:7})]);
    assert.equal(groups.length,1);
    assert.equal(groups[0].senders.length,2);
    assert.equal(groups[0].messages.length,3);
});
test('orphan and cyclic reactions stay visible and never loop',()=>{
    const orphan=msg(2,'👍',1);
    assert.equal(reactions.collect([orphan]).messages[0],orphan);
    const cycle=[msg(1,'👍',2),msg(2,'❤️',1)];
    const group=threads.groupThreads(cycle)[0];
    assert.equal(threads.replyTree(group).children.length,1);
});
test('text replies to reactions retain their nearest real parent',()=>{
    const group=threads.groupThreads([msg(1,'Root'),msg(2,'Reply',1),msg(3,'👍',2),msg(4,'Text',3)])[0];
    const tree=threads.replyTree(group);
    assert.equal(tree.children[0].children[0].message.packet_id,4);
});
test('browser globals build the same reaction tree without CommonJS',()=>{
    const context=vm.createContext({});
    for (const file of ['reactions.js','threads.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/js',file),'utf8'),context);
    const messages=[msg(1,'Root'),msg(2,'👍',1)];
    const tree=context.MeshThreads.replyTree(context.MeshThreads.groupThreads(messages)[0]);
    assert.equal(tree.reactions.length,1);
    assert.equal(tree.children.length,0);
});
test('bubble markup includes sender names, unread markers, and escaped text',()=>{
    const code=fs.readFileSync(path.join(__dirname,'../static/js/board.js'),'utf8');
    const start=code.indexOf('const boardReactionGroups = new Map();');
    const end=code.indexOf('\nfunction showReactionSenders',start);
    const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const context=vm.createContext({MeshReactions:reactions,escapeHtml:escape,
        getMessageSenderDisplayName:m=>m.sender_display,BoardUnread:{isUnread:()=>true,id:m=>m.id}});
    vm.runInContext(code.slice(start,end),context);
    const html=context.renderReactionBubbles(msg(1,'Root'),[msg(2,'❤️',1,{sender_num:7,sender_display:'<Cedar>'})]);
    assert.ok(html.includes('data-reaction-group='));
    assert.ok(html.includes('data-unread-post="2"'));
    assert.ok(html.includes('&lt;Cedar&gt;'));
    assert.ok(!html.includes('<Cedar>'));
});
test('the DM invitation wrapper forwards attached reactions to the message renderer',()=>{
    const code=fs.readFileSync(path.join(__dirname,'../static/js/board.js'),'utf8');
    const wrapper=code.match(/renderMessageHtml = function\([^]*?\n\};/)[0];
    let received;
    const context=vm.createContext({originalMessageRender:(message,reactions)=>{received=reactions;return '<div>message</div>';}});
    vm.runInContext(wrapper,context);
    const attached=[msg(2,'👍',1)];
    context.renderMessageHtml(msg(1,'hello',null,{message_type:'dm'}),attached);
    assert.equal(received,attached);
});

test('paged reaction summaries keep all reactors and merge live tapbacks without duplicates',()=>{
    const code=fs.readFileSync(path.join(__dirname,'../static/js/board.js'),'utf8');
    const start=code.indexOf('const boardReactionGroups = new Map();'),end=code.indexOf('\nfunction showReactionSenders',start);
    const context=vm.createContext({MeshReactions:reactions,escapeHtml:String,getMessageSenderDisplayName:m=>m.sender_display,BoardUnread:{isUnread:()=>false,id:m=>m.id}});
    vm.runInContext(code.slice(start,end),context);
    const original=msg(1,'Root');
    original.reaction_summary=[{emoji:'❤️',senders:[{sender_num:7,sender_display:'Cedar'},{sender_num:8,sender_display:'Riverbank'}]}];
    const html=context.renderReactionBubbles(original,[msg(2,'❤',1,{sender_num:8,sender_display:'Riverbank'})]);
    assert.match(html,/reaction-count">2</);
    assert.equal((html.match(/data-reaction-group=/g)||[]).length,1);
    assert.match(html,/Cedar, Riverbank/);
});

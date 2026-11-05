const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const board=fs.readFileSync(path.join(__dirname,'../static/js/board.js'),'utf8');
const template=fs.readFileSync(path.join(__dirname,'../templates/index.html'),'utf8');
function fixture() {
    const c={MeshReactions:require('../static/js/reactions.js'),getSenderBadgeTextColor:()=> '#ffffff',
        escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
        currentProfile:{node_id:'!12345678',short_name:'ME'},getNodeByNum:()=>null};
    vm.createContext(c);
    vm.runInContext(board.match(/function boardAvatarColor\([^]*?\n\}/)[0],c);
    vm.runInContext(board.match(/function renderIdentityAvatar\([^]*?\n\}/)[0],c);
    for(const name of ['getMessageSenderNodeId','getMessageSenderShortName']) vm.runInContext(template.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0],c);
    return c;
}
test('avatars preserve full short names, case, and complete emoji',()=>{
    const c=fixture();
    assert.match(c.renderIdentityAvatar('xTHR','!12345678'),/>xTHR<\/span>/);
    for(const glyph of ['🛰️','🇺🇸','👍🏽']) {
        const html=c.renderIdentityAvatar(glyph,'!12345678');
        assert.ok(html.includes('>'+glyph+'</span>'));assert.match(html,/--avatar-label-scale:0.6/);
    }
});
test('missing short names show the last four node ID digits for hex and numeric identities',()=>{
    const c=fixture();
    assert.match(c.renderIdentityAvatar('','!4E016635'),/>6635<\/span>/);
    assert.match(c.renderIdentityAvatar('   ','',0x07fbfdcd),/>fdcd<\/span>/);
    assert.match(c.renderIdentityAvatar(null,'!00000007'),/>0007<\/span>/);
    assert.doesNotMatch(c.renderIdentityAvatar('<x>','!12345678'),/><x>/);
});
test('messages use current node-info short names before old message metadata',()=>{
    const c=fixture();c.getNodeByNum=num=>num===7?{short_name:'NEW'}:null;
    assert.equal(c.getMessageSenderShortName({sender_num:7,sender_short_name:'OLD'}),'NEW');
    assert.equal(c.getMessageSenderShortName({sender:'!00000007'}),'NEW');
    assert.equal(c.getMessageSenderShortName({sender_num:8,sender_short_name:'RAD'}),'RAD');
    assert.equal(c.getMessageSenderShortName({sender_num:0x12345678}),'ME');
    assert.equal(c.getMessageSenderShortName({sender_num:9}),'');
});

test('circle colors use the last six hex digits, including numeric sender fallbacks',()=>{
    const c=fixture();
    assert.equal(c.boardAvatarColor('!4e016635'),'#016635');
    assert.equal(c.boardAvatarColor('!ABCDEF12'),'#cdef12');
    assert.equal(c.boardAvatarColor(0x07fbfdcd),'#fbfdcd');
    assert.match(c.renderIdentityAvatar('RAD','!4e016635'),/--avatar-color:#016635;/);
    assert.match(c.renderIdentityAvatar('RAD','',0x07fbfdcd),/--avatar-color:#fbfdcd;/);
});

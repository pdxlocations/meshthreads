const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const template = fs.readFileSync(require('node:path').join(__dirname, '../templates/index.html'), 'utf8');
const code=template.match(/async function detectPublicChannels\([^]*?\n\}/)[0];
function fixture(channels=[],detected=[]) {
    const button={disabled:false},status={},list={};let rendered;
    const c={Set,JSON,document:{getElementById:id=>id==='newChannelsList'?list:status},
        fetch:async()=>({ok:true,json:async()=>({channels:detected})}),
        collectProfileChannels:()=>channels,
        renderProfileChannelRows:(id,rows)=>{rendered=rows;},
    };
    vm.createContext(c);vm.runInContext(code,c);
    return {c,button,status,list,get rendered(){return rendered;}};
}
test('detection merges channels without duplicates or overwriting partial manual entries',async()=>{
    const f=fixture([{name:'Local',key:'AQ=='},{name:'Draft',key:''}],
        [{name:'Local',key:'AQ=='},{name:'Another',key:'Ag=='}]);
    await f.c.detectPublicChannels({currentTarget:f.button});
    assert.deepEqual(f.rendered,[{name:'Local',key:'AQ=='},{name:'Draft',key:''},{name:'Another',key:'Ag=='}]);
    assert.match(f.status.textContent,/Added 1 public channel/);
    assert.equal(f.button.disabled,false);
});
test('no matches leave the existing editor unchanged',async()=>{
    const f=fixture([{name:'Draft',key:''}]);
    await f.c.detectPublicChannels({currentTarget:f.button});
    assert.equal(f.rendered,undefined);
    assert.match(f.status.textContent,/No 1-byte key channels/);
});
test('failed detection reports an error without replacing the draft',async()=>{
    const f=fixture();f.c.fetch=async()=>({ok:false,json:async()=>({error:'Please sign in again'})});
    await f.c.detectPublicChannels({currentTarget:f.button});
    assert.equal(f.rendered,undefined);assert.equal(f.status.textContent,'Please sign in again');
    assert.equal(f.button.disabled,false);
});
test('late results do not update a replacement form after navigating away',async()=>{
    const f=fixture([],[{name:'Local',key:'AQ=='}]);
    f.c.fetch=async()=>{f.c.document.getElementById=()=>({});return {ok:true,json:async()=>({channels:[{name:'Local',key:'AQ=='}]})};};
    await f.c.detectPublicChannels({currentTarget:f.button});
    assert.equal(f.rendered,undefined);
});
test('edit detection updates the edit list and preserves existing channel indices',async()=>{
    const f=fixture([{name:'Local',key:'AQ==',profile_index:2}],[{name:'Local',key:'AQ=='},{name:'Another',key:'Ag=='}]);
    f.button.dataset={channelList:'editChannelsList',channelStatus:'editPublicChannelsStatus'};
    f.list.dataset={editorRevision:'1'};
    f.c.document.getElementById=id=>id==='editChannelsList'?f.list:id==='editPublicChannelsStatus'?f.status:null;
    f.c.collectProfileChannels=(id)=>{assert.equal(id,'editChannelsList');return [{name:'Local',key:'AQ==',profile_index:2}];};
    let target;
    f.c.renderProfileChannelRows=(id,rows)=>{target=id;assert.equal(rows[0].profile_index,2);assert.equal(rows.length,2);};
    await f.c.detectPublicChannels({currentTarget:f.button});
    assert.equal(target,'editChannelsList');
    assert.match(f.status.textContent,/before saving/);
});
test('late detection is discarded when the edit modal opens another profile',async()=>{
    const f=fixture();
    f.button.dataset={channelList:'editChannelsList',channelStatus:'editPublicChannelsStatus'};
    f.list.dataset={editorRevision:'1'};
    f.c.document.getElementById=id=>id==='editChannelsList'?f.list:f.status;
    f.c.fetch=async()=>{f.list.dataset.editorRevision='2';return {ok:true,json:async()=>({channels:[{name:'Local',key:'AQ=='}]})};};
    await f.c.detectPublicChannels({currentTarget:f.button});
    assert.equal(f.rendered,undefined);
});

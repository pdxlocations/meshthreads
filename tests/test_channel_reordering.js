const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const template=fs.readFileSync(require('node:path').join(__dirname,'../templates/index.html'),'utf8');
const code=['syncProfileChannelOrder','moveProfileChannelRow','collectProfileChannels','handleEditChannelListClick']
    .map(name=>template.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
function fixture(modern=false) {
    const container={rows:[],querySelectorAll(){return this.rows;},insertBefore(row,before){
        this.rows.splice(this.rows.indexOf(row),1);
        this.rows.splice(before?this.rows.indexOf(before):this.rows.length,0,row);
    }};
    if(modern) container.moveBefore=container.insertBefore;
    function row(name,key,original) {
        const nodes={
            '[data-remove-channel-index]':{dataset:{}},'[data-channel-position]':{},
            '[data-move-channel-step="-1"]':{focus(){this.focused=true;}},
            '[data-move-channel-step="1"]':{focus(){this.focused=true;}},
            '.channel-name-input':{value:name},'.channel-key-input':{value:key},
        };
        return {dataset:{...(original!==undefined?{profileChannelIndex:String(original)}:{})},
            nodes,querySelector(selector){return nodes[selector];},
            get nextSibling(){return container.rows[container.rows.indexOf(this)+1]||null;}};
    }
    container.rows=[row('First','AQ==',0),row('Second draft','Ag==',1),row('','')];
    const c={document:{getElementById:()=>container}};vm.createContext(c);vm.runInContext(code,c);
    c.syncProfileChannelOrder(container);
    return {c,container};
}
for(const modern of [true,false]) {
    test(`moving a channel preserves actual draft rows and history targets (${modern?'state-preserving':'fallback'} DOM move)`,()=>{
        const {c,container}=fixture(modern);const [first,second,blank]=container.rows;
        c.moveProfileChannelRow('editChannelsList',1,-1);
        assert.deepEqual(container.rows,[second,first,blank]);
        assert.equal(second.nodes['[data-channel-position]'].textContent,'Channel 1 · Primary');
        assert.equal(second.dataset.profileChannelIndex,'1');
        assert.equal(second.nodes['[data-remove-channel-index]'].dataset.removeChannelIndex,'0');
        assert.equal(second.nodes['[data-move-channel-step="-1"]'].disabled,true);
        assert.equal(second.nodes['[data-move-channel-step="1"]'].focused,true);
        assert.equal(second.nodes['.channel-name-input'].value,'Second draft');
        c.moveProfileChannelRow('editChannelsList',0,1);
        assert.deepEqual(container.rows,[first,second,blank]);
        assert.equal(blank.nodes['.channel-name-input'].value,'');
    });
}
test('saved channels follow visible order while retaining original history indices',()=>{
    const {c,container}=fixture();c.moveProfileChannelRow('editChannelsList',1,-1);
    const channels=JSON.parse(JSON.stringify(c.collectProfileChannels('editChannelsList')));
    assert.deepEqual(channels,[{name:'Second draft',key:'Ag==',profile_index:1},{name:'First',key:'AQ==',profile_index:0}]);
});
test('invalid moves and moving past either boundary do nothing',()=>{
    const {c,container}=fixture();const original=[...container.rows];
    for (const [index,step] of [[0,-1],[2,1],[-1,1],[99,-1],[1,2],[NaN,1]]) c.moveProfileChannelRow('editChannelsList',index,step);
    assert.deepEqual(container.rows,original);
});
test('delegated move button moves the clicked channel without triggering deletion',()=>{
    const {c,container}=fixture();const second=container.rows[1];let prevented=false;
    const button={disabled:false,dataset:{moveChannelStep:'-1'},closest:()=>second};
    c.handleEditChannelListClick({target:{closest:selector=>selector==='[data-move-channel-step]'?button:null},preventDefault(){prevented=true;}});
    assert.equal(prevented,true);assert.equal(container.rows[0],second);
});

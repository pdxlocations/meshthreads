const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../static/js/channel-history.js'),'utf8');
const page=(id=1,after=1,extra={})=>({channel:15,threads:[{thread_id:String(id),messages:[{id:String(id),packet_id:id,channel:15,thread_id:String(id)}],after,has_more:false,last_row_id:after}],next_cursor:'next',has_more:true,...extra});
function fixture(){
    const pending=[],timers=[];const scroller={scrollTop:0,clientHeight:400,querySelectorAll:()=>[],getBoundingClientRect:()=>({top:0})};
    const c={currentProfile:{id:'p'},activeChannelIndex:0,activeChatTab:'channel',channelMessages:[],dmMessages:[],replyingToPacketId:null,
        URLSearchParams,console,document:{addEventListener(){},getElementById:()=>scroller},
        fetch:url=>new Promise(resolve=>pending.push({url,finish:(data,ok=true)=>resolve({ok,json:async()=>data})})),
        getChannelNumberByIndex:index=>index===0?15:75,getProfileChannels:()=>[{channel_number:15},{channel_number:75}],
        upsertMessage:(list,message)=>{const i=list.findIndex(item=>item.id===message.id);if(i>=0)list[i]=message;else list.push(message);},
        reconcileMessageSenderLabelsFromNodes(){},renderActiveMessages(){},applyUnreadState(){},syncDmTargetsFromMessages(){},
        escapeHtml:String,setTimeout:fn=>{timers.push(fn);return timers.length;},requestAnimationFrame:fn=>1,
    };
    vm.createContext(c);vm.runInContext(source+'\nglobalThis.history=ChannelHistory;',c);
    return {c,pending,timers,scroller,h:c.history};
}
test('paging merges and deduplicates messages without dropping other rooms',async()=>{
    const {c,h,pending}=fixture();c.channelMessages=[{id:'other',channel:75}];
    const first=h.load();pending[0].finish(page());await first;
    assert.equal(h.state().loaded,true);assert.equal(h.state().cursor,'next');
    const next=h.more();pending[1].finish({...page(2),next_cursor:null,has_more:false});await next;
    assert.deepEqual(Array.from(c.channelMessages,m=>m.id),['other','1','2']);
    assert.equal(h.state().more,false);
});
test('two attempts to load the same room share one in-flight request',async()=>{
    const {h,pending}=fixture();const first=h.load();await h.load();assert.equal(pending.length,1);
    pending[0].finish(page());await first;
});
test('a history response for a previous profile is discarded',async()=>{
    const {c,h,pending}=fixture();const promise=h.load();c.currentProfile={id:'other'};
    pending[0].finish(page());await promise;assert.equal(c.channelMessages.length,0);
});
test('an explicit reset invalidates older in-flight responses',async()=>{
    const {c,h,pending}=fixture();const promise=h.load();h.accept(page(2),true);
    pending[0].finish(page());await promise;assert.equal(c.channelMessages.length,0);
    assert.equal(h.state().threads.has('2'),true);
});
test('live ACK changes survive a request while server thread metadata is attached',async()=>{
    const {c,h,pending}=fixture();c.channelMessages=[{id:'1',ack_status:'pending',channel:15}];
    const promise=h.load();c.channelMessages[0]={id:'1',ack_status:'ack',channel:15};
    pending[0].finish(page());await promise;
    assert.equal(c.channelMessages[0].ack_status,'ack');assert.equal(c.channelMessages[0].thread_id,'1');
});
test('long-thread pages retain their reply cursor during a head refresh',()=>{
    const {h}=fixture();h.accept(page(1,80),true);
    h.accept(page(1,40),false,'thread');assert.equal(h.state().threads.get('1').after,80);
    h.accept({...page(1,40),threads:[{thread_id:'1',messages:[],after:40,has_more:true,last_row_id:100}]},false,'thread');
    assert.equal(h.state().threads.get('1').has_more,true);
});
test('live replies to different threads are queued rather than losing all but the last',async()=>{
    const {h,pending,timers}=fixture();h.accept(page(),true);
    h.noteMessage({id:'10',packet_id:10,channel:15});h.noteMessage({id:'11',packet_id:11,channel:15});
    const pump=timers.shift()();assert.match(pending[0].url,/packet_id=10/);
    pending[0].finish(page());await pump;
    const second=timers.shift()();assert.match(pending[1].url,/packet_id=11/);
    pending[1].finish(page(2));await second;
});
test('virtualized output mounts only nearby threads and keeps an active reply composer mounted',()=>{
    const {c,h}=fixture();c.replyingToPacketId=90;
    const groups=Array.from({length:100},(_,i)=>({key:'g'+i,messages:[{packet_id:i}]}));
    const mounted=[];const html=h.windowed(groups,group=>{mounted.push(group.key);return '<article></article>';});
    assert.ok(mounted.length<15);assert.ok(mounted.includes('g90'));
    assert.ok(html.includes('thread-placeholder'));
});
test('failed loads leave existing history and expose a retry',async()=>{
    const {c,h,pending}=fixture();c.channelMessages=[{id:'old'}];const promise=h.load();
    pending[0].finish({error:'Offline'},false);await promise;
    assert.equal(c.channelMessages[0].id,'old');assert.match(h.footer(),/Offline/);assert.match(h.footer(),/data-history-retry/);
});

test('live replies are fetched even while initial active-room history is still loading',async()=>{
    const {h,pending,timers}=fixture();
    h.noteMessage({id:'10',packet_id:10,reply_packet_id:1,channel:15});
    assert.equal(timers.length,1);
    const pump=timers.shift()();assert.match(pending[0].url,/packet_id=10/);
    h.accept(page(2),true); // Initial snapshot supersedes the in-flight request.
    pending[0].finish(page());await pump;
    assert.ok(timers.length>0); // The superseded thread request will be retried.
});

/* Per-room history caches, on-demand replies, and a bounded thread DOM. */
const ChannelHistory = (() => {
    const states = new Map(), summaries = new Map(), heights = new Map();
    let observer, frame, windowKey = '', scrollTarget = null;
    const key = (channel, profile = currentProfile?.id) => `${profile}:${channel}`;
    function state(channel = getChannelNumberByIndex(activeChannelIndex)) {
        const id = key(channel);
        if (!states.has(id)) states.set(id, {loaded:false,loading:false,version:0,threads:new Map(),cursor:null,more:false,error:''});
        return states.get(id);
    }
    function accept(page, reset=false, kind='page') {
        if (!page) return;
        const s=state(page.channel);
        if (reset) { s.version++;s.threads.clear();s.loaded=false;s.cursor=null; }
        for (const thread of page.threads || []) {
            const old=s.threads.get(String(thread.thread_id));
            s.threads.set(String(thread.thread_id), {...thread,messages:undefined,
                after:Math.max(old?.after || 0,thread.after || 0),
                has_more:old && old.after > thread.after ? old.after < thread.last_row_id : thread.has_more});
        }
        if (kind==='page' && (!s.loaded || reset || page.requested_cursor)) {
            s.cursor=page.next_cursor;s.more=page.has_more;
        }
        s.loaded=true;s.error='';
    }
    function acceptSummaries(messages) {
        for (const message of messages || []) summaries.set(Number(message.channel),message);
    }
    async function load(index=activeChannelIndex, options={}) {
        if (!currentProfile || index===null || index===undefined) return;
        const channel=getChannelNumberByIndex(index), profile=currentProfile.id, s=state(channel);
        if (s.loading) return;
        s.loading=true;s.error='';
        if (activeChatTab==='channel' && Number(getChannelNumberByIndex(activeChannelIndex))===Number(channel)) {
            for (const button of document.querySelectorAll?.('[data-history-more],[data-history-thread]') || []) {
                button.disabled=true;button.textContent='Loading messages…';
            }
        }
        const version=s.version;
        const before=new Map(channelMessages.map(message=>[message.id,message]));
        const params=new URLSearchParams({channel_index:String(index)});
        for (const [name,value] of Object.entries(options)) if (value!==null && value!==undefined) params.set(name,String(value));
        try {
            const response=await fetch(`/api/channel-history?${params}`);
            const page=await response.json();
            if (!response.ok) throw new Error(page.error || 'Unable to load history.');
            if (currentProfile?.id!==profile || s.version!==version) return;
            if (Number(page.channel)!==Number(channel)) throw new Error('Room configuration changed. Refresh the page.');
            if (options.cursor) page.requested_cursor=options.cursor;
            if (!Object.keys(options).length && s.loaded) {s.cursor=page.next_cursor;s.more=page.has_more;}
            accept(page,false,options.thread_id!==undefined || options.packet_id!==undefined?'thread':'page');
            for (const thread of page.threads) for (const message of thread.messages) {
                const existing=channelMessages.find(item=>item.id===message.id);
                // ACK events can be newer than an in-flight history response.
                upsertMessage(channelMessages,existing && before.get(message.id)!==existing
                    ? {...message,...existing,thread_id:message.thread_id,thread_activity:Math.max(message.thread_activity || 0,existing.thread_activity || 0)} : message);
            }
            reconcileMessageSenderLabelsFromNodes();
        } catch (error) { if (s.version===version) {s.error=error.message;s.retryOptions=options;} }
        finally {
            s.loading=false;
            if (s.version!==version && options.packet_id!==undefined && currentProfile?.id===profile && s.pendingPackets) {
                s.pendingPackets.add(options.packet_id);
                if(!s.timer && s.pump) s.timer=setTimeout(s.pump,100);
            }
            if (currentProfile?.id===profile && Number(getChannelNumberByIndex(activeChannelIndex))===Number(channel) && activeChatTab==='channel') renderActiveMessages();
        }
    }
    function ensure() {
        if (currentProfile && activeChannelIndex!==null && activeChannelIndex!==undefined && !state().loaded && !state().loading && !state().error) void load();
    }
    function more() { const s=state();if(s.more&&!s.loading) return load(activeChannelIndex,{cursor:s.cursor}); }
    function threadMore(id) { const thread=state().threads.get(String(id));if(thread?.has_more) return load(activeChannelIndex,{thread_id:id,after:thread.after}); }
    function footer() {
        const s=state();
        if(s.error) return `<div class="history-more"><span role="status">${escapeHtml(s.error)}</span><button type="button" data-history-retry>Retry</button></div>`;
        if(s.loading) return '<div class="history-more" role="status">Loading messages…</div>';
        return s.more?'<div class="history-more"><button type="button" data-history-more>Load older threads</button></div>':'';
    }
    function threadFooter(group) {
        const id=group.messages.find(message=>message.thread_id!==undefined)?.thread_id;
        const thread=state().threads.get(String(id));
        if (typeof collapsedMeshThreads !== 'undefined' && collapsedMeshThreads.has(threadVisibilityKey(group.key))) return '';
        return thread?.has_more?`<div class="history-thread-more"><button type="button" data-history-thread="${escapeHtml(id)}">Load more replies</button></div>`:'';
    }
    function observe(container) {
        observer?.disconnect();
        const more=container.querySelectorAll('[data-history-more],[data-history-thread]');
        if(more.length && !state().error && typeof IntersectionObserver!=='undefined') {
            observer=new IntersectionObserver(entries=>{for(const entry of entries) if(entry.isIntersecting) {
                if(entry.target.hasAttribute('data-history-thread')) void threadMore(entry.target.dataset.historyThread);
                else void ChannelHistory.more();
            }},{root:container,rootMargin:'300px'});
            more.forEach(node=>observer.observe(node));
        }
        for(const node of container.querySelectorAll('.board-thread:not(.thread-placeholder)')) {
            const margin=parseFloat(getComputedStyle(node).marginBottom) || 0;
            heights.set(key(node.dataset.threadKey),node.getBoundingClientRect().height+margin);
        }
        onScroll();
    }
    function windowed(groups, render) {
        const container=document.getElementById('messagesContainer');
        const top=scrollTarget ?? container.scrollTop, buffer=Math.max(container.clientHeight,600);
        let y=0;const mounted=[];
        const html=groups.map(group=>{
            const height=heights.get(key(group.key)) || Math.max(100,Math.min(group.messages.length*80+35,3500));
            const pinned=replyingToPacketId && group.messages.some(message=>Number(message.packet_id)===Number(replyingToPacketId));
            const visible=pinned || (y+height>=top-buffer && y<=top+container.clientHeight+buffer);
            y+=height;
            if(visible) {mounted.push(group.key);return render(group);}
            return `<div class="thread-placeholder" data-thread-key="${escapeHtml(group.key)}" style="height:${height}px" aria-hidden="true"></div>`;
        }).join('');
        windowKey=mounted.join('|');return html;
    }
    function anchor(container) {
        const top=container.getBoundingClientRect().top;
        const node=[...container.querySelectorAll('[data-thread-key]')].find(node=>node.getBoundingClientRect().bottom>top);
        return node ? {key:node.dataset.threadKey,top:node.getBoundingClientRect().top} : null;
    }
    function anchorDelta(container,saved) {
        if(!saved) return 0;
        const node=[...container.querySelectorAll('[data-thread-key]')].find(node=>node.dataset.threadKey===saved.key);
        return node ? node.getBoundingClientRect().top-saved.top : 0;
    }
    function onScroll() {
        if(frame || activeChatTab!=='channel') return;
        frame=requestAnimationFrame(()=>{
            frame=null;
            const container=document.getElementById('messagesContainer');
            if(!container || !currentProfile || activeChannelIndex===null || activeChatTab!=='channel') return;
            const groups=MeshThreads.groupThreads(getVisibleMessages());
            const old=windowKey;
            // Recalculate the visible set without changing the DOM.
            windowed(groups,()=> '');
            if(old!==windowKey) renderActiveMessages();
        });
    }
    function noteMessage(message) {
        if((message.message_type || 'channel')!=='channel') return;
        acceptSummaries([message]);
        const index=getProfileChannels().findIndex((channel,index)=>Number(getChannelNumberByIndex(index))===Number(message.channel));
        if(index<0) return;
        if(!state(Number(message.channel)).loaded && !(activeChatTab==='channel' && Number(getChannelNumberByIndex(activeChannelIndex))===Number(message.channel))) return;
        // The server knows the original root even when this is a reply to an
        // older thread that has not been loaded in this browser yet.
        if(message.packet_id) {
            const s=state(Number(message.channel));
            if(!s.pendingPackets) s.pendingPackets=new Set();
            s.pendingPackets.add(message.packet_id);
            const owner=currentProfile.id;
            const pump=async()=>{
                s.timer=null;
                if(currentProfile?.id!==owner) {s.pendingPackets.clear();return;}
                if(s.loading) {s.timer=setTimeout(pump,100);return;}
                const packet=s.pendingPackets.values().next().value;
                if(packet===undefined) return;
                s.pendingPackets.delete(packet);
                await load(index,{packet_id:packet});
                if(s.pendingPackets.size && !s.timer) s.timer=setTimeout(pump,20);
            };
            s.pump=pump;
            if(!s.timer) s.timer=setTimeout(pump,100);
        }
    }
    async function refreshState() {
        const profile=currentProfile?.id;
        if(!profile) return;
        const response=await fetch(`/api/message-state${activeChatTab==='dm'?'?include_dms=1':''}`);
        const data=await response.json();
        if(!response.ok || currentProfile?.id!==profile) return;
        acceptSummaries(data.channel_summaries);applyUnreadState(data);
        if(data.dm_messages) for(const message of data.dm_messages) upsertMessage(dmMessages,message);
        syncDmTargetsFromMessages();
    }
    document.addEventListener('DOMContentLoaded',()=>{
        document.getElementById('messagesContainer')?.addEventListener('scroll',onScroll,{passive:true});
        document.addEventListener('click',event=>{
            const button=event.target.closest('[data-history-more],[data-history-thread],[data-history-retry]');
            if(!button) return;
            if(button.hasAttribute('data-history-thread')) void threadMore(button.dataset.historyThread);
            else if(button.hasAttribute('data-history-retry')) {const s=state();s.error='';void load(activeChannelIndex,s.retryOptions || {});}
            else void more();
        });
    });
    return {accept,acceptSummaries,summary:channel=>summaries.get(Number(channel)),state,load,ensure,more,threadMore,footer,threadFooter,observe,windowed,setScrollTarget:value=>{scrollTarget=value;},anchor,anchorDelta,noteMessage,refreshState};
})();

/* Thread badges retain unread activity until its messages have been visible. */
const BoardUnread = (() => {
    const seen = new Map();
    let current = null;
    let observer = null;
    let timer = null;
    const marking = new Set();
    const id = message => String(message.id || `packet:${message.sender_num || message.sender}:${message.packet_id}`);
    function select(messages, count) {
        if (!(Number(count) > 0)) return [];
        return [...messages].filter(message => (message.direction || 'received') === 'received')
            .sort((a, b) => (parseTimestampValue(a.timestamp)?.getTime() || 0) - (parseTimestampValue(b.timestamp)?.getTime() || 0) || (a.history_row_id ?? Number.MAX_SAFE_INTEGER) - (b.history_row_id ?? Number.MAX_SAFE_INTEGER)).slice(-Math.max(0, Number(count) || 0));
    }
    function stop() {
        observer?.disconnect(); observer = null;
        if (timer) clearTimeout(timer);
        timer = null;
        current = null;
    }
    function begin(messages, count) {
        stop();
        if (!currentProfile || activeChatTab !== 'channel' || !(count > 0)) return;
        const key = `${currentProfile.id}:${getChannelNumberByIndex(activeChannelIndex)}`;
        const all = select(messages, count);
        if (!seen.has(key)) seen.set(key, new Set());
        current = {key, count, all, ids: new Set(all.map(id)), visible: new Map(), profileId: currentProfile.id, channelIndex: activeChannelIndex};
    }
    function isUnread(message) { return Boolean(current?.ids.has(id(message)) && !seen.get(current.key)?.has(id(message))); }
    function countUnread(messages) { return messages.filter(isUnread).length; }
    function check() {
        timer = null;
        const state = current;
        if (!state || document.visibilityState !== 'visible' || !document.hasFocus()) return;
        if (document.querySelector?.('.mobile-nav-open, .modal.show, dialog[open]')) return;
        const visited = seen.get(state.key);
        for (const [messageId, element] of state.visible) {
            if (element.isConnected && !element.closest('.d-none')) visited.add(messageId);
        }
        if (state.all.length < state.count || !state.all.every(message => visited.has(id(message))) || marking.has(state.key)) return;
        if (currentProfile?.id !== state.profileId || activeChatTab !== 'channel' || activeChannelIndex !== state.channelIndex) return;
        marking.add(state.key);
        void markCurrentChannelRead(state.channelIndex).finally(() => marking.delete(state.key));
    }
    function schedule() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(check, 800);
    }
    function observe(container) {
        if (!current || typeof IntersectionObserver === 'undefined') return;
        const state = current;
        observer = new IntersectionObserver(entries => {
            if (state !== current) return;
            for (const entry of entries) {
                if (entry.isIntersecting && entry.intersectionRatio >= 0.6) state.visible.set(entry.target.dataset.unreadPost, entry.target);
                else state.visible.delete(entry.target.dataset.unreadPost);
            }
            schedule();
        }, {root: container, threshold: [0, 0.6]});
        container.querySelectorAll('[data-unread-post]').forEach(element => observer.observe(element));
        schedule();
    }
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('focus', schedule);
    document.addEventListener('hidden.bs.modal', schedule);
    return {id, select, begin, stop, isUnread, countUnread, observe, resume: schedule};
})();

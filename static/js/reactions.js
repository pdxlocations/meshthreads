/* Reaction classification and aggregation shared by rooms and direct messages. */
(function(root) {
    const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, {granularity:'grapheme'}) : null;
    function singleEmoji(value) {
        const text = String(value || '').trim();
        if (!text) return false;
        if (segmenter) {
            if ([...segmenter.segment(text)].length !== 1) return false;
        } else {
            // Older engines: consume complete emoji components and joined sequences.
            if (!/^(?:\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?)*|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)$/u.test(text)) return false;
        }
        return /\p{Extended_Pictographic}/u.test(text) || /^\p{Regional_Indicator}{2}$/u.test(text) || /^[0-9#*]\uFE0F?\u20E3$/u.test(text);
    }
    function isReaction(message) {
        return Boolean(message.reply_packet_id && (Number(message.is_emoji || message.emoji || 0) > 0 || singleEmoji(message.content)));
    }
    function collect(messages) {
        const packets = new Map(messages.filter(m => m.packet_id).map(m => [String(m.packet_id), m]));
        const byTarget = new Map(), hidden = new Set();
        for (const message of messages) {
            if (!isReaction(message)) continue;
            let target = packets.get(String(message.reply_packet_id));
            const visited = new Set([message]);
            while (target && isReaction(target)) {
                if (visited.has(target)) { target = null; break; }
                visited.add(target);
                target = packets.get(String(target.reply_packet_id));
            }
            // Retain orphan reactions as messages so missing history never loses data.
            if (!target || target === message) continue;
            if (!byTarget.has(target)) byTarget.set(target, []);
            byTarget.get(target).push(message);
            hidden.add(message);
        }
        return {messages: messages.filter(m => !hidden.has(m)), byTarget, hidden};
    }
    function aggregate(reactions) {
        const groups = new Map();
        for (const message of reactions) {
            const label = String(message.content || '').trim();
            const key = label.normalize('NFC').replace(/\uFE0F/g, '');
            if (!groups.has(key)) groups.set(key, {emoji:label, messages:[], senders:new Map()});
            const group = groups.get(key);
            group.messages.push(message);
            group.senders.set(String(message.sender_num || message.sender || message.id), message);
        }
        return [...groups.values()].map(group => ({...group, senders:[...group.senders.values()]}));
    }
    const api = {singleEmoji, isReaction, collect, aggregate};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.MeshReactions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

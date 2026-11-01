/* Pure thread grouping: follow radio reply IDs, tolerate missing ancestors and cycles. */
(function (root) {
    function groupThreads(messages) {
        const sorted = [...messages].sort((a, b) => time(a) - time(b));
        const byPacket = new Map(sorted.filter(m => m.packet_id).map(m => [String(m.packet_id), m]));
        const index = new Map(sorted.map((m, i) => [m, i]));
        const groups = new Map();
        for (const message of sorted) {
            let parent = message;
            const chain = [];
            const seen = new Set();
            while (parent) {
                if (seen.has(parent)) {
                    // Canonical representative makes all members of a cycle one thread.
                    parent = chain.slice(chain.indexOf(parent)).reduce((a, b) => index.get(a) < index.get(b) ? a : b);
                    break;
                }
                seen.add(parent);
                chain.push(parent);
                const next = byPacket.get(String(parent.reply_packet_id));
                if (!next) break;
                parent = next;
            }
            // Orphan replies to the same absent packet still belong together.
            const key = parent.reply_packet_id && !byPacket.has(String(parent.reply_packet_id))
                ? `missing:${parent.reply_packet_id}` : `root:${parent.id || (parent.packet_id ? `packet:${parent.packet_id}:${parent.sender_num || parent.sender || ""}` : index.get(parent))}`;
            if (!groups.has(key)) groups.set(key, {key, root: parent, messages: [], activity: 0, missing: key.startsWith('missing:')});
            const group = groups.get(key);
            group.messages.push(message);
            group.activity = Math.max(group.activity, time(message));
        }
        return [...groups.values()].sort((a, b) => b.activity - a.activity);
    }
    function replyTree(group) {
        const reactions = typeof module !== 'undefined' && module.exports ? require('./reactions.js') : root.MeshReactions;
        const collected = reactions.collect(group.messages);
        const nodes = new Map(collected.messages.map(message => [message, {message, reactions: collected.byTarget.get(message) || [], children: [], parent: null}]));
        const treeRoot = nodes.get(group.root) || nodes.values().next().value;
        const allPackets = new Map(group.messages.filter(m => m.packet_id).map(m => [String(m.packet_id), m]));
        for (const node of nodes.values()) {
            if (node === treeRoot) continue;
            let parentMessage = allPackets.get(String(node.message.reply_packet_id));
            const skipped = new Set();
            while (parentMessage && !nodes.has(parentMessage) && !skipped.has(parentMessage)) {
                skipped.add(parentMessage);
                parentMessage = allPackets.get(String(parentMessage.reply_packet_id));
            }
            let parent = nodes.get(parentMessage) || treeRoot;
            // Broken ancestry and radio reply cycles stay visible without creating DOM cycles.
            for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
                if (ancestor === node) { parent = treeRoot; break; }
            }
            node.parent = parent;
            parent.children.push(node);
        }
        return treeRoot;
    }
    function time(message) {
        if (typeof message.timestamp === 'number') return message.timestamp * (message.timestamp < 1e10 ? 1000 : 1);
        let value = String(message.timestamp || '');
        if (/^\d{4}-\d{2}-\d{2} /.test(value)) value = value.replace(' ', 'T') + 'Z';
        return Date.parse(value) || 0;
    }
    const api = {groupThreads, replyTree};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.MeshThreads = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

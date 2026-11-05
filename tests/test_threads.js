const {test} = require('node:test');
const assert = require('node:assert/strict');
const {groupThreads} = require('../static/js/threads.js');
const m = (packet_id, timestamp, reply_packet_id) => ({packet_id, timestamp, reply_packet_id});
test('a reply to an old root bumps that entire thread above newer roots', () => {
    const [top, next] = groupThreads([m(1, 1), m(2, 2), m(3, 3, 1)]);
    assert.equal(top.root.packet_id, 1); assert.equal(next.root.packet_id, 2);
    assert.deepEqual(top.messages.map(x => x.packet_id), [1,3]);
});
test('replies to replies resolve to the original message despite input order', () => {
    const threads = groupThreads([m(3, 3, 2), m(2, 2, 1), m(1, 1)]);
    assert.equal(threads.length, 1); assert.equal(threads[0].root.packet_id, 1);
});
test('orphan replies sharing a missing original remain together', () => {
    const threads = groupThreads([m(2, 2, 1), m(3, 3, 1), m(4, 4, 3)]);
    assert.equal(threads.length, 1); assert.equal(threads[0].missing, true);
});
test('cyclic reply IDs do not hang or duplicate threads', () => {
    const threads = groupThreads([m(1, 1, 2), m(2, 2, 1), m(3, 3, 2)]);
    assert.equal(threads.length, 1); assert.equal(threads[0].messages.length, 3);
});
test('root messages without packet IDs remain separate', () => {
    assert.equal(groupThreads([m(null, 1), m(null, 2)]).length, 2);
});
test('thread identity stays stable when older history loads or new replies arrive', () => {
    const root = {...m(20, 20), id:'original'};
    const before = groupThreads([root, m(21, 21, 20)])[0].key;
    const after = groupThreads([m(1, 1), root, m(21, 21, 20), m(22, 22, 20)]).find(t => t.root === root).key;
    assert.equal(after, before);
});

test('reply tree nests responses under their exact parent and keeps siblings separate', () => {
    const {replyTree} = require('../static/js/threads.js');
    const [group] = groupThreads([m(5, 5, 3), m(4, 4, 1), m(3, 3, 2), m(2, 2, 1), m(1, 1)]);
    const tree = replyTree(group);
    assert.equal(tree.message.packet_id, 1);
    assert.deepEqual(tree.children.map(n => n.message.packet_id), [2, 4]);
    assert.equal(tree.children[0].children[0].message.packet_id, 3);
    assert.equal(tree.children[0].children[0].children[0].message.packet_id, 5);
    assert.equal(tree.children[1].children.length, 0);
    assert.equal(tree.children[0].parent, tree);
});
test('reply trees keep orphan replies and cyclic ancestry visible exactly once', () => {
    const {replyTree} = require('../static/js/threads.js');
    for (const messages of [[m(2, 2, 1), m(3, 3, 1), m(4, 4, 3)], [m(1, 1, 2), m(2, 2, 1), m(3, 3, 2)], [m(1, 1), m(2, 2, 2)]]) {
        const visited = new Set();
        for (const group of groupThreads(messages)) {
            const pending = [replyTree(group)];
            while (pending.length) {
                const node = pending.pop();
                assert.equal(visited.has(node.message), false);
                visited.add(node.message);
                pending.push(...node.children);
            }
        }
        assert.equal(visited.size, messages.length);
    }
});

test('server activity keeps a partially loaded old thread above newer roots',()=>{
    const messages=[
        {id:'old',packet_id:1,channel:15,thread_id:'1',timestamp:1,thread_activity:5000,thread_last_id:30},
        {id:'new',packet_id:2,channel:15,thread_id:'2',timestamp:3,thread_activity:3000,thread_last_id:20},
        {id:'reply',packet_id:3,reply_packet_id:1,channel:15,timestamp:4},
    ];
    const api=require('../static/js/threads.js');
    const groups=api.groupThreads(messages);
    assert.equal(groups.length,2);
    assert.equal(groups[0].root.id,'old');
    assert.equal(groups[0].messages.length,2);
});

test('later reply pages retain chronological order when messages share a timestamp',()=>{
    const api=require('../static/js/threads.js');
    const messages=[
        {id:'root',packet_id:1,channel:15,thread_id:'1',timestamp:1,history_row_id:1},
        {id:'last',packet_id:100,reply_packet_id:1,channel:15,thread_id:'1',timestamp:1,history_row_id:100},
        {id:'middle',packet_id:40,reply_packet_id:1,channel:15,thread_id:'1',timestamp:1,history_row_id:40},
    ];
    const group=api.groupThreads(messages)[0];
    assert.deepEqual(api.replyTree(group).children.map(node=>node.message.id),['middle','last']);
});

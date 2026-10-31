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

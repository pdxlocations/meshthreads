/* MeshThreads presentation layer. Firefly remains responsible for transport and state. */
const collapsedMeshThreads = new Set();
let nodeBoardQuery = '';
let boardDialogBusy = false;
let favoriteNodeNums = new Set();
const pendingNodeFavorites = new Set();
let favoriteChangeVersion = 0;
const originalBoardRender = renderActiveMessages;
const originalComposerUpdate = updateComposerState;
const originalBoardBadges = updateNavigationBadges;
updateNavigationBadges = function() {
    originalBoardBadges();
    renderBoardRails();
};
const originalNodesList = renderNodesList;
const expandedDirectoryNodes = new Set();
let nodeDirectoryFilter = 'all';
let nodeDirectorySort = 'heard';
const originalNumericNodeLabel = getNodeDisplayLabel;
getNodeDisplayLabel = function(node) {
    if (node && typeof node === 'object') return node.long_name || node.short_name || node.node_id || `!${Number(node.node_num).toString(16).padStart(8, '0')}`;
    return originalNumericNodeLabel(node);
};
const originalMessageRender = renderMessageHtml;
const originalLoadBoardProfile = loadCurrentProfileAndStatus;
const originalStartReply = startReply;
const originalClearReply = clearReplyComposer;

loadCurrentProfileAndStatus = async function() {
    await originalLoadBoardProfile();
    await Promise.all([loadNodes(), loadNodeFavorites()]);
    renderBoardRails();
};

function threadVisibilityKey(key) {
    return `${currentProfile?.id || ''}:${getActiveChannel()?.channel_number ?? ''}:${key}`;
}

function sortFavoriteNodes(nodes) {
    return [...nodes].sort((a, b) => Number(favoriteNodeNums.has(Number(b.node_num))) - Number(favoriteNodeNums.has(Number(a.node_num))));
}

function renderNodeFavorite(node) {
    const number = Number(node.node_num);
    const favorite = favoriteNodeNums.has(number);
    const label = `${favorite ? 'Unstar' : 'Star'} ${getNodeDisplayLabel(node)}`;
    return `<button type="button" class="node-star ${favorite ? 'is-favorite' : ''}" data-board-favorite="${number}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" aria-pressed="${favorite}" ${pendingNodeFavorites.has(number) ? 'disabled' : ''}>${favorite ? '★' : '☆'}</button>`;
}

async function loadNodeFavorites() {
    const version = favoriteChangeVersion;
    try {
        const result = await roomRequest('/api/node-favorites');
        if (version === favoriteChangeVersion) favoriteNodeNums = new Set(result.node_nums.map(Number));
    } catch (error) { boardNotice(`Could not load starred nodes: ${error.message}`, true); }
}

async function toggleNodeFavorite(number) {
    if (pendingNodeFavorites.has(number)) return;
    const favorite = !favoriteNodeNums.has(number);
    favoriteChangeVersion += 1;
    pendingNodeFavorites.add(number);
    renderBoardNodes();
    if (activeChatTab === 'nodes') updateNodeListFilter();
    try {
        const result = await roomRequest(`/api/nodes/${number}/favorite`, 'PUT', {favorite});
        if (result.favorite) favoriteNodeNums.add(number); else favoriteNodeNums.delete(number);
    } catch (error) { boardNotice(`Could not save star: ${error.message}`, true); }
    finally {
        pendingNodeFavorites.delete(number);
        renderBoardNodes();
        if (activeChatTab === 'nodes') updateNodeListFilter();
    }
}

function activeDmPeerLabel() {
    const target = dmTargets.find(item => Number(item.node_num) === Number(activeDmTargetNodeNum));
    const node = getNodeByNum(activeDmTargetNodeNum);
    return node?.long_name || node?.short_name || target?.label || getNodeDisplayLabel(activeDmTargetNodeNum);
}

const originalFilteredNodes = getFilteredNodes;
getFilteredNodes = function() { return sortFavoriteNodes(originalFilteredNodes()); };

function boardIcon(name) {
    const paths = {
        plus: '<path d="M12 5v14M5 12h14"/>',
        link: '<path d="m10 13 4-4m-6 8-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 8a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1"/>',
        chat: '<path d="M4 4h16v12H8l-4 4V4Z"/>',
        map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16"/>',
        user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2H4Z"/>',
        nodes: '<circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="m10 8-4 8m8-8 4 8"/>',
        search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
        gear: '<path d="m9 3-1 3-3 1-2 3 2 2v3l3 1 1 3h5l1-3 3-1v-3l2-2-2-3-3-1-1-3H9Z"/><circle cx="11" cy="11" r="3"/>',
        right: '<path d="m9 5 7 7-7 7"/>',
        down: '<path d="m5 9 7 7 7-7"/>',
        reply: '<path d="m9 6-6 6 6 6M3 12h11a7 7 0 0 1 7 7"/>',
    };
    return `<svg class="board-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function boardAvatarColor(identity) {
    const colors = ['#568ec4', '#4d9975', '#4d8c91', '#8b70ae'];
    let hash = 0;
    for (const char of String(identity || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return colors[hash % colors.length];
}

function renderBoardPost(message, reactions = []) {
    const sender = getMessageSenderDisplayName(message);
    const identity = getMessageSenderNodeId(message);
    const packet = Number(message.packet_id);
    const reply = packet ? `<button type="button" class="board-post-reply" onclick="startReply(${packet})" aria-label="Reply to ${escapeHtml(sender)}">${boardIcon('reply')}<span>Reply</span></button>` : '';
    const unread = BoardUnread.isUnread(message);
    return `<div class="board-post ${unread ? 'board-post-unread' : ''}" ${unread ? `data-unread-post="${escapeHtml(BoardUnread.id(message))}"` : ''}><span class="identity-avatar" style="--avatar-color:${boardAvatarColor(identity)}" aria-hidden="true">${escapeHtml(String(sender || '?').trim().charAt(0).toUpperCase())}</span><div class="board-post-body"><div class="board-post-heading"><span class="board-post-author" title="${escapeHtml(identity || '')}">${escapeHtml(sender)}</span>${unread ? '<span class="post-new-badge">New</span>' : ''}<time class="board-post-time">${escapeHtml(formatTimestamp(message.timestamp))}</time></div><div class="message__content">${renderMessageContentHtml(message.content || '')}</div><div class="board-post-tools">${reply}${renderAckStatusHtml(message)}</div>${renderReactionBubbles(message, reactions)}</div></div>`;
}

async function roomRequest(path, method = 'GET', data) {
    const response = await fetch(path, {
        method, headers: {'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name=csrf-token]').content},
        ...(data ? {body: JSON.stringify(data)} : {}),
    });
    const payload = await response.json().catch(() => ({error: response.status === 404
        ? 'Restart MeshThreads to load the latest server changes.'
        : 'The server returned an unexpected response. Please retry.'}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
}

function boardNotice(text, error = false) {
    const notice = document.getElementById('boardNotice');
    notice.textContent = text;
    notice.hidden = false;
    notice.classList.toggle('is-error', error);
}

function setMobileNavigation(open, restoreFocus = true) {
    const grid = document.querySelector('.mesh-layout');
    const sidebar = document.getElementById('boardSidebar');
    const toggle = document.getElementById('mobileNavToggle');
    if (!grid || !sidebar || !toggle) return;
    grid.classList.toggle('mobile-nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    document.querySelector('.mobile-nav-backdrop').hidden = !open;
    document.querySelector('.chat-shell-card').inert = open;
    if (open) {
        sidebar.setAttribute('role', 'dialog');
        sidebar.setAttribute('aria-modal', 'true');
        sidebar.querySelector('[data-board-mobile-nav="close"]').focus();
    } else {
        sidebar.removeAttribute('role');
        sidebar.removeAttribute('aria-modal');
        if (restoreFocus && window.matchMedia('(max-width: 600px)').matches) toggle.focus();
        BoardUnread.resume();
    }
}

function handleMobileNavigationKey(event) {
    if (document.getElementById('mobileNavToggle')?.getAttribute('aria-expanded') !== 'true') return;
    if (event.key === 'Escape') { event.preventDefault(); setMobileNavigation(false); return; }
    if (event.key !== 'Tab') return;
    const controls = [...document.getElementById('boardSidebar').querySelectorAll('button:not(:disabled), select:not(:disabled), a[href], input:not(:disabled)')].filter(element => element.getClientRects().length);
    if (!controls.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
}

function handleAccountNavigationClick() {
    if (window.matchMedia('(max-width: 600px)').matches && document.getElementById('mobileNavToggle')?.getAttribute('aria-expanded') === 'true') {
        setMobileNavigation(false, false);
    }
}

function renderActiveStation() {
    const name = document.getElementById('activeStationName');
    const button = document.getElementById('activeStationProfile');
    if (!name || !button) return;
    name.textContent = currentProfile?.long_name || currentProfile?.node_id || 'Activate a profile';
    button.setAttribute('aria-label', `${currentProfile ? `Active profile: ${name.textContent}. ` : ''}Open Profiles`);
}

function installBoardLayout() {
    const shell = document.querySelector('.chat-shell-card');
    const grid = document.createElement('div');
    grid.className = 'mesh-layout';
    shell.parentNode.insertBefore(grid, shell);
    const rooms = document.createElement('aside');
    rooms.className = 'mesh-rooms';
    rooms.id = 'boardSidebar';
    rooms.setAttribute('aria-label', 'Rooms and profile');
    rooms.innerHTML = `<div class="mobile-nav-heading"><span>Rooms & navigation</span><button type="button" data-board-mobile-nav="close" aria-label="Close navigation">×</button></div><section class="harbor-panel profile-panel"><button id="activeStationProfile" class="station-profile-link" type="button" data-board-action="profiles"><span id="activeStationName">Activate a profile</span>${boardIcon('right')}</button><div class="station-status-line"><span>Web</span><span id="stationSocketStatus"></span></div><div class="station-status-line"><span>Mesh</span><span id="stationMeshStatus"></span></div></section>
        <section class="harbor-panel rooms-panel"><div class="rail-heading rooms-heading">Rooms</div>
        <div id="boardRooms"></div><button type="button" class="rail-link rail-new-room" data-board-action="create">${boardIcon('plus')}<span>New room</span></button>
            <button type="button" class="rail-link" data-board-action="join">${boardIcon('link')}<span>Join by URL</span></button>
        </section><nav class="rail-navigation harbor-panel" aria-label="Station navigation"><div class="rail-heading">Navigation</div>
            <button type="button" class="rail-link" data-board-action="dms">${boardIcon('chat')}<span>Direct messages</span><span id="railDmCount"></span></button>
            <button type="button" class="rail-link" data-board-action="map">${boardIcon('map')}<span>Network map</span></button>
            <button type="button" class="rail-link" data-board-action="nodes">${boardIcon('nodes')}<span>Node directory</span></button>
            <button type="button" class="rail-link" data-board-action="profiles">${boardIcon('user')}<span>Profiles</span></button>
        </nav>`;
    grid.append(rooms, shell);
    grid.insertAdjacentHTML('afterbegin', `<div class="mobile-board-nav"><button id="mobileNavToggle" type="button" data-board-mobile-nav="toggle" aria-controls="boardSidebar" aria-expanded="false"><span aria-hidden="true">☰</span> Rooms & navigation <span id="mobileMenuUnread" class="room-unread-badge" hidden></span></button></div><button class="mobile-nav-backdrop" type="button" data-board-mobile-nav="close" aria-label="Close navigation" tabindex="-1" hidden></button>`);
    window.matchMedia('(max-width: 600px)').addEventListener('change', () => setMobileNavigation(false, false));
    document.addEventListener('keydown', handleMobileNavigationKey);
    const nodes = document.createElement('aside');
    nodes.className = 'mesh-nodes';
    nodes.setAttribute('aria-label', 'Mesh nodes');
    nodes.innerHTML = `<div class="rail-heading">Mesh nodes <span id="boardNodeCount">0</span></div><div class="node-search">${boardIcon('search')}<label class="visually-hidden" for="boardNodeSearch">Search nodes</label><input id="boardNodeSearch" placeholder="Search nodes..." type="search"></div><div id="boardNodes"></div>`;
    grid.append(nodes);
    // Keep legacy controls in their hidden sheet for existing profile workflows.
    document.getElementById('stationSocketStatus').append(document.getElementById('connectionStatusMobile'));
    document.getElementById('stationMeshStatus').append(document.getElementById('interfaceStatusMobile'));
    const accountButton = document.querySelector('.navbar-auth__username');
    const logoutForm = document.querySelector('.navbar-auth__form');
    if (accountButton && logoutForm) {
        const menu = document.createElement('div');
        menu.className = 'dropdown station-account';
        accountButton.before(menu);
        accountButton.removeAttribute('data-bs-target');
        accountButton.setAttribute('data-bs-toggle', 'dropdown');
        accountButton.setAttribute('data-bs-display', 'static');
        accountButton.setAttribute('aria-expanded', 'false');
        accountButton.addEventListener('click', handleAccountNavigationClick);
        accountButton.insertAdjacentHTML('afterbegin', boardIcon('user'));
        accountButton.insertAdjacentHTML('beforeend', boardIcon('down'));
        menu.append(accountButton);
        menu.insertAdjacentHTML('beforeend', '<div class="dropdown-menu dropdown-menu-end"><button type="button" class="dropdown-item" data-board-action="profiles">Profiles</button><button type="button" class="dropdown-item" data-bs-toggle="modal" data-bs-target="#accountModal">Account settings</button></div>');
        menu.querySelector('.dropdown-menu').append(logoutForm);
        const adminLink = document.getElementById('adminMenuLink');
        if (adminLink) {
            menu.querySelector('.dropdown-menu').insertBefore(adminLink, logoutForm);
            adminLink.hidden = false;
        }
    }

    const messages = document.getElementById('messagesContainer');
    messages.insertAdjacentHTML('beforebegin', `<div class="board-heading"><h1 id="boardRoomTitle">Your rooms</h1><div class="board-heading-actions"><button type="button" data-board-action="manage">${boardIcon('gear')}<span>Room settings</span></button><button type="button" data-board-action="new-thread">${boardIcon('plus')}<span>New thread</span></button></div><p id="boardDescription">Threads sorted by last activity.</p></div><div id="boardNotice" role="status" aria-live="polite" hidden></div>`);
    const dock = document.createElement('div');
    dock.id = 'composerDock';
    messages.after(dock);
    dock.append(document.getElementById('composerBar'));
    document.getElementById('composerBar').insertAdjacentHTML('afterbegin', '<label id="composerLabel" class="visually-hidden" for="messageInput">Start a new thread</label>');
    document.body.insertAdjacentHTML('beforeend', `<dialog id="roomDialog" aria-labelledby="roomDialogTitle"><form id="roomDialogForm"><div class="dialog-heading"><h2 id="roomDialogTitle">ROOM</h2><button type="button" data-board-action="close-dialog" aria-label="Close">×</button></div><div id="roomDialogBody"></div><p id="roomDialogError" class="is-error" role="alert"></p><div class="dialog-actions"><button type="button" data-board-action="close-dialog">CANCEL</button><button type="submit" id="roomDialogSubmit">SAVE</button></div></form></dialog>`);
    document.addEventListener('click', boardClick);
    document.getElementById('roomDialogForm').addEventListener('submit', submitRoomDialog);
    document.getElementById('boardNodeSearch').addEventListener('input', event => {nodeBoardQuery = event.target.value.toLowerCase(); renderBoardNodes();});
    document.getElementById('roomDialog').addEventListener('cancel', event => {if (boardDialogBusy) event.preventDefault();});
    renderActiveMessages();
    void loadNodes().then(renderBoardNodes);
    setInterval(() => { if (currentProfile && !document.hidden) void loadNodes().then(renderBoardNodes); }, 30000);
}

function renderBoardRails() {
    renderActiveStation();
    updateProfileActivationButton();
    if (!document.getElementById('boardRooms')) return;
    const channels = getProfileChannels();
    document.getElementById('boardRooms').innerHTML = channels.length ? channels.map((channel, index) => {
        const count = unreadChannelMessageCounts.get(Number(channel.channel_number)) || 0;
        return `<button type="button" class="room-link ${activeChatTab === 'channel' && activeChannelIndex === index ? 'selected' : ''}" data-board-room="${index}"><span># ${escapeHtml(channel.name)}</span>${count ? `<b class="room-unread-badge" aria-label="${count} unread messages">${count}</b>` : ''}</button>`;
    }).join('') : '<p class="rail-empty">NO ROOMS YET<br>Create and activate a profile to begin.</p>';
    const title = activeChatTab === 'dm' && activeDmTargetNodeNum ? activeDmPeerLabel() : activeChatTab === 'channel' ? (getActiveChannel() ? '# ' + getActiveChannel().name : 'Your rooms') : ({dm: 'Direct messages', nodes: 'Node directory', profiles: 'Your station', map: 'Network map'}[activeChatTab]);
    document.getElementById('boardRoomTitle').textContent = title;
    document.getElementById('boardDescription').textContent = activeChatTab === 'channel' ? 'Threads sorted by last activity.' : ({dm: activeDmTargetNodeNum ? `Direct message · !${Number(activeDmTargetNodeNum).toString(16).padStart(8, '0')}` : 'Your private conversations.', nodes: 'Nodes discovered on your mesh.', profiles: 'Manage your mesh identity and channels.', map: 'Explore your mesh network.'}[activeChatTab] || '');
    document.querySelectorAll('.board-heading-actions button').forEach(button => button.hidden = activeChatTab !== 'channel');
    document.querySelectorAll('.rail-navigation [data-board-action]').forEach(button => {
        const selected = ({dms:'dm', nodes:'nodes', profiles:'profiles', map:'map'}[button.dataset.boardAction]) === activeChatTab;
        button.classList.toggle('selected', selected);
        if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    document.getElementById('railDmCount').textContent = [...unreadDmMessageCounts.values()].reduce((a,b) => a+b, 0) || '';
    const mobileUnread = document.getElementById('mobileMenuUnread');
    if (mobileUnread) {
        const total = getUnreadTotal(unreadChannelMessageCounts) + getUnreadTotal(unreadDmMessageCounts);
        mobileUnread.hidden = total === 0;
        mobileUnread.textContent = total > 99 ? '99+' : String(total);
        mobileUnread.setAttribute('aria-label', `${total} unread messages`);
    }
    renderBoardNodes();
}

function renderBoardNodes() {
    const target = document.getElementById('boardNodes');
    if (!target) return;
    document.getElementById('boardNodeCount').textContent = meshNodes.length;
    const nodes = sortFavoriteNodes(meshNodes.filter(n => `${n.long_name} ${n.short_name} ${n.node_id}`.toLowerCase().includes(nodeBoardQuery)));
    target.innerHTML = nodes.map(node => `<div class="rail-node" data-board-node="${Number(node.node_num)}"><span class="identity-avatar" style="--avatar-color:${boardAvatarColor(node.node_id || node.node_num)}" aria-hidden="true">${escapeHtml(getNodeDisplayLabel(node).trim().charAt(0).toUpperCase())}</span><div class="rail-node-body"><div class="rail-node-heading"><button type="button" class="rail-node-name rail-node-link" data-board-node="${Number(node.node_num)}" aria-label="View ${escapeHtml(getNodeDisplayLabel(node))} in node directory">${escapeHtml(getNodeDisplayLabel(node))}</button>${renderNodeFavorite(node)}</div><div class="rail-node-meta" title="${escapeHtml(String(node.node_id || ''))}">${escapeHtml(String(node.node_id || '').replace(/^!/, ''))}</div><div class="rail-node-actions"><button type="button" data-board-dm="${Number(node.node_num)}">DM</button><button type="button" data-board-invite="${Number(node.node_num)}">Invite to room</button></div></div></div>`).join('') || `<p class="rail-empty">${currentProfile ? (nodeBoardQuery ? 'No matching nodes.' : 'Listening for nodes…') : 'Activate a profile to discover nodes.'}</p>`;

}

function preserveComposerFocus(render) {
    const input = document.getElementById('messageInput');
    const focused = input && document.activeElement === input;
    const selection = focused ? [input.selectionStart, input.selectionEnd, input.selectionDirection] : null;
    const scrollTop = input?.scrollTop;
    try {
        return render();
    } finally {
        if (focused && input.isConnected && !input.disabled && !input.closest('.d-none')) {
            if (document.activeElement !== input) input.focus({preventScroll: true});
            input.setSelectionRange(...selection);
            input.scrollTop = scrollTop;
        }
    }
}

function moveBoardComposer(parent) {
    const composer = document.getElementById('composerBar');
    if (!parent || !composer || composer.parentNode === parent) return;
    // State-preserving moves also retain active IME composition in supporting browsers.
    if (parent.moveBefore && composer.isConnected && parent.isConnected) parent.moveBefore(composer, null);
    else parent.append(composer);
}

function replyBranchKey(node, group) {
    return node.message === group.root ? group.key : `${group.key}:reply:${node.message.id || node.message.packet_id || group.messages.indexOf(node.message)}`;
}

function renderReplyBranch(node, group) {
    const key = replyBranchKey(node, group);
    const open = !collapsedMeshThreads.has(threadVisibilityKey(key));
    const count = node.children.length;
    const footer = count ? `<footer class="thread-footer"><button type="button" data-board-toggle="${escapeHtml(key)}" aria-expanded="${open}">${boardIcon(open ? 'down' : 'right')} ${count} ${count === 1 ? 'reply' : 'replies'}</button></footer>` : '';
    return `<div class="reply-branch" data-reply-packet="${Number(node.message.packet_id) || ''}">${renderBoardPost(node.message, node.reactions)}${footer}<div class="thread-replies ${open ? '' : 'd-none'}">${node.children.map(child => renderReplyBranch(child, group)).join('')}<div class="inline-composer-slot"></div></div></div>`;
}

renderActiveMessages = function () {
    return preserveComposerFocus(() => {
        const container = document.getElementById('messagesContainer');
        const dock = document.getElementById('composerDock');
        if (!dock) return originalBoardRender();
        // Keep the live composer node and its unsent draft intact across live renders.
        moveBoardComposer(dock);
        NodePanels.disposeMaps();
        BoardUnread.stop();
        boardReactionGroups.clear();
        renderBoardRails();
        if (!currentProfile && (activeChatTab === 'channel' || activeChatTab === 'dm')) {
            const hasProfiles = Object.keys(managedProfiles).length > 0;
            container.innerHTML = `<section class="board-empty setup-empty" aria-labelledby="boardSetupTitle"><span class="empty-glyph">[ 01 ]</span><div class="board-eyebrow">GET CONNECTED / PROFILE REQUIRED</div><h2 id="boardSetupTitle">${hasProfiles ? 'ACTIVATE YOUR PROFILE_' : 'WELCOME TO MESHTHREADS_'}</h2><p>${hasProfiles ? 'Activate a profile to connect to the mesh.<br>Your rooms and messages will appear here.' : 'You’re signed in. Create a Meshtastic profile<br>before joining rooms or sending messages.'}</p><p class="setup-next">${hasProfiles ? 'Choose your profile and click Activate.' : '1. Create your profile &nbsp; 2. Activate it &nbsp; 3. Open a room'}</p><button type="button" data-board-action="setup-profile">${hasProfiles ? 'CHOOSE A PROFILE →' : 'CREATE YOUR FIRST PROFILE →'}</button></section>`;
            return;
        }
        if (activeChatTab !== 'channel' || activeChannelIndex === null || activeChannelIndex === undefined) {
            originalBoardRender();
            return;
        }
        container.classList.remove('messages-container--map', 'messages-container--nav-safe');
        const visibleMessages = getVisibleMessages();
        BoardUnread.begin(visibleMessages, getActiveUnreadCount());
        const groups = MeshThreads.groupThreads(visibleMessages);
        const scroll = container.scrollTop;
        container.innerHTML = groups.length ? groups.map(group => {
            const unreadCount = BoardUnread.countUnread(group.messages);
            return `<article class="board-thread ${unreadCount ? 'board-thread-unread' : ''}" data-thread-key="${escapeHtml(group.key)}">${unreadCount ? `<div class="thread-unread-label" aria-label="${unreadCount} unread messages">${unreadCount} unread</div>` : ''}${group.missing ? '<div class="orphan-note">ORIGINAL MESSAGE NOT IN LOCAL HISTORY</div>' : ''}${renderReplyBranch(MeshThreads.replyTree(group), group)}</article>`;
        }).join('') : '';
        if (replyingToPacketId) {
            const branch = [...container.querySelectorAll('[data-reply-packet]')].find(el => Number(el.dataset.replyPacket) === Number(replyingToPacketId));
            const slot = branch?.querySelector(':scope > .thread-replies > .inline-composer-slot');
            if (slot && !slot.closest('.d-none')) moveBoardComposer(slot);
        }
        container.scrollTop = scroll;
        BoardUnread.observe(container);
    });
};

updateComposerState = function () {
    originalComposerUpdate();
    if (!document.getElementById('composerLabel')) return;
    document.getElementById('composerLabel').textContent = activeChatTab === 'dm' ? 'Private message' : (replyingToPacketId ? 'Reply to thread' : 'Start a new thread');
    if (!isSendingMessage) document.getElementById('sendBtn').textContent = replyingToPacketId ? 'Reply' : 'Send';
    if (activeChatTab === 'channel' && getActiveChannel()) document.getElementById('messageInput').placeholder = replyingToPacketId ? 'Write a reply...' : 'Start a new thread...';
    renderBoardRails();
};
startReply = function(packetId) {
    originalStartReply(packetId);
    if (activeChatTab === 'channel') {
        const group = MeshThreads.groupThreads(getVisibleMessages()).find(thread => thread.messages.some(message => Number(message.packet_id) === Number(packetId)));
        if (group) {
            const tree = MeshThreads.replyTree(group);
            const pending = [tree];
            while (pending.length) {
                const node = pending.pop();
                if (Number(node.message.packet_id) === Number(packetId)) {
                    for (let ancestor = node; ancestor; ancestor = ancestor.parent) {
                        collapsedMeshThreads.delete(threadVisibilityKey(replyBranchKey(ancestor, group)));
                    }
                    break;
                }
                pending.push(...node.children);
            }
        }
    }
    renderActiveMessages();
    document.getElementById('messageInput').focus();
};
clearReplyComposer = function() { originalClearReply(); renderActiveMessages(); };
function renderSavedTraceroute(node) {
    const result = node.latest_traceroute;
    if (!result) return '<h4>Latest traceroute</h4><p class="saved-traceroute-empty">No saved traceroute yet. Run Traceroute to discover this node’s route.</p>';
    const relabel = hops => (hops || []).map(hop => {
        const known = getNodeByNum(hop.node_num);
        return {...hop, label: known ? getNodeDisplayLabel(known) : hop.label};
    });
    return `<div class="saved-traceroute-heading"><h4>Latest traceroute</h4><time datetime="${escapeHtml(result.received_at || '')}">${escapeHtml(formatDateTime(result.received_at))}</time></div><div class="saved-traceroute-path"><h5>Towards destination</h5>${renderTraceroutePath(relabel(result.route_towards))}</div><div class="saved-traceroute-path"><h5>Back to us</h5>${renderTraceroutePath(relabel(result.route_back))}</div>`;
}

function cacheTracerouteResult(result) {
    if (!result || !currentProfile || result.owner_profile_id !== currentProfile.id || !result.request_id || Number(result.to_node_num) !== parseNodeId(currentProfile.node_id)) return;
    const node = getNodeByNum(result.from_node_num);
    if (!node) return;
    node.latest_traceroute = result;
    const panel = document.getElementById(`savedTraceroute-${Number(node.node_num)}`);
    if (panel) panel.innerHTML = renderSavedTraceroute(node);
}

const originalTracerouteResult = handleTracerouteResult;
handleTracerouteResult = function(result) {
    cacheTracerouteResult(result);
    originalTracerouteResult(result);
};

function directoryNodeKey(nodeNum) {
    return `${currentProfile?.id || ''}:${Number(nodeNum)}`;
}

function sortedDirectoryNodes(nodes) {
    return [...nodes].filter(node => nodeDirectoryFilter !== 'starred' || favoriteNodeNums.has(Number(node.node_num))).sort((a, b) => {
        if (nodeDirectorySort === 'name') return getNodeDisplayLabel(a).localeCompare(getNodeDisplayLabel(b));
        if (nodeDirectorySort === 'hops') return (a.hops_away ?? Infinity) - (b.hops_away ?? Infinity);
        return (parseTimestampValue(b.last_seen)?.getTime() || 0) - (parseTimestampValue(a.last_seen)?.getTime() || 0);
    });
}

renderNodeListResults = function(nodes) {
    const sorted = sortedDirectoryNodes(nodes);
    if (!sorted.length) return '<p class="rail-empty">No nodes match this search or filter.</p>';
    const starred = sorted.filter(node => favoriteNodeNums.has(Number(node.node_num)));
    const others = sorted.filter(node => !favoriteNodeNums.has(Number(node.node_num)));
    return `<div class="node-roster">${[[starred, 'Starred'], [others, 'Other nodes']].filter(([group]) => group.length).map(([group, title]) => `<section class="node-roster-group" aria-label="${title}"><h2>${title} <span>(${group.length})</span></h2>${group.map(renderNodeCardHtml).join('')}</section>`).join('')}</div>`;
};

renderNodesList = function(container) {
    NodePanels.disposeMaps();
    if (!currentProfile || !meshNodes.length) return originalNodesList(container);
    container.innerHTML = `<section class="directory-roster" aria-label="Node directory">
        <div class="directory-toolbar"><label class="directory-search">${boardIcon('search')}<span class="visually-hidden">Search nodes</span><input id="nodeSearchInput" type="search" placeholder="Search nodes…" value="${escapeHtml(nodeSearchQuery)}" autocomplete="off"></label>
        <div class="directory-filters" role="group" aria-label="Filter nodes">${['all', 'starred'].map(filter => `<button type="button" data-board-directory-filter="${filter}" aria-pressed="${nodeDirectoryFilter === filter}">${filter === 'all' ? 'All' : 'Starred'}</button>`).join('')}</div>
        <label class="directory-sort">Sort <select id="nodeDirectorySort">${[['heard', 'Last heard'], ['name', 'Name'], ['hops', 'Hops']].map(([value, label]) => `<option value="${value}" ${nodeDirectorySort === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
        <p class="directory-count">${meshNodes.length} nodes discovered</p>
        <div id="nodeListResults">${renderNodeListResults(getFilteredNodes())}</div></section>`;
    NodePanels.refreshExpanded();
};

function renderNodeExtraInfo(node) {
    const fields = [];
    if (node.snr !== null && node.snr !== undefined && Number.isFinite(Number(node.snr))) fields.push(['Received SNR', `${Number(node.snr).toFixed(1)} dB`]);
    const channels = new Set((node.channel_numbers || []).map(Number));
    const rooms = getProfileChannels().filter(channel => channels.has(Number(channel.channel_number))).map(channel => channel.name);
    if (rooms.length) fields.push(['Seen in rooms', rooms.join(', ')]);
    fields.push(['Public key', node.public_key ? 'Received' : 'Not received yet']);
    if (node.is_unmessagable) fields.push(['Direct messaging', 'Node reports messaging unavailable']);
    return `<h4>Connection</h4><dl>${fields.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join('')}</dl>`;
}

renderNodeCardHtml = function(node) {
    const number = Number(node.node_num);
    const name = getNodeDisplayLabel(node);
    const id = node.node_id || `!${number.toString(16).padStart(8, '0')}`;
    const open = expandedDirectoryNodes.has(directoryNodeKey(number));
    const hops = node.hops_away === null || node.hops_away === undefined ? 'Hops unknown' : `${Number(node.hops_away)} ${Number(node.hops_away) === 1 ? 'hop' : 'hops'}`;
    return `<article class="node-roster-row" data-directory-node="${number}" tabindex="-1">
        <div class="node-roster-summary">${renderNodeFavorite(node)}<div class="node-roster-identity"><div class="node-roster-headline"><h3>${escapeHtml(name)}</h3><span class="node-roster-role">${escapeHtml(node.role || 'Unknown role')}</span><span class="node-roster-heard">${formatNodeLastSeen(node.last_seen)}</span><span class="node-roster-hops">${escapeHtml(hops)}</span></div>
        <div class="node-roster-meta">${[node.short_name, id, node.hw_model].filter(Boolean).map(value => `<span>${escapeHtml(String(value))}</span>`).join('')}</div></div>
        <div class="node-roster-actions"><button class="node-dm-trigger" type="button" data-node-num="${number}">${boardIcon('chat')}<span>DM</span></button><button type="button" data-board-invite="${number}">${boardIcon('user')}<span>Invite to room</span></button><button class="node-roster-expand" type="button" data-board-node-expand="${number}" aria-expanded="${open}" aria-controls="nodeDetails-${number}" aria-label="${open ? 'Hide' : 'Show'} details for ${escapeHtml(name)}">${boardIcon('down')}</button></div></div>
        <div class="node-roster-details" id="nodeDetails-${number}" ${open ? '' : 'hidden'}>
        <div class="node-roster-info">${renderNodeExtraInfo(node)}</div>
        <div class="node-roster-detail-actions"><h4>Actions</h4><div><button class="node-nodeinfo-trigger" type="button" data-node-num="${number}">${boardIcon('nodes')}<span>Exchange node info</span></button><button class="node-traceroute-trigger" type="button" data-node-num="${number}">${boardIcon('map')}<span>Traceroute</span></button></div></div><section class="saved-traceroute" id="savedTraceroute-${number}" aria-label="Latest traceroute" aria-live="polite">${renderSavedTraceroute(node)}</section>${NodePanels.render(node)}</div></article>`;
};

renderMessageHtml = function(message) {
    let html = originalMessageRender(message);
    if (message.message_type === 'dm') {
        const match = String(message.content || '').match(/https:\/\/meshtastic\.org\/[ed]\/#([A-Za-z0-9_\-=]+)/);
        if (match) html = html.replace('</div>\n                </div>\n                <div class="message__meta">', `<div class="invite-banner">ROOM INVITATION <button type="button" data-board-join="${escapeHtml(match[0])}">JOIN ROOM ↗</button></div></div>\n                </div>\n                <div class="message__meta">`);
    }
    return html;
};

function showRoomDialog(mode, extra = {}) {
    const dialog = document.getElementById('roomDialog');
    const channels = getProfileChannels();
    if (!currentProfile && mode !== 'close') {boardNotice('Create and activate a profile first.', true); void openProfilesInbox(); return;}
    const index = Number.isInteger(extra.index) ? extra.index : activeChannelIndex;
    dialog.dataset.mode = mode;
    dialog.dataset.index = index ?? '';
    dialog.dataset.target = extra.target || '';
    document.getElementById('roomDialogError').textContent = '';
    document.getElementById('roomDialogSubmit').hidden = false;
    document.getElementById('roomDialogSubmit').textContent = {create: 'CREATE ROOM', join: 'JOIN ROOM', manage: 'SAVE CHANGES', invite: 'SEND INVITATION'}[mode];
    document.getElementById('roomDialogTitle').textContent = {create: 'NEW ROOM_', join: 'JOIN A ROOM_', manage: 'ROOM SETTINGS_', invite: 'INVITE TO ROOM_'}[mode];
    let body = '';
    if (mode === 'create') body = '<label for="roomName">ROOM NAME</label><input id="roomName" name="name" required maxlength="12"><p>A random 256-bit PSK is generated for your new room.</p>';
    if (mode === 'join') body = `<label for="roomUrl">MESHTASTIC CHANNEL URL</label><textarea id="roomUrl" name="url" required rows="3" placeholder="https://meshtastic.org/e/#…">${escapeHtml(extra.url || '')}</textarea><p>This adds one room to ${escapeHtml(currentProfile.long_name)}. Your existing rooms stay available.</p>`;
    if (mode === 'manage') {
        if (!channels[index]) {boardNotice('Open a room to manage it.', true); return;}
        body = `<label for="roomName">ROOM NAME</label><input id="roomName" name="name" required maxlength="12" value="${escapeHtml(channels[index].name)}"><label for="roomLink">CHANNEL URL / INCLUDES PSK</label><textarea id="roomLink" readonly rows="3">Loading…</textarea><button type="button" data-board-action="copy-link">COPY LINK</button><p>Changing the name or key creates a different mesh channel. Share the updated link with members.</p><label class="check-label"><input type="checkbox" name="rotate_key"> GENERATE A NEW RANDOM PSK</label><button type="button" class="danger-button" data-board-action="leave">LEAVE ROOM</button>`;
        void roomRequest(`/api/rooms/${index}`).then(data => {if (dialog.dataset.mode === 'manage' && Number(dialog.dataset.index) === index) document.getElementById('roomLink').value = data.url;}).catch(error => {document.getElementById('roomDialogError').textContent = error.message;});
    }
    if (mode === 'invite') body = `<p>Send a private invitation to node !${Number(extra.target).toString(16).padStart(8, '0')}.</p><label for="inviteRoom">ROOM TO SHARE</label><select id="inviteRoom" name="index">${channels.map((c,i) => `<option value="${i}" ${i === index ? 'selected' : ''}># ${escapeHtml(c.name)}</option>`).join('')}</select><p>The invitation includes this room’s PSK. Anyone with its link can join.</p>`;
    document.getElementById('roomDialogBody').innerHTML = body;
    if (!dialog.open) dialog.showModal();
}

async function refreshAfterRoomChange(payload) {
    currentProfile = payload.profile;
    replyingToPacketId = null;
    activeChannelIndex = null;
    messageSnapshotRequestId += 1;
    channelMessages = [];
    await loadManagedProfiles();
    await setActiveChannel(payload.selected_channel_index);
    await loadMessages();
    renderActiveMessages(); updateComposerState();
}

async function submitRoomDialog(event) {
    event.preventDefault();
    if (boardDialogBusy) return;
    const dialog = document.getElementById('roomDialog');
    const data = new FormData(event.target);
    const mode = dialog.dataset.mode;
    boardDialogBusy = true;
    const button = document.getElementById('roomDialogSubmit');
    button.disabled = true;
    try {
        let result;
        if (mode === 'create') result = await roomRequest('/api/rooms', 'POST', {name: data.get('name')});
        if (mode === 'join') result = await roomRequest('/api/rooms', 'POST', {url: data.get('url').trim()});
        if (mode === 'manage') result = await roomRequest(`/api/rooms/${dialog.dataset.index}`, 'PUT', {name: data.get('name'), rotate_key: data.has('rotate_key')});
        if (mode === 'invite') {
            await roomRequest(`/api/rooms/${data.get('index')}/invite`, 'POST', {target_node_num: Number(dialog.dataset.target)});
            boardNotice('INVITATION TRANSMITTED / Check delivery status in DMs.');
        } else {
            await refreshAfterRoomChange(result);
            boardNotice(mode === 'join' ? 'ROOM JOINED / Ready to transmit.' : 'ROOM SAVED / Ready to transmit.');
        }
        dialog.close();
    } catch (error) {document.getElementById('roomDialogError').textContent = error.message;}
    finally {boardDialogBusy = false; button.disabled = false;}
}

async function jumpToDirectoryNode(nodeNum) {
    const number = Number(nodeNum);
    if (!Number.isFinite(number)) return;
    nodeSearchQuery = '';
    nodeDirectoryFilter = 'all';
    await openNodesInbox();
    const card = document.querySelector(`[data-directory-node="${number}"]`);
    if (card) {
        const toggle = card.querySelector?.('[data-board-node-expand]');
        if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
        card.focus({preventScroll: true});
        card.scrollIntoView({block: 'center', behavior: 'instant'});
    }
}

async function boardClick(event) {
    const button = event.target.closest('button');
    try {
        const node = event.target.closest('[data-board-node]');
        if (node && (!button || button.hasAttribute('data-board-node'))) {
            await jumpToDirectoryNode(node.dataset.boardNode);
            return;
        }
        if (button?.hasAttribute('data-board-mobile-nav')) {
            const open = button.dataset.boardMobileNav === 'toggle' && document.getElementById('mobileNavToggle').getAttribute('aria-expanded') !== 'true';
            setMobileNavigation(open);
            return;
        }
        if (!button) {
            const header = event.target.closest('.node-roster-summary');
            header?.querySelector('[data-board-node-expand]')?.click();
            return;
        }
        if (button.hasAttribute('data-board-directory-filter')) {
            nodeDirectoryFilter = button.dataset.boardDirectoryFilter;
            document.querySelectorAll('[data-board-directory-filter]').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.boardDirectoryFilter === nodeDirectoryFilter)));
            updateNodeListFilter();
            return;
        }
        if (button.hasAttribute('data-board-node-expand')) {
            const number = Number(button.dataset.boardNodeExpand);
            const key = directoryNodeKey(number);
            const open = !expandedDirectoryNodes.has(key);
            if (open) expandedDirectoryNodes.add(key); else expandedDirectoryNodes.delete(key);
            button.setAttribute('aria-expanded', String(open));
            button.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} details for ${getNodeDisplayLabel(number)}`);
            document.getElementById(`nodeDetails-${number}`).hidden = !open;
            if (open) void NodePanels.load(number); else NodePanels.disposeMap(number);
            return;
        }
        if (button.hasAttribute('data-board-favorite')) { await toggleNodeFavorite(Number(button.dataset.boardFavorite)); return; }
        if (button.hasAttribute('data-board-room')) {
            if (document.getElementById('mobileNavToggle')?.getAttribute('aria-expanded') === 'true') setMobileNavigation(false);
            await setActiveChannel(Number(button.dataset.boardRoom)); return;
        }
        if (button.hasAttribute('data-board-invite')) {showRoomDialog('invite', {target: Number(button.dataset.boardInvite)}); return;}
        if (button.hasAttribute('data-board-dm')) {setActiveChatTab('dm'); setActiveDmTarget(Number(button.dataset.boardDm)); return;}
        if (button.hasAttribute('data-board-join')) {showRoomDialog('join', {url: button.dataset.boardJoin}); return;}
        if (button.hasAttribute('data-board-toggle')) {
            const key = button.dataset.boardToggle;
            const stateKey = threadVisibilityKey(key);
            collapsedMeshThreads.has(stateKey) ? collapsedMeshThreads.delete(stateKey) : collapsedMeshThreads.add(stateKey);
            renderActiveMessages(); return;
        }
        const action = button.dataset.boardAction;
        if (['create', 'join', 'dms', 'map', 'nodes', 'profiles'].includes(action) && document.getElementById('mobileNavToggle')?.getAttribute('aria-expanded') === 'true') setMobileNavigation(false);
        if (['create', 'join', 'manage'].includes(action)) showRoomDialog(action);
        if (action === 'profiles' || action === 'setup-profile') {
            await openProfilesInbox();
            if (action === 'setup-profile' && !Object.keys(managedProfiles).length) {
                const form = document.querySelector('.profile-manager__create-shell');
                if (form) form.open = true;
                document.getElementById('newLongName')?.focus();
            }
        }
        if (action === 'dms') openDmInbox();
        if (action === 'map') await openMapInbox();
        if (action === 'nodes') await openNodesInbox();
        if (action === 'new-thread') {
            if (activeChatTab !== 'channel' || !getActiveChannel()) {boardNotice('Open a room first.', true); return;}
            clearReplyComposer(); document.getElementById('messageInput').focus();
        }
        if (action === 'close-dialog' && !boardDialogBusy) document.getElementById('roomDialog').close();
        if (action === 'copy-link') {
            const input = document.getElementById('roomLink');
            if (!input.value.startsWith('https://')) return;
            if (navigator.clipboard) await navigator.clipboard.writeText(input.value);
            else {input.select(); document.execCommand('copy');}
            button.textContent = 'COPIED';
        }
        if (action === 'leave' && !boardDialogBusy) {
            if (!confirm('Leave this room on your active profile? Its message history will remain stored locally.')) return;
            boardDialogBusy = true;
            try {
                const result = await roomRequest(`/api/rooms/${document.getElementById('roomDialog').dataset.index}`, 'DELETE');
                await refreshAfterRoomChange(result); document.getElementById('roomDialog').close(); boardNotice('ROOM LEFT.');
            } finally {boardDialogBusy = false;}
        }
    } catch (error) {
        if (document.getElementById('roomDialog')?.open) document.getElementById('roomDialogError').textContent = error.message;
        else boardNotice(error.message, true);
    }
}
document.addEventListener('DOMContentLoaded', installBoardLayout);

document.addEventListener('change', event => {
    if (event.target.id === 'nodeDirectorySort') {
        nodeDirectorySort = event.target.value;
        updateNodeListFilter();
    }
});

const originalDirectoryFilterUpdate = updateNodeListFilter;
updateNodeListFilter = function() {
    NodePanels.disposeMaps();
    originalDirectoryFilterUpdate();
    NodePanels.refreshExpanded();
};


const boardReactionGroups = new Map();
function renderReactionBubbles(message, reactions = []) {
    if (!reactions.length) return '';
    return `<div class="message-reactions" aria-label="Message reactions">${MeshReactions.aggregate(reactions).map(group => {
        const key = `${message.id || message.packet_id}:${group.emoji}`;
        boardReactionGroups.set(key, group);
        const names = group.senders.map(sender => getMessageSenderDisplayName(sender)).join(', ');
        const unread = group.messages.filter(reaction => BoardUnread.isUnread(reaction));
        return `<button type="button" class="message-reaction ${unread.length ? 'message-reaction-unread' : ''}" data-reaction-group="${escapeHtml(key)}" aria-label="${escapeHtml(group.emoji)} reaction from ${escapeHtml(names)}. Show senders" aria-haspopup="dialog"><span class="reaction-emoji">${escapeHtml(group.emoji)}</span>${group.senders.length > 1 ? `<span class="reaction-count">${group.senders.length}</span>` : ''}${unread.map(reaction => `<span class="reaction-read-marker" aria-hidden="true" data-unread-post="${escapeHtml(BoardUnread.id(reaction))}"></span>`).join('')}</button>`;
    }).join('')}</div>`;
}

function showReactionSenders(key) {
    const group = boardReactionGroups.get(key);
    if (!group) return;
    let dialog = document.getElementById('reactionSendersDialog');
    if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.id = 'reactionSendersDialog';
        dialog.className = 'reaction-senders-dialog';
        dialog.setAttribute('aria-labelledby', 'reactionSendersTitle');
        document.body.append(dialog);
        dialog.addEventListener('close', () => BoardUnread.resume());
        dialog.addEventListener('click', event => {
            if (event.target === dialog || event.target.closest('[data-reaction-close]')) dialog.close();
        });
    }
    dialog.innerHTML = `<header><h2 id="reactionSendersTitle">${escapeHtml(group.emoji)} Reactions</h2><button type="button" data-reaction-close aria-label="Close reactions">×</button></header><ul>${group.senders.map(sender => `<li><strong>${escapeHtml(getMessageSenderDisplayName(sender))}</strong><small>${escapeHtml(getMessageSenderNodeId(sender) || '')}</small></li>`).join('')}</ul>`;
    if (!dialog.open) dialog.showModal();
}
document.addEventListener('click', event => {
    const bubble = event.target.closest('[data-reaction-group]');
    if (bubble) showReactionSenders(bubble.dataset.reactionGroup);
});

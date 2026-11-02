(() => {
    const usersElement = document.getElementById('adminUsers');
    const notice = document.getElementById('adminNotice');
    const editor = document.getElementById('adminEditor');
    const editorForm = document.getElementById('adminEditorForm');
    let overview, loading = false, changingRole = false, editing = null;
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const date = value => value ? new Date(typeof value === 'number' ? value * 1000 : value).toLocaleString() : '—';
    const duration = seconds => {
        const minutes = Math.floor((seconds || 0) / 60);
        return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    };
    const stat = (title, value) => `<div class="admin-stat"><strong>${escape(value)}</strong><span>${escape(title)}</span></div>`;

    function renderUsers() {
        if (!overview) return;
        const expanded = new Set([...usersElement.querySelectorAll('details[open]')].map(el => el.dataset.user));
        const filter = document.getElementById('adminSearch').value.trim().toLocaleLowerCase();
        const users = overview.users.filter(user => user.username.toLocaleLowerCase().includes(filter));
        usersElement.innerHTML = users.map(user => {
            const sessions = user.sessions.filter((entry, index) => entry.active || index < 10);
            return `<article class="admin-user">
                <div class="admin-user-header"><h3>${escape(user.username)} ${user.is_admin ? '<span class="badge">Admin</span>' : ''}</h3>
                <span>${user.active_sessions ? `${user.active_sessions} active browser${user.active_sessions === 1 ? '' : 's'}` : 'Offline / idle'}</span>
                <div class="admin-actions"><button type="button" data-admin-role="${escape(user.id)}">${user.is_admin ? 'Remove admin' : 'Make admin'}</button><button type="button" data-edit-user="${escape(user.id)}">Edit user</button><button type="button" class="admin-danger" data-delete-user="${escape(user.id)}">Delete user</button></div></div>
                <div class="admin-user-summary"><span>Joined ${escape(date(user.created_at + 'Z'))}</span><span>Login time: ${escape(duration(user.online_seconds))}</span><span>Last activity: ${escape(date(user.sessions[0]?.last_seen))}</span></div>
                <div class="admin-profile-list">${user.profiles.length ? user.profiles.map(profile => {
                    const active = overview.transport.running && overview.transport.profile_id === profile.id;
                    return `<section class="admin-profile-group"><div class="admin-profile"><div><strong>${escape(profile.long_name)}</strong><small>${escape(profile.short_name)} · ${escape(profile.node_id)}</small></div><span>${profile.messages_in} in / ${profile.messages_out} out</span>${active ? '<span class="badge">Radio active</span>' : ''}</div>
                    <ul class="admin-channels">${(profile.channels || []).map(channel => `<li><span><strong># ${escape(channel.name)}</strong><small>${channel.index === 0 ? 'Primary · ' : ''}${channel.key_bytes === 1 ? 'Public · 1-byte key' : `${escape(channel.key_bytes)}-byte key`}</small></span><div class="admin-actions"><button type="button" data-edit-channel="${escape(profile.id)}" data-index="${channel.index}" ${active ? 'disabled title="Deactivate this radio profile first"' : ''}>Edit room</button><button type="button" class="admin-danger" data-delete-channel="${escape(profile.id)}" data-index="${channel.index}" ${active || profile.channels.length <= 1 ? 'disabled title="Deactivate the profile and keep at least one room"' : ''}>Remove</button></div></li>`).join('')}</ul>${active ? '<p class="form-text">Deactivate this profile before editing its rooms.</p>' : ''}</section>`;
                }).join('') : '<p class="form-text">No profiles yet.</p>'}</div>
                <details data-user="${escape(user.id)}" ${expanded.has(user.id) ? 'open' : ''}><summary>Browser sessions (${user.sessions.length})</summary>
                <div class="admin-session-list">${sessions.map(entry => {
                    const profile = user.profiles.find(p => p.id === entry.profile_id);
                    return `<div class="admin-session"><strong>${entry.ended_at ? 'Signed out' : entry.active ? 'Active' : 'Idle'}</strong><span>${escape(profile?.long_name || 'No active profile')}</span><span>Signed in ${escape(date(entry.started_at))}</span><span>Last seen ${escape(date(entry.last_seen))}</span><span>${escape(duration(entry.online_seconds))} observed</span></div>`;
                }).join('') || '<p>No tracked sessions yet.</p>'}</div><p class="form-text">Showing the 10 most recent sessions and all active sessions.</p></details></article>`;
        }).join('') || '<p>No matching users.</p>';
        for (const button of usersElement.querySelectorAll('[data-admin-role]')) {
            button.addEventListener('click', () => changeRole(button));
        }
    }

    function findProfile(id) {
        return overview.users.flatMap(user => user.profiles).find(profile => profile.id === id);
    }

    function openEditor(target) {
        editing = target;
        editorForm.reset();
        const userMode = target.type === 'user';
        document.getElementById('adminUserFields').hidden = !userMode;
        document.getElementById('adminChannelFields').hidden = userMode;
        document.getElementById('adminEditorError').textContent = '';
        document.getElementById('adminEditorTitle').textContent = userMode ? `Edit ${target.user.username}` : `Edit room in ${target.profile.long_name}`;
        document.getElementById('adminUsername').required = userMode;
        document.getElementById('adminChannelName').required = !userMode;
        if (userMode) document.getElementById('adminUsername').value = target.user.username;
        else document.getElementById('adminChannelName').value = target.channel.name;
        editor.showModal();
    }

    async function mutate(url, method, data) {
        const response = await fetch(url, {
            method, headers: {'Content-Type':'application/json', 'X-CSRF-Token':document.querySelector('meta[name="csrf-token"]').content},
            body: JSON.stringify(data),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to save changes.');
        return result;
    }

    async function saveEditor(event) {
        event.preventDefault();
        if (changingRole || !editing) return;
        changingRole = true;
        const save = document.getElementById('adminEditorSave');
        save.disabled = true;
        try {
            const target = editing;
            const userMode = target.type === 'user';
            const url = userMode ? `/api/admin/users/${encodeURIComponent(target.user.id)}`
                : `/api/admin/profiles/${encodeURIComponent(target.profile.id)}/channels/${target.channel.index}`;
            const data = userMode ? {username:document.getElementById('adminUsername').value, password:document.getElementById('adminPassword').value}
                : {name:document.getElementById('adminChannelName').value, key:document.getElementById('adminChannelKey').value, revision:target.profile.channel_revision};
            const result = await mutate(url, 'PUT', data);
            notice.textContent = result.warning || (userMode ? 'User updated.' : 'Room updated. Other profiles and stored messages are unchanged.');
            editor.close();
            editorForm.reset();
        } catch (error) { document.getElementById('adminEditorError').textContent = error.message; }
        finally { changingRole = false; save.disabled = false; }
        await refresh();
    }

    async function deleteEntry(button) {
        if (changingRole) return;
        const userMode = Boolean(button.dataset.deleteUser);
        const user = userMode ? overview.users.find(user => user.id === button.dataset.deleteUser) : null;
        const profile = userMode ? null : findProfile(button.dataset.deleteChannel);
        const channel = profile?.channels.find(channel => channel.index === Number(button.dataset.index));
        const question = userMode ? `Delete ${user.username}, all their profiles, and private messages? Shared room history is kept. This cannot be undone.`
            : `Remove #${channel.name} from ${profile.long_name}? Other profiles and stored messages are kept.`;
        if (!window.confirm(question)) return;
        changingRole = true;
        button.disabled = true;
        try {
            const url = userMode ? `/api/admin/users/${encodeURIComponent(user.id)}`
                : `/api/admin/profiles/${encodeURIComponent(profile.id)}/channels/${channel.index}`;
            const result = await mutate(url, 'DELETE', userMode ? {} : {revision:profile.channel_revision});
            notice.textContent = result.warning || (userMode ? 'User deleted.' : 'Room removed from profile.');
        } catch (error) { notice.textContent = error.message; }
        finally { changingRole = false; button.disabled = false; }
        await refresh();
    }

    usersElement.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button || button.disabled || changingRole) return;
        if (button.dataset.editUser) {
            openEditor({type:'user', user:overview.users.find(user => user.id === button.dataset.editUser)});
        } else if (button.dataset.editChannel) {
            const profile = findProfile(button.dataset.editChannel);
            openEditor({type:'channel', profile, channel:profile.channels.find(channel => channel.index === Number(button.dataset.index))});
        } else if (button.dataset.deleteUser || button.dataset.deleteChannel) void deleteEntry(button);
    });
    editorForm.addEventListener('submit', saveEditor);
    document.getElementById('adminEditorCancel').addEventListener('click', () => { if (!changingRole) editor.close(); });
    editor.addEventListener('cancel', event => { if (changingRole) event.preventDefault(); });
    editor.addEventListener('close', () => { editorForm.reset(); editing = null; void refresh(); });

    async function changeRole(button) {
        if (changingRole) return;
        const user = overview.users.find(entry => entry.id === button.dataset.adminRole);
        changingRole = true;
        button.disabled = true;
        try {
            const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/admin`, {
                method: 'PUT', headers: {'Content-Type':'application/json', 'X-CSRF-Token':document.querySelector('meta[name="csrf-token"]').content},
                body: JSON.stringify({is_admin: !user.is_admin}),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Unable to change admin access');
            notice.textContent = `${user.username}: admin access ${user.is_admin ? 'removed' : 'added'}.`;
        } catch (error) { notice.textContent = error.message; }
        finally { changingRole = false; button.disabled = false; }
        await refresh();
    }

    async function refresh() {
        if (loading || changingRole || editor.open) return;
        loading = true;
        try {
            const response = await fetch('/api/admin/overview', {cache:'no-store', headers:{Accept:'application/json'}});
            if (response.status === 401 || response.status === 403) { window.location.assign('/'); return; }
            if (!response.ok) throw new Error('Unable to load admin data');
            overview = await response.json();
            const totals = overview.totals, radio = overview.receiver;
            document.getElementById('adminTotals').innerHTML = stat('Users', totals.users) + stat('Profiles', totals.profiles) + stat('Active browsers', totals.active_sessions) + stat('Messages in', totals.messages_in) + stat('Messages out', totals.messages_out);
            document.getElementById('adminReceiver').innerHTML = `<div class="admin-stats">${stat('Packets received', radio.packets)}${stat('Inbound decoded', radio.inbound)}${stat('Local echoes', radio.local_echoes)}${stat('Undecodable', radio.undecodable)}${stat('Listener errors', radio.listener_errors)}</div><p>Server started ${escape(date(radio.started_at))} · Last packet ${escape(date(radio.last_packet_at))}</p>`;
            document.getElementById('adminUpdated').textContent = `Updated ${date(overview.generated_at)} · Refreshes every 30 seconds.`;
            renderUsers();
        } catch (error) { notice.textContent = error.message; }
        finally { loading = false; }
    }
    document.getElementById('adminSearch').addEventListener('input', renderUsers);
    document.getElementById('adminRefresh').addEventListener('click', refresh);
    setInterval(() => { if (!document.hidden) refresh(); }, 30000);
    refresh();
})();

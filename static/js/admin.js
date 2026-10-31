(() => {
    const usersElement = document.getElementById('adminUsers');
    const notice = document.getElementById('adminNotice');
    let overview, loading = false, changingRole = false;
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
                <button type="button" data-admin-role="${escape(user.id)}">${user.is_admin ? 'Remove admin' : 'Make admin'}</button></div>
                <div class="admin-user-summary"><span>Joined ${escape(date(user.created_at + 'Z'))}</span><span>Login time: ${escape(duration(user.online_seconds))}</span><span>Last activity: ${escape(date(user.sessions[0]?.last_seen))}</span></div>
                <div class="admin-profile-list">${user.profiles.length ? user.profiles.map(profile => `<div class="admin-profile"><div><strong>${escape(profile.long_name)}</strong><small>${escape(profile.short_name)} · ${escape(profile.node_id)}</small></div><span>${profile.messages_in} in / ${profile.messages_out} out</span>${overview.transport.running && overview.transport.profile_id === profile.id ? '<span class="badge">Radio active</span>' : ''}</div>`).join('') : '<p class="form-text">No profiles yet.</p>'}</div>
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
        if (loading || changingRole) return;
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

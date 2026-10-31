// A recently heard browser is active; closed or disconnected tabs become idle.
(() => {
    let pending = false;
    async function heartbeat() {
        if (pending) return;
        pending = true;
        try {
            const response = await fetch('/api/session-heartbeat', {
                method: 'POST',
                headers: {'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || ''},
            });
            if (response.status === 401) clearInterval(timer);
        } catch (_) { /* A disconnected browser will naturally become idle. */ }
        finally { pending = false; }
    }
    const timer = setInterval(heartbeat, 30000);
    window.addEventListener('pageshow', heartbeat);
})();

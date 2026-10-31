/* On-demand telemetry and map panels for expanded directory rows. */
const NodePanels = (() => {
    const cache = new Map();
    const pending = new Map();
    const maps = new Map();
    const key = number => `${currentProfile?.id || ''}:${Number(number)}`;
    const titles = {device: 'Device', environment: 'Environment', power: 'Power', air_quality: 'Air quality', local_stats: 'Radio statistics', host: 'Host'};
    const specs = {
        battery_level: ['Battery', '%'], voltage: ['Voltage', ' V'], channel_utilization: ['Channel utilization', '%'], air_util_tx: ['Transmit airtime', '%'], uptime_seconds: ['Uptime', 's'],
        temperature: ['Temperature', ' °C'], relative_humidity: ['Humidity', '%'], barometric_pressure: ['Pressure', ' hPa'], gas_resistance: ['Gas resistance', ' MΩ'], current: ['Current', ' mA'], iaq: ['Air quality index', ''], distance: ['Distance', ' mm'], lux: ['Light', ' lx'], wind_direction: ['Wind direction', '°'], wind_speed: ['Wind speed', ' m/s'], wind_gust: ['Wind gust', ' m/s'], rainfall_1h: ['Rain / 1 hour', ' mm'], rainfall_24h: ['Rain / 24 hours', ' mm'], soil_moisture: ['Soil moisture', '%'], soil_temperature: ['Soil temperature', ' °C'],
        co2: ['CO₂', ' ppm'], pm10_standard: ['PM1.0', ' µg/m³'], pm25_standard: ['PM2.5', ' µg/m³'], pm100_standard: ['PM10', ' µg/m³'], pm10_environmental: ['PM1.0 / ambient', ' µg/m³'], pm25_environmental: ['PM2.5 / ambient', ' µg/m³'], pm100_environmental: ['PM10 / ambient', ' µg/m³'], pm_voc_idx: ['VOC index', ''], pm_nox_idx: ['NOx index', ''],
        num_packets_tx: ['Packets sent', ''], num_packets_rx: ['Packets received', ''], num_packets_rx_bad: ['Bad packets', ''], num_online_nodes: ['Reported online nodes', ''], num_total_nodes: ['Known nodes', ''], heap_total_bytes: ['Heap total', 'bytes'], heap_free_bytes: ['Heap free', 'bytes'], freemem_bytes: ['Free memory', 'bytes'], diskfree1_bytes: ['Free disk', 'bytes'], load1: ['Load / 1 minute', ''], load5: ['Load / 5 minutes', ''], load15: ['Load / 15 minutes', ''],
    };
    function metric(name, value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
        let [label, unit] = specs[name] || [];
        const channel = name.match(/^ch(\d+)_(voltage|current)$/);
        if (channel) { label = `Channel ${channel[1]} ${channel[2]}`; unit = channel[2] === 'voltage' ? ' V' : ' mA'; }
        if (!label) return null;
        const number = Number(value);
        if (name === 'battery_level' && number > 100) return [label, 'External power'];
        if (unit === 's') {
            const minutes = Math.floor(number / 60);
            return [label, `${Math.floor(minutes / 1440)}d ${Math.floor(minutes / 60) % 24}h ${minutes % 60}m`];
        }
        if (/^load(1|5|15)$/.test(name)) return [label, (number / 100).toFixed(2)];
        if (unit === 'bytes') return [label, `${(number / 1048576).toFixed(1)} MiB`];
        return [label, `${Number.isInteger(number) ? number : Number(number.toFixed(2))}${unit}`];
    }
    function telemetryHtml(telemetry) {
        const groups = Object.entries(telemetry || {}).map(([category, data]) => {
            const order = Object.keys(specs);
            const values = Object.entries(data.values || {}).sort(([a], [b]) => (order.indexOf(a) < 0 ? 999 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 999 : order.indexOf(b))).map(([name, value]) => metric(name, value)).filter(Boolean);
            if (!values.length) return '';
            return `<div class="node-telemetry-group"><div class="node-panel-heading"><h5>${escapeHtml(titles[category] || category)}</h5><time>${escapeHtml(formatDateTime(data.updated_at))}</time></div><dl>${values.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></div>`;
        }).join('');
        return `<section class="node-telemetry"><h4>Telemetry</h4>${groups || '<p class="node-panel-empty">No telemetry received yet. Readings appear when this node broadcasts them.</p>'}</section>`;
    }
    function validPosition(node) {
        return hasRenderableLocation(node) && Math.abs(Number(node.latitude)) <= 90 && Math.abs(Number(node.longitude)) <= 180;
    }
    function contents(node, telemetry) {
        return telemetryHtml(telemetry) + `<section class="node-location"><div class="node-panel-heading"><h4>Map</h4>${node.position_timestamp ? `<time>${escapeHtml(formatDateTime(node.position_timestamp))}</time>` : ''}</div>${validPosition(node) ? `<div class="node-detail-map" id="nodeDetailMap-${Number(node.node_num)}" aria-label="Last reported position for ${escapeHtml(getNodeDisplayLabel(node))}"></div><p class="node-panel-empty">Last reported position · ${Number(node.latitude).toFixed(5)}, ${Number(node.longitude).toFixed(5)}${node.altitude !== null && node.altitude !== undefined && Number.isFinite(Number(node.altitude)) ? ` · ${Number(node.altitude)} m altitude` : ''}</p>` : '<p class="node-panel-empty">No position received yet.</p>'}</section>`;
    }
    function render(node) {
        return `<div class="node-detail-panels" id="nodePanels-${Number(node.node_num)}">${contents(node, node.telemetry || cache.get(key(node.node_num))?.telemetry)}</div>`;
    }
    function disposeMap(number) {
        const entry = maps.get(Number(number));
        if (entry) { entry.map.remove(); maps.delete(Number(number)); }
    }
    function disposeMaps() { [...maps.keys()].forEach(disposeMap); }
    function mountMap(node) {
        const element = document.getElementById(`nodeDetailMap-${Number(node.node_num)}`);
        if (!element || element.closest('[hidden]') || !validPosition(node)) return;
        if (typeof L === 'undefined') { element.textContent = 'Map unavailable. The last reported coordinates are shown below.'; return; }
        const existing = maps.get(Number(node.node_num));
        if (existing?.element === element) { existing.map.invalidateSize(); return; }
        disposeMap(node.node_num);
        const point = [Number(node.latitude), Number(node.longitude)];
        const map = L.map(element, {scrollWheelZoom: false}).setView(point, 13);
        buildMapBaseLayers()['OpenStreetMap'].addTo(map);
        L.marker(point, {title: getNodeDisplayLabel(node)}).addTo(map);
        maps.set(Number(node.node_num), {element, map});
        map.invalidateSize();
    }
    async function load(number) {
        const profileId = currentProfile?.id;
        if (!profileId) return;
        const cacheKey = key(number);
        const node = getNodeByNum(number);
        if (node) mountMap(node);
        if (pending.has(cacheKey)) return pending.get(cacheKey);
        const task = (async () => {
            try {
                const response = await fetch(`/api/nodes/${Number(number)}`);
                if (!response.ok) throw new Error('Could not load node telemetry. Reopen details to retry.');
                const detail = await response.json();
                if (currentProfile?.id !== profileId) return;
                cache.set(cacheKey, detail);
                const current = getNodeByNum(number);
                if (!current) return;
                current.telemetry = detail.telemetry || {};
                if (detail.position_timestamp && (!current.position_timestamp || detail.position_timestamp >= current.position_timestamp)) {
                    for (const field of ['latitude', 'longitude', 'altitude', 'position_timestamp']) current[field] = detail[field];
                }
                const panel = document.getElementById(`nodePanels-${Number(number)}`);
                if (panel) {
                    disposeMap(number);
                    panel.innerHTML = contents(current, current.telemetry);
                    mountMap(current);
                }
            } catch (error) {
                if (currentProfile?.id !== profileId) return;
                const panel = document.getElementById(`nodePanels-${Number(number)}`);
                if (panel && !panel.querySelector('.node-panel-error')) panel.insertAdjacentHTML('beforeend', `<p class="node-panel-error" role="status">${escapeHtml(error.message)}</p>`);
            } finally { pending.delete(cacheKey); }
        })();
        pending.set(cacheKey, task);
        return task;
    }
    function refreshExpanded() {
        document.querySelectorAll('[data-board-node-expand][aria-expanded="true"]').forEach(button => void load(Number(button.dataset.boardNodeExpand)));
    }
    return {render, load, refreshExpanded, disposeMap, disposeMaps, metric, telemetryHtml, validPosition};
})();

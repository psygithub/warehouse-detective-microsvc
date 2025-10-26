// Make loadAlerts globally accessible for the pagination callback
window.loadAlerts = async function(page = 1) {
    const container = document.getElementById('alertsList');
    if (!container) {
        console.error('Dashboard alerts container #alertsList not found in the DOM.');
        return;
    }
    try {
        currentAlertsPage = page;
        // Read the value from the select dropdown each time
        alertsPerPage = parseInt(document.getElementById('alerts-rows-per-page-select').value, 10);
        const response = await apiRequest(`/api/inventory/alerts?page=${page}&limit=${alertsPerPage}`);
        if (response && response.items) {
            displayAlerts(response.items);
            renderAlertsPagination(response.total);
        } else {
             displayAlerts([]);
             renderAlertsPagination(0);
        }
    } catch (error) {
        console.error('加载预警失败:', error);
        container.innerHTML = '<tr><td colspan="5" class="text-danger text-center">加载预警失败</td></tr>';
    }
}

// Avoid script re-execution errors
if (typeof window.dashboardScriptLoaded === 'undefined') {
    var currentAlertsPage = 1;
    var alertsPerPage = 50; // Default value
    window.dashboardScriptLoaded = true;
}

window.sectionInitializers = window.sectionInitializers || {};
window.sectionInitializers.dashboard = async () => {
    try {
        // Load stats
        const [configsRes, schedulesRes, resultsRes, usersRes] = await Promise.all([
            apiRequest('/api/configs'),
            apiRequest('/api/schedules'),
            apiRequest('/api/results?limit=10'),
            (currentUser.role === 'admin' || currentUser.role === 'super_admin') ? apiRequest('/api/users') : Promise.resolve([])
        ]);

        // Update stat cards
        const totalConfigsEl = document.getElementById('totalConfigs');
        if (totalConfigsEl) totalConfigsEl.textContent = configsRes.length;

        const activeSchedulesEl = document.getElementById('activeSchedules');
        if (activeSchedulesEl) activeSchedulesEl.textContent = schedulesRes.filter(s => s.isActive).length;

        const today = new Date().toDateString();
        const todayResults = resultsRes.filter(r => new Date(r.createdAt).toDateString() === today);
        const todayResultsEl = document.getElementById('todayResults');
        if (todayResultsEl) todayResultsEl.textContent = todayResults.length;

        const totalUsersEl = document.getElementById('totalUsers');
        if (totalUsersEl) {
            if (currentUser.role === 'admin' || currentUser.role === 'super_admin') {
                totalUsersEl.textContent = usersRes.length;
            } else {
                totalUsersEl.textContent = '-';
            }
        }

        // Load alerts and configs
        window.loadAlerts(1); // Initial load for page 1
        loadAlertConfigs();

        // Event delegation for alert list clicks
        const alertsList = document.getElementById('alertsList');
        if (alertsList) {
            alertsList.addEventListener('click', function(event) {
                const headerRow = event.target.closest('.alert-row');
                if (headerRow) {
                    const alertId = headerRow.dataset.id;
                    const detailRow = document.querySelector(`.alert-details-row[data-id="${alertId}"]`);
                    if (detailRow) {
                        detailRow.classList.toggle('d-none');
                    }
                }
            });
        }

        // Bind alert config events
        const saveBtn = document.getElementById('save-alert-config-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', saveAlertConfig);
        }
        const runBtn = document.getElementById('run-analysis-btn');
        if (runBtn) {
            runBtn.addEventListener('click', runAnalysis);
        }

        // Bind pagination rows per page selector
        const rowsPerPageSelect = document.getElementById('alerts-rows-per-page-select');
        if (rowsPerPageSelect) {
            rowsPerPageSelect.addEventListener('change', () => {
                window.loadAlerts(1); // Reload from page 1
            });
        }

    } catch (error) {
        console.error('Failed to load dashboard data:', error);
    }
};

function displayAlerts(alerts) {
    const container = document.getElementById('alertsList');
    if (!container) return;

    if (!alerts || alerts.length === 0) {
        container.innerHTML = '<tr><td colspan="5" class="text-center text-muted">暂无库存预警</td></tr>';
        return;
    }

    let html = '';
    alerts.forEach((alert, index) => {
        const details = JSON.parse(alert.details);
        let rowClass = '';
        switch (alert.alert_level) {
            case 3: rowClass = 'table-danger'; break;
            case 2: rowClass = 'table-warning'; break;
            case 1: rowClass = 'table-info'; break;
        }

        const consumptionRateText = typeof details.consumptionRate === 'number' ? `${(details.consumptionRate * 100).toFixed(2)}%` : 'N/A';
        const dailyConsumptionText = typeof details.dailyConsumption === 'number' ? details.dailyConsumption.toFixed(4) : 'N/A';
        const consumptionDetail = `(${details.days}天内消耗 ${details.qtyChange}件, 日均消耗率: ${consumptionRateText})`;
        const alertId = `alert-${index}`;

        html += `
            <tr class="${rowClass} alert-row" data-id="${alertId}" style="cursor: pointer;">
                <td>${alert.sku}</td>
                <td>${alert.region_name}</td>
                <td>${getBadgeForLevel(alert.alert_level)}</td>
                <td>${consumptionDetail}</td>
                <td>${new Date(alert.created_at).toLocaleString()}</td>
            </tr>
            <tr class="alert-details-row d-none" data-id="${alertId}">
                <td colspan="5" class="bg-light p-3">
                    <!-- Detailed info here -->
                </td>
            </tr>
        `;
    });
    container.innerHTML = html;
}

async function loadAlertConfigs() {
    try {
        const configs = await apiRequest('/api/inventory/system-configs');
        if (configs) {
            // Populate config inputs
            const inputs = ['alert-timespan', 'alert-threshold', 'alert-min-daily-consumption', 'alert-max-daily-consumption', 'alert-medium-threshold-multiplier'];
            inputs.forEach(id => {
                const el = document.getElementById(id + '-input');
                if (el) el.value = configs[id.replace(/-/g, '_')] || '';
            });
        }
    } catch (error) {
        console.error('Failed to load alert configs:', error);
    }
}

function renderAlertsPagination(totalAlerts) {
    const paginationContainer = document.getElementById('alerts-pagination');
    if (paginationContainer && typeof window.renderPagination === 'function') {
        // Ensure the callback function name is correct and globally accessible
        window.renderPagination('alerts-pagination', totalAlerts, currentAlertsPage, alertsPerPage, 'loadAlerts');
    } else {
        console.error('Pagination container or renderPagination function not found.');
    }
}

async function saveAlertConfig() {
    const configs = {
        alert_timespan: document.getElementById('alert-timespan-input').value,
        alert_threshold: document.getElementById('alert-threshold-input').value,
        alert_min_daily_consumption: document.getElementById('alert-min-daily-consumption-input').value,
        alert_max_daily_consumption: document.getElementById('alert-max-daily-consumption-input').value,
        alert_medium_threshold_multiplier: document.getElementById('alert-medium-threshold-multiplier-input').value,
    };
    
    try {
        await apiRequest('/api/inventory/system-configs', 'POST', { configs });
        alert('预警规则已保存');
    } catch (error) {
        alert('保存预警规则失败: ' + error.message);
    }
}

async function runAnalysis() {
    if (!confirm('立即执行一次库存分析吗？')) return;
    try {
        const result = await apiRequest('/api/inventory/run-analysis', 'POST');
        alert(result.message);
        window.loadAlerts(); // Refresh alerts list
    } catch (error) {
        alert('执行分析失败: ' + error.message);
    }
}

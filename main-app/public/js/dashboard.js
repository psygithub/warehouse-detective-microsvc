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
        const limitSelect = document.getElementById('alerts-rows-per-page-select');
        alertsPerPage = limitSelect ? parseInt(limitSelect.value, 10) : 50;
        
        let url = `/api/inventory/alerts?page=${page}&limit=${alertsPerPage}`;
        if (currentAlertRegion) {
            url += `&region=${encodeURIComponent(currentAlertRegion)}`;
        }

        const response = await apiRequest(url);
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
    var currentAlertRegion = null; // 当前选中的区域
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
            alertsList.addEventListener('click', handleAlertListClick);
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

const regionShortNameMap = {
    '菲律宾': '菲', '马来西亚': '马', '越南': '越', '泰国': '泰',
    '新加坡': '新', '台湾': '台', '美国': '美', '墨西哥': '墨',
    '欧洲': '欧', '日本': '日', '加拿大': '加', '英国': '英',
    '澳大利亚': '澳', '俄罗斯': '俄', '韩国': '韩', '印度尼西亚': '印',
    '巴西': '巴', '智利': '智', '哥伦比亚': '哥'
};

window.switchAlertTab = function(region) {
    currentAlertRegion = region || null;
    
    document.querySelectorAll('#alertTabs .nav-link').forEach(link => {
        link.classList.remove('active');
        
        // 提取该 Tab 对应的区域名
        let tabRegion = '';
        const onclickAttr = link.getAttribute('onclick');
        if (onclickAttr) {
            const match = onclickAttr.match(/'(.*)'/);
            if (match) tabRegion = match[1];
        }

        const isTarget = (region === '' && tabRegion === '') || (region !== '' && tabRegion === region);
        
        if (isTarget) {
            link.classList.add('active');
            // 激活时显示全名 (除了默认 Tab)
            if (tabRegion) link.textContent = tabRegion;
        } else {
            // 非激活时显示简称
            if (tabRegion && regionShortNameMap[tabRegion]) {
                link.textContent = regionShortNameMap[tabRegion];
            }
        }
    });

    // 控制表头“区域”列的显示/隐藏
    // 假设表格在 .table-container 下
    const regionTh = document.querySelector('.table-container table thead th:nth-child(2)');
    if (regionTh) {
        regionTh.style.display = currentAlertRegion ? 'none' : '';
    }

    window.loadAlerts(1);
}

function getBadgeForLevel(level) {
    switch (Number(level)) {
        case 3: return '<span class="badge bg-danger">快速</span>';
        case 2: return '<span class="badge bg-warning text-dark">中等</span>';
        case 1: return '<span class="badge bg-info text-dark">普通</span>';
        default: return '';
    }
}

function displayAlerts(alerts) {
    const container = document.getElementById('alertsList');
    if (!container) return;

    if (!alerts || alerts.length === 0) {
        container.innerHTML = '<tr><td colspan="5" class="text-center text-muted">暂无库存预警</td></tr>';
        return;
    }

    const isRegionHidden = !!currentAlertRegion;

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
        const dailyConsumptionText = typeof details.dailyConsumption === 'number' ? details.dailyConsumption.toFixed(2) : 'N/A'; // 保留两位小数
        
        // 兼容新旧两种命名方式
        const startStock = details.startQty !== undefined ? details.startQty : details.start_qty;
        const currentStock = details.endQty !== undefined ? details.endQty : details.end_qty;
        
        const detailParts = [];
        detailParts.push(`分析周期: ${details.days}天`);
        detailParts.push(`期初: ${startStock}`);
        detailParts.push(`消耗: ${details.qtyChange}`);
        detailParts.push(`当前: ${currentStock}`);
        detailParts.push(`日均消耗: ${dailyConsumptionText}`);
        detailParts.push(`消耗率: ${consumptionRateText}`);
        
        const consumptionDetail = `<div style="white-space: nowrap;">${detailParts.join(' | ')}</div>`;

        html += `
            <tr class="${rowClass} alert-row" data-id="${alert.id}" data-sku-id="${alert.tracked_sku_id}" data-sku="${alert.sku}" data-image="${alert.product_image || ''}" style="cursor: pointer;">
                <td>
                    <span class="sku-text text-primary" style="cursor: pointer; text-decoration: underline;">${alert.sku}</span>
                </td>
                <td style="${isRegionHidden ? 'display:none;' : ''}">${alert.region_name}</td>
                <td>${getBadgeForLevel(alert.alert_level)}</td>
                <td>${consumptionDetail}</td>
                <td>${new Date(alert.updated_at).toLocaleString()}</td>
            </tr>
        `;
    });
    container.innerHTML = html;
}

// Global variable to hold the chart instance
let alertInventoryChart = null;

async function handleAlertListClick(event) {
    const target = event.target;
    const row = target.closest('.alert-row');
    
    if (!row) return;

    // Handle SKU click for image popup
    if (target.classList.contains('sku-text')) {
        event.stopPropagation();
        const skuId = row.dataset.skuId;
        const sku = row.dataset.sku;
        const image = row.dataset.image;
        showSkuImage(skuId, sku, image);
        return;
    }

    // Handle row click for chart
    const skuId = row.dataset.skuId;
    const sku = row.dataset.sku;
    
    // Highlight active row
    document.querySelectorAll('.alert-row').forEach(r => r.classList.remove('table-active', 'border-primary', 'border-2'));
    row.classList.add('table-active', 'border-primary', 'border-2');

    await loadAlertChart(skuId, sku);
}

async function showSkuImage(skuId, sku, imageUrl) {
    try {
        const modalImg = document.getElementById('modal-sku-image');
        const modalTitle = document.getElementById('modal-sku-name');
        
        if (imageUrl) {
            modalImg.src = imageUrl;
            modalTitle.textContent = sku;
        } else {
            // Fallback: fetch from history endpoint if no image url provided
            // Optimally we should have image url in the list response to avoid extra call, 
            // but let's check if we can get it from history endpoint which returns sku info
             const data = await apiRequest(`/api/inventory/regional-history/${skuId}`);
             
             if (data && data.product_image) {
                 modalImg.src = data.product_image;
                 modalTitle.textContent = `${sku} - ${data.sku}`; // Using SKU from data in case passed one is different
             } else {
                 modalImg.src = 'https://via.placeholder.com/400x400?text=No+Image';
                 modalTitle.textContent = sku;
             }
        }
         
         const modal = new bootstrap.Modal(document.getElementById('skuImageModal'));
         modal.show();

    } catch (error) {
        console.error('Failed to load SKU image:', error);
        showCommonModal('错误', '无法加载图片信息');
    }
}

async function loadAlertChart(skuId, skuName) {
    const chartTitle = document.getElementById('alert-chart-title');
    const chartPlaceholder = document.getElementById('alert-chart-placeholder');
    const chartCanvas = document.getElementById('alert-inventory-chart');

    chartTitle.textContent = `库存趋势: ${skuName}`;
    if(chartPlaceholder) chartPlaceholder.style.display = 'none';
    if(chartCanvas) chartCanvas.style.display = 'block';

    try {
        const data = await apiRequest(`/api/inventory/regional-history/${skuId}`);
        if (data && data.history) {
            renderAlertChart(data.history);
        } else {
            // Handle no data case
             if (alertInventoryChart) {
                alertInventoryChart.destroy();
                alertInventoryChart = null;
            }
            const ctx = chartCanvas.getContext('2d');
            ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
            ctx.textAlign = 'center';
            ctx.fillText('暂无数据', chartCanvas.width / 2, chartCanvas.height / 2);
        }
    } catch (error) {
        console.error('Failed to load chart data:', error);
        chartTitle.textContent = `加载失败: ${skuName}`;
    }
}

function renderAlertChart(historyData) {
    const chartCanvas = document.getElementById('alert-inventory-chart');
    if (alertInventoryChart) {
        alertInventoryChart.destroy();
    }

    const historyByRegion = historyData.reduce((acc, record) => {
        const region = record.region_name || '未知区域';
        if (!acc[region]) {
            acc[region] = [];
        }
        acc[region].push({ x: record.record_date, y: record.qty });
        return acc;
    }, {});

    const datasets = Object.keys(historyByRegion).map((region, index) => {
        const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'];
        return {
            label: region,
            data: historyByRegion[region],
            borderColor: colors[index % colors.length],
            backgroundColor: colors[index % colors.length] + '33',
            tension: 0.1,
            fill: false,
        };
    });

    alertInventoryChart = new Chart(chartCanvas, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'day',
                        tooltipFormat: 'yyyy-MM-dd',
                    },
                    title: { display: true, text: '日期' }
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: '库存数量' }
                }
            },
            plugins: {
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        title: (context) => `日期: ${context[0].label}`,
                        label: (context) => `${context.dataset.label}: ${context.parsed.y} 件`,
                    }
                }
            }
        }
    });
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
        showCommonModal('操作成功', '预警规则已保存');
    } catch (error) {
        showCommonModal('错误', '保存预警规则失败: ' + error.message);
    }
}

async function runAnalysis() {
    if (!confirm('立即执行一次库存分析吗？')) return;
    try {
        const result = await apiRequest('/api/inventory/run-analysis', 'POST');
        showCommonModal('任务状态', result.message);
        window.loadAlerts(); // Refresh alerts list
    } catch (error) {
        showCommonModal('错误', '执行分析失败: ' + error.message);
    }
}

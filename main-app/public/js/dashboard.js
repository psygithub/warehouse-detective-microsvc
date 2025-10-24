// 避免重复加载脚本时出错
if (typeof window.dashboardScriptLoaded === 'undefined') {
    var currentAlertsPage = 1;
    var alertsPerPage = 50; // 每页显示50条
    window.dashboardScriptLoaded = true;
}

window.sectionInitializers = window.sectionInitializers || {};
window.sectionInitializers.dashboard = async () => {
    try {
        // 加载统计数据
        const [configsRes, schedulesRes, resultsRes, usersRes] = await Promise.all([
            apiRequest('/api/configs'),
            apiRequest('/api/schedules'),
            apiRequest('/api/results?limit=10'),
            (currentUser.role === 'admin' || currentUser.role === 'super_admin') ? apiRequest('/api/users') : Promise.resolve([])
        ]);

        // 更新统计卡片
        const totalConfigsEl = document.getElementById('totalConfigs');
        if (totalConfigsEl) totalConfigsEl.textContent = configsRes.length;

        const activeSchedulesEl = document.getElementById('activeSchedules');
        if (activeSchedulesEl) activeSchedulesEl.textContent = schedulesRes.filter(s => s.isActive).length;

        // 计算今日结果
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

        // 加载库存预警
        loadAlerts(1); // 初始加载第一页
        // 加载预警配置
        loadAlertConfigs();

        // 使用事件委托处理预警列表的点击事件
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

        // 绑定预警配置事件
        const saveBtn = document.getElementById('save-alert-config-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', saveAlertConfig);
        }
        const runBtn = document.getElementById('run-analysis-btn');
        if (runBtn) {
            runBtn.addEventListener('click', runAnalysis);
        }

    } catch (error) {
        console.error('加载仪表板数据失败:', error);
    }
};

async function loadAlerts(page = 1) {
    const container = document.getElementById('alertsList');
    if (!container) {
        console.error('Dashboard alerts container #alertsList not found in the DOM.');
        return;
    }
    try {
        currentAlertsPage = page;
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

        // 主行
        html += `
            <tr class="${rowClass} alert-row" data-id="${alertId}" style="cursor: pointer;">
                <td>${alert.sku}</td>
                <td>${alert.region_name}</td>
                <td>${getBadgeForLevel(alert.alert_level)}</td>
                <td>${consumptionDetail}</td>
                <td>${new Date(alert.created_at).toLocaleString()}</td>
            </tr>
        `;

        // 详情行，默认隐藏
        html += `
            <tr class="alert-details-row d-none" data-id="${alertId}">
                <td colspan="5" class="bg-light p-3">
                    <div class="row">
                        <div class="col-md-6">
                            <strong>详细信息:</strong>
                            <ul>
                                <li>分析周期: ${details.days} 天</li>
                                <li>期初库存: ${details.start_qty}</li>
                                <li>期末库存: ${details.end_qty}</li>
                                <li>库存变化: ${details.qtyChange}</li>
                            </ul>
                        </div>
                        <div class="col-md-6">
                            <strong>预警判断:</strong>
                            <ul>
                                <li>日均消耗量: ${dailyConsumptionText}</li>
                                <li>日均消耗率: ${consumptionRateText}</li>
                                <li>预警级别: ${alert.alert_level}</li>
                            </ul>
                        </div>
                    </div>
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
            const alertTimespanInput = document.getElementById('alert-timespan-input');
            if (alertTimespanInput) alertTimespanInput.value = configs.alert_timespan || '7';

            const alertThresholdInput = document.getElementById('alert-threshold-input');
            if (alertThresholdInput) alertThresholdInput.value = configs.alert_threshold || '0.03';

            const alertMinDailyConsumptionInput = document.getElementById('alert-min-daily-consumption-input');
            if (alertMinDailyConsumptionInput) alertMinDailyConsumptionInput.value = configs.alert_min_daily_consumption || '5';

            const alertMaxDailyConsumptionInput = document.getElementById('alert-max-daily-consumption-input');
            if (alertMaxDailyConsumptionInput) alertMaxDailyConsumptionInput.value = configs.alert_max_daily_consumption || '20';

            const alertMediumThresholdMultiplierInput = document.getElementById('alert-medium-threshold-multiplier-input');
            if (alertMediumThresholdMultiplierInput) alertMediumThresholdMultiplierInput.value = configs.alert_medium_threshold_multiplier || '1.5';
        }

        const schedules = await apiRequest('/api/schedules');
        const alertSchedule = schedules.find(s => s.name === 'Alert Analysis Schedule');
        const alertCronInput = document.getElementById('alert-cron-input');
        if (alertCronInput) {
            if (alertSchedule) {
                alertCronInput.value = alertSchedule.cron;
            } else {
                alertCronInput.value = '0 3 * * *'; // 默认值
            }
        }
    } catch (error) {
        console.error('加载预警配置失败:', error);
    }
}


function renderAlertsPagination(totalAlerts) {
    const paginationContainer = document.getElementById('alerts-pagination');
    if (!paginationContainer) return;

    const totalPages = Math.ceil(totalAlerts / alertsPerPage);
    paginationContainer.innerHTML = '';

    if (totalPages < 1) return;

    let paginationHTML = `<ul class="pagination">`;

    const prevDisabled = currentAlertsPage === 1 ? 'disabled' : '';
    paginationHTML += `<li class="page-item ${prevDisabled}"><a class="page-link" href="#" onclick="event.preventDefault(); loadAlerts(${currentAlertsPage - 1})">上一页</a></li>`;

    let startPage = Math.max(1, currentAlertsPage - 2);
    let endPage = Math.min(totalPages, currentAlertsPage + 2);

    if (startPage > 1) {
        paginationHTML += `<li class="page-item"><a class="page-link" href="#" onclick="event.preventDefault(); loadAlerts(1)">1</a></li>`;
        if (startPage > 2) {
            paginationHTML += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
    }

    for (let i = startPage; i <= endPage; i++) {
        const activeClass = i === currentAlertsPage ? 'active' : '';
        paginationHTML += `<li class="page-item ${activeClass}"><a class="page-link" href="#" onclick="event.preventDefault(); loadAlerts(${i})">${i}</a></li>`;
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            paginationHTML += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
        paginationHTML += `<li class="page-item"><a class="page-link" href="#" onclick="event.preventDefault(); loadAlerts(${totalPages})">${totalPages}</a></li>`;
    }

    const nextDisabled = currentAlertsPage === totalPages ? 'disabled' : '';
    paginationHTML += `<li class="page-item ${nextDisabled}"><a class="page-link" href="#" onclick="event.preventDefault(); loadAlerts(${currentAlertsPage + 1})">下一页</a></li>`;

    paginationHTML += `</ul>`;
    paginationContainer.innerHTML = paginationHTML;
}

async function saveAlertConfig() {
    // 保存预警参数
    const configs = {
        alert_timespan: document.getElementById('alert-timespan-input').value,
        alert_threshold: document.getElementById('alert-threshold-input').value,
        alert_min_daily_consumption: document.getElementById('alert-min-daily-consumption-input').value,
        alert_max_daily_consumption: document.getElementById('alert-max-daily-consumption-input').value,
        alert_medium_threshold_multiplier: document.getElementById('alert-medium-threshold-multiplier-input').value,
    };
    await apiRequest('/api/inventory/system-configs', 'POST', { configs });

    // 保存定时任务
    const cron = document.getElementById('alert-cron-input').value.trim();
    if (!cron) {
        alert('请输入预警分析的 Cron 表达式');
        return;
    }

    const schedules = await apiRequest('/api/schedules');
    const alertSchedule = schedules.find(s => s.name === 'Alert Analysis Schedule');
    
    const scheduleData = {
        name: 'Alert Analysis Schedule',
        cron: cron,
        task_type: 'run_analysis', // 指定任务类型
        isActive: true
    };

    try {
        if (alertSchedule) {
            await apiRequest(`/api/schedules/${alertSchedule.id}`, 'PUT', scheduleData);
        } else {
            await apiRequest('/api/schedules', 'POST', scheduleData);
        }
        alert('预警配置已保存');
    } catch (error) {
        alert('保存定时任务失败: ' + error.message);
    }
}


async function runAnalysis() {
    if (!confirm('立即执行一次库存分析吗？这可能需要一些时间。')) {
        return;
    }
    try {
        const result = await apiRequest('/api/inventory/run-analysis', 'POST');
        alert(result.message);
        loadAlerts(); // 刷新预警列表
    } catch (error) {
        alert('执行分析失败: ' + error.message);
    }
}

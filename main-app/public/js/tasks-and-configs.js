// A robust function to wait for an element to be available in the DOM
function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const interval = setInterval(() => {
            const element = document.querySelector(selector);
            if (element) {
                clearInterval(interval);
                resolve(element);
            } else if (Date.now() - startTime > timeout) {
                clearInterval(interval);
                reject(new Error(`Element "${selector}" not found within ${timeout}ms`));
            }
        }, 100); // Check every 100ms
    });
}

window.sectionInitializers = window.sectionInitializers || {};
window.sectionInitializers['tasks-and-configs'] = async () => {
    try {
        // Wait for a key element to be ready before proceeding
        await waitForElement('#inventory-cron-input');

        // Now that we're sure the DOM is ready, we can proceed
        await loadConfigsForSelect();
        await loadSystemSchedules();
        await loadScheduleHistory();
        setupEventListeners();

    } catch (error) {
        console.error("Failed to initialize 'tasks-and-configs' section:", error);
        // Optionally, display an error message to the user in the UI
    }
};

async function loadSystemSchedules() {
    try {
        // Fetch inventory schedule
        const inventorySchedules = await apiRequest('/api/schedules?task_type=fetch_inventory');
        if (inventorySchedules && inventorySchedules.length > 0) {
            document.getElementById('inventory-cron-input').value = inventorySchedules[0].cron;
            document.getElementById('save-inventory-schedule-btn').dataset.scheduleId = inventorySchedules[0].id;
        }

        // Fetch analysis schedule
        const analysisSchedules = await apiRequest('/api/schedules?task_type=run_analysis');
        if (analysisSchedules && analysisSchedules.length > 0) {
            document.getElementById('analysis-cron-input').value = analysisSchedules[0].cron;
            document.getElementById('save-analysis-schedule-btn').dataset.scheduleId = analysisSchedules[0].id;
        }
    } catch (error) {
        console.error('Failed to load system schedules:', error);
        alert('加载系统定时任务失败: ' + error.message);
    }
}

async function loadScheduleHistory() {
    const historyList = document.getElementById('schedule-history-list');
    if (!historyList) return;

    try {
        const history = await apiRequest('/api/inventory/schedule/history');
        if (history && history.length > 0) {
            historyList.innerHTML = history.map(item => `
                <li class="list-group-item">
                    <strong>${new Date(item.createdAt).toLocaleString()}:</strong> 
                    任务 <strong>${item.scheduleId}</strong> 完成, 状态: 
                    <span class="badge bg-${item.status === 'completed' ? 'success' : 'danger'}">${item.status}</span>.
                </li>
            `).join('');
        } else {
            historyList.innerHTML = '<li class="list-group-item">暂无执行历史。</li>';
        }
    } catch (error) {
        console.error('Failed to load schedule history:', error);
        historyList.innerHTML = '<li class="list-group-item text-danger">加载历史失败。</li>';
    }
}

function setupEventListeners() {
    const saveInventoryBtn = document.getElementById('save-inventory-schedule-btn');
    const saveAnalysisBtn = document.getElementById('save-analysis-schedule-btn');

    if (saveInventoryBtn) {
        saveInventoryBtn.addEventListener('click', () => saveSystemSchedule('inventory'));
    }

    if (saveAnalysisBtn) {
        saveAnalysisBtn.addEventListener('click', () => saveSystemSchedule('analysis'));
    }
}

async function saveSystemSchedule(type) {
    let cronInput, scheduleId, scheduleData;

    if (type === 'inventory') {
        cronInput = document.getElementById('inventory-cron-input').value.trim();
        scheduleId = document.getElementById('save-inventory-schedule-btn').dataset.scheduleId;
        scheduleData = { cron: cronInput, name: 'Default Inventory Schedule', task_type: 'fetch_inventory', isActive: true };
    } else if (type === 'analysis') {
        cronInput = document.getElementById('analysis-cron-input').value.trim();
        scheduleId = document.getElementById('save-analysis-schedule-btn').dataset.scheduleId;
        scheduleData = { cron: cronInput, name: 'Alert Analysis Schedule', task_type: 'run_analysis', isActive: true };
    } else {
        return;
    }

    if (!cronInput) {
        alert('Cron 表达式不能为空。');
        return;
    }

    try {
        if (scheduleId) {
            // Update existing schedule
            await apiRequest(`/api/schedules/${scheduleId}`, 'PUT', { cron: cronInput });
        } else {
            // Create new schedule if it doesn't exist
            await apiRequest('/api/schedules', 'POST', scheduleData);
        }
        alert('保存成功！');
        await loadSystemSchedules(); // Reload to get the new ID if created
    } catch (error) {
        console.error(`Failed to save ${type} schedule:`, error);
        alert(`保存失败: ${error.message}`);
    }
}

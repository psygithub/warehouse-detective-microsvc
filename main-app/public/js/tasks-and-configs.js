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
        await waitForElement('#schedulesList');

        // Load data
        await loadScheduleHistory();
        await loadSchedules();

    } catch (error) {
        console.error("Failed to initialize 'tasks-and-configs' section:", error);
    }
};

async function loadScheduleHistory() {
    const historyList = document.getElementById('schedule-history-list');
    if (!historyList) {
        console.error('Element #schedule-history-list not found!');
        return;
    }

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

// ==========================================
// Schedule Management Functions
// ==========================================

async function loadSchedules() {
    const container = document.getElementById('schedulesList');
    if (!container) return; 

    try {
        const schedules = await apiRequest('/api/schedules');
        displaySchedules(schedules);
    } catch (error) {
        console.error('加载定时任务失败:', error);
        container.innerHTML = '<p class="text-danger">加载定时任务失败</p>';
    }
}

function displaySchedules(schedules) {
    const container = document.getElementById('schedulesList');
    if (!container) return; 

    if (schedules.length === 0) {
        container.innerHTML = '<p class="text-muted">暂无定时任务</p>';
        return;
    }

    const typeMap = {
        'fetch_inventory': '<span class="badge bg-primary">库存查询</span>',
        'run_analysis': '<span class="badge bg-info text-dark">预警分析</span>',
        'check_orders': '<span class="badge bg-warning text-dark">订单查询</span>'
    };

    let html = `
        <div class="table-responsive">
            <table class="table">
                <thead>
                    <tr>
                        <th>类型</th>
                        <th>名称</th>
                        <th>Cron表达式</th>
                        <th>状态</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
    `;

    schedules.forEach(schedule => {
        html += `
            <tr>
                <td>${typeMap[schedule.task_type] || schedule.task_type}</td>
                <td><strong>${schedule.name}</strong></td>
                <td><code>${schedule.cron}</code></td>
                <td>
                    <span class="badge bg-${schedule.isActive ? 'success' : 'secondary'}">
                        ${schedule.isActive ? '启用' : '禁用'}
                    </span>
                </td>
                <td>
                    <button class="btn btn-sm btn-outline-success" onclick="executeSchedule(${schedule.id})">
                        <i class="fas fa-play"></i> 执行
                    </button>
                    <button class="btn btn-sm btn-outline-primary" onclick="editSchedule(${schedule.id})">
                        <i class="fas fa-edit"></i> 编辑
                    </button>
                    <button class="btn btn-sm btn-outline-info" onclick="showScheduleHistory(${schedule.id})">
                        <i class="fas fa-history"></i> 历史
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteSchedule(${schedule.id})">
                        <i class="fas fa-trash"></i> 删除
                    </button>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

function showScheduleModal(scheduleId = null) {
    const modalElement = document.getElementById('scheduleModal');
    
    if (!modalElement) {
        console.error('定时任务模态框元素不存在');
        return;
    }

    const modal = new bootstrap.Modal(modalElement);
    
    if (scheduleId) {
        // 编辑模式
        loadScheduleForEdit(scheduleId).then(() => {
            modal.show();
        }).catch(error => {
            console.error('加载定时任务失败:', error);
            alert('加载定时任务失败: ' + error.message);
        });
    } else {
        // 新建模式
        document.getElementById('scheduleForm').reset();
        document.getElementById('scheduleId').value = '';
        document.getElementById('scheduleActive').checked = true;
        document.getElementById('scheduleTaskType').value = 'fetch_inventory'; 
        modal.show();
    }
}

async function loadScheduleForEdit(scheduleId) {
    try {
        const schedule = await apiRequest(`/api/schedules/${scheduleId}`);

        document.getElementById('scheduleId').value = schedule.id;
        document.getElementById('scheduleName').value = schedule.name || '';
        document.getElementById('scheduleCron').value = schedule.cron || '';
        document.getElementById('scheduleActive').checked = schedule.isActive;
        document.getElementById('scheduleTaskType').value = schedule.task_type || 'fetch_inventory';

    } catch (error) {
        alert('加载定时任务失败: ' + error.message);
        throw error;
    }
}

async function saveSchedule() {
    const scheduleId = document.getElementById('scheduleId').value;
    const name = document.getElementById('scheduleName').value.trim();
    const cronExpression = document.getElementById('scheduleCron').value.trim();
    const isActive = document.getElementById('scheduleActive').checked;
    const taskType = document.getElementById('scheduleTaskType').value;

    if (!name || !cronExpression || !taskType) {
        alert('请填写所有必填字段');
        return;
    }
    
    const scheduleData = { 
        name, 
        configId: null, // No longer used
        cron: cronExpression, 
        isActive,
        task_type: taskType 
    };

    try {
        if (scheduleId) {
            await apiRequest(`/api/schedules/${scheduleId}`, 'PUT', scheduleData);
        } else {
            await apiRequest('/api/schedules', 'POST', scheduleData);
        }

        const modal = bootstrap.Modal.getInstance(document.getElementById('scheduleModal'));
        if (modal) modal.hide();
        
        // 刷新列表
        loadSchedules();

    } catch (error) {
        alert('保存定时任务失败: ' + error.message);
    }
}

function editSchedule(scheduleId) {
    showScheduleModal(scheduleId);
}

async function deleteSchedule(scheduleId) {
    if (!confirm('确定要删除这个定时任务吗？')) return;

    try {
        await apiRequest(`/api/schedules/${scheduleId}`, 'DELETE');
        loadSchedules();
    } catch (error) {
        alert('删除定时任务失败: ' + error.message);
    }
}

async function executeSchedule(scheduleId) {
    if (!confirm('确定要立即执行这个任务吗？')) return;
    try {
        const result = await apiRequest(`/api/schedules/${scheduleId}/run`, 'POST');
        alert(result.message || '任务已开始执行');
        setTimeout(loadScheduleHistory, 2000); 
    } catch (error) {
        alert('执行任务失败: ' + error.message);
    }
}

async function showScheduleHistory(scheduleId) {
    try {
        const history = await apiRequest(`/api/inventory/schedule/history?schedule_id=${scheduleId}`);
        const modalElement = document.getElementById('scheduleHistoryModal');
        const modalBody = document.getElementById('scheduleHistoryBody');
        
        if (!modalElement || !modalBody) {
            console.error('历史记录模态框不存在');
            return;
        }

        if (history.length === 0) {
            modalBody.innerHTML = '<p>暂无执行历史</p>';
        } else {
            let html = '<ul class="list-group">';
            history.forEach(record => {
                html += `
                    <li class="list-group-item">
                        <strong>执行时间:</strong> ${new Date(record.updatedAt || record.createdAt).toLocaleString()}<br>
                        <strong>状态:</strong> <span class="badge bg-${record.status === 'completed' ? 'success' : 'danger'}">${record.status}</span><br>
                        <strong>详情:</strong> <pre style="max-height: 200px; overflow: auto;">${record.results ? JSON.stringify(record.results, null, 2) : '无详情'}</pre>
                    </li>
                `;
            });
            html += '</ul>';
            modalBody.innerHTML = html;
        }

        const modal = new bootstrap.Modal(modalElement);
        modal.show();
    } catch (error) {
        console.error('加载任务历史失败:', error);
        alert('加载任务历史失败: ' + error.message);
    }
}

// Export functions to global scope explicitly
window.loadSchedules = loadSchedules;
window.displaySchedules = displaySchedules;
window.showScheduleModal = showScheduleModal;
window.saveSchedule = saveSchedule;
window.editSchedule = editSchedule;
window.deleteSchedule = deleteSchedule;
window.showScheduleHistory = showScheduleHistory;
window.executeSchedule = executeSchedule;

// Functions for managing schedules

async function loadSchedules() {
    const container = document.getElementById('schedulesList');
    if (!container) return; // 如果容器不存在，则不执行任何操作

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
    if (!container) return; // 如果容器不存在，则不执行任何操作

    if (schedules.length === 0) {
        container.innerHTML = '<p class="text-muted">暂无定时任务</p>';
        return;
    }

    let html = `
        <div class="table-responsive">
            <table class="table">
                <thead>
                    <tr>
                        <th>名称</th>
                        <th>Cron表达式</th>
                        <th>状态</th>
                        <th>创建时间</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
    `;

    schedules.forEach(schedule => {
        html += `
            <tr>
                <td><strong>${schedule.name}</strong></td>
                <td><code>${schedule.cron}</code></td>
                <td>
                    <span class="badge bg-${schedule.isActive ? 'success' : 'secondary'}">
                        ${schedule.isActive ? '启用' : '禁用'}
                    </span>
                </td>
                <td>${new Date(schedule.createdAt).toLocaleString()}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="editSchedule(${schedule.id})">
                        <i class="fas fa-edit"></i> 编辑
                    </button>
                    <button class="btn btn-sm btn-outline-info" onclick="showScheduleHistory(${schedule.id})">
                        <i class="fas fa-history"></i> 查看历史
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
    // 确保先加载配置到选择框
    loadConfigsForSelect().then(() => {
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
            modal.show();
        }
    }).catch(error => {
        console.error('加载配置失败:', error);
        alert('加载配置失败: ' + error.message);
    });
}

async function loadScheduleForEdit(scheduleId) {
    try {
        const schedule = await apiRequest(`/api/schedules/${scheduleId}`);

        document.getElementById('scheduleId').value = schedule.id;
        document.getElementById('scheduleName').value = schedule.name || '';
        document.getElementById('scheduleConfigId').value = schedule.configId || '';
        document.getElementById('scheduleCron').value = schedule.cron || '';
        document.getElementById('scheduleActive').checked = schedule.isActive;

    } catch (error) {
        alert('加载定时任务失败: ' + error.message);
    }
}

async function saveSchedule() {
    const scheduleId = document.getElementById('scheduleId').value;
    const name = document.getElementById('scheduleName').value.trim();
    const configId = document.getElementById('scheduleConfigId').value;
    const cronExpression = document.getElementById('scheduleCron').value.trim();
    const isActive = document.getElementById('scheduleActive').checked;

    if (!name || !configId || !cronExpression) {
        alert('请填写所有必填字段');
        return;
    }

    const scheduleData = { name, configId: parseInt(configId), cron:cronExpression, isActive };

    try {
        if (scheduleId) {
            await apiRequest(`/api/schedules/${scheduleId}`, 'PUT', scheduleData);
        } else {
            await apiRequest('/api/schedules', 'POST', scheduleData);
        }

        bootstrap.Modal.getInstance(document.getElementById('scheduleModal')).hide();
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
                        <strong>执行时间:</strong> ${new Date(record.run_time).toLocaleString()}<br>
                        <strong>状态:</strong> <span class="badge bg-${record.status === 'completed' ? 'success' : 'danger'}">${record.status}</span><br>
                        <strong>详情:</strong> <pre>${record.details}</pre>
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

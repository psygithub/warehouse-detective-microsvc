// Functions for managing configurations

async function loadConfigs() {
    const container = document.getElementById('configsList');
    if (!container) {
        return; // If the container doesn't exist on the page, do nothing.
    }

    try {
        const configs = await apiRequest('/api/configs');
        displayConfigs(configs, container);
    } catch (error) {
        console.error('加载配置失败:', error);
        container.innerHTML = '<p class="text-danger">加载配置失败</p>';
    }
}

function displayConfigs(configs, container) {
    if (configs.length === 0) {
        container.innerHTML = '<p class="text-muted">暂无配置</p>';
        return;
    }

    let html = `
        <div class="table-responsive">
            <table class="table">
                <thead>
                    <tr>
                        <th>名称</th>
                        <th>SKU数量</th>
                        <th>地区数量</th>
                        <th>创建时间</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
    `;

    configs.forEach(config => {
        let skusArray = [];
        try {
            skusArray = JSON.parse(config.skus);
        } catch (error) {
            console.error("SKU数据解析失败:", error);
        }

        let regionsArray = [];
        try {
            regionsArray = JSON.parse(config.regions);
        } catch (error) {
            console.error("REGION数据解析失败:", error);
        }

        const skuCount = skusArray.length;
        const regionCount = regionsArray.length;

        html += `
            <tr>
                <td>
                    <strong>${config.name || '未命名'}</strong>
                    ${config.description ? `<br><small class="text-muted">${config.description}</small>` : ''}
                </td>
                <td>${skuCount}</td>
                <td>${regionCount}</td>
                <td>${new Date(config.createdAt).toLocaleString()}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="editConfig(${config.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteConfig(${config.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

function showConfigModal(configId = null) {
    const modal = new bootstrap.Modal(document.getElementById('configModal'));

    if (configId) {
        loadConfigForEdit(configId);
    } else {
        document.getElementById('configForm').reset();
        document.getElementById('configId').value = '';
    }

    modal.show();
}

async function loadConfigForEdit(configId) {
  try {
        const config = await apiRequest(`/api/configs/${configId}`);
        
        if (!config) {
            throw new Error('未找到配置');
        }

        document.getElementById('configId').value = config.id;
        document.getElementById('configName').value = config.name || '';
        document.getElementById('configSkus').value = config.skus || '';
        document.getElementById('configRegions').value = config.regions || '';
        document.getElementById('configDescription').value = config.description || '';

    } catch (error) {
        console.error('加载配置失败:', error);
        throw error;
    }
}

async function saveConfig() {
    const configId = document.getElementById('configId').value;
    const name = document.getElementById('configName').value.trim();
    const skusText = document.getElementById('configSkus').value.trim();
    const regionsText = document.getElementById('configRegions').value.trim();
    const description = document.getElementById('configDescription').value.trim();

    if (!name || !skusText) {
        alert('请填写配置名称和SKU列表');
        return;
    }

    const skus = skusText.split('\n').map(s => s.trim()).filter(s => s);
    const regions = regionsText ? regionsText.split('\n').map(r => r.trim()).filter(r => r) : [];

    const configData = { name, skus, regions, description };

    try {
        if (configId) {
            await apiRequest(`/api/configs/${configId}`, 'PUT', configData);
        } else {
            await apiRequest('/api/configs', 'POST', configData);
        }

        bootstrap.Modal.getInstance(document.getElementById('configModal')).hide();
        loadConfigs();
        loadConfigsForSelect();

    } catch (error) {
        alert('保存配置失败: ' + error.message);
    }
}

function editConfig(configId) {
    showConfigModal(configId);
}

async function deleteConfig(configId) {
    if (!confirm('确定要删除这个配置吗？')) return;

    try {
        await apiRequest(`/api/configs/${configId}`, 'DELETE');
        loadConfigs();
        loadConfigsForSelect();
    } catch (error) {
        alert('删除配置失败: ' + error.message);
    }
}

async function loadConfigsForSelect() {
    try {
        const configs = await apiRequest('/api/configs');
        
        const configSelect = document.getElementById('configSelect');
        if (configSelect) {
            configSelect.innerHTML = '<option value="">选择配置...</option>';
            configs.forEach(config => {
                configSelect.innerHTML += `<option value="${config.id}">${config.name || '未命名配置'}</option>`;
            });
        }

        const scheduleConfigSelect = document.getElementById('scheduleConfigId');
        if (scheduleConfigSelect) {
            scheduleConfigSelect.innerHTML = '<option value="">选择配置...</option>';
            configs.forEach(config => {
                scheduleConfigSelect.innerHTML += `<option value="${config.id}">${config.name || '未命名配置'}</option>`;
            });
        }
    } catch (error) {
        console.error('加载配置到选择框失败:', error);
    }
}

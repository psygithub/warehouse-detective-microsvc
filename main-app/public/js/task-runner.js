// Functions for running tasks

async function executeTask(skus, regions, configId = null) {
    const resultCard = document.getElementById('taskResultCard');
    const resultDiv = document.getElementById('taskResult');

    resultCard.style.display = 'block';
    resultDiv.innerHTML = '<div class="text-center"><div class="spinner-border"></div><p class="mt-2">正在执行任务...</p></div>';

    try {
        const response = await apiRequest('/api/tasks/run', 'POST', {
            skus,
            regions,
            configId
        });

        if (response.results && response.results.length > 0) {
            displayTaskResults(response.results);
        } else {
            resultDiv.innerHTML = '<div class="alert alert-warning">任务执行完成，但未找到结果</div>';
        }

        // 刷新仪表板数据
        if (document.getElementById('dashboard').classList.contains('active')) {
            loadDashboard();
        }

    } catch (error) {
        resultDiv.innerHTML = `<div class="alert alert-danger">任务执行失败: ${error.message}</div>`;
    }
}

function displayTaskResults(results) {
    const resultDiv = document.getElementById('taskResult');

    let html = `
        <div class="alert alert-success">
            <i class="fas fa-check-circle me-2"></i>
            任务执行完成，共获得 ${results.length} 个结果
        </div>
        <div class="table-responsive">
            <table class="table table-sm">
                <thead>
                    <tr>
                        <th>SKU</th>
                        <th>地区</th>
                        <th>库存</th>
                    </tr>
                </thead>
                <tbody>
    `;

    results.forEach(result => {
        html += `
            <tr>
                <td>${result.sku}</td>
                <td>${result.region}</td>
                <td>
                    <span class="badge bg-${result.stock.includes('未找到') ? 'danger' : 'success'}">
                        ${result.stock}
                    </span>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table></div>';
    resultDiv.innerHTML = html;
}

async function executeWithConfig() {
    const configId = document.getElementById('configSelect').value;
    if (!configId) {
        alert('请选择配置');
        return;
    }

    try {
        const config = await apiRequest(`/api/configs/${configId}`);
        await executeTask(config.skus, config.regions, configId);
    } catch (error) {
        alert('执行失败: ' + error.message);
    }
}

function setupForms() {
    // 快速任务表单
    const quickTaskForm = document.getElementById('quickTaskForm');
    if (quickTaskForm) {
        quickTaskForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            const skusText = document.getElementById('taskSkus').value.trim();
            const regionsText = document.getElementById('taskRegions').value.trim();

            if (!skusText) {
                alert('请输入SKU');
                return;
            }

            const skus = skusText.split('\n').map(s => s.trim()).filter(s => s);
            const regions = regionsText ? regionsText.split('\n').map(r => r.trim()).filter(r => r) : [];

            await executeTask(skus, regions);
        });
    }
}

(() => {
    let currentPage = 1;
    let rowsPerPage = 20;
    let existingSkus = new Set();
    let alertsBySkuId = {};

    // This function will be exposed to the global scope for pagination
    async function loadInventoryConfigSkus(page = 1) {
        currentPage = page;
        rowsPerPage = document.getElementById('rows-per-page-select').value;
        const response = await apiRequest(`/api/inventory/skus-paginated?page=${page}&limit=${rowsPerPage}`);
        if (response && response.items) {
            existingSkus = new Set(response.items.map(s => s.sku));
            renderSkuList(response.items);
            window.renderPagination('pagination-links', response.total, page, rowsPerPage, 'loadInventoryConfigSkus');
            if (response.items.length > 0) {
                loadHistoryForSku(response.items[0].id);
                setTimeout(() => {
                    const firstRow = document.querySelector('#sku-list-body tr');
                    if (firstRow) {
                        firstRow.classList.add('table-active');
                    }
                }, 0);
            } else {
                renderChart([], '无SKU');
            }
        }
    }

    window.sectionInitializers = window.sectionInitializers || {};
    window.sectionInitializers['inventory-config'] = async () => {
        // Expose the pagination function to the global scope
        window.loadInventoryConfigSkus = loadInventoryConfigSkus;

        const rowsPerPageSelect = document.getElementById('rows-per-page-select');
        if (rowsPerPageSelect) {
            rowsPerPageSelect.addEventListener('change', () => loadInventoryConfigSkus(1));
        }

        const alerts = await apiRequest('/api/inventory/alerts/all');
        alertsBySkuId = alerts.reduce((acc, alert) => {
            if (!acc[alert.tracked_sku_id]) {
                acc[alert.tracked_sku_id] = [];
            }
            acc[alert.tracked_sku_id].push(alert);
            return acc;
        }, {});

        await loadInventoryConfigSkus();
        await loadSchedule();
        await loadScheduleHistory();

        const skuListBody = document.getElementById('sku-list-body');
        if (skuListBody) {
            skuListBody.addEventListener('click', handleSkuListClick);
        }

        const saveSkusBtn = document.getElementById('save-skus-btn');
        if (saveSkusBtn) {
            saveSkusBtn.addEventListener('click', handleSaveSkus);
        }

        const fetchNowBtn = document.getElementById('fetch-now-btn');
        if (fetchNowBtn) {
            fetchNowBtn.addEventListener('click', handleFetchNow);
        }

        const saveScheduleBtn = document.getElementById('save-schedule-btn');
        if (saveScheduleBtn) {
            saveScheduleBtn.addEventListener('click', handleSaveSchedule);
        }
    };

    async function handleSkuListClick(e) {
        const target = e.target;
        const tr = target.closest('.sku-row');
        if (!tr) return;

        const skuId = tr.dataset.skuId;

        if (target.tagName === 'BUTTON' || target.closest('button')) {
            e.stopPropagation();
            const button = target.closest('button');
            const id = button.dataset.id;
            if (button.classList.contains('delete-btn')) {
                const historyCheck = await apiRequest(`/api/inventory/skus/${id}/has-history`);
                let confirmMessage = "确定要删除这个 SKU 吗？";
                if (historyCheck && historyCheck.hasHistory) {
                    confirmMessage = "警告：这个 SKU 存在历史库存数据，删除后将一并清除。确定要删除吗？";
                }
                if (confirm(confirmMessage)) {
                    const result = await apiRequest(`/api/inventory/skus/${id}`, 'DELETE');
                    if (result) {
                        loadInventoryConfigSkus(currentPage);
                    }
                }
            } else if (button.classList.contains('query-btn')) {
                querySku(id);
            } else if (button.classList.contains('analyze-btn')) {
                analyzeSku(id, button);
            }
            return;
        }

        if (skuId) {
            document.querySelectorAll('#sku-list-body .sku-row').forEach(row => row.classList.remove('table-active'));
            tr.classList.add('table-active');
            loadHistoryForSku(skuId);
            const detailRow = document.querySelector(`.sku-details-row[data-sku-id="${skuId}"]`);
            if (detailRow) {
                const isHidden = detailRow.classList.contains('d-none');
                document.querySelectorAll('.sku-details-row').forEach(row => row.classList.add('d-none'));
                if (isHidden) {
                    detailRow.classList.remove('d-none');
                }
            }
        }
    }

    async function handleSaveSkus() {
        const skusText = document.getElementById('sku-textarea').value.trim();
        if (!skusText) {
            alert('请输入 SKU');
            return;
        }
        const skus = skusText.split('\n').map(s => s.trim()).filter(s => s);
        if (skus.length === 0) {
            alert('请输入有效的 SKU');
            return;
        }
        const uniqueSkus = [...new Set(skus)];
        if (uniqueSkus.length === 0) {
            alert('请输入有效的 SKU');
            return;
        }
        const saveBtn = document.getElementById('save-skus-btn');
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 正在添加...';
        try {
            const result = await apiRequest('/api/inventory/skus/batch', 'POST', { skus: uniqueSkus });
            let message = result.message || `${result.newSkusCount} 个新 SKU 已成功处理。`;
            if (result.failedCount > 0) {
                message += `\n${result.failedCount} 个 SKU 查询失败: ${result.failedSkus.join(', ')}`;
            }
            alert(message);
        } catch (error) {
            alert(`添加失败: ${error.message}`);
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '保存';
            document.getElementById('sku-textarea').value = '';
            const modal = bootstrap.Modal.getInstance(document.getElementById('addSkuModal'));
            if (modal) {
                modal.hide();
            }
            await loadInventoryConfigSkus();
        }
    }

    async function handleFetchNow() {
        if (!confirm('立即查询会覆盖今天已有的最新数据，确定要执行吗？')) {
            return;
        }
        try {
            const result = await apiRequest('/api/inventory/fetch-now', 'POST');
            alert(result.message || '查询任务已启动');
            await loadInventoryConfigSkus();
            await loadScheduleHistory();
        } catch (error) {
            alert(`查询失败: ${error.message}`);
        }
    }

    async function handleSaveSchedule() {
        const cronInput = document.getElementById('cron-input');
        if (!cronInput) return;
        const cron = cronInput.value.trim();
        if (!cron) {
            alert('请输入 Cron 表达式');
            return;
        }
        const schedules = await apiRequest('/api/schedules');
        const scheduleData = {
            name: 'Default Inventory Schedule',
            cron: cron,
            configId: 1,
            isActive: true
        };
        try {
            if (schedules && schedules.length > 0) {
                await apiRequest(`/api/schedules/${schedules[0].id}`, 'PUT', scheduleData);
            } else {
                await apiRequest('/api/schedules', 'POST', scheduleData);
            }
            alert('定时任务已保存');
            loadSchedule();
        } catch (error) {
            alert('保存失败: ' + error.message);
        }
    }

    function renderSkuList(skus) {
        const skuListBody = document.getElementById('sku-list-body');
        if (!skuListBody) return;
        skuListBody.innerHTML = '';
        if (skus.length === 0) {
            skuListBody.innerHTML = '<tr><td colspan="6" class="text-center">暂无跟踪的 SKU。</td></tr>';
            return;
        }
        let html = '';
        skus.forEach(sku => {
            const alerts = alertsBySkuId[sku.id];
            let highestAlertLevel = 0;
            if (alerts && alerts.length > 0) {
                highestAlertLevel = Math.max(...alerts.map(a => a.alert_level));
            }
            const recordTime = sku.latest_record_time ? new Date(sku.latest_record_time).toLocaleString() : 'N/A';
            html += `
                <tr class="sku-row" data-sku-id="${sku.id}" style="cursor: pointer;">
                    <td><img src="${sku.product_image || 'https://via.placeholder.com/50'}" alt="${sku.sku}" width="50" height="50"></td>
                    <td>${sku.sku} ${getBadgeForLevel(highestAlertLevel)}</td>
                    <td>${sku.latest_qty ?? 'NA'}</td>
                    <td>${sku.latest_month_sale ?? 'N/A'}</td>
                    <td>${recordTime}</td>
                    <td>
                        <button class="btn btn-info btn-sm query-btn" data-id="${sku.id}">查询</button>
                        <button class="btn btn-warning btn-sm analyze-btn" data-id="${sku.id}">分析</button>
                        <button class="btn btn-danger btn-sm delete-btn" data-id="${sku.id}">删除</button>
                    </td>
                </tr>
            `;
            if (alerts && alerts.length > 0) {
                const alertContent = alerts.sort((a, b) => b.alert_level - a.alert_level).map(alert => {
                    const details = JSON.parse(alert.details);
                    return `<div class="alert alert-secondary mb-1 p-2">
                                ${getBadgeForLevel(alert.alert_level)} <strong>${alert.region_name}:</strong> 
                                (${details.days}天内消耗 ${details.qtyChange}件, 
                                日均消耗率: ${(details.consumptionRate * 100).toFixed(2)}%)
                            </div>`;
                }).join('');
                html += `
                    <tr class="sku-details-row d-none" data-sku-id="${sku.id}">
                        <td colspan="6" class="bg-light p-3">
                            <h6 class="alert-heading">预警详情</h6>
                            ${alertContent}
                        </td>
                    </tr>
                `;
            }
        });
        skuListBody.innerHTML = html;
    }

    async function loadSchedule() {
        const cronInput = document.getElementById('cron-input');
        if (!cronInput) return;
        const schedules = await apiRequest('/api/schedules');
        if (schedules && schedules.length > 0) {
            cronInput.value = schedules[0].cron;
        } else {
            cronInput.value = '0 2 * * *';
        }
    }

    async function loadScheduleHistory() {
        const history = await apiRequest('/api/inventory/schedule/history');
        const scheduleHistoryList = document.getElementById('schedule-history-list');
        if (!scheduleHistoryList) return;
        scheduleHistoryList.innerHTML = '';
        if (history && history.length > 0) {
            history.forEach(item => {
                const li = document.createElement('li');
                li.className = 'list-group-item';
                let skuArray = [];
                if (Array.isArray(item.skus)) {
                    skuArray = item.skus;
                } else if (typeof item.skus === 'string') {
                    try {
                        skuArray = JSON.parse(item.skus);
                    } catch (e) {
                        skuArray = [item.skus];
                    }
                }
                const skus = skuArray.join(', ');
                const time = new Date(item.createdAt).toLocaleString();
                li.innerHTML = `<strong>${time}:</strong> 对 ${skus} 的查询已完成，状态: ${item.status}。`;
                scheduleHistoryList.appendChild(li);
            });
        } else {
            scheduleHistoryList.innerHTML = '<li class="list-group-item">暂无定时任务执行历史。</li>';
        }
    }

    async function analyzeSku(skuId, button) {
        try {
            button.disabled = true;
            button.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
            const result = await apiRequest(`/api/inventory/run-analysis/${skuId}`, 'POST');
            alert(`分析完成！新增 ${result.newAlertsCount} 条预警。`);
            await window.sectionInitializers['inventory-config']();
        } catch (error) {
            alert(`分析失败: ${error.message}`);
        } finally {
            button.disabled = false;
            button.innerHTML = '分析';
        }
    }

    async function querySku(skuId) {
        try {
            const result = await apiRequest(`/api/inventory/fetch-sku/${skuId}`, 'POST');
            if (result) {
                alert(`查询成功: ${result.sku} - 库存: ${result.qty}`);
                loadInventoryConfigSkus(currentPage);
            }
        } catch (error) {
            alert(`查询失败: ${error.message}`);
        }
    }

    async function loadHistoryForSku(skuId) {
        const data = await apiRequest(`/api/inventory/regional-history/${skuId}`);
        const productImage = document.getElementById('product-image');
        const chartSkuName = document.getElementById('chart-sku-name');
        if (data) {
            chartSkuName.textContent = `SKU: ${data.sku}`;
            renderChart(data.history, data.sku);
            if (data.product_image) {
                productImage.src = data.product_image;
                productImage.style.display = 'block';
            } else {
                productImage.style.display = 'none';
            }
        } else {
            chartSkuName.textContent = '选择一个 SKU 查看历史记录';
            productImage.style.display = 'none';
            renderChart([], '');
        }
    }

    function renderChart(historyData, skuName) {
        const chartCanvas = document.getElementById('inventory-chart');
        const regionCheckboxes = document.getElementById('region-checkboxes');
        let inventoryChart = Chart.getChart(chartCanvas);
        if (inventoryChart) {
            inventoryChart.destroy();
        }
        if (!historyData || historyData.length === 0) {
            const ctx = chartCanvas.getContext('2d');
            ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
            ctx.textAlign = 'center';
            ctx.fillText('暂无该 SKU 的历史数据', chartCanvas.width / 2, chartCanvas.height / 2);
            regionCheckboxes.innerHTML = '';
            return;
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
        inventoryChart = new Chart(chartCanvas, {
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
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (context) => `日期: ${context[0].label}`,
                            label: (context) => `${context.dataset.label}: ${context.parsed.y} 件`,
                        }
                    }
                }
            }
        });
        regionCheckboxes.innerHTML = datasets.map((ds, i) => `
            <div class="form-check form-check-inline">
                <input class="form-check-input" type="checkbox" id="region-${i}" value="${ds.label}" checked>
                <label class="form-check-label" for="region-${i}" style="color: ${ds.borderColor};">${ds.label}</label>
            </div>
        `).join('');
        regionCheckboxes.querySelectorAll('input').forEach((checkbox, index) => {
            checkbox.addEventListener('change', () => {
                inventoryChart.setDatasetVisibility(index, checkbox.checked);
                inventoryChart.update();
            });
        });
    }
})();

window.sectionInitializers = window.sectionInitializers || {};
window.sectionInitializers['inventory-history'] = async () => {
    // The sku-manager module is not needed here for now, but this shows how it could be loaded.
    // await loadSkuManagerModule(); 
    await init();
    setupEventListeners();
};

async function init() {
    await loadUserSkusForDropdown();
}

// This function is ready for when the SKU manager is needed on this page again.
async function loadSkuManagerModule() {
    const container = document.getElementById('sku-manager-placeholder');
    try {
        const response = await fetch('/partials/sku-manager.html');
        if (!response.ok) throw new Error('Failed to load SKU manager HTML');
        container.innerHTML = await response.text();
        
        const script = document.createElement('script');
        script.src = '/js/sku-manager.js';
        script.onload = () => {
            // The SkuManager class is now available globally if needed
        };
        document.body.appendChild(script);
    } catch (error) {
        console.error("Failed to load SKU manager module:", error);
        container.innerHTML = '<p class="text-danger">无法加载 SKU 管理器。</p>';
    }
}

async function loadUserSkusForDropdown() {
    const skuSelect = document.getElementById('sku-select');
    if (!skuSelect) {
        console.error('SKU select dropdown #sku-select not found in the DOM.');
        return;
    }
    let skus = [];
    try {
        if (currentUser.role === 'admin') {
            // 管理员加载所有 SKU
            skus = await apiRequest('/api/inventory/skus');
        } else {
            // 普通用户加载自己关联的 SKU
            skus = await apiRequest(`/api/users/${currentUser.id}/skus`);
        }

        if (skus && skus.length > 0) {
            skuSelect.innerHTML = skus.map(sku => `<option value="${sku.id}">${sku.sku} - ${sku.product_name || 'N/A'}</option>`).join('');
            if (skus[0]) {
                loadHistoryForSku(skus[0].id);
            }
        } else {
            if (currentUser.role === 'admin') {
                skuSelect.innerHTML = '<option>系统中没有 SKU</option>';
            } else {
                skuSelect.innerHTML = '<option>您还没有关联任何 SKU</option>';
            }
            renderChart([], '');
        }
    } catch (error) {
        console.error("加载SKU失败:", error);
        skuSelect.innerHTML = '<option>加载SKU失败</option>';
    }

    skuSelect.onchange = (e) => {
        const skuId = e.target.value;
        if (skuId) {
            loadHistoryForSku(skuId);
        }
    };
}

function setupEventListeners() {
    // Hide the "Manage My SKUs" button as requested
    const manageSkusBtn = document.getElementById('manageMySkusBtn');
    if (manageSkusBtn) {
        manageSkusBtn.style.display = 'none';
    }
}

async function loadHistoryForSku(skuId) {
    const data = await apiRequest(`/api/inventory/regional-history/${skuId}`);
    const productImage = document.getElementById('product-image');

    if (data) {
        renderChart(data.history, data.sku);
        if (data.product_image) {
            productImage.src = data.product_image;
            productImage.style.display = 'block';
        } else {
            productImage.style.display = 'none';
        }
    } else {
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
            backgroundColor: colors[index % colors.length] + '33', // Add alpha for fill
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

    // Render checkboxes
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

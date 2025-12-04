// 注册初始化函数
if (!window.sectionInitializers) {
    window.sectionInitializers = {};
}

window.sectionInitializers.orders = function() {
    console.log('Orders section initialized');
    loadOrders();
};

const OrderStatus = {
    NEED_PAY: 900,            // 待付款
    PAID_PENDING_AUDIT: 100,  // 已付款待审核
    WAIT_PURCHASE: 200,       // 待采购
    NO_TRACKING_NO: 301       // 未申请运单号
};

async function loadOrders(isRefresh = false) {
    const ordersList = document.getElementById('ordersList');
    const newOrdersCountEl = document.getElementById('newOrdersCount');
    
    if (!ordersList) return;
    
    ordersList.innerHTML = '<tr><td colspan="13" class="text-center p-3"><div class="spinner-border spinner-border-sm me-2"></div>加载中...</td></tr>';

    try {
        const token = localStorage.getItem('token');
        // 调用新的后端接口，不再直接调用 /api/orders
        const response = await fetch(`/api/orders/pending?isRefresh=${isRefresh}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch orders');
        }

        const data = await response.json();
        const targetOrders = data.items || [];

        const newOrdersCount = targetOrders.filter(o => o.order_status === OrderStatus.PAID_PENDING_AUDIT).length;
        
        if (newOrdersCountEl) newOrdersCountEl.textContent = newOrdersCount;

        renderOrders(ordersList, targetOrders);

    } catch (error) {
        console.error('Error loading orders:', error);
        ordersList.innerHTML = `<tr><td colspan="13" class="text-center p-3 text-danger">加载失败: ${error.message}</td></tr>`;
    }
}

function renderOrders(container, orders) {
    if (orders.length === 0) {
        container.innerHTML = '<tr><td colspan="13" class="text-center p-4 text-muted">暂无待处理订单</td></tr>';
        return;
    }

    let html = '';
    
    orders.forEach(order => {
        const items = order.order_items || [];
        const loopCount = Math.max(items.length, 1);

        for (let i = 0; i < loopCount; i++) {
            const item = items[i] || {};
            
            let statusBadge = '';
            if (order.order_status === OrderStatus.PAID_PENDING_AUDIT) {
                statusBadge = '<span class="badge bg-primary">待审核</span>';
            } else if (order.order_status === OrderStatus.WAIT_PURCHASE) {
                statusBadge = '<span class="badge bg-info text-dark">待采购</span>';
            } else {
                statusBadge = `<span class="badge bg-secondary">${order.order_status_desc || '未知'}</span>`;
            }

            // 操作按钮：只在第一行显示（避免重复）
            let actionButtons = '';
            if (i === 0) {
                if (order.order_status === OrderStatus.PAID_PENDING_AUDIT) {
                    // 将 items 和 country 编码以便传递
                    const itemsData = encodeURIComponent(JSON.stringify(order.order_items));
                    const country = order.xy_country || '';
                    
                    actionButtons = `
                        <div class="d-grid gap-2">
                            <button class="btn btn-sm btn-info text-white" onclick="checkInventory('${order.global_order_no}', '${country}', '${itemsData}')">
                                <i class="fas fa-search me-1"></i>查库存
                            </button>
                            <button class="btn btn-sm btn-success" onclick="approveOrder('${order.global_order_no}')">
                                <i class="fas fa-check me-1"></i>审核通过
                            </button>
                        </div>
                    `;
            } else if (order.order_status === OrderStatus.WAIT_PURCHASE && order.order_sub_status === OrderStatus.NO_TRACKING_NO) {
                actionButtons = `
                    <div class="d-grid gap-2">
                        <button class="btn btn-sm btn-primary" onclick="applyTrackingNo('${order.global_order_no}')">
                            <i class="fas fa-shipping-fast me-1"></i>申请运单号
                        </button>
                    </div>
                `;
            }
            }

            html += `
                <tr>
                    <td>${statusBadge}</td>
                    <td><span class="badge bg-light text-dark border">${order.order_sub_status_desc || '-'}</span></td>
                    <td><span class="fw-bold text-nowrap">${order.global_order_no}</span></td>
                    <td>${order.shop_name}</td>
                    <td>${order.country || '-'}</td>
                    <td>${formatDate(order.place_order_time)}</td>
                    <td class="text-amount">¥${order.amount}</td>
                    
                    <td class="text-center">
                        ${item.picture_url ? 
                            `<img src="${item.picture_url}" class="order-img" alt="img" onclick="showImage('${item.picture_url}')">` : 
                            '-'}
                    </td>
                    <td>${item.platform_order_goods_no || '-'}</td>
                    <td>${item.platform_seller_sku || '-'}</td>
                    <td class="text-primary fw-bold">${item.xy_sku || '-'}</td>
                    <td>${item.sell_price ? '¥' + item.sell_price : '-'}</td>
                    <td>${item.quantity ? 'x' + item.quantity : '-'}</td>
                    <td>${actionButtons}</td>
                </tr>
            `;
        }
    });

    container.innerHTML = html;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString();
}

function showImage(url) {
    const modalImage = document.getElementById('modalImage');
    const imageModal = new bootstrap.Modal(document.getElementById('imageModal'));
    if (modalImage && imageModal) {
        modalImage.src = url;
        imageModal.show();
    }
}

async function checkInventory(orderId, country, itemsData) {
    if (!country) {
        showCommonModal('查库存失败', '订单缺少国家代码信息，无法查库存。');
        return;
    }
    
    let items = [];
    try {
        items = JSON.parse(decodeURIComponent(itemsData));
    } catch (e) {
        console.error('解析商品数据失败', e);
        showCommonModal('错误', '解析商品数据失败');
        return;
    }

    if (!items || items.length === 0) {
        showCommonModal('查库存失败', '订单没有商品，无法查库存。');
        return;
    }

    const token = localStorage.getItem('token');
    let htmlResults = '<div class="list-group">';
    
    // 遍历商品逐个查询
    for (const item of items) {
        const sku = item.xy_sku;
        if (!sku) continue;

        try {
            const response = await fetch('/api/orders/inventory/check-sku', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ sku, country })
            });
            const result = await response.json();
            
            if (result.success) {
                const data = result.data || {};
                const stockStatus = data.stock_status || '未知';
                const qty = data.quantity !== undefined ? data.quantity : '-';
                const price = data.price || '-';
                const regionName = data.region_name || country;
                
                const badgeClass = (stockStatus === '有货' || qty > 0) ? 'bg-success' : 'bg-danger';

                htmlResults += `
                    <div class="list-group-item">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1 fw-bold">${sku}</h6>
                            <span class="badge ${badgeClass}">${stockStatus}</span>
                        </div>
                        <p class="mb-1 small">区域: ${regionName} | 库存: ${qty} | 价格: ${price}</p>
                    </div>
                `;
            } else {
                htmlResults += `
                    <div class="list-group-item list-group-item-danger">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">${sku}</h6>
                            <span class="badge bg-danger">失败</span>
                        </div>
                        <small>${result.message}</small>
                    </div>
                `;
            }
        } catch (error) {
            htmlResults += `
                <div class="list-group-item list-group-item-warning">
                    <h6 class="mb-1">${sku}</h6>
                    <small>请求错误: ${error.message}</small>
                </div>
            `;
        }
    }
    htmlResults += '</div>';

    if (htmlResults !== '<div class="list-group"></div>') {
        showCommonModal(`库存查询结果 (Order: ${orderId})`, htmlResults);
    } else {
        showCommonModal('提示', '未找到有效的SKU进行查询');
    }
}

async function approveOrder(orderId) {
    if (!confirm('确定要审核通过吗？')) return;
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/orders/${orderId}/approve`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await response.json();
        showCommonModal('操作结果', result.message || '操作完成');
        // 刷新列表
        loadOrders(true);
    } catch (error) {
        console.error('审核失败:', error);
        showCommonModal('错误', '审核失败: ' + error.message);
    }
}

async function applyTrackingNo(orderId) {
    if (!confirm('确定要为该订单申请运单号吗？')) return;
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/orders/${orderId}/apply-tracking`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await response.json();
        if (result.success) {
            showCommonModal('申请结果', result.message || '申请成功');
            loadOrders(true);
        } else {
            showCommonModal('错误', result.message || '申请失败');
        }
    } catch (error) {
        console.error('申请运单号失败:', error);
        showCommonModal('错误', '申请运单号失败: ' + error.message);
    }
}

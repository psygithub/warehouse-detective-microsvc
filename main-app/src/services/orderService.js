const { getStatusDesc, OrderStatus } = require('../orderStatus');
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const db = require('../db_sqlite');
const inventoryService = require('./inventoryService');

async function getXizhiyueOrderList(token, page = 1, pageSize = 20) {
    const url = `https://api.westmonth.com/erp/order/list`;

    const now = new Date();
    const endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);
    
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 30);
    startDate.setHours(0, 0, 0, 0);

    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    const body = {
        page: page,
        size: pageSize,
        order_status: "",
        time_field: "place_order_time",
        time_start: formatDate(startDate),
        time_end: formatDate(endDate),
        ordersort: "desc",
        search_field: "global_order_no",
        search_value: "",
        limit: pageSize
    };

    let lastError = null;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                body: JSON.stringify(body),
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });

            const responseText = await response.text();

            console.log(`[LOG] [order_list API] Attempt ${attempt}. RAW TEXT: ${responseText}`);
            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }

            let responseData;
            try {
                responseData = JSON.parse(responseText);
            } catch (e) {
                throw new Error(`Failed to parse API response: ${responseText}`);
            }

            if (responseData.code !== 0) {
                // 特殊处理 PHP 命名空间冲突错误
                if (responseData.message && responseData.message.includes('Cannot use') && responseData.message.includes('as') && responseData.message.includes('because the name is already in use')) {
                    console.warn(`[WARNING] 检测到远程服务器 PHP 命名空间冲突错误 (Attempt ${attempt}): ${responseData.message}`);
                    // 这种错误通常是服务器端代码问题，重试可能无效，但也可能是部署过程中的瞬间状态
                }
                throw new Error(`API Error: ${responseData.message || 'Unknown error'}`);
            }

            const orders = responseData.data && responseData.data.data ? responseData.data.data : [];
            return extractedOrdersFromData(orders);

        } catch (error) {
            console.warn(`[WARNING] getXizhiyueOrderList attempt ${attempt} failed: ${error.message}`);
            lastError = error;
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // 递增等待
            }
        }
    }
    
    throw lastError;
}

function extractedOrdersFromData(orders) {
    return orders.map(order => ({
        global_order_no: order.global_order_no,
        shop_name: order.shop_name,
        place_order_time: order.place_order_time,
        amount: order.amount,
        xy_country: order.xy_country,
        country:order.country_code_desc,
        order_status: order.order_status,
        order_status_desc: getStatusDesc(order.order_status),
        order_sub_status: order.order_sub_status,
        order_sub_status_desc: getStatusDesc(order.order_sub_status),
        currency: order.currency,
        order_items: (order.order_items || []).map(item => ({
            ...item, // 保留原始的所有字段，防止漏掉
            picture_url: item.picture_url,
            platform_order_goods_no: item.platform_order_goods_no,
            platform_seller_sku: item.platform_seller_sku,
            xy_sku: item.xy_sku,
            sell_price: item.sell_price,
            quantity: item.quantity
        }))
    }));
}

// 保留旧函数名以兼容引用，实际上 logic 已移入 extractedOrdersFromData
async function _old_getXizhiyueOrderList_logic_placeholder() {
    
    const extractedOrders = orders.map(order => ({
        global_order_no: order.global_order_no,
        shop_name: order.shop_name,
        place_order_time: order.place_order_time,
        amount: order.amount,
        xy_country: order.xy_country,
        country:order.country_code_desc,
        order_status: order.order_status,
        order_status_desc: getStatusDesc(order.order_status),
        order_sub_status: order.order_sub_status,
        order_sub_status_desc: getStatusDesc(order.order_sub_status),
        order_items: (order.order_items || []).map(item => ({
            ...item, // 保留原始的所有字段，防止漏掉
            picture_url: item.picture_url,
            platform_order_goods_no: item.platform_order_goods_no,
            platform_seller_sku: item.platform_seller_sku,
            xy_sku: item.xy_sku,
            sell_price: item.sell_price,
            quantity: item.quantity
        }))
    }));

    return extractedOrders;
}

// 获取待处理订单 (待付款 + 待审核)
async function getPendingOrders(token) {
    // 获取前100条订单进行过滤，确保覆盖最近的待处理订单
    // 注意：如果待处理订单非常久远，这种方式可能会漏掉，但考虑到性能和第三方接口限制，暂定取前100条
    const orders = await getXizhiyueOrderList(token, 1, 100);
    
    const pendingOrders = orders.filter(order => 
        order.order_status === OrderStatus.WAIT_PURCHASE || 
        order.order_status === OrderStatus.PAID_PENDING_AUDIT
    );
    
    return pendingOrders;
}

function loadConfig() {
    try {
        // 优先检查 Docker 常用路径 /app/config/config.json
        // 如果不存在则回退到本地开发路径
        let configPath = '/app/config/config.json';
        if (!fs.existsSync(configPath)) {
            configPath = path.join(__dirname, '../../../config/config.json');
        }

        console.log(`[DEBUG] 尝试加载配置文件路径: ${configPath}`);
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            console.log(`[DEBUG] 配置文件加载成功`);
            return config;
        } else {
            console.error(`[DEBUG] 配置文件不存在: ${configPath}`);
        }
    } catch (e) {
        console.error('加载配置文件失败:', e);
    }
    return null;
}

async function sendOrderNotification(newOrders, toPayOrders) {
    console.log('[DEBUG] 开始 sendOrderNotification');
    const config = loadConfig();
    if (!config || !config.email) {
        console.error('邮件配置缺失，无法发送通知');
        return;
    }
    console.log('[DEBUG] 邮件配置已获取，准备创建 transporter');

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || config.email.smtpHost,
        port: process.env.SMTP_PORT || config.email.smtpPort || 587,
        secure: process.env.SMTP_SECURE || config.email.smtpSecure || false,
        auth: {
            user: process.env.SMTP_USER || config.email.smtpUser,
            pass: process.env.SMTP_PASS || config.email.smtpPass,
        },
    });

    const htmlContent = generateOrderEmailHtml(newOrders, toPayOrders);
    const subjectPrefix = [];
    if (newOrders.length > 0) subjectPrefix.push(`${newOrders.length}个新订单`);
    if (toPayOrders.length > 0) subjectPrefix.push(`${toPayOrders.length}个待付款`);

    const mailOptions = {
        from: config.email.from,
        to: config.email.to,
        subject: `[订单提醒] ${subjectPrefix.join(', ')} - ${new Date().toLocaleString('zh-CN')}`,
        html: htmlContent
    };

    console.log(`[DEBUG] 准备发送邮件给: ${config.email.to}`);
    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('订单通知邮件已发送:', info.messageId);
    } catch (error) {
        console.error('发送订单通知邮件失败:', error);
    }
    console.log('[DEBUG] sendOrderNotification 结束');
}

function generateOrderEmailHtml(newOrders, toPayOrders) {
    let html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Segoe UI', sans-serif; color: #333; }
            .section { margin-bottom: 25px; border: 1px solid #e0e0e0; border-radius: 5px; overflow: hidden; }
            .header { padding: 10px 15px; background-color: #f5f5f5; border-bottom: 1px solid #e0e0e0; font-weight: bold; font-size: 16px; }
            .header.new { background-color: #e3f2fd; color: #1565c0; }
            .header.pay { background-color: #fff3e0; color: #e65100; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
            th { background-color: #fafafa; color: #666; }
            .amount { color: #d32f2f; font-weight: bold; }
            .items { font-size: 12px; color: #666; }
            .sku-tag { display: inline-block; background: #f0f0f0; padding: 2px 5px; border-radius: 3px; margin-right: 5px; }
        </style>
    </head>
    <body>
        <h2>订单更新通知</h2>
        <p>检测时间: ${new Date().toLocaleString('zh-CN')}</p>
    `;

    const renderTable = (orders, title, cssClass) => {
        if (!orders || orders.length === 0) return '';
        let section = `
        <div class="section">
            <div class="header ${cssClass}">${title} (${orders.length})</div>
            <table>
                <thead>
                    <tr>
                        <th>订单号</th>
                        <th>店铺</th>
                        <th>子状态</th>
                        <th>下单时间</th>
                        <th>金额</th>
                        <th>商品摘要</th>
                    </tr>
                </thead>
                <tbody>
        `;
        orders.forEach(order => {
            const itemsHtml = order.order_items.map(item => 
                `<div><span class="sku-tag">${item.xy_sku}</span> x${item.quantity}</div>`
            ).join('');
            
            section += `
                <tr>
                    <td>${order.global_order_no}</td>
                    <td>${order.shop_name}</td>
                    <td>${order.order_sub_status_desc || '-'}</td>
                    <td>${order.place_order_time}</td>
                    <td class="amount">¥${order.amount}</td>
                    <td class="items">${itemsHtml}</td>
                </tr>
            `;
        });
        section += `</tbody></table></div>`;
        return section;
    };

    html += renderTable(newOrders, '新订单 (已付款待审核)', 'new');
    html += renderTable(toPayOrders, '待付款订单', 'pay');

    html += `</body></html>`;
    return html;
}

async function checkNewOrderAndSendNotice(token) {
    try {
        // 获取前20条订单
        const orders = await getXizhiyueOrderList(token, 1, 20);
        
        const newOrders = orders.filter(order => order.order_status === OrderStatus.PAID_PENDING_AUDIT);
        const toPayOrders = orders.filter(order => order.order_status === OrderStatus.WAIT_PURCHASE);

        if (newOrders.length > 0 || toPayOrders.length > 0) {
            console.log(`[NOTICE] 发现新订单: ${newOrders.length}, 待付款: ${toPayOrders.length}。准备发送通知...`);
            
            // 打印 SKU 详情
            const logSkus = (orders, type) => {
                if (orders.length > 0) {
                    const skus = orders.flatMap(o => o.order_items.map(i => `${i.xy_sku} (x${i.quantity})`)).join(', ');
                    console.log(`[NOTICE] ${type} SKU详情: ${skus}`);
                }
            };
            logSkus(newOrders, '新订单');
            logSkus(toPayOrders, '待付款');

            await sendOrderNotification(newOrders, toPayOrders);
        } else {
            console.log('[NOTICE] 没有需要通知的订单');
        }
    } catch (error) {
        console.error('检查订单并发送通知失败:', error);
    }
}

// 检查单个 SKU 库存
async function checkSkuInventory(sku, countryCode, token) {
    console.log(`[CheckInventory] Checking SKU: ${sku}, Country: ${countryCode}`);
    
    try {
        // 使用 inventoryService 获取商品详情
        const invResult = await inventoryService.fetchInventoryFromAPI(sku, token);
        
        if (!invResult.success || !invResult.data) {
            return { success: false, message: `未找到 SKU ${sku} 的商品信息: ${invResult.reason || '未知错误'}` };
        }

        const productData = invResult.data;
        const deliveryRegions = productData.delivery_regions;

        if (!deliveryRegions) {
            return { success: false, message: `SKU ${sku} 没有配送区域信息` };
        }

        // 遍历 delivery_regions 寻找匹配 countryCode 的区域
        // delivery_regions 是一个对象，key 是 ID，value 是区域信息对象
        const regionValues = Object.values(deliveryRegions);
        const matchedRegion = regionValues.find(r => r.delivery_region_code === countryCode);

        if (matchedRegion) {
            console.log(`[CheckInventory] Found matching region for ${countryCode}:`, matchedRegion);
            return { 
                success: true, 
                data: {
                    price: matchedRegion.price_format || matchedRegion.price,
                    stock_status: matchedRegion.stock_text || matchedRegion.in_stock,
                    quantity: matchedRegion.qty || matchedRegion.quantity,
                    region_name: matchedRegion.delivery_region_name
                }
            };
        } else {
            return { success: false, message: `SKU ${sku} 不支持配送至国家代码: ${countryCode}` };
        }

    } catch (error) {
        console.error(`[CheckInventory] Error:`, error);
        return { success: false, message: `库存检查异常: ${error.message}` };
    }
}

// 保留旧的 Order 级别方法作为兼容或占位
async function checkOrderInventory(orderId) {
    return { success: false, message: "请使用新的 SKU 级别检查接口" };
}

// 审核通过
async function approveOrder(orderId, token) {
    console.log(`[ApproveOrder] Approving orderId: ${orderId}`);
    
    // URL based on placeholder or user input
    const url = `https://api.westmonth.com/erp/order/audit`;
    
    const body = {
        global_order_no_list: [orderId]
    };

    try {
        console.log(`[ApproveOrder] Request: ${JSON.stringify(body)}`);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const responseText = await response.text();
        console.log(`[ApproveOrder] Response: ${responseText}`);

        let result;
        try {
            result = JSON.parse(responseText);
        } catch (e) {
            return { success: false, message: `解析响应失败: ${responseText}` };
        }

        if (response.ok && result.code === 0) {
            return { success: true, message: '审核通过成功', data: result.data };
        } else {
            return { success: false, message: `审核失败: ${result.message || '未知错误'}` };
        }
    } catch (error) {
        console.error(`[ApproveOrder] Error:`, error);
        return { success: false, message: `请求异常: ${error.message}` };
    }
}

module.exports = {
    getXizhiyueOrderList,
    getPendingOrders,
    checkNewOrderAndSendNotice,
    checkOrderInventory,
    checkSkuInventory,
    approveOrder,
    applyTrackingNo
};

// 申请运单号
async function applyTrackingNo(orderId, token) {
    console.log(`[ApplyTrackingNo] Applying tracking number for orderId: ${orderId}`);
    
    // API URL 由用户配置
    const url = `https://api.westmonth.com/erp/order/apply-tacking-number`;
    
    // 请求体格式: 数组，包含订单信息对象
    const body = [
        {
            "global_order_no": orderId,
            "logistics_mode": 1,
            "retry": 0,
            "logistics_company_id": "",
            "provider_code": null,
            "shipping_allocate_type": null
        }
    ];

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const responseText = await response.text();
        console.log(`[ApplyTrackingNo] Response: ${responseText}`);

        let result;
        try {
            result = JSON.parse(responseText);
        } catch (e) {
            return { success: false, message: `解析响应失败: ${responseText}` };
        }

        if (response.ok && result.code === 0) {
            return { success: true, message: '申请成功', data: result.data };
        } else {
            return { success: false, message: `申请失败: ${result.message || '未知错误'}` };
        }
    } catch (error) {
        console.error(`[ApplyTrackingNo] Error:`, error);
        return { success: false, message: `请求异常: ${error.message}` };
    }
}

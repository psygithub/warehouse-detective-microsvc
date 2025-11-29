const { getStatusDesc, OrderStatus } = require('../orderStatus');
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const db = require('../db_sqlite');
const inventoryService = require('./inventoryService');

async function getXizhiyueOrderList(token, page = 1, pageSize = 20) {
    const url = `https://api.westmonth.com/erp/order/list`;
    const body = {
        page: page,
        size: pageSize
    };

    const response = await fetch(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });

    const responseText = await response.text();

    console.log(`[LOG] [order_list API] . RAW TEXT: ${responseText}`);
    if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
    }

    const responseData = JSON.parse(responseText);
    if (responseData.code !== 0) {
        throw new Error(`API Error: ${responseData.message || 'Unknown error'}`);
    }

    const orders = responseData.data && responseData.data.data ? responseData.data.data : [];
    
    const extractedOrders = orders.map(order => ({
        global_order_no: order.global_order_no,
        shop_name: order.shop_name,
        place_order_time: order.place_order_time,
        amount: order.amount,
        xy_country: order.xy_country,
        country:order.country_code_desc,
        order_status: order.order_status,
        order_status_desc: getStatusDesc(order.order_status),
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
        order.order_status === OrderStatus.NEED_PAY || 
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
        const toPayOrders = orders.filter(order => order.order_status === OrderStatus.NEED_PAY);

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

// TODO: 实现审核通过逻辑
async function approveOrder(orderId) {
    console.log(`[TODO] approveOrder called for orderId: ${orderId}`);
    return { 
        success: true, 
        message: `[TODO] 审核通过功能尚未实现 (Order: ${orderId})` 
    };
}

module.exports = {
    getXizhiyueOrderList,
    getPendingOrders,
    checkNewOrderAndSendNotice,
    checkOrderInventory,
    checkSkuInventory,
    approveOrder
};

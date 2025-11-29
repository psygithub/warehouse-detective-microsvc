const express = require('express');
const auth = require('../auth');
const orderService = require('../services/orderService');
const xizhiyueClient = require('../services/xizhiyueClient');
const router = express.Router();

router.get('/', auth.authenticateToken.bind(auth), async (req, res) => {
    console.log(`[API Entry] GET /api/orders`);
    try {
        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.limit) || 20;
        
        const authInfo = await xizhiyueClient.getAuthInfo();
        const orders = await orderService.getXizhiyueOrderList(
            authInfo.token, 
            page, 
            pageSize
        );
        
        res.json({
            items: orders,
            page: page,
            limit: pageSize
        });
    } catch (error) {
        console.error('获取订单列表失败:', error);
        res.status(500).json({ error: '获取订单列表失败: ' + error.message });
    }
});

// 获取待处理订单
router.get('/pending', auth.authenticateToken.bind(auth), async (req, res) => {
    console.log(`[API Entry] GET /api/orders/pending`);
    try {
        const authInfo = await xizhiyueClient.getAuthInfo();
        const pendingOrders = await orderService.getPendingOrders(authInfo.token);
        res.json({
            items: pendingOrders
        });
    } catch (error) {
        console.error('获取待处理订单失败:', error);
        res.status(500).json({ error: '获取待处理订单失败: ' + error.message });
    }
});

router.post('/check-and-notify', auth.authenticateToken.bind(auth), async (req, res) => {
    console.log(`[API Entry] POST /api/orders/check-and-notify`);
    try {
        const authInfo = await xizhiyueClient.getAuthInfo();
        // 异步执行，不等待结果，避免前端超时
        orderService.checkNewOrderAndSendNotice(authInfo.token).catch(err => {
            console.error('后台检查订单通知失败:', err);
        });
        res.json({ message: '订单检查任务已触发，如有新订单将发送通知。' });
    } catch (error) {
        console.error('触发订单检查失败:', error);
        res.status(500).json({ error: '触发订单检查失败: ' + error.message });
    }
});

// 查库存
router.post('/:id/check-inventory', auth.authenticateToken.bind(auth), async (req, res) => {
    try {
        const orderId = req.params.id;
        const result = await orderService.checkOrderInventory(orderId);
        res.json(result);
    } catch (error) {
        console.error('查库存失败:', error);
        res.status(500).json({ error: '查库存失败: ' + error.message });
    }
});

// SKU级别查库存
router.post('/inventory/check-sku', auth.authenticateToken.bind(auth), async (req, res) => {
    try {
        const { sku, country } = req.body;
        if (!sku || !country) {
            return res.status(400).json({ error: '缺少必要参数: sku, country' });
        }
        
        const authInfo = await xizhiyueClient.getAuthInfo();
        const result = await orderService.checkSkuInventory(sku, country, authInfo.token);
        res.json(result);
    } catch (error) {
        console.error('SKU查库存失败:', error);
        res.status(500).json({ error: 'SKU查库存失败: ' + error.message });
    }
});

// 审核通过
router.post('/:id/approve', auth.authenticateToken.bind(auth), async (req, res) => {
    try {
        const orderId = req.params.id;
        const result = await orderService.approveOrder(orderId);
        res.json(result);
    } catch (error) {
        console.error('审核失败:', error);
        res.status(500).json({ error: '审核失败: ' + error.message });
    }
});

// 申请运单号
router.post('/:id/apply-tracking', auth.authenticateToken.bind(auth), async (req, res) => {
    try {
        const orderId = req.params.id;
        const authInfo = await xizhiyueClient.getAuthInfo();
        const result = await orderService.applyTrackingNo(orderId, authInfo.token);
        res.json(result);
    } catch (error) {
        console.error('申请运单号失败:', error);
        res.status(500).json({ error: '申请运单号失败: ' + error.message });
    }
});

module.exports = router;

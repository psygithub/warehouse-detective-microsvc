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

module.exports = router;

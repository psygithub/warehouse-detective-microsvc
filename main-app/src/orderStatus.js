/**
 * 订单状态管理模块
 * 
 * ================= 调用说明 =================
 * const { getStatusDesc, OrderStatus, statusMap } = require('./orderStatus');
 * 
 * // 使用常量判断状态 (推荐):
 * if (order.status === OrderStatus.PAID_PENDING_AUDIT) { ... }
 * 
 * // 获取状态描述:
 * const desc = getStatusDesc(100); // "已付款待审核"
 * ===========================================
 */

// 状态常量定义
const OrderStatus = {
    // --- 主状态 ---
    NEED_PAY: 900,            // 待付款
    PAID_PENDING_AUDIT: 100,  // 已付款待审核
    WAIT_PURCHASE: 200,       // 待采购
    PURCHASED: 1000,          // 已采购
    WAIT_PAYMENT: 1100,       // 待支付
    WAIT_SHIP: 300,           // 待发货
    SHIPPING: 1200,           // 发货中
    SHIPPED: 400,             // 已发货
    COLLECTED: 1300,          // 已揽收
    IN_TRANSIT: 1400,         // 运输中
    DELIVERING: 1500,         // 派送中
    SIGNED: 1600,             // 已签收
    REJECTED: 1700,           // 拒收
    VOID: 500,                // 已作废
    CANCELLED: 600,           // 已取消
    NO_NEED_SHIP: 700,        // 无需发货

    // --- 子状态 ---
    SKU_UNMATCHED: 101,       // sku未配对
    SKU_MATCHED: 102,         // sku已配对
    NO_TRACKING_NO: 301,      // 未申请运单号
    APPLYING_TRACKING_NO: 302,// 运单号申请中
    APPLY_TRACKING_NO_FAILED: 304, // 运单号申请失败
    WAIT_SUBMIT_PURCHASE: 201,// 待提交采购
    PURCHASE_FAILED: 203,     // 采购失败
    SHIP_FAILED: 401,         // 发货失败
    SHIP_SUCCESS: 402         // 发货成功
};

// 状态映射表 (使用常量构建以保持一致性)
const statusMap = {
    [OrderStatus.NEED_PAY]: '待付款',
    [OrderStatus.PAID_PENDING_AUDIT]: '已付款待审核',
    [OrderStatus.WAIT_PURCHASE]: '待采购',
    [OrderStatus.PURCHASED]: '已采购',
    [OrderStatus.WAIT_PAYMENT]: '待支付',
    [OrderStatus.WAIT_SHIP]: '待发货',
    [OrderStatus.SHIPPING]: '发货中',
    [OrderStatus.SHIPPED]: '已发货',
    [OrderStatus.COLLECTED]: '已揽收',
    [OrderStatus.IN_TRANSIT]: '运输中',
    [OrderStatus.DELIVERING]: '派送中',
    [OrderStatus.SIGNED]: '已签收',
    [OrderStatus.REJECTED]: '拒收',
    [OrderStatus.VOID]: '已作废',
    [OrderStatus.CANCELLED]: '已取消',
    [OrderStatus.NO_NEED_SHIP]: '无需发货',

    // 子状态
    [OrderStatus.SKU_UNMATCHED]: 'sku未配对',
    [OrderStatus.SKU_MATCHED]: 'sku已配对',
    [OrderStatus.NO_TRACKING_NO]: '未申请运单号',
    [OrderStatus.APPLYING_TRACKING_NO]: '运单号申请中',
    [OrderStatus.APPLY_TRACKING_NO_FAILED]: '运单号申请失败',
    [OrderStatus.WAIT_SUBMIT_PURCHASE]: '待提交采购',
    [OrderStatus.PURCHASE_FAILED]: '采购失败',
    [OrderStatus.SHIP_FAILED]: '发货失败',
    [OrderStatus.SHIP_SUCCESS]: '发货成功'
};

/**
 * 根据状态码获取中文描述
 * @param {number|string} code 状态码
 * @returns {string} 中文描述，如果未找到则返回 '未知状态'
 */
function getStatusDesc(code) {
    if (code === null || code === undefined) return '';
    return statusMap[Number(code)] || '未知状态';
}

module.exports = {
    OrderStatus,
    statusMap,
    getStatusDesc
};

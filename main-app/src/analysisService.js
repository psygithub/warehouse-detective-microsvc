const db = require('./db_sqlite');

async function runInventoryAnalysis(trackedSkuId = null) {
    let newAlertsCount = 0;
    const configs = db.getSystemConfigs();
    const timespan = parseInt(configs.alert_timespan || '7', 10);
    
    // Load all config values for grading
    const minConsumption = parseFloat(configs.alert_min_daily_consumption || '5');
    const maxConsumption = parseFloat(configs.alert_max_daily_consumption || '20');
    const baseThreshold = parseFloat(configs.alert_threshold || '0.03');
    const mediumMultiplier = parseFloat(configs.alert_medium_threshold_multiplier || '1.5');
    const mediumThreshold = baseThreshold * mediumMultiplier;

    let skusToAnalyze;
    if (trackedSkuId) {
        console.log(`开始为单个SKU (ID: ${trackedSkuId}) 执行库存消耗分析...`);
        const singleSku = db.getTrackedSkuById(trackedSkuId);
        skusToAnalyze = singleSku ? [singleSku] : [];
    } else {
        console.log('开始为所有SKU执行库存消耗分析...');
        skusToAnalyze = db.getTrackedSkus();
    }

    for (const sku of skusToAnalyze) {
        const history = db.getRegionalInventoryHistoryForSku(sku.id, timespan);
        
        // 按区域分组
        const historyByRegion = history.reduce((acc, record) => {
            if (!acc[record.region_id]) {
                acc[record.region_id] = [];
            }
            acc[record.region_id].push(record);
            return acc;
        }, {});

        for (const regionId in historyByRegion) {
            const regionHistory = historyByRegion[regionId];
            if (regionHistory.length < 2) continue;

            // 简单线性回归分析消耗速度
            const firstRecord = regionHistory[0];
            const lastRecord = regionHistory[regionHistory.length - 1];
            
            const qtyChange = firstRecord.qty - lastRecord.qty;
            const days = (new Date(lastRecord.record_date) - new Date(firstRecord.record_date)) / (1000 * 60 * 60 * 24);

            if (days > 0 && qtyChange > 0) {
                const consumptionRate = (qtyChange / firstRecord.qty) / days;
                const dailyConsumption = qtyChange / days;
                
                let alertLevel = 0;

                if (dailyConsumption > maxConsumption) {
                    alertLevel = 3; // High Severity: Consumption volume is the only factor
                } else if (dailyConsumption >= minConsumption) {
                    if (consumptionRate > mediumThreshold) {
                        alertLevel = 2; // Medium Severity
                    } else if (consumptionRate > baseThreshold) {
                        alertLevel = 1; // Low Severity
                    }
                }

                if (alertLevel > 0) {
                    const alertDetails = {
                        timespan,
                        consumptionRate,
                        dailyConsumption,
                        qtyChange,
                        days,
                        start_qty: firstRecord.qty,
                        end_qty: lastRecord.qty,
                    };
                    db.createAlert({
                        tracked_sku_id: sku.id,
                        sku: sku.sku,
                        region_id: regionId,
                        region_name: firstRecord.region_name,
                        alert_type: 'FAST_CONSUMPTION',
                        alert_level: alertLevel,
                        details: JSON.stringify(alertDetails),
                    });
                    newAlertsCount++;
                    console.log(`预警 (等级 ${alertLevel}): SKU ${sku.sku} 在 ${firstRecord.region_name} 消耗过快! 日均消耗率: ${consumptionRate.toFixed(3)}, 日均消耗量: ${dailyConsumption.toFixed(2)}`);
                }
            }
        }
    }
    console.log('库存消耗分析完成。');
    return { newAlertsCount };
}

module.exports = {
    runInventoryAnalysis,
};

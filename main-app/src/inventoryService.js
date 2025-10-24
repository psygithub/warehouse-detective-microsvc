const db = require('./db_sqlite');
const fetch = require('node-fetch'); // 使用 node-fetch

const API_URL = 'https://westmonth.com/shop_api/products/load_list?sort_mode=2&page=1&indistinct=';

function formatProductData(apiData) {
    if (!apiData) return null;
    const delivery_regions = Object.values(apiData.delivery_regions || {}).flat();
    return {
        product_sku_id: apiData.product_sku_id,
        product_id: apiData.product_id,
        product_sku: apiData.product_sku,
        product_name: apiData.product_name,
        qty: parseInt(apiData.qty, 10) || 0,
        month_sale: parseInt(apiData.month_sale, 10) || 0,
        product_sales: parseInt(apiData.product_sales, 10) || 0,
        delivery_regions,
        product_image: apiData.product_image,
        raw_data: apiData,
    };
}

async function fetchInventoryFromAPI(sku, token) {
    try {
        const url = `${API_URL}${sku}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome',
                'Accept': 'application/json, text/plain, */*',
            },
        });
        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        const responseData = await response.json();
        if (responseData && responseData.status === 'success' && responseData.data.data.length > 0) {
            return formatProductData(responseData.data.data[0]);
        }
        console.warn(`API call for SKU ${sku} did not return valid data.`);
        return null;
    } catch (error) {
        console.error(`Error fetching inventory for SKU ${sku}:`, error.message);
        return null;
    }
}

async function fetchAndSaveAllTrackedSkus(token) {
    const skusToTrack = db.getTrackedSkus();
    const results = { success: [], failed: [] };
    for (const trackedSku of skusToTrack) {
        const productData = await fetchInventoryFromAPI(trackedSku.sku, token);
        if (productData) {
            const recordDate = new Date().toISOString().split('T')[0];
            
            // 保存到旧表 (可选，如果仍需保留)
            const summaryRecord = {
                tracked_sku_id: trackedSku.id,
                sku: trackedSku.sku,
                record_date: recordDate,
                qty: productData.qty,
                month_sale: productData.month_sale,
                product_sales: productData.product_sales,
                delivery_regions: productData.delivery_regions,
                product_image: productData.product_image,
                raw_data: productData.raw_data,
            };
            db.saveInventoryRecord(summaryRecord);

            // 保存到新的区域历史表
            if (productData.delivery_regions && Array.isArray(productData.delivery_regions)) {
                for (const regionData of productData.delivery_regions) {
                    const regionalRecord = {
                        tracked_sku_id: trackedSku.id,
                        sku: trackedSku.sku,
                        product_sku_id: productData.product_sku_id,
                        product_id: productData.product_id,
                        record_date: recordDate,
                        region_id: regionData.delivery_region_id,
                        region_name: regionData.delivery_region_name,
                        region_code: regionData.delivery_region_code,
                        qty: parseInt(regionData.qty, 10) || 0,
                        price: regionData.product_price,
                    };
                    db.saveRegionalInventoryRecord(regionalRecord);
                }
            }
            
            results.success.push({ sku: trackedSku.sku, name: productData.product_name, qty: productData.qty });
        } else {
            results.failed.push(trackedSku.sku);
        }
    }
    return results;
}

async function addOrUpdateTrackedSku(sku, token) {
    const productData = await fetchInventoryFromAPI(sku, token);
    if (productData) {
        const skuData = {
            sku: sku,
            product_name: productData.product_name,
            product_id: productData.product_id,
            product_sku_id: productData.product_sku_id,
            product_image: productData.product_image,
        };
        
        // 添加或更新 tracked_sku 并获取其完整对象（包括ID）
        const trackedSku = db.addTrackedSku(skuData);
        if (!trackedSku) {
            // 如果添加失败，可能意味着数据库操作出错了
            console.error(`Failed to add or update tracked SKU for ${sku}`);
            return null;
        }

        // 为新添加的 SKU 创建初始库存记录
        const recordDate = new Date().toISOString().split('T')[0];
        
        // 1. 保存主库存记录
        const summaryRecord = {
            tracked_sku_id: trackedSku.id,
            sku: trackedSku.sku,
            record_date: recordDate,
            qty: productData.qty,
            month_sale: productData.month_sale,
            product_sales: productData.product_sales,
            delivery_regions: productData.delivery_regions,
            product_image: productData.product_image,
            raw_data: productData.raw_data,
        };
        db.saveInventoryRecord(summaryRecord);

        // 2. 保存各区域的库存记录
        if (productData.delivery_regions && Array.isArray(productData.delivery_regions)) {
            for (const regionData of productData.delivery_regions) {
                const regionalRecord = {
                    tracked_sku_id: trackedSku.id,
                    sku: trackedSku.sku,
                    product_sku_id: productData.product_sku_id,
                    product_id: productData.product_id,
                    record_date: recordDate,
                    region_id: regionData.delivery_region_id,
                    region_name: regionData.delivery_region_name,
                    region_code: regionData.delivery_region_code,
                    qty: parseInt(regionData.qty, 10) || 0,
                    price: regionData.product_price,
                };
                db.saveRegionalInventoryRecord(regionalRecord);
            }
        }
        
        return trackedSku;
    }
    return null;
}

function getInventoryHistoryBySku(skuId) {
    const skuDetails = db.getTrackedSkus().find(s => s.id == skuId);
    if (!skuDetails) {
        return null;
    }
    const history = db.getInventoryHistory(skuId);
    return {
        sku: skuDetails.sku,
        product_name: skuDetails.product_name,
        product_image: skuDetails.product_image,
        history: history,
    };
}

async function fetchSingleSkuById(skuId, token) {
    const sku = db.getTrackedSkuById(skuId);
    if (!sku) {
        throw new Error(`SKU with ID ${skuId} not found.`);
    }
    const productData = await fetchInventoryFromAPI(sku.sku, token);
    if (productData) {
        const recordDate = new Date().toISOString().split('T')[0];
        if (productData.delivery_regions && Array.isArray(productData.delivery_regions)) {
            for (const regionData of productData.delivery_regions) {
                const regionalRecord = {
                    tracked_sku_id: sku.id,
                    sku: sku.sku,
                    product_sku_id: productData.product_sku_id,
                    product_id: productData.product_id,
                    record_date: recordDate,
                    region_id: regionData.delivery_region_id,
                    region_name: regionData.delivery_region_name,
                    region_code: regionData.delivery_region_code,
                    qty: parseInt(regionData.qty, 10) || 0,
                    price: regionData.product_price,
                };
                db.saveRegionalInventoryRecord(regionalRecord);
            }
        }
        // Update the latest quantity and record time in the main tracked_skus table
        db.updateTrackedSku(sku.id, { 
            latest_qty: productData.qty, 
            latest_record_time: new Date().toISOString() 
        });
        return { sku: sku.sku, qty: productData.qty };
    }
    return null;
}

module.exports = {
    fetchInventoryFromAPI,
    fetchAndSaveAllTrackedSkus,
    addOrUpdateTrackedSku,
    getInventoryHistoryBySku,
    fetchSingleSkuById,
};

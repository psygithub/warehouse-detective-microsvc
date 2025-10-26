const db = require('./db_sqlite');
const fetch = require('node-fetch'); // 使用 node-fetch

const API_URL = 'https://westmonth.com/shop_api/products/load_list?sort_mode=2&page=1&indistinct=';

function formatProductData(apiData) {
    if (!apiData) return null;
    return {
        product_sku_id: apiData.product_sku_id,
        product_id: apiData.product_id,
        product_sku: apiData.product_sku,
        product_name: apiData.product_name,
        qty: parseInt(apiData.qty, 10) || 0,
        month_sale: parseInt(apiData.month_sale, 10) || 0,
        product_sales: parseInt(apiData.product_sales, 10) || 0,
        delivery_regions: apiData.delivery_regions,
        product_image: apiData.product_image,
        raw_data: apiData,
    };
}

async function fetchInventoryFromAPI(sku, token) {
    const url = `${API_URL}${sku}`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome',
        'Accept': 'application/json, text/plain, */*',
    };

    console.log(`[LOG] Starting to fetch inventory for SKU: ${sku}`);
    console.log(`[LOG] Request URL: ${url}`);
    console.log('[LOG] Request Headers:', headers);

    try {
        const response = await fetch(url, { headers });
        
        const responseText = await response.text();
        console.log(`[LOG] Full API response for SKU ${sku}:`, responseText);

        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const responseData = JSON.parse(responseText);
        if (responseData && responseData.status === 'success' && responseData.data.data.length > 0) {
            const productData = responseData.data.data[0];
            console.log(`[LOG] Successfully fetched inventory for SKU: ${sku}. Product Name: ${productData.product_name}, Quantity: ${productData.qty}`);
            return formatProductData(productData);
        }
        
        console.warn(`[LOG] API call for SKU ${sku} did not return valid data.`);
        return null;
    } catch (error) {
        console.error(`[LOG] Error fetching inventory for SKU ${sku}:`, error.message);
        return null;
    }
}

// 新增的私有函数，用于处理区域库存记录的保存
async function _saveRegionalInventoryRecords(trackedSku, productData, recordDate) {
    let deliveryRegions = productData.delivery_regions;
    if (typeof deliveryRegions === 'string') {
        try {
            deliveryRegions = JSON.parse(deliveryRegions);
        } catch (e) {
            console.error(`Error parsing delivery_regions for SKU ${trackedSku.sku}:`, e);
            deliveryRegions = null;
        }
    }

    if (deliveryRegions && typeof deliveryRegions === 'object') {
        const regions = Object.values(deliveryRegions).flat();
        if (regions.length > 0) {
            for (const regionData of regions) {
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
                // console.log(`[LOG] Saving regional record for SKU ${trackedSku.sku}:`, regionalRecord);
                db.saveRegionalInventoryRecord(regionalRecord);
            }
        }
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

            // 调用新的私有函数来保存区域数据
            await _saveRegionalInventoryRecords(trackedSku, productData, recordDate);
            
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

        // 调用新的私有函数来保存区域数据
        await _saveRegionalInventoryRecords(trackedSku, productData, recordDate);
        
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
        
        // 调用新的私有函数来保存区域数据
        await _saveRegionalInventoryRecords(sku, productData, recordDate);

        return { sku: sku.sku, qty: productData.qty };
    }
    return null;
}

async function addOrUpdateTrackedSkusInBatch(skus, token) {
    const existingSkus = new Set(db.getTrackedSkus().map(s => s.sku));
    const newSkus = skus.filter(s => !existingSkus.has(s));

    if (newSkus.length === 0) {
        return { newSkusCount: 0, failedSkus: [] };
    }

    const promises = newSkus.map(sku => fetchInventoryFromAPI(sku, token));
    const results = await Promise.all(promises);

    const successfulFetches = results.filter(Boolean);
    const failedSkus = skus.filter((sku, index) => !results[index]);

    if (successfulFetches.length > 0) {
        const skusToAdd = successfulFetches.map(productData => ({
            sku: productData.product_sku,
            product_name: productData.product_name,
            product_id: productData.product_id,
            product_sku_id: productData.product_sku_id,
            product_image: productData.product_image,
        }));
        db.addTrackedSkusBulk(skusToAdd);

        const recordDate = new Date().toISOString().split('T')[0];
        for (const productData of successfulFetches) {
            // 注意：这里需要重新从数据库获取一次，以确保我们有 tracked_sku 的 id
            const trackedSku = db.getTrackedSkuBySku(productData.product_sku);
            if (trackedSku) {
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
                await _saveRegionalInventoryRecords(trackedSku, productData, recordDate);
            }
        }
    }

    return { newSkusCount: successfulFetches.length, failedSkus };
}

module.exports = {
    fetchInventoryFromAPI,
    fetchAndSaveAllTrackedSkus,
    addOrUpdateTrackedSku,
    getInventoryHistoryBySku,
    fetchSingleSkuById,
    addOrUpdateTrackedSkusInBatch,
};

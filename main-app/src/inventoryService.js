const db = require('./db_sqlite');
const fetch = require('node-fetch'); // 使用 node-fetch

// 辅助函数：生成符合数据库格式的本地日期 (YYYY-MM-DD)
function getLocalDateForDb() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const LIST_API_URL = 'https://westmonth.com/shop_api/products/load_list?sort_mode=2&page=1&sku=';
const DETAILS_API_URL = 'https://westmonth.com/shop_api/products/detail?product_id=';

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

async function fetchInventoryFromListAPI(sku, token) {
    const url = `${LIST_API_URL}${sku}`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome',
        'Accept': 'application/json, text/plain, */*',
    };

    console.log(`[LOG] [List API] Starting to fetch inventory for SKU: ${sku}`);
    console.log(`[LOG] [List API] Request URL: ${url}`);

    try {
        const response = await fetch(url, { headers });
        const responseText = await response.text();
        console.log(`[LOG] [List API] Full API response for SKU ${sku}:`, responseText);

        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const responseData = JSON.parse(responseText);
        if (responseData && responseData.status === 'success' && responseData.data.data.length > 0) {
            const productData = responseData.data.data[0];
            console.log(`[LOG] [List API] Successfully fetched inventory for SKU: ${sku}.`);
            return { success: true, data: formatProductData(productData) };
        }
        
        const reason = responseData.data.data.length === 0 ? 'API未返回产品信息' : 'API响应格式不正确';
        console.warn(`[LOG] [List API] Call for SKU ${sku} did not return valid data. Reason: ${reason}`);
        return { success: false, sku: sku, reason: reason };
    } catch (error) {
        console.error(`[LOG] [List API] Error fetching inventory for SKU ${sku}:`, error.message);
        return { success: false, sku: sku, reason: error.message };
    }
}

async function fetchInventoryFromDetailsAPI(productId, sku, token) {
    const url = `${DETAILS_API_URL}${productId}`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome',
        'Accept': 'application/json, text/plain, */*',
    };

    console.log(`[LOG] [Details API] Starting to fetch inventory for SKU: ${sku} (Product ID: ${productId})`);
    console.log(`[LOG] [Details API] Request URL: ${url}`);

    try {
        const response = await fetch(url, { headers });
        const responseText = await response.text();

        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const responseData = JSON.parse(responseText);
        if (responseData && responseData.status === 'success' && responseData.data) {
            const productDetails = responseData.data;
            const skuDetails = productDetails.skus.find(s => s.sku === sku);

            if (skuDetails) {
                // 映射数据结构以匹配 formatProductData 的期望
                const mappedData = {
                    product_sku_id: skuDetails.id,
                    product_id: productDetails.id,
                    product_sku: skuDetails.sku,
                    product_name: productDetails.name,
                    qty: skuDetails.quantity, // 使用 quantity 字段
                    month_sale: parseInt(productDetails.month_sale, 10) || 0, // 从主产品信息中获取
                    product_sales: 0, // 详情API中没有此字段
                    delivery_regions: skuDetails.delivery_regions,
                    product_image: skuDetails.images.length > 0 ? skuDetails.images[0].thumb : null,
                    raw_data: skuDetails, // 保存原始的SKU详情
                };
                console.log(`[LOG] [Details API] Successfully fetched inventory for SKU: ${sku}.`);
                return { success: true, data: formatProductData(mappedData) };
            }
        }
        
        const reason = '详情API未返回匹配的SKU信息';
        console.warn(`[LOG] [Details API] Call for SKU ${sku} did not return valid data. Reason: ${reason}`);
        return { success: false, sku: sku, reason: reason };
    } catch (error) {
        console.error(`[LOG] [Details API] Error fetching inventory for SKU ${sku}:`, error.message);
        return { success: false, sku: sku, reason: error.message };
    }
}

async function fetchInventoryFromAPI(sku, token) {
    const trackedSku = db.getTrackedSkuBySku(sku);

    if (trackedSku && trackedSku.product_id) {
        // 如果SKU已存在且有product_id，调用详情API
        return await fetchInventoryFromDetailsAPI(trackedSku.product_id, sku, token);
    } else {
        // 否则，调用列表API
        return await fetchInventoryFromListAPI(sku, token);
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
                db.saveRegionalInventoryRecord(regionalRecord);
            }
        }
    }
}

// 统一的核心函数，用于获取并保存单个已跟踪SKU的库存数据
async function _fetchAndSaveInventoryForTrackedSku(trackedSku, token) {
    const result = await fetchInventoryFromAPI(trackedSku.sku, token);
    if (result.success) {
        const productData = result.data;
        const recordDate = getLocalDateForDb();

        // 保存主库存记录
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

        // 保存区域库存记录
        await _saveRegionalInventoryRecords(trackedSku, productData, recordDate);
        
        return { success: true, sku: trackedSku.sku, name: productData.product_name, qty: productData.qty };
    } else {
        return { success: false, sku: trackedSku.sku, reason: result.reason };
    }
}

async function fetchAndSaveAllTrackedSkus(token) {
    const skusToTrack = db.getTrackedSkus();
    const promises = skusToTrack.map(trackedSku => _fetchAndSaveInventoryForTrackedSku(trackedSku, token));
    const allResults = await Promise.all(promises);

    const results = {
        success: allResults.filter(r => r.success),
        failed: allResults.filter(r => !r.success).map(r => r.sku),
    };
    return results;
}

async function addOrUpdateTrackedSku(sku, token) {
    const result = await fetchInventoryFromAPI(sku, token);
    if (result.success) {
        const productData = result.data;
        const skuData = {
            sku: sku,
            product_name: productData.product_name,
            product_id: productData.product_id,
            product_sku_id: productData.product_sku_id,
            product_image: productData.product_image,
        };
        
        const trackedSku = db.addTrackedSku(skuData);
        if (!trackedSku) {
            console.error(`Failed to add or update tracked SKU for ${sku}`);
            return { success: false, sku: sku, reason: '数据库操作失败' };
        }

        const recordDate = getLocalDateForDb();
        
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
        
        return { success: true, data: trackedSku };
    }
    return result;
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
    // 完全委托给新的核心函数
    return await _fetchAndSaveInventoryForTrackedSku(sku, token);
}

async function addOrUpdateTrackedSkusInBatch(skus, token) {
    const existingSkus = new Set(db.getTrackedSkus().map(s => s.sku));
    const newSkus = skus.filter(s => !existingSkus.has(s));

    if (newSkus.length === 0) {
        return { newSkusCount: 0, failedSkus: [] };
    }

    const promises = newSkus.map(sku => fetchInventoryFromAPI(sku, token));
    const results = await Promise.all(promises);

    const successfulFetches = results.filter(r => r.success).map(r => r.data);
    const failedSkus = results.filter(r => !r.success);

    if (successfulFetches.length > 0) {
        const skusToAdd = successfulFetches.map(productData => ({
            sku: productData.product_sku,
            product_name: productData.product_name,
            product_id: productData.product_id,
            product_sku_id: productData.product_sku_id,
            product_image: productData.product_image,
        }));
        db.addTrackedSkusBulk(skusToAdd);

        const recordDate = getLocalDateForDb();
        for (const productData of successfulFetches) {
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

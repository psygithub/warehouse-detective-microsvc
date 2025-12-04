const db = require('../db_sqlite');
const fetch = require('node-fetch'); // 使用 node-fetch
const TIME_OUT=30*1000; // 30秒超时
const BATCH_SIZE = 10; //并发限制

// 辅助函数：并发控制
async function processInBatches(items, batchSize, processFn) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(processFn));
        results.push(...batchResults);
    }
    return results;
}

// 辅助函数：生成符合数据库格式的本地日期 (YYYY-MM-DD)
function getLocalDateForDb() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
const LIST_API_URLS = [
    'https://westmonth.com/shop_api/products/load_list?indistinct=',
    'https://api-x.westmonth.com/product-center/shop/products/load-list?indistinct='
];
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
    const headers = {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 1.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome',
        'Accept': 'application/json, text/plain, */*',
    };

    console.log(`[LOG] [List API] Starting fetch. SKU: ${sku}`);
    const encodedSku = encodeURIComponent(sku);

    for (let i = 0; i < LIST_API_URLS.length; i++) {
        const baseUrl = LIST_API_URLS[i];
        const url = `${baseUrl}${encodedSku}`;
        console.log(`[LOG] [List API] Attempt #${i + 1}: Requesting URL: ${url}`);
        console.log(`[LOG] [List API] Request headers:`, headers);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), TIME_OUT);
            const response = await fetch(url, { headers, signal: controller.signal });
            clearTimeout(timeoutId);

            console.log(`---------------------------------1---------------------------------------`);
            console.log(`---------------------------------1---------------------------------------`);
            console.log(`---------------------------------1---------------------------------------`);
            const responseText = await response.text();
            console.log(`[LOG] [List API] Attempt #${i + 1} responseText for SKU ${sku}:`, responseText);
            if (!response.ok) {
                console.warn(`[LOG] [List API] Attempt #${i + 1} failed with status ${response.status}.`);
                continue; // Try next URL
            }

            console.log(`---------------------------------2---------------------------------------`);
            console.log(`---------------------------------2---------------------------------------`);
            console.log(`---------------------------------2---------------------------------------`);
            const responseData = JSON.parse(responseText);
            console.log(`[LOG] [List API] Attempt #${i + 1} Parsed response data for SKU ${sku}:`, responseData);
            if (responseData && responseData.status === 'success' && Array.isArray(responseData.data.data)) {
                const productData = responseData.data.data.find(item => item.product_sku === sku);

                if (productData) {
                    console.log(`[LOG] [List API] Attempt #${i + 1} SUCCEEDED. Found matching SKU: ${sku}.`);
                    const formattedData = formatProductData(productData);
                    console.log(`[LOG] [List API] Returning formatted data for SKU ${sku}:`, formattedData);
                    return { success: true, data: formattedData };
                } else {
                    console.warn(`[LOG] [List API] Attempt #${i + 1} did not find matching SKU in list. Requested: ${sku}.`);
                }
            } else {
                console.log(`[LOG] [List API] Attempt #${i + 1} did not return valid product data list.`);
            }
        } catch (error) {
            console.error(`[LOG] [List API] Attempt #${i + 1} threw an error:`, error.message);
        }
    }

    const finalReason = `All ${LIST_API_URLS.length} API attempts failed to find a matching SKU.`;
    console.error(`[LOG] [List API] ${finalReason}`);
    return { success: false, sku: sku, reason: finalReason };
}

async function fetchInventoryFromDetailsAPI(productId, sku, token) {
    const url = `${DETAILS_API_URL}${productId}`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome',
        'Accept': 'application/json, text/plain, */*',
    };

    console.log(`[LOG] [Details API] Starting fetch. Product ID: ${productId}, SKU: ${sku}`);
    console.log(`[LOG] [Details API] Request URL: ${url}`);
    console.log(`[LOG] [Details API] Request headers:`, headers);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIME_OUT);
        const response = await fetch(url, { headers, signal: controller.signal });
        clearTimeout(timeoutId);

        console.log(`---------------------------------1---------------------------------------`);
        console.log(`---------------------------------1---------------------------------------`);
        console.log(`---------------------------------1---------------------------------------`);
        const responseText = await response.text();
        console.log(`[LOG] [Details API] responseText  for SKU ${sku}:`, responseText);
        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        console.log(`---------------------------------2---------------------------------------`);
        console.log(`---------------------------------2---------------------------------------`);
        console.log(`---------------------------------2---------------------------------------`);
        const responseData = JSON.parse(responseText);
        console.log(`[LOG] [Details API] Parsed response data for SKU ${sku}:`, responseData);
        if (responseData && responseData.status === 'success' && responseData.data) {
            const productDetails = responseData.data;
            const skuDetails = productDetails.skus.find(s => s.sku === sku);

            if (skuDetails) {
                const mappedData = {
                    product_sku_id: skuDetails.id,
                    product_id: productDetails.id,
                    product_sku: skuDetails.sku,
                    product_name: productDetails.name,
                    qty: skuDetails.quantity,
                    month_sale: parseInt(productDetails.month_sale, 10) || 0,
                    product_sales: 0,
                    delivery_regions: skuDetails.delivery_regions,
                    product_image: skuDetails.images.length > 0 ? skuDetails.images[0].thumb : null,
                    raw_data: skuDetails,
                };
                console.log(`[LOG] [Details API] Successfully mapped data for SKU: ${sku}.`);
                const formattedData = formatProductData(mappedData);
                console.log(`[LOG] [Details API] Returning formatted data for SKU ${sku}:`, formattedData);
                return { success: true, data: formattedData };
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
        return await fetchInventoryFromDetailsAPI(trackedSku.product_id, sku, token);
    } else {
        return await fetchInventoryFromListAPI(sku, token);
    }
}

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

async function _fetchAndSaveInventoryForTrackedSku(trackedSku, token) {
    const result = await fetchInventoryFromAPI(trackedSku.sku, token);
    if (result.success) {
        const productData = result.data;
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
        
        return { success: true, sku: trackedSku.sku, name: productData.product_name, qty: productData.qty };
    } else {
        return { success: false, sku: trackedSku.sku, reason: result.reason };
    }
}

async function fetchAndSaveAllTrackedSkus(token) {
    const skusToTrack = db.getTrackedSkus();
    // 使用并发控制
    const allResults = await processInBatches(skusToTrack, BATCH_SIZE, trackedSku => _fetchAndSaveInventoryForTrackedSku(trackedSku, token));

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
    return await _fetchAndSaveInventoryForTrackedSku(sku, token);
}

async function addOrUpdateTrackedSkusInBatch(skus, token) {
    console.log(`[LOG] [Batch Add] Starting batch add for ${skus.length} SKUs:`, skus);
    const existingSkus = new Set(db.getTrackedSkus().map(s => s.sku));
    const newSkus = skus.filter(s => !existingSkus.has(s));

    console.log(`[LOG] [Batch Add] Found ${newSkus.length} new SKUs to process:`, newSkus);

    if (newSkus.length === 0) {
        console.log('[LOG] [Batch Add] No new SKUs to add. Exiting.');
        return { newSkusCount: 0, failedSkus: [] };
    }

    // 使用并发控制
    const results = await processInBatches(newSkus, BATCH_SIZE, sku => fetchInventoryFromAPI(sku, token));

    const successfulFetches = results.filter(r => r.success).map(r => r.data);
    const failedSkus = results.filter(r => !r.success);

    console.log(`[LOG] [Batch Add] API fetch results: ${successfulFetches.length} successful, ${failedSkus.length} failed.`);
    if (failedSkus.length > 0) {
        console.log('[LOG] [Batch Add] Failed SKUs:', failedSkus);
    }

    if (successfulFetches.length > 0) {
        const skusToAdd = successfulFetches.map(productData => ({
            sku: productData.product_sku,
            product_name: productData.product_name,
            product_id: productData.product_id,
            product_sku_id: productData.product_sku_id,
            product_image: productData.product_image,
        }));
        console.log(`[LOG] [Batch Add] Bulk inserting ${skusToAdd.length} new SKUs into the database.`);
        console.log('[LOG] [Batch Add] Data to be bulk inserted:', skusToAdd);
        db.addTrackedSkusBulk(skusToAdd);

        const skuStrings = successfulFetches.map(pd => pd.product_sku);
        const trackedSkusFromDb = db.getTrackedSkusBySkuNames(skuStrings);
        const trackedSkusMap = trackedSkusFromDb.reduce((map, sku) => {
            map[sku.sku] = sku;
            return map;
        }, {});
        console.log(`[LOG] [Batch Add] Fetched ${trackedSkusFromDb.length} tracked SKUs from DB after bulk insert.`);


        const recordDate = getLocalDateForDb();
        console.log(`[LOG] [Batch Add] Saving inventory records for ${successfulFetches.length} SKUs for date: ${recordDate}`);
        for (const productData of successfulFetches) {
            const trackedSku = trackedSkusMap[productData.product_sku];
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
                console.log(`[LOG] [Batch Add] Saving summary record for SKU ${trackedSku.sku}:`, summaryRecord);
                db.saveInventoryRecord(summaryRecord);
                await _saveRegionalInventoryRecords(trackedSku, productData, recordDate);
            } else {
                console.warn(`[LOG] [Batch Add] Could not find tracked SKU for ${productData.product_sku} after bulk add. Skipping inventory record save.`);
            }
        }
    }

    const returnValue = { newSkusCount: successfulFetches.length, failedSkus };
    console.log('[LOG] [Batch Add] Batch process finished. Returning:', returnValue);
    return returnValue;
}

module.exports = {
    fetchInventoryFromAPI,
    fetchAndSaveAllTrackedSkus,
    addOrUpdateTrackedSku,
    getInventoryHistoryBySku,
    fetchSingleSkuById,
    addOrUpdateTrackedSkusInBatch,
};

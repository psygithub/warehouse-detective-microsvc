const NodeCache = require('node-cache');

/**
 * Global In-Memory Cache Service
 * 
 * Default TTL: 300 seconds (5 minutes)
 * Check Period: 320 seconds (Automatic delete check interval)
 */
const cache = new NodeCache({ 
    stdTTL: 300, 
    checkperiod: 320,
    useClones: false // Store references for better performance (be careful not to mutate objects)
});

module.exports = cache;

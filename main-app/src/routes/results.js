const express = require('express');
const auth = require('../auth');
const database = require('../db_sqlite');
const router = express.Router();

router.get('/', auth.authenticateToken.bind(auth), (req, res) => {
    console.log(`[API Entry] GET /api/results`);
    try {
        const { limit = 50, offset = 0, scheduled } = req.query;
        let results = database.getResults(parseInt(limit), parseInt(offset));
        if (scheduled === 'true') {
            results = results.filter(result => result.isScheduled === 1);
        } else if (scheduled === 'false') {
            results = results.filter(result => result.isScheduled === 0);
        }
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id', auth.authenticateToken.bind(auth), (req, res) => {
    console.log(`[API Entry] GET /api/results/:id`);
    try {
        const result = database.getResultById(parseInt(req.params.id));
        if (!result) return res.status(404).json({ error: '结果不存在' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

const express = require('express');
const auth = require('../auth');
const database = require('../db_sqlite');
const router = express.Router();

router.get('/', auth.authenticateToken.bind(auth), (req, res) => {
    console.log(`[API Entry] GET /api/configs`);
    try {
        const configs = database.getConfigs();
        res.json(configs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/', auth.authenticateToken.bind(auth), (req, res) => {
    console.log(`[API Entry] POST /api/configs`);
    try {
        const configData = { ...req.body, userId: req.user.id };
        const newConfig = database.saveConfig(configData);
        res.status(201).json(newConfig);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id', auth.authenticateToken.bind(auth), (req, res) => {
    console.log(`[API Entry] GET /api/configs/:id`);
    try {
        const config = database.getConfigById(parseInt(req.params.id));
        if (!config) return res.status(404).json({ error: '配置不存在' });
        res.json(config);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/:id', auth.authenticateToken.bind(auth), (req, res) => {
    console.log(`[API Entry] PUT /api/configs/:id`);
    try {
        const configId = parseInt(req.params.id);
        const updatedConfig = database.updateConfig(configId, req.body);
        if (!updatedConfig) return res.status(404).json({ error: '配置不存在' });
        res.json(updatedConfig);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/:id', auth.authenticateToken.bind(auth), (req, res) => {
    console.log(`[API Entry] DELETE /api/configs/:id`);
    try {
        const configId = parseInt(req.params.id);
        const success = database.deleteConfig(configId);
        if (!success) return res.status(404).json({ error: '配置不存在' });
        res.json({ message: '配置删除成功' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

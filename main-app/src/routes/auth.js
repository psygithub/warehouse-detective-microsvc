const express = require('express');
const auth = require('../auth');
const UAParser = require('ua-parser-js');
const db = require('../db_sqlite');
const router = express.Router();

router.post('/login', async (req, res) => {
    console.log(`[API Entry] POST /api/auth/login`);
    const { username, password } = req.body;
    let loginStatus = 'failed';
    
    // 获取客户端信息
    const userAgentStr = req.headers['user-agent'] || '';
    const parser = new UAParser(userAgentStr);
    const resultUA = parser.getResult();
    
    // 优先获取 Nginx 传递的真实 IP
    let ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress;
    // 如果是多个IP（x-forwarded-for），取第一个
    if (ip && ip.includes(',')) {
        ip = ip.split(',')[0].trim();
    }

    try {
        if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
        
        const result = await auth.login(username, password);
        loginStatus = 'success';
        
        // 记录日志
        db.createLoginLog({
            username: username,
            ip_address: ip,
            user_agent: userAgentStr,
            browser: `${resultUA.browser.name || 'Unknown'} ${resultUA.browser.version || ''}`,
            os: `${resultUA.os.name || 'Unknown'} ${resultUA.os.version || ''}`,
            device: resultUA.device.model || (resultUA.device.type ? resultUA.device.type : 'Desktop'),
            status: loginStatus
        });

        res.json(result);
    } catch (error) {
        // 即使失败也记录日志
        db.createLoginLog({
            username: username || 'Unknown',
            ip_address: ip,
            user_agent: userAgentStr,
            browser: `${resultUA.browser.name || 'Unknown'}`,
            os: `${resultUA.os.name || 'Unknown'}`,
            device: resultUA.device.model || 'Unknown',
            status: loginStatus
        });
        res.status(401).json({ error: error.message });
    }
});

router.get('/logs', auth.authenticateToken.bind(auth), (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '权限不足' });
    
    try {
        const { page = 1, limit = 20 } = req.query;
        const logs = db.getLoginLogsPaginated({ page, limit });
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: '获取日志失败: ' + error.message });
    }
});

router.post('/register', async (req, res) => {
    console.log(`[API Entry] POST /api/auth/register`);
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) return res.status(400).json({ error: '用户名、邮箱和密码不能为空' });
        if (password.length < 6) return res.status(400).json({ error: '密码长度至少6位' });
        const result = await auth.register({ username, email, password });
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.get('/verify', auth.authenticateToken.bind(auth), (req, res) => {
    console.log(`[API Entry] GET /api/auth/verify`);
    res.json({ user: req.user })
});

router.get('/check-session', auth.authenticateToken.bind(auth), (req, res) => {
    console.log(`[API Entry] GET /api/auth/check-session`);
    res.json({ isValid: true })
});

module.exports = router;

const express = require('express');
const auth = require('../auth');
const router = express.Router();

router.post('/login', async (req, res) => {
    console.log(`[API Entry] POST /api/auth/login`);
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
        const result = await auth.login(username, password);
        res.json(result);
    } catch (error) {
        res.status(401).json({ error: error.message });
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

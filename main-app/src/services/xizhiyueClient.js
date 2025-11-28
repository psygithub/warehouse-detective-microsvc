const fetch = require('node-fetch');

class XizhiyueClient {
    constructor() {
        this.authInfo = { cookies: null, token: null, lastUpdated: null };
    }

    isAuthInfoValid(authInfo, maxAge = 60 * 60 * 1000) {
        if (!authInfo || !authInfo.lastUpdated) return false;
        return (Date.now() - authInfo.lastUpdated) < maxAge;
    }

    async getAuthInfo(forceLogin = false) {
        if (!forceLogin && this.isAuthInfoValid(this.authInfo)) {
            return this.authInfo;
        }
        try {
            const url = `https://customer.westmonth.com/login_v2`;
            // 注意：这里的账号密码建议从环境变量或配置文件读取，暂时保持原样以确保功能一致性
            const body = { area_code: `+86`, account: "18575215654", password: "FUNyaxN9SSB9WiPA5Xhz096kgDmlKag3tOqfoT0sUonuj7YHEANZOt8HD13Rq6q4edNaHsbAHw/+Kghrw+Muw96y+xKL1W8tfl29aQj8+TC6Ht257OXVWGvYQmxgQQtQymzhCitziKwi3lFGP+Kpv+ZaCjIwpqV4jlqlgrbwvLsYep31USgj80nAhll4tYDVEDNM29GfP8zvdC2MLMt8mNRZzMlTNwtcII9vA1J4mKjfQR6OKpSt7nWu90iUYD4bgRU70PfWdJrJ3JBYcrBUeVcNWid0gQMc4cl4SzxgyiqXrocqk5KIg8U/h/2yOUa/c3x77wXoEKb0dEuzAlPo5A==", type: `1` };
            const options = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome' },
                body: JSON.stringify(body)
            };
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`获取token请求失败: ${response.status} ${response.statusText}`);
            const res = await response.json();
            this.authInfo = { token: res.data.access_token, lastUpdated: Date.now() };
            return this.authInfo;
        } catch (error) {
            console.error('获取认证信息失败:', error);
            throw error;
        }
    }

    async makeAuthenticatedRequest(url, method = 'GET', options = {}, maxRetries = 2) {
        let authInfo = await this.getAuthInfo();
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const requestOptions = {
                    ...options,
                    method: method,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json',
                        'Authorization': authInfo.token ? `Bearer ${authInfo.token}` : '',
                        ...options.headers
                    }
                };
                const response = await fetch(url, requestOptions);
                if (response.status === 401 || response.status === 403) {
                    if (attempt < maxRetries) {
                        authInfo = await this.getAuthInfo(true);
                        continue;
                    } else {
                        throw new Error(`认证失败: ${response.status} ${response.statusText}`);
                    }
                }
                if (!response.ok) {
                    const rawText = await response.text();
                    throw new Error(`请求失败: ${response.status} ${response.statusText}，返回内容: ${rawText}`);
                }
                return await response.json();
            } catch (error) {
                if (attempt >= maxRetries) throw error;
            }
        }
    }
}

// 导出单例
module.exports = new XizhiyueClient();

const { chromium } = require('playwright');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { json } = require('express/lib/response');

class WarehouseDetective {
  constructor() {
    this.config = this.loadConfig();
    this.browser = null;
    this.page = null;
    this.isRemoteBrowser = false; // 用于跟踪是否使用远程浏览器
    this.results = [];
    this.mailTransporter = this.createMailTransporter();
    this.authToken = null; // 添加认证token缓存
    this.authCookies = null; // 添加cookies缓存
    this.lastLoginTime = null; // 最后登录时间
    // 修复：确保 serverBaseUrl 有默认值
    this.serverBaseUrl = process.env.SERVER_URL || 'http://localhost:3000';

    // 添加调试信息
    console.log('服务器基础URL:', this.serverBaseUrl);
  }

  loadConfig() {
    // This path assumes the config folder will be copied to the service's root
    const configPath = path.join(__dirname, '../config/config.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  async init() {
    const browserServiceUrl = process.env.BROWSER_SERVICE_URL;
    if (!browserServiceUrl) {
      throw new Error('BROWSER_SERVICE_URL environment variable is not set. This service cannot function without it.');
    }

    console.log(`Connecting to remote browser service at: ${browserServiceUrl}`);
    this.browser = await chromium.connect(browserServiceUrl);
    this.page = await this.browser.newPage();
    this.isRemoteBrowser = true; // This service always uses a remote browser
  }

  // 添加获取认证信息的方法
  async getAuthInfo() {
    // 如果有有效的token/cookies，直接返回
    if (this.isAuthValid()) {
      return {
        cookies: this.authCookies,
        token: this.authToken
      };
    }

    // 否则重新登录
    console.log('没有登录，重新登录...');
    await this.loginXZY();

    return {
      cookies: this.authCookies,
      token: this.authToken
    };
  }


  // 创建邮件传输器
  createMailTransporter() {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST || this.config.email?.smtpHost,
      port: process.env.SMTP_PORT || this.config.email?.smtpPort || 587,
      secure: process.env.SMTP_SECURE || this.config.email?.smtpSecure || false,
      auth: {
        user: process.env.SMTP_USER || this.config.email?.smtpUser,
        pass: process.env.SMTP_PASS || this.config.email?.smtpPass,
      },
    });
  }

  // 检查认证是否有效（假设1小时内有效）
  isAuthValid() {
    if (!this.lastLoginTime) return false;
    const oneDay = 24 * 60 * 60 * 1000;
    return (Date.now() - this.lastLoginTime) < oneDay;
  }

  // 从storage获取token
  async getAuthTokenFromStorage() {
    console.log(`12312312321`);
    try {
      const localStorageData = await this.page.evaluate(() => {
        let items = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          items[key] = localStorage.getItem(key);
        }
        return items;
      });
      console.log('LocalStorage:', localStorageData);
      return await this.page.evaluate(() => {
        console.log(`localStorage ${JSON.stringify(localStorage)}`);
        return localStorage.getItem('access_token') ||
          localStorage.getItem('im_token') ||
          sessionStorage.getItem('auth_token') ||
          document.cookie.match(/(^|;)token=([^;]+)/)?.[2];
      });
    } catch (error) {
      console.error('获取认证token失败:', error);
      return null;
    }
  }

  // 清空认证缓存
  clearAuthCache() {
    this.authToken = null;
    this.authCookies = null;
    this.lastLoginTime = null;
  }



  async loginXZY() {
    console.log('正在登录...');
    try {
      await this.page.goto(this.config.website.loginUrl, {
        waitUntil: 'networkidle',
        timeout: this.config.browser.timeout
      });

      // 等待页面加载完成
      await this.page.waitForTimeout(2000);
      console.log('打开页面...');
      await this.page.locator('#layout-header i').nth(3).click();
      await this.page.getByText('手机登录').click();
      await this.page.getByRole('textbox', { name: '请输入手机号' }).click();
      await this.page.getByText('密码登录').click();
      await this.page.getByRole('textbox', { name: '请输入手机号' }).click();
      await this.page.getByRole('textbox', { name: '请输入手机号' }).fill(this.config.website.username);
      await this.page.getByRole('textbox', { name: '请输入密码' }).click();
      await this.page.getByRole('textbox', { name: '请输入密码' }).fill(this.config.website.password);
      console.log('点击同意...');
      await this.page.locator('label span').nth(1).click();
      await this.page.getByText('登录/注册').click();
      this.lastLoginTime = Date.now();
      await this.page.waitForTimeout(3000);
      // 获取token和cookies
      this.authToken = await this.getAuthTokenFromStorage();
      this.authCookies = await this.page.context().cookies();
      this.lastLoginTime = Date.now();

      console.log(`登录成功，token：${this.authToken}`);
      return true;
    } catch (error) {
      console.error('登录过程中出错:', error);
      this.clearAuthCache(); // 登录失败时清空缓存
      return false;
    }
  }

  async loginAdmin() {
    console.log('正在登录管理后台...');
    try {
      await this.page.goto(this.config.website.adminLoginUrl, {
        waitUntil: 'networkidle',
      });
      await page.getByRole('textbox', { name: '用户名' }).click();
      await page.getByRole('textbox', { name: '用户名' }).fill('admin');
      await page.getByRole('textbox', { name: '密码' }).click();
      await page.getByRole('textbox', { name: '密码' }).fill('admin123');
      await page.getByRole('button', { name: ' 登录' }).click();
    }
    catch (error) {

    }
  }
  // 发送邮件（截取整个结果弹窗）
  async sendEmailWithAttach(results, skus, regions, toEmail = this.config.email?.to || []) {
    // 检查results是否为null或undefined
    if (!results) {
      console.log('没有结果数据，跳过发送邮件');
      return;
    }
    let txtAttachmentPath = null;
    try {
      const date = new Date().toLocaleString('zh-CN');
      const subject = `库存检测结果 - ${date}`;

      // 计算有库存和无库存的数量
      const inStockCount = results.filter(item =>
        !item.stock.includes('未找到') &&
        !item.stock.includes('无库存') &&
        item.stock.trim() !== ''
      ).length;
      const outOfStockCount = results.length - inStockCount;

      // 创建文本文件附件
      txtAttachmentPath = await this.createTextFile(results, skus, regions, date);
      // 美化邮件内容
      let htmlContent = this.createHtml(results, skus, regions, date, inStockCount, outOfStockCount);

      // 确保 toEmail 是一个数组
      let toList = Array.isArray(toEmail) ? toEmail : [toEmail];

      if (toList.length === 0) {
        console.log('未配置收件人邮箱，跳过发送邮件');
        return;
      }

      const validEmails = toList.filter(email => email && email.includes('@'));
      if (validEmails.length === 0) {
        console.log('没有有效的收件人邮箱，跳过发送邮件');
        return;
      }


      // ====== 发邮件 ======
      const mailOptions = {
        from: this.config.email?.from,
        to: validEmails.join(','),
        subject,
        html: htmlContent,
        attachments: [
          {
            filename: `库存检测结果-${date.replace(/[/:\\]/g, '-')}.txt`,
            path: txtAttachmentPath
          }
        ]
      };

      await this.mailTransporter.sendMail(mailOptions);
      console.log('邮件发送成功');

    } catch (error) {
      console.error('发送邮件失败:', error);
    }
  }

  // 创建文本文件附件
  async createTextFile(results, skus, regions, date) {
    const tempDir = path.join(__dirname, '../temp');

    // 确保临时目录存在
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const filePath = path.join(tempDir, `inventory-result-${Date.now()}.txt`);

    let content = `库存检测结果报告\n`;
    content += `检测时间: ${date}\n`;
    content += `检测SKU数量: ${skus.length}\n`;
    content += `检测地区数量: ${regions.length}\n`;
    content += `总结果数量: ${results.length}\n\n`;

    content += `详细结果:\n`;
    content += `SKU\t地区\t库存状态\n`;
    content += `----------------------------------------\n`;

    for (const item of results) {
      content += `${item.sku}\t${item.region}\t${item.stock}\n`;
    }

    fs.writeFileSync(filePath, content, 'utf8');
    console.log('文本附件已创建:', filePath);

    return filePath;
  }


  createHtml(results, skus, regions, date, inStockCount, outOfStockCount) {
    let htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>库存检测结果</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1000px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f9f9f9;
    }
    .header {
      background: linear-gradient(135deg, #2c3e50, #3498db);
      color: white;
      padding: 25px;
      border-radius: 8px 8px 0 0;
      text-align: center;
      margin-bottom: 0;
    }
    .content {
      background-color: white;
      padding: 25px;
      border-radius: 0 0 8px 8px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .summary {
      margin-bottom: 25px;
      padding: 15px;
      background-color: #f8f9fa;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
    }
    .summary-item {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 120px;
      padding: 12px;
      background-color: white;
      border-radius: 6px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      text-align: left;
    }
    .summary-label {
      font-size: 13px;
      color: #6c757d;
      margin-bottom: 5px;
      font-weight: 500;
    }
    .summary-value {
      font-size: 18px;
      font-weight: bold;
      color: #2c3e50;
    }
    .summary-value.in-stock {
      color: #28a745;
    }
    .summary-value.out-of-stock {
      color: #dc3545;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }
    th, td {
      padding: 12px 15px;
      text-align: left;
      border-bottom: 1px solid #e9ecef;
    }
    th {
      background-color: #f8f9fa;
      font-weight: 600;
      color: #495057;
    }
    tr:hover {
      background-color: #f8f9fa;
    }
    /* 根据库存状态设置不同样式 */
    .stock-out-of-stock {
      color: #dc3545;
      font-weight: bold;
      background-color: #fff5f5;
      padding: 4px 8px;
      border-radius: 4px;
    }
    .stock-low {
      color: #fd7e14;
      font-weight: bold;
      background-color: #fff9f0;
      padding: 4px 8px;
      border-radius: 4px;
    }
    .stock-available {
      color: #15e08cff;
      font-weight: bold;
      background-color: #f0fff4;
      padding: 4px 8px;
      border-radius: 4px;
    }
    .stock-sufficient {
      color: #057a05ff;
      font-weight: bold;
      background-color: #e6ffe6;
      padding: 4px 8px;
      border-radius: 4px;
    }
    .stock-unknown {
      color: #6c757d;
      font-weight: bold;
      background-color: #f8f9fa;
      padding: 4px 8px;
      border-radius: 4px;
    }
    .footer {
      margin-top: 25px;
      text-align: center;
      font-size: 14px;
      color: #6c757d;
    }
    @media (max-width: 768px) {
      .summary-row {
        flex-direction: column;
      }
      .summary-item {
        min-width: 100%;
      }
      table {
        font-size: 14px;
      }
      th, td {
        padding: 8px 10px;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>库存检测结果报告</h1>
    <p>检测时间: ${date}</p>
  </div>
  <div class="content">
    <div class="summary">
      <div class="summary-row">
        <div class="summary-item">
          <span class="summary-label">检测SKU数量</span>
          <span class="summary-value">${skus.length}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">检测地区数量</span>
          <span class="summary-value">${regions.length}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">总结果数量</span>
          <span class="summary-value">${results.length}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">有库存</span>
          <span class="summary-value in-stock">${inStockCount}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">无库存</span>
          <span class="summary-value out-of-stock">${outOfStockCount}</span>
        </div>
      </div>
    </div>
    
    <h2>详细结果</h2>
    <table>
      <thead>
        <tr>
          <th>SKU</th>
          <th>地区</th>
          <th>库存状态</th>
        </tr>
      </thead>
      <tbody>
`;
    // 添加每个结果的表格行
    for (const item of results) {
      // 根据库存状态确定CSS类
      let stockClass = 'stock-unknown';

      if (item.stock.includes('缺货') || item.stock.includes('无库存')) {
        stockClass = 'stock-out-of-stock';
      } else if (item.stock.includes('库存紧张')) {
        stockClass = 'stock-low';
      } else if (item.stock.includes('有货')) {
        stockClass = 'stock-available';
      } else if (item.stock.includes('库存充足')) {
        stockClass = 'stock-sufficient';
      }

      htmlContent += `
            <tr>
              <td>${item.sku}</td>
              <td>${item.region}</td>
              <td class="${stockClass}">${item.stock}</td>
            </tr>
      `;
    }

    htmlContent += `
          </tbody>
        </table>
        <div class="footer">
          <p>此邮件由 Warehouse Detective 系统自动生成，请勿直接回复。</p>
        </div>
      </div>
    </body>
    </html>
    `;
    return htmlContent;
  }

  async searchSkuList(skuList, regionList) {
    const results = [];

    for (const sku of skuList) {
      if (regionList.length > 0) {
        for (const region of regionList) {
          const result = await this.searchSKU(sku, region);
          if (result) {
            results.push(...result);
          }
          await this.page.waitForTimeout(1000); // 添加延迟避免请求过快
        }
      } else {
        const result = await this.searchSKU(sku);
        if (result) {
          results.push(...result);
        }
        await this.page.waitForTimeout(1000); // 添加延迟避免请求过快
      }
    }
    return results;
  }
  async searchSKU(sku, region = '') {
    console.log(`搜索SKU: ${sku}, 地区: ${region || '全部'}`);

    try {
      // 清空搜索框并输入SKU
      await this.page.getByRole('searchbox', { name: '请输入商品名称、sku等关键词进行搜索' }).click();
      await this.page.getByRole('searchbox', { name: '请输入商品名称、sku等关键词进行搜索' }).fill('');
      await this.page.getByRole('searchbox', { name: '请输入商品名称、sku等关键词进行搜索' }).fill(sku);
      console.log(`已输入SKU: ${sku}`);

      // 点击搜索按钮
      await this.page.getByText('搜索').click();

      // 等待搜索结果加载
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(3000);

      // 等待真实商品图片加载，而不是占位符
      console.log('等待真实商品图片加载...');

      // 使用更智能的等待策略
      await this.page.waitForFunction(() => {
        const images = document.querySelectorAll('.proimg img');
        if (images.length === 0) return false;

        // 检查是否有非占位符的真实图片
        return Array.from(images).some(img => {
          const src = img.src || '';
          return !src.includes('商品正在加载时.png') && !src.includes('newImage');
        });
      }, { timeout: 30000 });

      // 使用 page.$$ 获取元素句柄而不是 $$eval
      const productImages = await this.page.$$('.proimg img');
      if (productImages.length === 0) {
        console.log('未找到商品图片');
        return null;
      }

      // 过滤掉占位符图片
      const validImages = [];
      for (const imgHandle of productImages) {
        const src = await imgHandle.getAttribute('src');
        if (src && !src.includes('商品正在加载时.png') && !src.includes('newImage')) {
          validImages.push(imgHandle);
        }
      }

      if (validImages.length === 0) {
        console.log('未找到真实商品图片，只有占位符');

        // 尝试另一种选择器或等待更长时间
        await this.page.waitForTimeout(5000);
        const fallbackImages = await this.page.$$('.proimg img:not([src*="加载"])');
        if (fallbackImages.length === 0) {
          console.log('确实没有找到商品');
          return null;
        }

        // 点击第一个非占位符图片
        await fallbackImages[0].click();
      } else {
        // 点击第一个真实商品图片
        console.log('找到真实商品图片，准备点击');
        await validImages[0].click();
      }

      console.log('已点击商品图片');

      // 等待新页面弹出
      const page1 = await this.page.waitForEvent('popup', { timeout: 60000 });
      console.log('已打开商品详情页');

      // 设置新页面的超时时间
      page1.setDefaultTimeout(60000);

      // 等待新页面加载完成
      await page1.waitForLoadState('domcontentloaded');
      await page1.waitForTimeout(3000);

      // 选择地区
      try {
        const regionButton = page1.getByText(region, { exact: true });
        await regionButton.waitFor({ state: 'visible', timeout: 10000 });
        await regionButton.click();
        console.log('已选择地区: ' + region);
      } catch (error) {
        console.log('选择地区失败，可能已经默认选择或地区不可用:', error.message);
      }

      // 点击库存参考
      try {
        const stockButton = page1.getByText('库存参考');
        await stockButton.waitFor({ state: 'visible', timeout: 10000 });
        await stockButton.click();
        console.log('已点击库存参考');
      } catch (error) {
        console.log('点击库存参考失败:', error.message);
      }

      // 等待库存信息加载
      await page1.waitForTimeout(5000);

      // 尝试多种选择器来获取库存信息
      let stockNum = '未找到结果';
      const stockSelectors = [
        '.depot-inventory-box > .model-box > .model-right'
        // ,
        // '.model-right',
        // '[class*="inventory"]',
        // '[class*="stock"]',
        // '.ant-table-cell' // 可能是表格形式的库存显示
      ];

      for (const selector of stockSelectors) {
        try {
          const stockElement = page1.locator(selector).first();
          await stockElement.waitFor({ state: 'visible', timeout: 5000 });
          stockNum = await stockElement.textContent();
          if (stockNum && stockNum.trim() !== '') {
            console.log("使用选择器", selector, "获取到的库存:", stockNum);
            break;
          }
        } catch (error) {
          // 继续尝试下一个选择器
          continue;
        }
      }

      // 获取商品图片
      let imgSrc = '';
      try {
        const imgLocator = page1.locator('.imgView__item > img').first();
        await imgLocator.waitFor({ state: 'visible', timeout: 5000 });
        imgSrc = await imgLocator.getAttribute('src');
        console.log('图片地址:', imgSrc);
      } catch (error) {
        console.log('获取图片地址失败:', error.message);
      }

      const productDetails = await page1.evaluate(() => {
        const product_sku_id = window.PRODUCT_SKU_ID || null;
        const product_id = window.PRODUCT_ID || null;
        return { product_sku_id, product_id };
      });

      const items = [{
        sku,
        product_sku_id: productDetails.product_sku_id,
        product_id: productDetails.product_id,
        region: region || '全部',
        stock: stockNum || '未找到结果',
        lastUpdated: new Date().toISOString(),
        img: imgSrc || '',
        url: page1.url()
      }];

      // 关闭新页面
      await page1.close();
      return items;

    } catch (error) {
      console.error(`搜索SKU ${sku} 时出错:`, error.message);

      // 尝试捕获当前页面的截图以便调试
      try {
        const screenshotPath = `error_${sku}_${Date.now()}.png`;
        await this.page.screenshot({ path: screenshotPath });
        console.log(`错误截图已保存到: ${screenshotPath}`);
      } catch (screenshotError) {
        console.log('无法保存错误截图:', screenshotError.message);
      }

      return null;
    }
  }

  async searchByLink(link, region) {

  }
  async saveResults() {
    const outputPath = path.join(__dirname, '../output', this.config.output.filename);

    // 确保输出目录存在
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const output = {
      timestamp: new Date().toISOString(),
      totalResults: this.results.length,
      results: this.results
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`结果已保存到: ${outputPath}`);
  }
  // 添加调用服务器API的方法
  async callServerAPI(endpoint, method = 'GET', data = null) {
    try {
      const url = `${this.serverBaseUrl}${endpoint}`;
      const authToken = (await this.getAuthInfo()).token;
      console.log(`BearerToken ${authToken}`);
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}` // 如果需要认证
        }
      };

      if (data && method !== 'GET') {
        options.body = JSON.stringify(data);
      }

      console.log(`调用服务器API: ${url} options: ${options}`);
      const response = await fetch(url, options);

      if (!response.ok) {
        throw new Error(`服务器请求失败: ${url} ${response.status} ${response.statusText}`, response.json());
      }

      return await response.json();
    } catch (error) {
      console.error('调用服务器API失败:', error);
      throw error;
    }
  }
  // 获取商品列表
  async getProductList(regionId = '6', page = '1', pageSize = '10') {
    try {
      const endpoint = `/api/xizhiyue/products?regionId=${regionId}&page=${page}&pagesize=${pageSize}`;
      const result = await this.callServerAPI(endpoint);
      return result;
    } catch (error) {
      console.error('获取商品列表失败:', error);
      throw error;
    }
  }

  // 获取特定商品详情
  async getProductDetail(productId, regionId = '6') {
    try {
      const endpoint = `/api/xizhiyue/product/${productId}?regionId=${regionId}`;
      const result = await this.callServerAPI(endpoint);
      return result;
    } catch (error) {
      console.error('获取商品详情失败:', error);
      throw error;
    }
  }

  // 搜索商品
  async searchProducts(keyword, regionId = '6', page = '1') {
    try {
      const endpoint = `/api/xizhiyue/search?keyword=${encodeURIComponent(keyword)}&regionId=${regionId}&page=${page}`;
      const result = await this.callServerAPI(endpoint);
      return result;
    } catch (error) {
      console.error('搜索商品失败:', error);
      throw error;
    }
  }



  //保存到sqlite
  async saveResultsToDb(userId, configId, skus, regions, results, status = 'completed', isScheduled = false, scheduleId = null) {
    const now = new Date().toISOString();
    const resultData = {
      userId,
      configId,
      skus,
      regions,
      results: this.results,
      status,
      isScheduled,
      scheduleId
    };

    try {
      const savedResult = database.saveResult(resultData);
      console.log('结果已保存到SQLite数据库，ID:', savedResult.id);
      return savedResult;
    } catch (error) {
      console.error('保存到数据库失败:', error);
      throw error;
    }
  }


  // 将商品数据转换为邮件结果格式
  convertProductsToResults(products, targetRegionId = '6') {
    const results = [];

    for (const product of products) {
      // 从delivery_regions获取目标地区的库存信息
      let stockQuantity = 0;
      let stockStatus = '未知';

      console.log("---产品：" + product.product_name + ";qty:" + product.qty);
      // 直接从产品对象获取库存数量
      if (product.qty != undefined && product.qty != null) {
        stockQuantity = parseInt(product.qty) || 0;
        stockStatus = this.determineStockStatus(stockQuantity);
        console.log("---产品：" + product.product_name + ";stockQuantity:" + stockQuantity + ",从产品对象获取状态：" + stockStatus);
      }

      // 尝试从delivery_regions获取更精确的信息
      if (product.delivery_regions && product.delivery_regions[targetRegionId]) {
        const regionData = product.delivery_regions[targetRegionId][0];
        if (regionData && regionData.qty) {
          stockQuantity = parseInt(regionData.qty) || 0;
          stockStatus = this.determineStockStatus(stockQuantity);
          console.log("---产品：" + product.product_name + ";stockQuantity:" + stockQuantity + ",从delivery_regions产品对象获取状态：" + stockStatus);

        }
      }

      // 构建结果对象
      const result = {
        product_id: product.product_id,
        product_sku_id: product.product_sku_id,
        sku: product.product_sku,
        region: targetRegionId.toString(),
        stock: this.formatStockStatus(stockStatus, stockQuantity),
        lastUpdated: new Date().toISOString(),
        img: product.product_image || '',
        url: this.generateProductUrl(product.product_id),
        product_name: product.product_name,
        quantity: stockQuantity,
        price: product.product_price || '未知'
      };

      results.push(result);
    }

    return results;
  }

  // 格式化库存状态显示
  formatStockStatus(status, quantity) {
    const statusMap = {
      '缺货': `无库存 (${quantity})`,
      '库存紧张': `库存紧张 (${quantity})`,
      '有货': `有货 (${quantity})`,
      '库存充足': `库存充足 (${quantity})`,
      '未知': `库存未知 (${quantity})`
    };

    return statusMap[status] || `库存状态: ${status} (${quantity})`;
  }

  // 生成商品URL（根据你的网站结构）
  generateProductUrl(productId) {
    return `https://westmonth.com/products/${productId}`;
  }

  // 判断库存状态（复用之前的方法）
  determineStockStatus(quantity) {
    if (quantity == 0) return '缺货';
    if (quantity > 0 && quantity <= 10) return '库存紧张';
    if (quantity > 10 && quantity <= 100) return '有货';
    if (quantity > 100) return '库存充足';
    return '未知';
  }


  async run(skus = [], regions = []) {
    try {
      await this.init();

      const skuList = skus.length > 0 ? skus : this.config.search.skus;
      const regionList = regions.length > 0 ? regions : this.config.search.regions;

      if (skuList.length === 0) {
        console.log('没有要搜索的SKU');
        return [];
      }

      console.log(`[Playwright Service] 开始搜索 ${skuList.length} 个SKU...`);
      const results = await this.searchSkuList(skuList, regionList);
      console.log('[Playwright Service] 搜索完成！');
      
      return results;

    } catch (error) {
      console.error('[Playwright Service] 运行过程中出错:', error);
      throw error; // Re-throw the error to be caught by the API handler
    } finally {
      if (this.browser) {
        if (this.isRemoteBrowser) {
          await this.browser.disconnect();
          console.log('已与远程浏览器断开连接');
        } else {
          await this.browser.close();
          console.log('本地浏览器已关闭');
        }
      }
    }
  }


  async close() {
    if (this.browser) {
      if (this.isRemoteBrowser) {
        await this.browser.disconnect();
        console.log('已与远程浏览器断开连接');
      } else {
        await this.browser.close();
        console.log('本地浏览器已关闭');
      }
    }
  }
}







// 如果直接运行此文件
if (require.main === module) {
  const detective = new WarehouseDetective();

  // 从命令行参数获取SKU和地区
  const args = process.argv.slice(2);
  const skus = args.filter(arg => !arg.startsWith('--'));

  detective.run(skus).then(() => {
    console.log('程序执行完成');
  }).catch(error => {
    console.error('程序执行失败:', error);
  });
}

module.exports = WarehouseDetective;

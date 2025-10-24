// API请求封装
async function apiRequest(url, method = 'GET', data = null) {
    // Ensure token is available globally, defined in admin-main.js or user.html
    if (typeof token === 'undefined' || !token) {
        console.error('Authentication token is not available.');
        // Redirect to login or handle error appropriately
        window.location.href = '/login'; 
        throw new Error('Token not found');
    }

    const baseUrl = window.location.origin;
    const fullUrl = new URL(url, baseUrl).href;

    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    };

    if (data) {
        options.body = JSON.stringify(data);
    }

    const response = await fetch(fullUrl, options);

    if (response.status === 401) {
        console.log('API request authentication failed, logging out.');
        // Ensure logout function is available globally
        if (typeof logout === 'function') {
            logout();
        } else {
            // Fallback if logout function is not defined
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/login';
        }
        throw new Error('Session expired');
    }

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Request failed');
    }

    const text = await response.text();
    return text ? JSON.parse(text) : {};
}

function getBadgeForLevel(level) {
    switch (level) {
        case 3: return '<span class="badge bg-danger ms-2">快速</span>';
        case 2: return '<span class="badge bg-warning ms-2">中等</span>';
        case 1: return '<span class="badge bg-info ms-2">一般</span>';
        default: return '';
    }
}

/**
 * 渲染分页控件
 * @param {string} containerId - 分页控件的容器ID
 * @param {number} totalItems - 总项目数
 * @param {number} currentPage - 当前页码
 * @param {number} itemsPerPage - 每页显示的项目数
 * @param {string} callbackFunction - 点击分页链接时调用的函数名 (例如 'loadAlerts')
 */
(function() {
    function renderPagination(containerId, totalItems, currentPage, itemsPerPage, callbackFunction) {
        const paginationContainer = document.getElementById(containerId);
        if (!paginationContainer) {
            console.error(`Pagination container with id ${containerId} not found.`);
            return;
        }

    const totalPages = Math.ceil(totalItems / itemsPerPage);
    paginationContainer.innerHTML = '';

    if (totalPages <= 1) return;

    let paginationHTML = `<ul class="pagination pagination-sm">`;

    // 上一页
    const prevDisabled = currentPage === 1 ? 'disabled' : '';
    paginationHTML += `<li class="page-item ${prevDisabled}"><a class="page-link" href="#" onclick="event.preventDefault(); ${callbackFunction}(${currentPage - 1})">上一页</a></li>`;

    // 页面链接逻辑
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, currentPage + 2);

    if (startPage > 1) {
        paginationHTML += `<li class="page-item"><a class="page-link" href="#" onclick="event.preventDefault(); ${callbackFunction}(1)">1</a></li>`;
        if (startPage > 2) {
            paginationHTML += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
    }

    for (let i = startPage; i <= endPage; i++) {
        const activeClass = i === currentPage ? 'active' : '';
        paginationHTML += `<li class="page-item ${activeClass}"><a class="page-link" href="#" onclick="event.preventDefault(); ${callbackFunction}(${i})">${i}</a></li>`;
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            paginationHTML += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
        paginationHTML += `<li class="page-item"><a class="page-link" href="#" onclick="event.preventDefault(); ${callbackFunction}(${totalPages})">${totalPages}</a></li>`;
    }

    // 下一页
    const nextDisabled = currentPage === totalPages ? 'disabled' : '';
    paginationHTML += `<li class="page-item ${nextDisabled}"><a class="page-link" href="#" onclick="event.preventDefault(); ${callbackFunction}(${currentPage + 1})">下一页</a></li>`;

    paginationHTML += `</ul>`;
        paginationContainer.innerHTML = paginationHTML;
    }

    // Attach to the window object to make it globally available
    window.renderPagination = renderPagination;
})();

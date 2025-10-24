(() => {
    window.sectionInitializers = window.sectionInitializers || {};
    window.sectionInitializers['pivot-table'] = async () => {
        await loadLatestPivotData();
    };

    async function loadLatestPivotData() {
        const tableHead = document.getElementById('pivot-table-head');
        const tableBody = document.getElementById('pivot-table-body');

        if (!tableHead || !tableBody) {
            console.error('数据透视表元素未找到!');
            return;
        }

        tableHead.innerHTML = '<tr><th>加载中...</th></tr>';
        tableBody.innerHTML = '';

        try {
            const data = await apiRequest(`/api/inventory/pivot-history`);
            
            if (!data || data.columns.length === 0) {
                tableHead.innerHTML = '<tr><th>无数据</th></tr>';
                return;
            }

            let columns = data.columns;
            let rows = data.rows;
            let sortableInstance = null;
            let sortState = {}; // To track sorting state { column: 'colName', order: 'asc' | 'desc' }

            function initSortable() {
                if (sortableInstance) {
                    sortableInstance.destroy();
                }
                const headerRow = tableHead.querySelector('tr');
                if (headerRow && typeof Sortable !== 'undefined') {
                    sortableInstance = Sortable.create(headerRow, {
                        animation: 150,
                        onEnd: function (evt) {
                            const movedItem = columns.splice(evt.oldIndex, 1)[0];
                            columns.splice(evt.newIndex, 0, movedItem);
                            renderTable();
                        }
                    });
                }
            }

            function renderTable() {
                // Render header
                const nonSortableColumns = ['图片', 'SKU', '商品名称', '最新日期', '有效日期'];
                const headerHtml = columns.map(col => {
                    if (nonSortableColumns.includes(col)) {
                        return `<th>${col}</th>`;
                    }
                    let sortIndicator = '';
                    if (sortState.column === col) {
                        sortIndicator = sortState.order === 'asc' ? '&nbsp;<i class="fas fa-sort-up"></i>' : '&nbsp;<i class="fas fa-sort-down"></i>';
                    }
                    return `<th title="${col}" style="cursor: pointer;">${col.charAt(0)}${sortIndicator}</th>`;
                }).join('');
                tableHead.innerHTML = `<tr>${headerHtml}</tr>`;

                // Render body
                tableBody.innerHTML = rows.map(row => {
                    const cells = columns.map(col => {
                        const value = row[col];
                        if (col === '图片') {
                            return `<td><img src="${value || ''}" alt="N/A" width="50"></td>`;
                        }
                        if (value === 0) {
                            return `<td><span class="badge bg-warning">${value}</span></td>`;
                        }
                        return `<td>${value !== null ? value : ''}</td>`;
                    }).join('');
                    return `<tr>${cells}</tr>`;
                }).join('');

                // Re-initialize sortable after rendering
                initSortable();
                addSortListeners();
            }

            function addSortListeners() {
                const headers = tableHead.querySelectorAll('th');
                headers.forEach((header, index) => {
                    const columnName = columns[index];
                    const nonSortableColumns = ['图片', 'SKU', '商品名称', '最新日期', '有效日期'];
                    if (!nonSortableColumns.includes(columnName)) {
                        header.addEventListener('click', () => sortTable(columnName));
                        new bootstrap.Tooltip(header);
                    }
                });
            }

            function sortTable(columnName) {
                const currentSort = sortState.column === columnName && sortState.order === 'asc' ? 'desc' : 'asc';
                
                rows.sort((a, b) => {
                    const valA = a[columnName] === null ? -1 : a[columnName];
                    const valB = b[columnName] === null ? -1 : b[columnName];

                    if (valA < valB) {
                        return currentSort === 'asc' ? -1 : 1;
                    }
                    if (valA > valB) {
                        return currentSort === 'asc' ? 1 : -1;
                    }
                    return 0;
                });

                sortState = { column: columnName, order: currentSort };
                renderTable();
            }

            renderTable();

        } catch (error) {
            console.error('加载数据透视表失败:', error);
            if (tableHead) {
                tableHead.innerHTML = `<tr><th class="text-danger">加载失败: ${error.message}</th></tr>`;
            }
        }
    }
})();

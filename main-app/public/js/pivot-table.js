(() => {
    let currentPage = 1;
    let rowsPerPage = 20;
    let columns = [];
    let sortState = {}; // To track sorting state { column: 'colName', order: 'asc' | 'desc' }
    let sortableInstance = null;

    window.sectionInitializers = window.sectionInitializers || {};
    window.sectionInitializers['pivot-table'] = async () => {
        window.loadPivotData = loadLatestPivotData; // Expose to global scope for pagination
        
        const rowsPerPageSelect = document.getElementById('pivot-rows-per-page-select');
        if (rowsPerPageSelect) {
            rowsPerPageSelect.addEventListener('change', () => {
                rowsPerPage = parseInt(rowsPerPageSelect.value, 10);
                loadLatestPivotData(1);
            });
        }
        
        await loadLatestPivotData();

        const exportBtn = document.getElementById('export-pivot-table-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', exportPivotTableToCSV);
        }
    };

    async function exportPivotTableToCSV() {
        try {
            // 1. Fetch all data from the API by requesting page 1 with a very large limit
            const allData = await apiRequest(`/api/inventory/pivot-history?page=1&limit=9999`);
            
            if (!allData || !allData.rows || allData.rows.length === 0) {
                alert('没有数据可导出。');
                return;
            }

            const exportColumns = allData.columns;
            const exportRows = allData.rows;

            // 2. Generate CSV content
            const csvHeader = exportColumns.map(col => `"${String(col).replace(/"/g, '""')}"`).join(',');

            const csvRows = exportRows.map(row => {
                return exportColumns.map(col => {
                    const value = row[col] !== null && row[col] !== undefined ? row[col] : '';
                    return `"${String(value).replace(/"/g, '""')}"`;
                }).join(',');
            });

            const csvContent = [csvHeader, ...csvRows].join('\n');

            // 3. Create and trigger download
            const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            const fileName = `库存数据${year}${month}${day}.csv`;

            link.setAttribute('href', url);
            link.setAttribute('download', fileName);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (error) {
            console.error('导出CSV失败:', error);
            alert(`导出失败: ${error.message}`);
        }
    }

    async function loadLatestPivotData(page = 1) {
        currentPage = page;
        rowsPerPage = parseInt(document.getElementById('pivot-rows-per-page-select').value, 10);

        const tableHead = document.getElementById('pivot-table-head');
        const tableBody = document.getElementById('pivot-table-body');

        if (!tableHead || !tableBody) {
            console.error('数据透视表元素未找到!');
            return;
        }

        tableHead.innerHTML = '<tr><th>加载中...</th></tr>';
        tableBody.innerHTML = '<tr><td colspan="100%" class="text-center">加载中...</td></tr>';

        try {
            const data = await apiRequest(`/api/inventory/pivot-history?page=${currentPage}&limit=${rowsPerPage}`);
            
            if (!data || data.rows.length === 0) {
                tableHead.innerHTML = '<tr><th>无数据</th></tr>';
                tableBody.innerHTML = '<tr><td colspan="100%" class="text-center">没有找到符合条件的记录。</td></tr>';
                window.renderPagination('pivot-pagination-links', 0, currentPage, rowsPerPage, 'loadPivotData');
                return;
            }

            columns = data.columns;
            let rows = data.rows;

            // Reorder columns: move all region columns after 'SKU'
            if (columns.includes('SKU')) {
                const regionCols = [];
                const otherCols = [];
                const knownNonRegionCols = ['图片', 'SKU', '商品名称', '最新日期', '有效日期'];

                for (const col of columns) {
                    if (knownNonRegionCols.includes(col)) {
                        otherCols.push(col);
                    } else {
                        // Any column not in the known list is considered a region column
                        regionCols.push(col);
                    }
                }

                // Rebuild the columns array in the desired order
                const finalCols = [];
                if (otherCols.includes('图片')) finalCols.push('图片');
                if (otherCols.includes('SKU')) finalCols.push('SKU');
                
                finalCols.push(...regionCols.sort()); // Add sorted region columns right after SKU
                
                if (otherCols.includes('商品名称')) finalCols.push('商品名称');
                if (otherCols.includes('有效日期')) finalCols.push('有效日期');
                if (otherCols.includes('最新日期')) finalCols.push('最新日期');
                
                columns = finalCols;
            }
            
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
                            renderTable(rows); // Re-render with new column order
                        }
                    });
                }
            }

            function renderTable(currentRows) {
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
                tableBody.innerHTML = currentRows.map(row => {
                    const cells = columns.map(col => {
                        const value = row[col] !== null ? row[col] : '';
                        let classes = '';
                        let styles = '';

                        if (col === 'SKU' || col === '商品名称') {
                            classes += 'cell-small-font ';
                        }
                        if (col === 'SKU') {
                            classes += 'text-center';
                        }
                        if (col === '图片') {
                            styles = 'vertical-align: top;'; // Override global middle alignment
                            return `<td style="${styles}"><img src="${value || ''}" alt="N/A" width="50" style="cursor: pointer;" onclick="showImageModal('${value || ''}')"></td>`;
                        }
                        if (value === 0) {
                            return `<td class="${classes}" style="${styles}"><span class="badge bg-warning">0</span></td>`;
                        }
                        return `<td class="${classes}" style="${styles}">${value}</td>`;
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
                        header.addEventListener('click', () => sortTable(columnName, rows));
                        new bootstrap.Tooltip(header);
                    }
                });
            }

            function sortTable(columnName, currentRows) {
                const currentSort = sortState.column === columnName && sortState.order === 'asc' ? 'desc' : 'asc';
                
                currentRows.sort((a, b) => {
                    const valA = a[columnName] === null ? -Infinity : a[columnName];
                    const valB = b[columnName] === null ? -Infinity : b[columnName];

                    if (valA < valB) {
                        return currentSort === 'asc' ? -1 : 1;
                    }
                    if (valA > valB) {
                        return currentSort === 'asc' ? 1 : -1;
                    }
                    return 0;
                });

                sortState = { column: columnName, order: currentSort };
                renderTable(currentRows);
            }

            renderTable(rows);
            window.renderPagination('pivot-pagination-links', data.total, currentPage, rowsPerPage, 'loadPivotData');

        } catch (error) {
            console.error('加载数据透视表失败:', error);
            if (tableHead) {
                tableHead.innerHTML = `<tr><th class="text-danger">加载失败: ${error.message}</th></tr>`;
            }
        }
    }

    window.showImageModal = (src) => {
        const modalImage = document.getElementById('modalImage');
        if (modalImage) {
            modalImage.src = src;
            const imageModal = new bootstrap.Modal(document.getElementById('imageModal'));
            imageModal.show();
        }
    };
})();

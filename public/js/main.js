const { jsPDF } = window.jspdf;

// --- SESSION-WIDE LOG STORAGE ---
let sessionLog = JSON.parse(sessionStorage.getItem('sessionLog')) || [];

document.addEventListener('DOMContentLoaded', function() {
    const socket = io();
    
    const statusIndicator = document.getElementById('status-indicator');
    const qrImage = document.getElementById('qr-image');
    const qrContainer = document.getElementById('qr-container');
    const authSuccess = document.getElementById('auth-success');
    
    socket.on('status', (message) => { if(statusIndicator) statusIndicator.textContent = message; });
    socket.on('qr', (qr) => {
        if (qrImage) {
            qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=250x250`;
            qrContainer.classList.remove('hidden');
            authSuccess.classList.add('hidden');
        }
    });
    socket.on('authenticated', () => {
        if(qrContainer) {
            qrContainer.classList.add('hidden');
            authSuccess.classList.remove('hidden');
        }
    });
    socket.on('show_qr', () => {
        if(qrContainer) {
            qrContainer.classList.remove('hidden');
            authSuccess.classList.add('hidden');
            qrImage.src = '';
        }
    });
    
    if (document.getElementById('campaign-form')) initializeDashboardPage(socket);
    if (document.getElementById('template-form')) initializeTemplatesPage();
    if (document.getElementById('media-list-container')) initializeMediaPage();
    if (document.getElementById('report-list-container')) initializeReportsPage();
    if (document.getElementById('contact-group-list')) initializeContactsPage();

    document.body.addEventListener('click', function(e) {
        if (e.target && e.target.classList.contains('delete-btn')) {
            if (!confirm('Are you sure you want to delete this item? This action cannot be undone.')) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }
    }, true);
});

function initializeDashboardPage(socket) {
    const logContainer = document.getElementById('log-container');
    const campaignForm = document.getElementById('campaign-form');
    const nextBatchBtn = document.getElementById('next-batch-btn');
    const batchControlDiv = document.getElementById('batch-control');
    const batchStatusText = document.getElementById('batch-status-text');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const progressContainer = document.getElementById('progress-container');
    const progressPlaceholder = document.getElementById('progress-placeholder');
    const pauseBtn = document.getElementById('pause-campaign-btn');
    const resumeBtn = document.getElementById('resume-campaign-btn');
    const endBtn = document.getElementById('end-campaign-btn');
    const resetStatsBtn = document.getElementById('reset-stats-btn');

    logContainer.innerHTML = sessionLog.join('');
    logContainer.scrollTop = logContainer.scrollHeight;


    socket.on('log', (message) => {
        const logMessage = `<div>[${new Date().toLocaleTimeString()}] ${message.replace(/->/g, '&rarr;')}</div>`;
        sessionLog.push(logMessage);
        sessionStorage.setItem('sessionLog', JSON.stringify(sessionLog));
        logContainer.innerHTML += logMessage;
        logContainer.scrollTop = logContainer.scrollHeight;
    });
    socket.on('batchComplete', (data) => {
        document.getElementById('start-campaign-btn').disabled = true;
        batchControlDiv.classList.remove('hidden');
        batchStatusText.textContent = `Batch complete. Ready for batch #${data.nextBatch}.`;
    });
    socket.on('campaignState', (state) => {
        if (state.isRunning) {
            progressContainer.classList.remove('hidden');
            progressPlaceholder.classList.add('hidden');
            const percentage = state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
            progressBar.style.width = `${percentage}%`;
            progressText.textContent = `Sent: ${state.sent} / ${state.total} (${percentage}%) | Failed: ${state.failed}`;
            if (state.isPaused) {
                pauseBtn.classList.add('hidden');
                resumeBtn.classList.remove('hidden');
            } else {
                pauseBtn.classList.remove('hidden');
                resumeBtn.classList.add('hidden');
            }
        } else {
            progressContainer.classList.add('hidden');
            progressPlaceholder.classList.remove('hidden');
            batchControlDiv.classList.add('hidden');
            campaignForm.reset();
            document.getElementById('start-campaign-btn').disabled = false;
        }
    });

    socket.on('statsUpdated', () => {
        console.log('Stats updated event received, reloading stats...');
        loadDashboardStats();
    });

    campaignForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sessionLog = [];
        sessionStorage.removeItem('sessionLog');
        logContainer.innerHTML = '';

        const formData = new FormData(campaignForm);
        fetch('/api/campaign/start', { method: 'POST', body: formData })
        .then(res => res.json())
        .then(data => {
            if (!data.success) {
                alert('Error: ' + data.error);
            }
        });
    });
    
    nextBatchBtn.addEventListener('click', () => {
        socket.emit('sendNextBatch');
        batchControlDiv.classList.add('hidden');
    });
    pauseBtn.addEventListener('click', () => socket.emit('pauseCampaign'));
    resumeBtn.addEventListener('click', () => socket.emit('resumeCampaign'));
    endBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to end this campaign? Progress will be saved.')) {
            socket.emit('endCampaign');
        }
    });
    resetStatsBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset ALL statistics, including all campaign reports? This cannot be undone.')) {
            fetch('/api/stats/reset', { method: 'POST' }).then(() => loadDashboardStats());
        }
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
            document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
        });
    });
    
    const warmupCheckbox = document.getElementById('warmup-enabled');
    warmupCheckbox.addEventListener('change', () => {
        document.getElementById('warmup-settings').classList.toggle('hidden', !warmupCheckbox.checked);
        document.getElementById('daily-limit').disabled = warmupCheckbox.checked;
    });

    async function loadDashboardStats() {
        const res = await fetch('/api/stats');
        const stats = await res.json();
        const today = new Date().toISOString().split('T')[0];
        const todayEntry = stats.daily ? stats.daily.find(d => d.date === today) : null;
        document.getElementById('stat-total-sent').textContent = stats.totalSent || 0;
        document.getElementById('stat-total-campaigns').textContent = stats.totalCampaigns || 0;
        document.getElementById('stat-today-sent').textContent = `Sent: ${todayEntry ? todayEntry.sent : 0}`;
    }

    populateTemplatesDropdown(document.getElementById('template-select'));
    populateContactGroupsDropdown(document.getElementById('contact-group-select'));
    loadDashboardStats();
}

function initializeTemplatesPage() {
    let templatesCache = [];
    const templateForm = document.getElementById('template-form');
    const formTitle = document.getElementById('form-title');
    const saveBtn = document.getElementById('save-template-btn');
    const cancelBtn = document.getElementById('cancel-edit-btn');
    const idField = document.getElementById('template-id-field');
    const emojiPickerBtn = document.getElementById('emoji-picker-container');
    const emojiPickerWrapper = document.getElementById('emoji-picker-wrapper');
    const messageTextarea = document.getElementById('template-message');
    
    populateMediaDropdown(document.getElementById('media-select'));
    loadTemplates();
    setupEmojiPicker();

    function setupEmojiPicker() {
        const emojiPicker = document.querySelector('emoji-picker');
        emojiPicker.addEventListener('emoji-click', event => {
            messageTextarea.value += event.detail.unicode;
        });
        emojiPickerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            emojiPickerWrapper.classList.toggle('hidden');
        });
        document.addEventListener('click', (e) => {
            if (!emojiPickerWrapper.contains(e.target) && e.target !== emojiPickerBtn) {
                emojiPickerWrapper.classList.add('hidden');
            }
        });
    }

    function resetTemplateForm() {
        templateForm.reset();
        idField.value = '';
        formTitle.textContent = 'Create New Template';
        saveBtn.textContent = 'Save Template';
        cancelBtn.classList.add('hidden');
    }

    templateForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const isEditing = idField.value;
        const url = isEditing ? `/api/templates/${idField.value}` : '/api/templates';
        const method = isEditing ? 'PUT' : 'POST';
        const data = {
            name: document.getElementById('template-name').value,
            message: messageTextarea.value,
            filePaths: Array.from(document.getElementById('media-select').selectedOptions).map(opt => opt.value)
        };
        await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        resetTemplateForm();
        loadTemplates();
    });

    cancelBtn.addEventListener('click', resetTemplateForm);

    async function loadTemplates() {
        const list = document.getElementById('template-list');
        const response = await fetch('/api/templates');
        templatesCache = await response.json();
        list.innerHTML = '';
        templatesCache.forEach(t => {
            const div = document.createElement('div');
            div.className = 'list-item';
            div.innerHTML = `
                <div class="list-item-info"><strong>${t.name}</strong><br><small>${t.message.substring(0, 50)}...</small></div>
                <div class="list-item-actions">
                    <button class="edit-btn" data-id="${t.id}">Edit</button>
                    <button class="delete-btn" data-id="${t.id}">Delete</button>
                </div>`;
            list.appendChild(div);
        });
        
        list.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.dataset.id;
                fetch(`/api/templates/${id}`, { method: 'DELETE' }).then(() => loadTemplates());
            });
        });
        list.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.dataset.id;
                const templateToEdit = templatesCache.find(t => t.id == id);
                if (templateToEdit) {
                    formTitle.textContent = `Editing "${templateToEdit.name}"`;
                    idField.value = templateToEdit.id;
                    document.getElementById('template-name').value = templateToEdit.name;
                    messageTextarea.value = templateToEdit.message;
                    const mediaSelect = document.getElementById('media-select');
                    Array.from(mediaSelect.options).forEach(opt => {
                        opt.selected = (templateToEdit.filePaths || []).includes(opt.value);
                    });
                    saveBtn.textContent = 'Update Template';
                    cancelBtn.classList.remove('hidden');
                    window.scrollTo(0, 0);
                }
            });
        });
    }
}

function initializeMediaPage() {
    const mediaListContainer = document.getElementById('media-list-container');
    async function loadMedia() {
        const response = await fetch('/api/media');
        const files = await response.json();
        mediaListContainer.innerHTML = '';
        if (files.length === 0) {
            mediaListContainer.innerHTML = '<p>No media files uploaded yet.</p>';
            return;
        }
        files.forEach(file => {
            const div = document.createElement('div');
            div.className = 'media-item';
            const cacheBuster = new Date().getTime();
            const preview = file.isImage 
                ? `<img src="/media/${encodeURIComponent(file.name)}?t=${cacheBuster}" alt="${file.name}">`
                : `<div class="file-icon">📄</div>`;
            div.innerHTML = `
                ${preview}
                <p title="${file.name}">${file.name}</p>
                <div class="media-item-actions">
                    <button class="rename-btn" data-filename="${file.name}">Rename</button>
                    <button class="delete-btn" data-filename="${file.name}">Delete</button>
                </div>`;
            mediaListContainer.appendChild(div);
        });
        
        mediaListContainer.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const filename = e.target.dataset.filename;
                fetch(`/api/media/${filename}`, { method: 'DELETE' }).then(() => loadMedia());
            });
        });
        mediaListContainer.querySelectorAll('.rename-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const oldName = e.target.dataset.filename;
                const newName = prompt('Enter new filename:', oldName);
                if (newName && newName !== oldName) {
                    fetch('/api/media/rename', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ oldName, newName })
                    }).then(res => res.json()).then(data => {
                        if (!data.success) alert('Error: ' + data.error);
                        loadMedia();
                    });
                }
            });
        });
    }
    loadMedia();
}

function initializeReportsPage() {
    const reportListContainer = document.getElementById('report-list-container');
    const reportTitle = document.getElementById('report-title');
    const downloadPdfBtn = document.getElementById('download-pdf-btn');
    const reportTable = document.getElementById('report-table');
    const reportTableBody = reportTable.querySelector('tbody');
    const reportPlaceholder = document.getElementById('report-placeholder');
    const filterButtons = document.getElementById('filter-buttons');
    let currentReportData = [];

    async function loadReportList() {
        const response = await fetch('/api/reports');
        const reportFiles = await response.json();
        if (reportFiles.length === 0) {
            reportListContainer.innerHTML = '<p>No reports found.</p>';
            return;
        }
        const ul = document.createElement('ul');
        reportFiles.sort().reverse().forEach(file => {
            const li = document.createElement('li');
            li.className = 'report-list-item';
            li.innerHTML = `<span class="list-item-info">${file}</span><button class="delete-btn" data-filename="${file}">X</button>`;
            li.dataset.filename = file;
            ul.appendChild(li);
        });
        reportListContainer.innerHTML = '';
        reportListContainer.appendChild(ul);

        ul.querySelectorAll('.report-list-item').forEach(li => {
            li.addEventListener('click', (e) => {
                if(e.target.tagName === 'BUTTON') return;
                ul.querySelectorAll('li').forEach(item => item.classList.remove('active'));
                e.currentTarget.classList.add('active');
                loadReportData(e.currentTarget.dataset.filename);
            });
        });
        ul.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const filename = e.target.dataset.filename;
                fetch(`/api/reports/${filename}`, { method: 'DELETE' }).then(() => loadReportList());
            });
        });
    }
    
    async function loadReportData(filename) {
        reportTitle.textContent = 'Loading...';
        const response = await fetch(`/api/reports/${filename}`);
        currentReportData = await response.json();
        reportTitle.textContent = filename;
        reportTableBody.innerHTML = '';
        
        if (currentReportData.length > 0) {
            currentReportData.forEach(row => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${row.number || ''}</td><td>${row.name || ''}</td><td>${row.status || ''}</td>`;
                reportTableBody.appendChild(tr);
            });
            reportTable.classList.remove('hidden');
            reportPlaceholder.classList.add('hidden');
            downloadPdfBtn.classList.remove('hidden');
            filterButtons.classList.remove('hidden');
            filterButtons.querySelector('[data-status="all"]').click();
        } else {
            reportTable.classList.add('hidden');
            reportPlaceholder.classList.remove('hidden');
            reportPlaceholder.textContent = 'No data in this report.';
            downloadPdfBtn.classList.add('hidden');
            filterButtons.classList.add('hidden');
        }
    }

    downloadPdfBtn.addEventListener('click', () => {
        const doc = new jsPDF();
        doc.autoTable({
            head: [['Number', 'Name', 'Status']],
            body: currentReportData.map(row => [row.number, row.name, row.status]),
            startY: 15,
            didDrawPage: (data) => doc.text('Campaign Report', data.settings.margin.left, 10)
        });
        doc.save((reportTitle.textContent || 'report').replace('.csv', '.pdf'));
    });

    filterButtons.addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-btn')) {
            filterButtons.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const status = e.target.dataset.status;
            reportTable.querySelectorAll('tbody tr').forEach(row => {
                const rowStatus = row.cells[2].textContent;
                if (status === 'all' || rowStatus.includes(status)) row.style.display = '';
                else row.style.display = 'none';
            });
        }
    });

    loadReportList();
}

function initializeContactsPage() {
    const contactGroupList = document.getElementById('contact-group-list');
    const contactViewCard = document.getElementById('contact-view-card');
    const contactViewTitle = document.getElementById('contact-view-title');
    const contactTableBody = document.querySelector('#contact-table tbody');

    async function loadContactGroups() {
        const response = await fetch('/api/contacts');
        const files = await response.json();
        if (files.length === 0) {
            contactGroupList.innerHTML = '<p>No contact groups uploaded yet.</p>';
            return;
        }
        contactGroupList.innerHTML = '';
        files.forEach(file => {
            const div = document.createElement('div');
            div.className = 'list-item';
            div.innerHTML = `
                <div class="list-item-info" data-filename="${file.name}">
                    <strong>${file.name}</strong>
                    <small>Progress: ${file.progress} contacts done</small>
                </div>
                <div class="list-item-actions">
                    <button class="secondary-btn reset-btn" data-filename="${file.name}">Reset</button>
                    <button class="delete-btn" data-filename="${file.name}">Delete</button>
                </div>`;
            contactGroupList.appendChild(div);
        });
        contactGroupList.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const filename = e.target.dataset.filename;
                fetch(`/api/contacts/${filename}`, { method: 'DELETE' }).then(() => loadContactGroups());
            });
        });
        contactGroupList.querySelectorAll('.reset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const filename = e.target.dataset.filename;
                if (confirm(`Are you sure you want to reset the progress for ${filename}? The next campaign will start from the beginning.`)) {
                    fetch(`/api/contacts/${filename}/reset`, { method: 'POST' }).then(() => loadContactGroups());
                }
            });
        });
        contactGroupList.querySelectorAll('.list-item-info').forEach(item => {
            item.addEventListener('click', (e) => {
                const filename = e.currentTarget.dataset.filename;
                viewContactGroup(filename);
            });
        });
    }

    async function viewContactGroup(filename) {
        contactViewCard.classList.remove('hidden');
        contactViewTitle.textContent = `Viewing: ${filename}`;
        contactTableBody.innerHTML = '<tr><td colspan="3">Loading...</td></tr>';
        const response = await fetch(`/api/contacts/${filename}`);
        const contacts = await response.json();
        contactTableBody.innerHTML = '';
        if (contacts && contacts.length > 0) {
            contacts.forEach((contact, index) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${index + 1}</td><td>${contact.number}</td><td>${contact.name || ''}</td>`;
                contactTableBody.appendChild(tr);
            });
        } else {
            contactTableBody.innerHTML = '<tr><td colspan="3">No contacts found in this group.</td></tr>';
        }
    }
    loadContactGroups();
}

async function populateTemplatesDropdown(selectElement) {
    if (!selectElement) return;
    const response = await fetch('/api/templates');
    const templates = await response.json();
    selectElement.innerHTML = '';
    templates.forEach(t => {
        const option = document.createElement('option');
        option.value = t.id;
        option.textContent = t.name;
        selectElement.appendChild(option);
    });
}
async function populateMediaDropdown(selectElement) {
    if (!selectElement) return;
    const response = await fetch('/api/media');
    const mediaFiles = await response.json();
    selectElement.innerHTML = '';
    mediaFiles.forEach(file => {
        const option = document.createElement('option');
        option.value = file.name;
        option.textContent = file.name;
        selectElement.appendChild(option);
    });
}
async function populateContactGroupsDropdown(selectElement) {
    if (!selectElement) return;
    const response = await fetch('/api/contacts');
    const groups = await response.json();
    selectElement.innerHTML = '';
    if (groups.length === 0) {
        selectElement.innerHTML = '<option disabled selected>No groups found. Please upload one.</option>';
    }
    groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.name;
        option.textContent = group.name;
        selectElement.appendChild(option);
    });
}

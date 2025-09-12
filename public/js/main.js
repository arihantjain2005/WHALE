const { jsPDF } = window.jspdf;

// --- PERSISTENT LIVE LOG ---
let sessionLog = JSON.parse(sessionStorage.getItem("sessionLog")) || [];

function updateLog(message) {
  const logMessage = `<div>[${new Date().toLocaleTimeString()}] ${message.replace(
    /->/g,
    "&rarr;"
  )}</div>`;
  sessionLog.push(logMessage);
  sessionStorage.setItem("sessionLog", JSON.stringify(sessionLog));
  const logContainer = document.getElementById("log-container");
  if (logContainer) {
    logContainer.innerHTML += logMessage;
    logContainer.scrollTop = logContainer.scrollHeight;
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const socket = io();

  // Page Initializers
  if (document.getElementById("campaign-form")) initializeDashboardPage(socket);
  if (document.getElementById("template-form")) initializeTemplatesPage();
  if (document.getElementById("media-list-container")) initializeMediaPage();
  if (document.getElementById("report-list-container")) initializeReportsPage();
  if (document.getElementById("contact-group-list")) initializeContactsPage();

  // Global confirmation modal for delete actions
  document.body.addEventListener(
    "click",
    function (e) {
      if (e.target && e.target.classList.contains("delete-btn")) {
        if (
          !confirm(
            "Are you sure you want to delete this item? This action cannot be undone."
          )
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }
    },
    true
  );
});

// --- DASHBOARD PAGE ---
function initializeDashboardPage(socket) {
  // ... (No changes needed in this function, it can remain as it was in the last version) ...
  const statusIndicator = document.getElementById("status-indicator");
  const qrImage = document.getElementById("qr-image");
  const qrContainer = document.getElementById("qr-container");
  const authSuccess = document.getElementById("auth-success");
  const logContainer = document.getElementById("log-container");
  const campaignForm = document.getElementById("campaign-form");
  const nextBatchBtn = document.getElementById("next-batch-btn");
  const batchControlDiv = document.getElementById("batch-control");
  const batchStatusText = document.getElementById("batch-status-text");
  const progressBar = document.getElementById("progress-bar");
  const progressText = document.getElementById("progress-text");
  const progressContainer = document.getElementById("progress-container");
  const progressPlaceholder = document.getElementById("progress-placeholder");
  const pauseBtn = document.getElementById("pause-campaign-btn");
  const resumeBtn = document.getElementById("resume-campaign-btn");
  const endBtn = document.getElementById("end-campaign-btn");
  const resetStatsBtn = document.getElementById("reset-stats-btn");
  const startCampaignBtn = document.getElementById("start-campaign-btn");

  // Render persistent log on page load
  logContainer.innerHTML = sessionLog.join("");
  logContainer.scrollTop = logContainer.scrollHeight;

  // Socket listeners
  socket.on("status", (message) => (statusIndicator.textContent = message));
  socket.on("qr", (qr) => {
    qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
      qr
    )}&size=250x250`;
    qrContainer.classList.remove("hidden");
    authSuccess.classList.add("hidden");
  });
  socket.on("authenticated", () => {
    qrContainer.classList.add("hidden");
    authSuccess.classList.remove("hidden");
  });
  socket.on("show_qr", () => {
    qrContainer.classList.remove("hidden");
    authSuccess.classList.add("hidden");
    qrImage.src = "";
  });
  socket.on("log", (message) => updateLog(message));
  socket.on("batchComplete", (data) => {
    startCampaignBtn.disabled = true;
    batchControlDiv.classList.remove("hidden");
    batchStatusText.textContent = `Batch complete. Ready for batch #${data.nextBatch}.`;
  });
  socket.on("campaignState", (state) => {
    if (state.isRunning) {
      progressContainer.classList.remove("hidden");
      progressPlaceholder.classList.add("hidden");
      const percentage =
        state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
      progressBar.style.width = `${percentage}%`;
      progressText.textContent = `Sent: ${state.sent} / ${state.total} (${percentage}%) | Failed: ${state.failed}`;
      if (state.isPaused) {
        pauseBtn.classList.add("hidden");
        resumeBtn.classList.remove("hidden");
      } else {
        pauseBtn.classList.remove("hidden");
        resumeBtn.classList.add("hidden");
      }
      endBtn.classList.remove("hidden");
    } else {
      progressContainer.classList.add("hidden");
      progressPlaceholder.classList.remove("hidden");
      batchControlDiv.classList.add("hidden");
      campaignForm.reset();
      startCampaignBtn.disabled = false;
      pauseBtn.classList.add("hidden");
      resumeBtn.classList.add("hidden");
      endBtn.classList.add("hidden");
    }
  });
  socket.on("statsUpdated", () => loadDashboardStats());

  // Event Handlers
  campaignForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const selectedTemplateOptions =
      document.getElementById("template-select").selectedOptions;
    const contactFile = document.getElementById("contact-file").files[0];
    const contactGroup = document.getElementById("contact-group-select").value;
    const isUploading = document
      .querySelector('.tab-btn[data-tab="upload"]')
      .classList.contains("active");

    // --- Frontend Validation ---
    if (selectedTemplateOptions.length === 0) {
      return alert("Please select at least one template.");
    }
    if (isUploading && !contactFile) {
      return alert("Please select a contact file to upload.");
    }
    if (!isUploading && !contactGroup) {
      return alert("Please select a contact group to use.");
    }

    startCampaignBtn.disabled = true;

    sessionLog = []; // Clear log on new campaign start
    sessionStorage.removeItem("sessionLog");
    logContainer.innerHTML = "";
    
    const formData = new FormData(campaignForm);
    formData.delete("templateIds");
    Array.from(selectedTemplateOptions).forEach((option) => {
      formData.append("templateIds", option.value);
    });

    fetch("/api/campaign/start", { method: "POST", body: formData })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          alert("Error: " + (data.error || "Unknown error"));
          startCampaignBtn.disabled = false;
        }
      });
  });

  nextBatchBtn.addEventListener("click", () => {
    socket.emit("sendNextBatch");
    batchControlDiv.classList.add("hidden");
  });
  pauseBtn.addEventListener("click", () => socket.emit("pauseCampaign"));
  resumeBtn.addEventListener("click", () => socket.emit("resumeCampaign"));
  endBtn.addEventListener("click", () => {
    if (
      confirm(
        "Are you sure you want to end this campaign? Progress will be saved."
      )
    ) {
      socket.emit("endCampaign");
    }
  });
  resetStatsBtn.addEventListener("click", () => {
    if (
      confirm(
        "Are you sure you want to reset ALL statistics, including all campaign reports? This cannot be undone."
      )
    ) {
      fetch("/api/stats/reset", { method: "POST" }).then(() =>
        loadDashboardStats()
      );
    }
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".tab-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document
        .querySelectorAll(".tab-content")
        .forEach((c) => c.classList.add("hidden"));
      document
        .getElementById(`tab-${btn.dataset.tab}`)
        .classList.remove("hidden");
    });
  });

  document.getElementById("warmup-enabled").addEventListener("change", (e) => {
    document
      .getElementById("warmup-settings")
      .classList.toggle("hidden", !e.target.checked);
    document.getElementById("daily-limit").disabled = e.target.checked;
  });

  async function loadDashboardStats() {
    const res = await fetch("/api/stats");
    const stats = await res.json();
    const todayEntry = stats.daily
      ? stats.daily.find(
          (d) => d.date === new Date().toISOString().split("T")[0]
        )
      : null;
    document.getElementById("stat-total-sent").textContent =
      stats.totalSent || 0;
    document.getElementById("stat-total-campaigns").textContent =
      stats.totalCampaigns || 0;
    document.getElementById("stat-today-sent").textContent = `Sent: ${
      todayEntry ? todayEntry.sent : 0
    }`;
  }

  populateTemplatesDropdown(document.getElementById("template-select"));
  populateContactGroupsDropdown(
    document.getElementById("contact-group-select")
  );
  loadDashboardStats();
}

// --- TEMPLATES PAGE ---
function initializeTemplatesPage() {
  let templatesCache = [];
  const templateForm = document.getElementById("template-form");
  const formTitle = document.getElementById("form-title");
  const saveBtn = document.getElementById("save-template-btn");
  const cancelBtn = document.getElementById("cancel-edit-btn");
  const idField = document.getElementById("template-id-field");
  const messageTextarea = document.getElementById("template-message");

  const emojiPickerBtn = document.getElementById("emoji-picker-container");
  const emojiPickerWrapper = document.getElementById("emoji-picker-wrapper");
  const emojiPicker = document.querySelector("emoji-picker");
  
  if (emojiPicker) {
      emojiPicker.addEventListener('emoji-click', event => {
          messageTextarea.value += event.detail.unicode;
      });
  }
  emojiPickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      emojiPickerWrapper.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
      if (!emojiPickerWrapper.contains(e.target) && !emojiPickerBtn.contains(e.target)) {
          emojiPickerWrapper.classList.add('hidden');
      }
  });

  let currentOrderedFiles = [];
  const mediaSelect = document.getElementById('media-select');
  const selectedMediaContainer = document.getElementById('selected-media-list');

  function renderSelectedMedia() {
      selectedMediaContainer.innerHTML = '';
      if (currentOrderedFiles.length === 0) return;

      const ul = document.createElement('ul');
      currentOrderedFiles.forEach((file, index) => {
          const li = document.createElement('li');
          li.innerHTML = `
              <span>${file}</span>
              <div>
                  <button type="button" class="move-up" data-index="${index}" ${index === 0 ? 'disabled' : ''}>⬆️</button>
                  <button type="button" class="move-down" data-index="${index}" ${index === currentOrderedFiles.length - 1 ? 'disabled' : ''}>⬇️</button>
              </div>`;
          ul.appendChild(li);
      });
      selectedMediaContainer.appendChild(ul);

      ul.querySelectorAll('.move-up, .move-down').forEach(btn => {
          btn.addEventListener('click', e => {
              const index = parseInt(e.target.dataset.index);
              const direction = e.target.classList.contains('move-up') ? -1 : 1;
              const newIndex = index + direction;
              if (newIndex >= 0 && newIndex < currentOrderedFiles.length) {
                  [currentOrderedFiles[index], currentOrderedFiles[newIndex]] = [currentOrderedFiles[newIndex], currentOrderedFiles[index]];
                  renderSelectedMedia();
              }
          });
      });
  }
  
  mediaSelect.addEventListener('change', () => {
      currentOrderedFiles = [...mediaSelect.selectedOptions].map(opt => opt.value);
      renderSelectedMedia();
  });


  function resetTemplateForm() {
    templateForm.reset();
    idField.value = "";
    formTitle.textContent = "Create New Template";
    saveBtn.textContent = "Save Template";
    cancelBtn.classList.add("hidden");
    currentOrderedFiles = [];
    renderSelectedMedia();
    [...mediaSelect.options].forEach(opt => opt.selected = false);
  }

  templateForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const isEditing = idField.value;
    const url = isEditing
      ? `/api/templates/${idField.value}`
      : "/api/templates";
    const method = isEditing ? "PUT" : "POST";
    const data = {
      name: document.getElementById("template-name").value,
      message: messageTextarea.value,
      filePaths: currentOrderedFiles, // Use the reordered list
    };
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    resetTemplateForm();
    loadTemplates();
  });

  cancelBtn.addEventListener("click", resetTemplateForm);

  async function loadTemplates() {
    const list = document.getElementById("template-list");
    const response = await fetch("/api/templates");
    templatesCache = await response.json();
    list.innerHTML = "";
    templatesCache.forEach((t) => {
      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `
                <div class="list-item-info"><strong>${
                  t.name
                }</strong><br><small>${t.message.substring(
        0,
        50
      )}...</small></div>
                <div class="list-item-actions">
                    <button class="edit-btn" data-id="${t.id}">Edit</button>
                    <button class="delete-btn" data-id="${t.id}">Delete</button>
                </div>`;
      list.appendChild(div);
    });

    list.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = e.target.dataset.id;
        fetch(`/api/templates/${id}`, { method: "DELETE" }).then(() =>
          loadTemplates()
        );
      });
    });
    list.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const templateToEdit = templatesCache.find(
          (t) => t.id == e.target.dataset.id
        );
        if (templateToEdit) {
          formTitle.textContent = `Editing "${templateToEdit.name}"`;
          idField.value = templateToEdit.id;
          document.getElementById("template-name").value = templateToEdit.name;
          messageTextarea.value = templateToEdit.message;
          
          currentOrderedFiles = templateToEdit.filePaths || [];
          [...mediaSelect.options].forEach(
            (opt) => {
              opt.selected = currentOrderedFiles.includes(
                opt.value
              );
            }
          );
          renderSelectedMedia();

          saveBtn.textContent = "Update Template";
          cancelBtn.classList.remove("hidden");
          window.scrollTo(0, 0);
        }
      });
    });
  }

  populateMediaDropdown(document.getElementById("media-select"));
  loadTemplates();
}

// --- MEDIA PAGE ---
function initializeMediaPage() {
    // ... (No changes needed in this function, it can remain as it was in the last version) ...
    const mediaListContainer = document.getElementById("media-list-container");
    async function loadMedia() {
    const response = await fetch("/api/media");
    const files = await response.json();
    mediaListContainer.innerHTML = "";
    if (files.length === 0) {
      mediaListContainer.innerHTML = "<p>No media files uploaded yet.</p>";
      return;
    }
    files.forEach((file) => {
      const div = document.createElement("div");
      div.className = "media-item";
      const timestamp = new Date().getTime();
      const preview = file.isImage
        ? `<img src="/media/${encodeURIComponent(
            file.name
          )}?t=${timestamp}" alt="${file.name}">`
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

    mediaListContainer.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const filename = e.target.dataset.filename;
        fetch(`/api/media/${filename}`, { method: "DELETE" }).then(() =>
          loadMedia()
        );
      });
    });
    mediaListContainer.querySelectorAll(".rename-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const oldName = e.target.dataset.filename;
        const newName = prompt("Enter new filename:", oldName);
        if (newName && newName !== oldName) {
          fetch("/api/media/rename", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ oldName, newName }),
          })
            .then((res) => res.json())
            .then((data) => {
              if (!data.success) alert("Error: " + data.error);
              loadMedia();
            });
        }
      });
    });
  }
  loadMedia();
}

// --- REPORTS PAGE ---
function initializeReportsPage() {
    // ... (No changes needed in this function, it can remain as it was in the last version) ...
    let currentReportData = [];
    const reportListContainer = document.getElementById("report-list-container");
    const reportTitle = document.getElementById("report-title");
    const downloadPdfBtn = document.getElementById("download-pdf-btn");
    const reportTable = document.getElementById("report-table");
    const reportTableBody = reportTable.querySelector("tbody");
    const reportPlaceholder = document.getElementById("report-placeholder");
    const filterButtons = document.getElementById("filter-buttons");

    async function loadReportList() {
    const response = await fetch("/api/reports");
    const reportFiles = await response.json();
    reportListContainer.innerHTML = "";
    if (reportFiles.length === 0) {
      reportListContainer.innerHTML = "<p>No reports found.</p>";
      return;
    }
    const ul = document.createElement("ul");
    reportFiles
      .sort()
      .reverse()
      .forEach((file) => {
        const li = document.createElement("li");
        li.className = "report-list-item";
        li.innerHTML = `<span class="list-item-info">${file}</span><button class="delete-btn" data-filename="${file}">X</button>`;
        li.dataset.filename = file;
        ul.appendChild(li);
      });
    reportListContainer.appendChild(ul);

    ul.querySelectorAll(".list-item-info").forEach((li) => {
      li.addEventListener("click", (e) => {
        ul.querySelectorAll("li").forEach((item) =>
          item.classList.remove("active")
        );
        e.currentTarget.parentElement.classList.add("active");
        loadReportData(e.currentTarget.parentElement.dataset.filename);
      });
    });
    ul.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const filename = e.target.dataset.filename;
        fetch(`/api/reports/${filename}`, { method: "DELETE" }).then(() => {
          loadReportList();
          reportTitle.textContent = "Select a report to view";
          reportTable.classList.add("hidden");
          reportPlaceholder.classList.remove("hidden");
        });
      });
    });
    }

    async function loadReportData(filename) {
    reportTitle.textContent = "Loading...";
    const response = await fetch(`/api/reports/${filename}`);
    currentReportData = await response.json();
    reportTitle.textContent = filename;

    if (currentReportData.length > 0) {
      reportTable.classList.remove("hidden");
      reportPlaceholder.classList.add("hidden");
      downloadPdfBtn.classList.remove("hidden");
      filterButtons.classList.remove("hidden");
      filterButtons.querySelector('[data-status="all"]').click();
    } else {
      reportTable.classList.add("hidden");
      reportPlaceholder.classList.remove("hidden");
      reportPlaceholder.textContent = "No data in this report.";
      downloadPdfBtn.classList.add("hidden");
      filterButtons.classList.add("hidden");
    }
    }

    downloadPdfBtn.addEventListener("click", () => {
    const doc = new jsPDF();
    doc.autoTable({
      head: [["Number", "Name", "Status"]],
      body: currentReportData.map((row) => [row.number, row.name, row.status]),
      startY: 15,
      didDrawPage: (data) =>
        doc.text("Campaign Report", data.settings.margin.left, 10),
    });
    doc.save((reportTitle.textContent || "report").replace(".csv", ".pdf"));
    });

    filterButtons.addEventListener("click", (e) => {
    if (e.target.classList.contains("filter-btn")) {
      filterButtons
        .querySelectorAll(".filter-btn")
        .forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      const status = e.target.dataset.status;
      reportTableBody.innerHTML = "";
      const filteredData =
        status === "all"
          ? currentReportData
          : currentReportData.filter((row) =>
              (row.status || "").includes(status)
            );
      filteredData.forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${row.number || ""}</td><td>${
          row.name || ""
        }</td><td>${row.status || ""}</td>`;
        reportTableBody.appendChild(tr);
      });
    }
    });

    loadReportList();
}

// --- CONTACTS PAGE ---
function initializeContactsPage() {
    // ... (No changes needed in this function, it can remain as it was in the last version) ...
    let currentContacts = [];
    let currentFilename = "";
    const contactGroupList = document.getElementById("contact-group-list");
    const contactViewCard = document.getElementById("contact-view-card");
    const contactViewTitle = document.getElementById("contact-view-title");
    const contactTableBody = document.querySelector("#contact-table tbody");
    const saveBtn = document.getElementById("save-contacts-btn");
    const searchBar = document.getElementById("contact-search-bar");

    async function loadContactGroups() {
    const response = await fetch("/api/contacts");
    const files = await response.json();
    contactGroupList.innerHTML = "";
    if (files.length === 0) {
      contactGroupList.innerHTML = "<p>No contact groups uploaded yet.</p>";
      return;
    }
    files.forEach((file) => {
      const div = document.createElement("div");
      div.className = "list-item";
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
    contactGroupList.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const filename = e.target.dataset.filename;
        fetch(`/api/contacts/${filename}`, { method: "DELETE" }).then(() =>
          loadContactGroups()
        );
      });
    });
    contactGroupList.querySelectorAll(".reset-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const filename = e.target.dataset.filename;
        if (
          confirm(
            `Are you sure you want to reset the progress for ${filename}? The next campaign will start from the beginning.`
          )
        ) {
          fetch(`/api/contacts/${filename}/reset`, { method: "POST" }).then(
            () => loadContactGroups()
          );
        }
      });
    });
    contactGroupList.querySelectorAll(".list-item-info").forEach((item) => {
      item.addEventListener("click", (e) => {
        viewContactGroup(e.currentTarget.dataset.filename);
      });
    });
    }

    async function viewContactGroup(filename) {
    currentFilename = filename;
    contactViewCard.classList.remove("hidden");
    contactViewTitle.textContent = `Viewing: ${filename}`;
    contactTableBody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
    const response = await fetch(`/api/contacts/${filename}`);
    currentContacts = await response.json();
    renderContacts(currentContacts);
    saveBtn.classList.add("hidden");
    }

    function renderContacts(contacts) {
    contactTableBody.innerHTML = "";
    if (!contacts || contacts.length === 0) {
      contactTableBody.innerHTML =
        '<tr><td colspan="4">No contacts found in this group.</td></tr>';
      return;
    }
    contacts.forEach((contact, index) => {
      const tr = document.createElement("tr");
      tr.dataset.index = index;
      tr.innerHTML = `
                <td>${index + 1}</td>
                <td contenteditable="true" data-field="number">${
                  contact.number || ""
                }</td>
                <td contenteditable="true" data-field="name">${
                  contact.name || ""
                }</td>
                <td><button class="delete-contact-btn delete-btn">Delete</button></td>`;
      contactTableBody.appendChild(tr);
    });
    }

    contactTableBody.addEventListener("input", (e) => {
    if (e.target.isContentEditable) {
      const index = e.target.parentElement.dataset.index;
      const field = e.target.dataset.field;
      currentContacts[index][field] = e.target.textContent;
      saveBtn.classList.remove("hidden");
    }
    });

    contactTableBody.addEventListener("click", (e) => {
    if (e.target.classList.contains("delete-contact-btn")) {
      const index = e.target.parentElement.parentElement.dataset.index;
      currentContacts.splice(index, 1);
      renderContacts(currentContacts);
      saveBtn.classList.remove("hidden");
    }
    });

    searchBar.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const filteredContacts = currentContacts.filter(
      (c) =>
        (c.number || "").toString().toLowerCase().includes(searchTerm) ||
        (c.name || "").toLowerCase().includes(searchTerm)
    );
    renderContacts(filteredContacts);
    });

    saveBtn.addEventListener("click", async () => {
    saveBtn.textContent = "Saving...";
    saveBtn.disabled = true;
    const res = await fetch(`/api/contacts/${currentFilename}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentContacts),
    });
    const data = await res.json();
    if (data.success) {
      alert("Changes saved successfully!");
      saveBtn.classList.add("hidden");
    } else {
      alert("Error saving changes: " + data.error);
    }
    saveBtn.textContent = "Save Changes";
    saveBtn.disabled = false;
    });

    loadContactGroups();
}

// --- GLOBAL HELPER FUNCTIONS ---
async function populateTemplatesDropdown(selectElement) {
  if (!selectElement) return;
  const response = await fetch("/api/templates");
  const templates = await response.json();
  selectElement.innerHTML = "";
  templates.forEach((t) => {
    const option = document.createElement("option");
    option.value = t.id;
    option.textContent = t.name;
    selectElement.appendChild(option);
  });
}
async function populateMediaDropdown(selectElement) {
  if (!selectElement) return;
  const response = await fetch("/api/media");
  const mediaFiles = await response.json();
  selectElement.innerHTML = "";
  mediaFiles.forEach((file) => {
    const option = document.createElement("option");
    option.value = file.name;
    option.textContent = file.name;
    selectElement.appendChild(option);
  });
}
async function populateContactGroupsDropdown(selectElement) {
  if (!selectElement) return;
  const response = await fetch("/api/contacts");
  const groups = await response.json();
  selectElement.innerHTML = "";
  if (groups.length === 0) {
    selectElement.innerHTML =
      "<option disabled selected>No groups. Upload one on the Contacts page.</option>";
    return;
  }
  groups.forEach((group) => {
    const option = document.createElement("option");
    option.value = group.name;
    option.textContent = group.name;
    selectElement.appendChild(option);
  });
}
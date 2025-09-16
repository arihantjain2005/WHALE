import {
  populateTemplatesDropdown,
  populateContactGroupsDropdown,
} from "../helpers/ui.js";

let sessionLog = JSON.parse(sessionStorage.getItem("sessionLog")) || [];

function updateLog(message) {
    const logContainer = document.getElementById("log-container");
    const logMessage = `<div>[${new Date().toLocaleTimeString()}] ${message.replace(
        /->/g,
        "&rarr;"
    )}</div>`;
    sessionLog.push(logMessage);
    sessionStorage.setItem("sessionLog", JSON.stringify(sessionLog));
    if (logContainer) {
        logContainer.innerHTML += logMessage;
        logContainer.scrollTop = logContainer.scrollHeight;
    }
}

export function initializeDashboardPage(socket) {
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
    if (logContainer) {
        logContainer.innerHTML = sessionLog.join("");
        logContainer.scrollTop = logContainer.scrollHeight;
    }
    
    // Socket listeners
    socket.on("status", (message) => (statusIndicator.textContent = message));
    socket.on("qr", (qr) => {
        qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=250x250`;
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
            const percentage = state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
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
        const selectedTemplateOptions = document.getElementById("template-select").selectedOptions;
        const contactFile = document.getElementById("contact-file").files[0];
        const contactGroup = document.getElementById("contact-group-select").value;
        const isUploading = document.querySelector('.tab-btn[data-tab="upload"]').classList.contains("active");

        if (selectedTemplateOptions.length === 0) return alert("Please select at least one template.");
        if (isUploading && !contactFile) return alert("Please select a contact file to upload.");
        if (!isUploading && !contactGroup) return alert("Please select a contact group to use.");

        startCampaignBtn.disabled = true;
        sessionLog = [];
        sessionStorage.removeItem("sessionLog");
        logContainer.innerHTML = "";

        const formData = new FormData(campaignForm);
        formData.delete("templateIds");
        Array.from(selectedTemplateOptions).forEach(option => formData.append("templateIds", option.value));

        fetch("/api/campaign/start", { method: "POST", body: formData })
            .then(res => res.json())
            .then(data => {
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
        if (confirm("Are you sure you want to end this campaign? Progress will be saved.")) {
            socket.emit("endCampaign");
        }
    });
    resetStatsBtn.addEventListener("click", () => {
        if (confirm("Are you sure you want to reset ALL statistics, including all campaign reports? This cannot be undone.")) {
            fetch("/api/stats/reset", { method: "POST" }).then(() => loadDashboardStats());
        }
    });

    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
            document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
        });
    });

    document.getElementById("warmup-enabled").addEventListener("change", (e) => {
        document.getElementById("warmup-settings").classList.toggle("hidden", !e.target.checked);
        document.getElementById("daily-limit").disabled = e.target.checked;
    });

    async function loadDashboardStats() {
        const res = await fetch("/api/stats");
        const stats = await res.json();
        const todayEntry = stats.daily ? stats.daily.find(d => d.date === new Date().toISOString().split("T")[0]) : null;
        document.getElementById("stat-total-sent").textContent = stats.totalSent || 0;
        document.getElementById("stat-total-campaigns").textContent = stats.totalCampaigns || 0;
        document.getElementById("stat-today-sent").textContent = `Sent: ${todayEntry ? todayEntry.sent : 0}`;
    }

    populateTemplatesDropdown(document.getElementById("template-select"));
    populateContactGroupsDropdown(document.getElementById("contact-group-select"));
    loadDashboardStats();
}
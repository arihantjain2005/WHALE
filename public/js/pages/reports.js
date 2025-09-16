export function initializeReportsPage() {
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
                ul.querySelectorAll("li").forEach((item) => item.classList.remove("active"));
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
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.autoTable({
            head: [["Number", "Name", "Status"]],
            body: currentReportData.map((row) => [row.number, row.name, row.status]),
            startY: 15,
            didDrawPage: (data) => doc.text("Campaign Report", data.settings.margin.left, 10),
        });
        doc.save((reportTitle.textContent || "report").replace(".csv", ".pdf"));
    });

    filterButtons.addEventListener("click", (e) => {
        if (e.target.classList.contains("filter-btn")) {
            filterButtons.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
            e.target.classList.add("active");
            const status = e.target.dataset.status;
            reportTableBody.innerHTML = "";
            const filteredData = status === "all" ?
                currentReportData :
                currentReportData.filter((row) => (row.status || "").includes(status));
            filteredData.forEach((row) => {
                const tr = document.createElement("tr");
                tr.innerHTML = `<td>${row.number || ""}</td><td>${row.name || ""}</td><td>${row.status || ""}</td>`;
                reportTableBody.appendChild(tr);
            });
        }
    });

    loadReportList();
}
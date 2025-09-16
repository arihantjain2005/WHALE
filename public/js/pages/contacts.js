export function initializeContactsPage() {
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
                fetch(`/api/contacts/${filename}`, { method: "DELETE" }).then(() => loadContactGroups());
            });
        });
        contactGroupList.querySelectorAll(".reset-btn").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                const filename = e.target.dataset.filename;
                if (confirm(`Are you sure you want to reset the progress for ${filename}? The next campaign will start from the beginning.`)) {
                    fetch(`/api/contacts/${filename}/reset`, { method: "POST" }).then(() => loadContactGroups());
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
            contactTableBody.innerHTML = '<tr><td colspan="4">No contacts found in this group.</td></tr>';
            return;
        }
        contacts.forEach((contact, index) => {
            const tr = document.createElement("tr");
            tr.dataset.index = index;
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td contenteditable="true" data-field="number">${contact.number || ""}</td>
                <td contenteditable="true" data-field="name">${contact.name || ""}</td>
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
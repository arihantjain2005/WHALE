import { populateMediaDropdown } from '../helpers/ui.js';

export function initializeTemplatesPage() {
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
        const url = isEditing ? `/api/templates/${idField.value}` : "/api/templates";
        const method = isEditing ? "PUT" : "POST";
        const data = {
            name: document.getElementById("template-name").value,
            message: messageTextarea.value,
            filePaths: currentOrderedFiles,
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
                <div class="list-item-info"><strong>${t.name}</strong><br><small>${t.message.substring(0,50)}...</small></div>
                <div class="list-item-actions">
                    <button class="edit-btn" data-id="${t.id}">Edit</button>
                    <button class="delete-btn" data-id="${t.id}">Delete</button>
                </div>`;
            list.appendChild(div);
        });

        list.querySelectorAll(".delete-btn").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                const id = e.target.dataset.id;
                fetch(`/api/templates/${id}`, { method: "DELETE" }).then(() => loadTemplates());
            });
        });

        list.querySelectorAll(".edit-btn").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                const templateToEdit = templatesCache.find((t) => t.id == e.target.dataset.id);
                if (templateToEdit) {
                    formTitle.textContent = `Editing "${templateToEdit.name}"`;
                    idField.value = templateToEdit.id;
                    document.getElementById("template-name").value = templateToEdit.name;
                    messageTextarea.value = templateToEdit.message;
                    currentOrderedFiles = templateToEdit.filePaths || [];
                    [...mediaSelect.options].forEach(opt => {
                        opt.selected = currentOrderedFiles.includes(opt.value);
                    });
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
export async function populateTemplatesDropdown(selectElement) {
    if (!selectElement) return;
    try {
        const response = await fetch("/api/templates");
        const templates = await response.json();
        selectElement.innerHTML = "";
        templates.forEach((t) => {
            const option = document.createElement("option");
            option.value = t.id;
            option.textContent = t.name;
            selectElement.appendChild(option);
        });
    } catch (error) {
        console.error("Failed to populate templates dropdown:", error);
    }
}

export async function populateMediaDropdown(selectElement) {
    if (!selectElement) return;
    try {
        const response = await fetch("/api/media");
        const mediaFiles = await response.json();
        selectElement.innerHTML = "";
        mediaFiles.forEach((file) => {
            const option = document.createElement("option");
            option.value = file.name;
            option.textContent = file.name;
            selectElement.appendChild(option);
        });
    } catch (error) {
        console.error("Failed to populate media dropdown:", error);
    }
}

export async function populateContactGroupsDropdown(selectElement) {
    if (!selectElement) return;
    try {
        const response = await fetch("/api/contacts");
        const groups = await response.json();
        selectElement.innerHTML = "";
        if (groups.length === 0) {
            selectElement.innerHTML = "<option disabled selected>No groups. Upload one on the Contacts page.</option>";
            return;
        }
        groups.forEach((group) => {
            const option = document.createElement("option");
            option.value = group.name;
            option.textContent = group.name;
            selectElement.appendChild(option);
        });
    } catch (error) {
        console.error("Failed to populate contact groups dropdown:", error);
    }
}
export function initializeMediaPage() {
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
            const preview = file.isImage ?
                `<img src="/media/${encodeURIComponent(file.name)}?t=${timestamp}" alt="${file.name}">` :
                `<div class="file-icon">📄</div>`;
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
                fetch(`/api/media/${filename}`, { method: "DELETE" }).then(() => loadMedia());
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
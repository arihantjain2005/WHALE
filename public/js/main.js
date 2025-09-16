import { initializeDashboardPage } from './pages/dashboard.js';
import { initializeTemplatesPage } from './pages/templates.js';
import { initializeMediaPage } from './pages/media.js';
import { initializeReportsPage } from './pages/reports.js';
import { initializeContactsPage } from './pages/contacts.js';

document.addEventListener("DOMContentLoaded", function () {
    const socket = io();

    // --- PAGE INITIALIZERS ---
    if (document.getElementById("campaign-form")) initializeDashboardPage(socket);
    if (document.getElementById("template-form")) initializeTemplatesPage();
    if (document.getElementById("media-list-container")) initializeMediaPage();
    if (document.getElementById("report-list-container")) initializeReportsPage();
    if (document.getElementById("contact-group-list")) initializeContactsPage();

    // --- GLOBAL CONFIRMATION MODAL ---
    document.body.addEventListener('click', function(e) {
        if (e.target && e.target.classList.contains('delete-btn')) {
            if (!confirm('Are you sure you want to delete this item? This action cannot be undone.')) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }
    }, true);
});
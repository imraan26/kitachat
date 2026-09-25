/*
 * Shared UI helpers.
 * Load after app.js so these handlers can use the application functions
 * (loadAlbumPhotos, loadAgendaAndBirthdays, and loadFamilyMembers).
 */
(() => {
    'use strict';

    const CONTENT_PREFIX = 'content-';
    const CALL_MODAL_ID = 'call-modal';

    function getTabContents() {
        return document.querySelectorAll('.tab-content');
    }

    function getMenuItems() {
        return document.querySelectorAll('.menu-item');
    }

    function isNavigationItem(item, tabName) {
        const handler = item.getAttribute('onclick') || '';
        return handler.includes(`'${tabName}'`) || handler.includes(`"${tabName}"`);
    }

    function setActiveMenu(tabName, clickedItem) {
        getMenuItems().forEach((item) => {
            item.classList.toggle(
                'active',
                item === clickedItem || isNavigationItem(item, tabName)
            );
        });
    }

    function showTab(tabName) {
        const target = document.getElementById(`${CONTENT_PREFIX}${tabName}`);
        if (!target) return false;

        getTabContents().forEach((content) => {
            if (content.id === CALL_MODAL_ID) return;
            const isTarget = content === target;
            content.classList.toggle('hidden', !isTarget);
            content.style.display = isTarget ? 'flex' : 'none';
        });

        return true;
    }

    function loadTabData(tabName) {
        const loaders = {
            album: window.loadAlbumPhotos,
            agenda: window.loadAgendaAndBirthdays,
            family: window.loadFamilyMembers
        };

        const loader = loaders[tabName];
        if (typeof loader === 'function') loader();
    }

    // Centralized tab navigation. The public signature remains compatible with
    // existing inline onclick handlers: switchTabNav('album', this).
    window.switchTabNav = function switchTabNav(tabName, clickedItem = null) {
        if (!showTab(tabName)) return;
        setActiveMenu(tabName, clickedItem);
        loadTabData(tabName);
    };

    // Close open album menus without creating multiple document listeners.
    if (!window.__kitachatAlbumMenuListener) {
        window.__kitachatAlbumMenuListener = true;
        document.addEventListener('click', () => {
            document.querySelectorAll('.photo-dropdown.active').forEach((menu) => {
                menu.classList.remove('active');
            });
        });
    }
})();

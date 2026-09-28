(() => {
  'use strict';

  const CONTENT_PREFIX = 'content-';

  // Hanya elemen dengan ID content-* yang dianggap sebagai halaman/tab.
  // Modal seperti call-modal, password-modal, email-modal, dan otp-modal
  // tidak akan ikut disembunyikan saat navigasi.
  const TAB_SELECTOR = '[id^="content-"].tab-content';

  const TAB_NAMES = new Set([
    'chat',
    'album',
    'agenda',
    'family',
    'settings'
  ]);

  function getElement(id) {
    return document.getElementById(id);
  }

  function getTabContents() {
    return Array.from(document.querySelectorAll(TAB_SELECTOR));
  }

  function getMenuItems() {
    return Array.from(document.querySelectorAll('.menu-item'));
  }

  function getTabNameFromItem(item) {
    if (!item) {
      return null;
    }

    const dataTab = item.dataset.tab;

    if (dataTab && TAB_NAMES.has(dataTab)) {
      return dataTab;
    }

    const onclick = item.getAttribute('onclick') || '';
    const match = onclick.match(
      /switchTabNav\s*\(\s*['"]([^'"]+)['"]/
    );

    return match && TAB_NAMES.has(match[1])
      ? match[1]
      : null;
  }

  function setAriaState(element, isActive) {
    if (!element) {
      return;
    }

    element.setAttribute('aria-hidden', String(!isActive));
  }

  function setActiveMenu(tabName, clickedItem = null) {
    getMenuItems().forEach(item => {
      const itemTab = getTabNameFromItem(item);
      const isActive = item === clickedItem || itemTab === tabName;

      item.classList.toggle('active', isActive);
      item.setAttribute('aria-selected', String(isActive));
      item.setAttribute('tabindex', isActive ? '0' : '-1');
    });
  }

  function showTab(tabName) {
    if (!TAB_NAMES.has(tabName)) {
      console.warn(`Tab tidak dikenal: ${tabName}`);
      return false;
    }

    const target = getElement(`${CONTENT_PREFIX}${tabName}`);

    if (!target) {
      console.warn(`Konten tab tidak ditemukan: content-${tabName}`);
      return false;
    }

    getTabContents().forEach(content => {
      const isTarget = content === target;

      content.classList.toggle('hidden', !isTarget);
      content.style.display = isTarget ? 'flex' : 'none';

      setAriaState(content, isTarget);
    });

    target.classList.add('active');

    return true;
  }

  function getLoader(tabName) {
    const loaders = {
      album: window.loadAlbumPhotos,
      agenda: window.loadAgendaAndBirthdays,
      family: window.loadFamilyMembers
    };

    return loaders[tabName];
  }

  async function loadTabData(tabName) {
    const loader = getLoader(tabName);

    if (typeof loader !== 'function') {
      return;
    }

    try {
      await Promise.resolve(loader());
    } catch (error) {
      console.error(`Gagal memuat data tab ${tabName}:`, error);
    }
  }

  function closePhotoMenus(except = null) {
    document
      .querySelectorAll('.photo-dropdown.active')
      .forEach(menu => {
        if (menu !== except) {
          menu.classList.remove('active');
        }
      });
  }

  function initializeMenuAccessibility() {
    getMenuItems().forEach(item => {
      const tabName = getTabNameFromItem(item);

      if (!tabName) {
        return;
      }

      item.setAttribute('role', 'tab');
      item.setAttribute('aria-controls', `${CONTENT_PREFIX}${tabName}`);

      if (!item.hasAttribute('aria-selected')) {
        item.setAttribute(
          'aria-selected',
          String(item.classList.contains('active'))
        );
      }
    });

    getTabContents().forEach(content => {
      content.setAttribute('role', 'tabpanel');

      const isActive =
        content.classList.contains('active') &&
        !content.classList.contains('hidden');

      content.setAttribute('aria-hidden', String(!isActive));
    });
  }

  function initializeDefaultTab() {
    const activeContent = getTabContents().find(content => {
      return (
        content.classList.contains('active') &&
        !content.classList.contains('hidden')
      );
    });

    const defaultTab = activeContent
      ? activeContent.id.replace(CONTENT_PREFIX, '')
      : 'chat';

    const activeMenu = getMenuItems().find(item => {
      return getTabNameFromItem(item) === defaultTab;
    });

    showTab(defaultTab);
    setActiveMenu(defaultTab, activeMenu || null);
  }

  // Tetap kompatibel dengan:
  // switchTabNav('album')
  // switchTabNav('album', this)
  window.switchTabNav = async function switchTabNav(
    tabName,
    clickedItem = null
  ) {
    const normalizedTabName = String(tabName || '').trim().toLowerCase();

    if (!showTab(normalizedTabName)) {
      return false;
    }

    setActiveMenu(normalizedTabName, clickedItem);
    closePhotoMenus();

    await loadTabData(normalizedTabName);

    return true;
  };

  // Listener global hanya dibuat sekali.
  if (!window.__kitachatUiHelpersInitialized) {
    window.__kitachatUiHelpersInitialized = true;

    document.addEventListener('click', event => {
      const clickedMenu = event.target.closest('.photo-dropdown');

      if (!clickedMenu) {
        closePhotoMenus();
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closePhotoMenus();

        const zoomModal = getElement('photo-zoom-modal');

        if (
          zoomModal &&
          !zoomModal.classList.contains('hidden') &&
          typeof window.closeZoomModal === 'function'
        ) {
          window.closeZoomModal();
        }
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      const item = event.target.closest('.menu-item');

      if (!item) {
        return;
      }

      event.preventDefault();

      const tabName = getTabNameFromItem(item);

      if (tabName) {
        window.switchTabNav(tabName, item);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initializeMenuAccessibility();
      initializeDefaultTab();
    }, { once: true });
  } else {
    initializeMenuAccessibility();
    initializeDefaultTab();
  }
})();

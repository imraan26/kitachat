let currentUser = null;
let socket = null;
let failedLoginAttempts = 0;
let isLoggingOut = false;
let socketBound = false;

const STORAGE_KEYS = {
  user: 'kitachat_user',
  token: 'kitachat_session_token',
  theme: 'kitachat_theme'
};

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ],
  iceCandidatePoolSize: 10
};

let localStream = null;
let peerConnection = null;
let targetSocketId = null;
let targetUserId = null;
let iceCandidateQueue = [];
let incomingOffer = null;

const chatBeepAudio = new Audio('/audio/chat-beep.mp3');
const callRingtone = new Audio('/audio/nadadering-phone.mp3');
callRingtone.loop = true;

window.replyingToMessageId = null;
let deferredPrompt = null;

// ==========================================================
// SESSION / STORAGE
// ==========================================================
function clearSavedSession() {
  localStorage.removeItem(STORAGE_KEYS.user);
  localStorage.removeItem(STORAGE_KEYS.token);
}

function loadSavedSession() {
  const savedUser = localStorage.getItem(STORAGE_KEYS.user);
  const savedToken = localStorage.getItem(STORAGE_KEYS.token);

  if (!savedUser || !savedToken || savedUser === 'undefined') {
    return null;
  }

  try {
    const parsed = JSON.parse(savedUser);

    if (!parsed || !parsed.id) {
      throw new Error('User tidak valid');
    }

    return {
      user: parsed,
      token: savedToken
    };
  } catch (error) {
    console.warn('Sesi tersimpan tidak valid:', error);
    clearSavedSession();
    return null;
  }
}

function getSavedSession() {
  const saved = loadSavedSession();
  return saved || { user: null, token: null };
}

const savedSession = getSavedSession();
if (savedSession.user) {
  currentUser = savedSession.user;
}

// ==========================================================
// SOCKET.IO
// ==========================================================
function createSocket() {
  const token = localStorage.getItem(STORAGE_KEYS.token);
  const userId = currentUser ? currentUser.id : null;

  if (!userId || !token) {
    return null;
  }

  const client = io({
    auth: {
      userId: String(userId),
      sessionToken: token
    },
    reconnection: true,
    reconnectionAttempts: 5,
    timeout: 10000
  });

  client.on('connect_error', error => {
    console.warn('Socket connect_error:', error.message);

    if (
      error.message === 'Unauthorized' ||
      error.message === 'Authentication failed'
    ) {
      logout();
    }
  });

  return client;
}

function registerSocketEvents() {
  if (!socket || socketBound) return;

  socketBound = true;

  socket.on('connect', () => {
    console.log('Socket terhubung:', socket.id);
  });

  socket.on('chat_history', history => {
    renderChatHistory(history);
  });

  socket.on('receive_message', message => {
    renderIncomingMessage(message);
  });

  socket.on('message_deleted', data => {
    removeMessageFromUI(data.id);
  });

  socket.on('messages_deleted_by_user', data => {
    if (String(data.user_id) === String(currentUser?.id)) {
      clearChatContainer();
    }
  });

  socket.on('call_answered', handleCallAnswered);
  socket.on('incoming_call', handleIncomingCall);
  socket.on('ice_candidate', handleIceCandidate);
  socket.on('call_ended', () => cleanupCall(false));
  socket.on('chat_cleared', clearChatContainer);
}

function connectAuthenticatedSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    socketBound = false;
  }

  socket = createSocket();

  if (socket) {
    registerSocketEvents();
  }
}

// ==========================================================
// API HELPERS
// ==========================================================
async function parseJsonResponse(response) {
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    return {};
  }

  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

async function apiFetch(url, options = {}) {
  const token = localStorage.getItem(STORAGE_KEYS.token) || '';
  const userId = currentUser ? String(currentUser.id) : '';

  const headers = new Headers(options.headers || {});
  if (userId) headers.set('x-user-id', userId);
  if (token) headers.set('x-session-token', token);

  const requestOptions = {
    ...options,
    headers
  };

  if (requestOptions.body instanceof FormData) {
    requestOptions.headers.delete('Content-Type');
  }

  let response;

  try {
    response = await fetch(url, requestOptions);
  } catch (error) {
    throw new Error('Tidak dapat terhubung ke server.');
  }

  if (response.status === 401 || response.status === 403) {
    const data = await parseJsonResponse(response);
    const shouldLogout =
      response.status === 401 ||
      data.error === 'SESSION_KICKED';

    if (shouldLogout) {
      if (!isLoggingOut) {
        alert(data.message || 'Sesi tidak valid atau telah berakhir. Silakan login ulang.');
      }
      logout();
    }
  }

  return response;
}

// ==========================================================
// SERVICE WORKER / PWA
// ==========================================================
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (
            newWorker.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            const shouldUpdate = confirm(
              'Versi baru Kitachat tersedia. Perbarui sekarang?'
            );

            if (shouldUpdate) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          }
        });
      });

      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => {
          window.location.reload();
        },
        { once: true }
      );
    } catch (error) {
      console.warn('Service Worker gagal didaftarkan:', error);
    }
  });
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredPrompt = event;

  const installContainer = document.getElementById('install-pwa-container');
  if (installContainer) installContainer.classList.remove('hidden');
});

function installAppToAndroid() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(choiceResult => {
      if (choiceResult.outcome === 'accepted') {
        console.log('PWA diinstal.');
      }
      deferredPrompt = null;
    });
  } else {
    alert('Aplikasi sudah terinstal atau browser tidak mendukung instalasi otomatis.');
  }
}

// ==========================================================
// THEME
// ==========================================================
function applySavedTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
  const isDark = savedTheme === 'dark';

  document.body.classList.toggle('dark-mode', isDark);
  document.body.classList.toggle('light-mode', !isDark);
}

function toggleTheme() {
  const isDark = document.body.classList.contains('dark-mode');

  document.body.classList.toggle('dark-mode', !isDark);
  document.body.classList.toggle('light-mode', isDark);

  localStorage.setItem(
    STORAGE_KEYS.theme,
    document.body.classList.contains('dark-mode') ? 'dark' : 'light'
  );
}

// ==========================================================
// UI HELPERS
// ==========================================================
function showAuthScreen() {
  const authScreen = document.getElementById('auth-screen');
  const mainScreen = document.getElementById('main-screen');

  if (mainScreen) {
    mainScreen.classList.remove('active');
    mainScreen.style.display = 'none';
  }

  if (authScreen) {
    authScreen.classList.add('active');
    authScreen.style.display = 'flex';
  }
}

function showMainScreen() {
  const authScreen = document.getElementById('auth-screen');
  const mainScreen = document.getElementById('main-screen');

  if (authScreen) {
    authScreen.classList.remove('active');
    authScreen.style.display = 'none';
  }

  if (mainScreen) {
    mainScreen.classList.add('active');
    mainScreen.style.display = 'flex';
  }
}

function switchTab(tab) {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');

  if (!loginForm || !registerForm || !tabLogin || !tabRegister) return;

  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
  } else {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
  }
}

function switchTabNav(tabName) {
  const navMap = {
    home: 'home-tab',
    chat: 'chat-tab',
    album: 'album-tab',
    agenda: 'agenda-tab',
    settings: 'settings-tab'
  };

  const targetId = navMap[tabName];
  if (!targetId) return;

  const tab = document.getElementById(targetId);
  if (tab) tab.click();
}

function updateUserInterface() {
  if (!currentUser) return;

  const names = [
    document.getElementById('user-display-name'),
    document.getElementById('user-display-name-desktop'),
    document.getElementById('settings-user-name')
  ];

  names.forEach(el => {
    if (el) el.textContent = currentUser.name || '';
  });

  const avatarEls = [
    document.getElementById('user-avatar'),
    document.getElementById('user-avatar-desktop'),
    document.getElementById('settings-user-avatar')
  ];

  avatarEls.forEach(el => {
    if (el && currentUser.photo_url) {
      el.src = currentUser.photo_url;
    }
  });

  const phoneEl = document.getElementById('settings-user-phone');
  if (phoneEl) {
    phoneEl.replaceChildren();

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-phone';

    const textNode = document.createTextNode(` ${currentUser.phone || ''}`);

    phoneEl.appendChild(icon);
    phoneEl.appendChild(textNode);
  }

  showMainScreen();
}

// ==========================================================
// AUTH: REGISTER / LOGIN / LOGOUT
// ==========================================================
async function handleRegister(event) {
  event.preventDefault();

  const name = document.getElementById('reg-name')?.value?.trim() || '';
  const phone = document.getElementById('reg-phone')?.value?.trim() || '';
  const password = document.getElementById('reg-password')?.value || '';
  const birthdate = document.getElementById('reg-birthdate')?.value || '';

  if (!name || !phone || !password) {
    alert('Nomor telepon, nama, dan password wajib diisi.');
    return;
  }

  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, password, birthdate })
    });

    const data = await parseJsonResponse(response);

    if (response.ok) {
      alert(data.message || 'Registrasi berhasil.');
      switchTab('login');
    } else {
      alert(data.error || 'Registrasi gagal.');
    }
  } catch (error) {
    console.error('Error register:', error);
    alert('Terjadi kesalahan jaringan.');
  }
}

async function handleLogin(event) {
  event.preventDefault();

  const phoneInput = document.getElementById('login-phone');
  const passwordInput = document.getElementById('login-password');
  const forgotBtn = document.getElementById('forgot-password-btn');

  const phone = phoneInput ? phoneInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

  if (!phone || !password) {
    alert('Nomor telepon dan password wajib diisi.');
    return;
  }

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password })
    });

    const data = await parseJsonResponse(response);

    if (!response.ok) {
      alert(data.error || 'Login gagal.');

      if (
        data.error === 'Password salah.' ||
        data.error === 'Password salah!'
      ) {
        failedLoginAttempts++;
        if (failedLoginAttempts >= 3 && forgotBtn) {
          forgotBtn.classList.remove('hidden');
        }
      }

      return;
    }

    failedLoginAttempts = 0;

    if (forgotBtn) {
      forgotBtn.classList.add('hidden');
    }

    currentUser = data.user;

    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(currentUser));
    localStorage.setItem(STORAGE_KEYS.token, data.session_token);

    updateUserInterface();
    connectAuthenticatedSocket();

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  } catch (error) {
    console.error('Error login:', error);
    alert('Tidak dapat terhubung ke server.');
  }
}

function logout() {
  if (isLoggingOut) return;
  isLoggingOut = true;

  cleanupCall(false);

  if (socket) {
    socket.disconnect();
    socket = null;
    socketBound = false;
  }

  currentUser = null;
  clearSavedSession();

  showAuthScreen();

  isLoggingOut = false;
}

// ==========================================================
// CHAT
// ==========================================================
function clearChatContainer() {
  const chatContainer = document.getElementById('chat-messages-container');
  if (chatContainer) {
    chatContainer.replaceChildren();
  }
}

function renderChatHistory(history) {
  const chatContainer = document.getElementById('chat-messages-container');
  if (!chatContainer) return;

  chatContainer.replaceChildren();

  if (!Array.isArray(history) || history.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'Belum ada pesan.';
    empty.style.color = 'gray';
    empty.style.textAlign = 'center';
    empty.style.padding = '12px';
    chatContainer.appendChild(empty);
    return;
  }

  history.forEach(item => {
    renderIncomingMessage(item, true);
  });
}

function renderIncomingMessage(message, silent = false) {
  const chatContainer = document.getElementById('chat-messages-container');
  if (!chatContainer || !message) return;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  const sender = document.createElement('div');
  sender.className = 'chat-sender';
  sender.textContent = message.name || 'Keluarga';

  const text = document.createElement('div');
  text.className = 'chat-text';
  text.textContent = message.message || '(Media)';

  bubble.appendChild(sender);
  bubble.appendChild(text);

  if (message.reply_to_id && message.reply_text) {
    const reply = document.createElement('div');
    reply.className = 'chat-reply';
    reply.textContent = `Balasan: ${message.reply_text}`;
    bubble.appendChild(reply);
  }

  if (message.image_url) {
    const img = document.createElement('img');
    img.src = message.image_url;
    img.alt = 'gambar';
    img.style.maxWidth = '220px';
    img.style.borderRadius = '10px';
    bubble.appendChild(img);
  }

  if (message.audio_url) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = message.audio_url;
    bubble.appendChild(audio);
  }

  if (message.sticker_url) {
    const sticker = document.createElement('img');
    sticker.src = message.sticker_url;
    sticker.alt = 'sticker';
    sticker.style.maxWidth = '120px';
    bubble.appendChild(sticker);
  }

  const time = document.createElement('div');
  time.className = 'chat-time';
  time.textContent = message.time || '';

  bubble.appendChild(time);
  chatContainer.appendChild(bubble);

  if (!silent) {
    chatBeepAudio.play().catch(() => {});
  }

  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function removeMessageFromUI(id) {
  const message = document.querySelector(`[data-message-id="${id}"]`);
  if (message) message.remove();
}

function cancelReply() {
  window.replyingToMessageId = null;
  const replyBox = document.getElementById('reply-preview');
  if (replyBox) replyBox.innerHTML = '';
}

async function sendMessage() {
  const input = document.getElementById('message-input');
  if (!input) return;

  const messageText = input.value.trim();
  if (!messageText) return;

  if (!currentUser) {
    alert('Silakan login terlebih dahulu!');
    return;
  }

  const formData = new FormData();
  formData.append('message', messageText);
  formData.append(
    'client_time',
    new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit'
    })
  );

  if (window.replyingToMessageId) {
    formData.append('reply_to_id', String(window.replyingToMessageId));
  }

  try {
    const response = await apiFetch('/api/send-message', {
      method: 'POST',
      body: formData
    });

    const data = await parseJsonResponse(response);

    if (!response.ok) {
      alert(data.error || 'Gagal mengirim pesan.');
      return;
    }

    input.value = '';
    input.style.height = 'auto';
    cancelReply();
  } catch (error) {
    console.error('Error saat mengirim pesan:', error);
    alert('Terjadi kesalahan jaringan.');
  }
}

// ==========================================================
// ALBUM
// ==========================================================
let currentAlbumFilter = 'semua';
let globalAlbumData = [];
let albumRequestId = 0;
const ALBUM_MAX_FILE_SIZE = 10 * 1024 * 1024;

function getAlbumElements() {
  return {
    grid: document.getElementById('album-grid-container'),
    fileInput: document.getElementById('photo-file-input'),
    fileNameLabel: document.getElementById('selected-file-label'),
    formCard: document.getElementById('photo-upload-form'),
    captionInput: document.getElementById('photo-caption-input'),
    submitBtn: document.querySelector('#photo-upload-form button[type="submit"]')
  };
}

function cancelAlbumUpload() {
  const { fileInput, captionInput } = getAlbumElements();

  if (fileInput) fileInput.value = '';
  if (captionInput) captionInput.value = '';
}

function renderAlbumGrid(photos) {
  const { grid: container } = getAlbumElements();
  if (!container) return;

  container.replaceChildren();

  if (!Array.isArray(photos) || photos.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'Belum ada foto di album.';
    p.style.color = 'gray';
    p.style.gridColumn = 'span 3';
    p.style.textAlign = 'center';
    p.style.padding = '20px';
    container.appendChild(p);
    return;
  }

  photos.forEach((item, index) => {
    const card = document.createElement('div');
    card.style.position = 'relative';
    card.style.width = '100%';
    card.style.aspectRatio = '1 / 1';
    card.style.borderRadius = '4px';
    card.style.overflow = 'hidden';
    card.style.background = '#ddd';
    card.style.cursor = 'pointer';

    const img = document.createElement('img');
    img.src = item.image_url;
    img.alt = item.caption || 'Foto';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.onclick = () => openZoomModal(item.image_url);

    const menuId = `album-menu-${item.id || index}`;
    const menuBtn = document.createElement('button');
    menuBtn.className = 'photo-menu-btn';
    menuBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
    menuBtn.style.position = 'absolute';
    menuBtn.style.right = '8px';
    menuBtn.style.bottom = '8px';
    menuBtn.style.width = '28px';
    menuBtn.style.height = '28px';
    menuBtn.style.borderRadius = '50%';
    menuBtn.style.border = 'none';
    menuBtn.style.background = 'rgba(0,0,0,0.6)';
    menuBtn.style.color = 'white';
    menuBtn.onclick = event => togglePhotoMenu(event, menuId);

    const dropdown = document.createElement('div');
    dropdown.id = menuId;
    dropdown.className = 'photo-dropdown';

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Simpan';
    downloadBtn.onclick = () => downloadPhoto(item.image_url);
    dropdown.appendChild(downloadBtn);

    const isOwner =
      currentUser &&
      String(currentUser.id) === String(item.user_id);

    if (isOwner) {
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Hapus';
      deleteBtn.style.color = '#e74c3c';
      deleteBtn.onclick = () => deleteAlbumPhoto(item.id);
      dropdown.appendChild(deleteBtn);
    }

    card.appendChild(img);
    card.appendChild(menuBtn);
    card.appendChild(dropdown);
    container.appendChild(card);
  });
}

function filterAlbum(type) {
  currentAlbumFilter = type;

  ['tahun', 'bulan', 'semua'].forEach(key => {
    const btn = document.getElementById(`filter-btn-${key}`);
    if (!btn) return;

    if (key === type) {
      btn.style.background = 'white';
      btn.style.color = '#111';
      btn.style.fontWeight = 'bold';
      btn.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    } else {
      btn.style.background = 'transparent';
      btn.style.color = '#aaa';
      btn.style.fontWeight = '500';
      btn.style.boxShadow = 'none';
    }
  });

  let filtered = [...globalAlbumData];
  const now = new Date();

  if (type === 'tahun') {
    filtered = globalAlbumData.filter(item => {
      const d = new Date(item.created_at);
      return d.getFullYear() === now.getFullYear();
    });
  } else if (type === 'bulan') {
    filtered = globalAlbumData.filter(item => {
      const d = new Date(item.created_at);
      return (
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
      );
    });
  }

  renderAlbumGrid(filtered);
}

async function loadAlbumPhotos() {
  const currentReqId = ++albumRequestId;

  try {
    const response = await apiFetch('/api/albums');

    if (currentReqId !== albumRequestId) return;

    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const data = await response.json();
        globalAlbumData = Array.isArray(data) ? data : [];
        renderAlbumGrid(globalAlbumData);
      }
    }
  } catch (error) {
    console.error('Gagal memuat album:', error);
  }
}

async function handleUploadPhoto(event) {
  event.preventDefault();

  if (!currentUser) {
    alert('Silakan login terlebih dahulu!');
    return;
  }

  const { fileInput, captionInput, submitBtn } = getAlbumElements();

  if (!fileInput || fileInput.files.length === 0) {
    alert('Pilih file gambar terlebih dahulu!');
    return;
  }

  const file = fileInput.files[0];
  if (!file.type.startsWith('image/')) {
    alert('File harus berupa gambar.');
    return;
  }

  if (file.size > ALBUM_MAX_FILE_SIZE) {
    alert('Ukuran file maksimal 10MB.');
    return;
  }

  const formData = new FormData();
  formData.append('image', file);
  formData.append('caption', captionInput ? captionInput.value : '');

  if (submitBtn) submitBtn.disabled = true;

  try {
    const response = await apiFetch('/api/albums', {
      method: 'POST',
      body: formData
    });

    const data = await parseJsonResponse(response);

    if (response.ok) {
      cancelAlbumUpload();
      switchTabNav('album');
      await loadAlbumPhotos();
    } else {
      alert(data.error || 'Gagal mengunggah foto.');
    }
  } catch (error) {
    console.error('Error upload foto:', error);
    alert('Terjadi kesalahan jaringan.');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function togglePhotoMenu(event, menuId) {
  event.stopPropagation();

  document.querySelectorAll('.photo-dropdown').forEach(el => {
    if (el.id !== menuId) el.classList.remove('active');
  });

  const dropdown = document.getElementById(menuId);
  if (dropdown) dropdown.classList.toggle('active');
}

window.addEventListener('click', () => {
  document.querySelectorAll('.photo-dropdown').forEach(el => {
    el.classList.remove('active');
  });
});

function openZoomModal(imageUrl) {
  const modal = document.getElementById('photo-zoom-modal');
  const img = document.getElementById('zoomed-img-element');

  if (modal && img) {
    img.src = imageUrl;
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
}

function closeZoomModal() {
  const modal = document.getElementById('photo-zoom-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

async function downloadPhoto(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `kitachat-foto-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  } catch (error) {
    alert('Gagal menyimpan foto.');
  }
}

async function deleteAlbumPhoto(photoId) {
  if (!confirm('Apakah Anda yakin ingin menghapus foto ini?')) return;

  try {
    const response = await apiFetch(`/api/albums/${photoId}`, {
      method: 'DELETE'
    });

    const data = await parseJsonResponse(response);

    if (response.ok) {
      alert(data.message || 'Foto berhasil dihapus.');
      await loadAlbumPhotos();
    } else {
      alert(data.error || 'Gagal menghapus foto.');
    }
  } catch (error) {
    console.error('Error delete album:', error);
  }
}

// ==========================================================
// AGENDA
// ==========================================================
async function handleCreateAgenda(event) {
  event.preventDefault();

  if (!currentUser) {
    alert('Silakan login terlebih dahulu!');
    return;
  }

  const title = document.getElementById('agenda-title')?.value.trim() || '';
  const eventDate = document.getElementById('agenda-date')?.value || '';
  const description = document.getElementById('agenda-desc')?.value || '';

  if (!title || !eventDate) {
    alert('Judul dan tanggal acara wajib diisi.');
    return;
  }

  try {
    const response = await apiFetch('/api/agendas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, event_date: eventDate, description })
    });

    const data = await parseJsonResponse(response);

    if (response.ok) {
      alert(data.message || 'Agenda berhasil dibuat.');

      const titleInput = document.getElementById('agenda-title');
      const dateInput = document.getElementById('agenda-date');
      const descInput = document.getElementById('agenda-desc');

      if (titleInput) titleInput.value = '';
      if (dateInput) dateInput.value = '';
      if (descInput) descInput.value = '';

      const form = document.getElementById('agenda-form-container');
      const label = document.getElementById('agenda-toggle-label');
      const chevron = document.getElementById('agenda-chevron-icon');

      if (form) form.style.display = 'none';
      if (label) label.innerText = 'Ketuk untuk membuat jadwal acara baru';
      if (chevron) chevron.style.transform = 'rotate(0deg)';

      await loadAgendaAndBirthdays();
    } else {
      alert(data.error || 'Gagal menambahkan agenda.');
    }
  } catch (error) {
    console.error('Error create agenda:', error);
    alert('Terjadi kesalahan jaringan.');
  }
}

async function loadAgendaAndBirthdays() {
  try {
    const resUsers = await apiFetch('/api/users');
    if (resUsers.ok) {
      const users = await resUsers.json();
      const bdayContainer = document.getElementById('birthday-list-container');

      if (bdayContainer) {
        bdayContainer.replaceChildren();

        const usersWithBday = users.filter(u => u.birthdate);

        if (usersWithBday.length === 0) {
          bdayContainer.innerHTML =
            '<p style="font-size: 13px; color: gray;">Belum ada data tanggal lahir.</p>';
        } else {
          usersWithBday.forEach(user => {
            const date = new Date(user.birthdate);
            const bdate = date.toLocaleDateString('id-ID', {
              day: 'numeric',
              month: 'long'
            });

            const row = document.createElement('div');
            // Disesuaikan menjadi latar belakang var(--card-bg) tanpa garis hijau (clean)
            row.style.cssText =
              'display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; font-size: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.02);';

            const name = document.createElement('span');
            name.innerHTML = `<b>${user.name}</b>`;

            const birthday = document.createElement('span');
            birthday.style.color = 'var(--primary-color)';
            birthday.style.fontWeight = '600';
            birthday.innerHTML = `<i class="fa-solid fa-gift"></i> ${bdate}`;

            row.appendChild(name);
            row.appendChild(birthday);
            bdayContainer.appendChild(row);
          });
        }
      }
    }
  } catch (error) {
    console.warn('Gagal memuat data ulang tahun:', error);
  }

  try {
    const resAgendas = await apiFetch('/api/agendas');
    if (resAgendas.ok) {
      const agendas = await resAgendas.json();
      const agendaContainer = document.getElementById('agenda-list-container');

      if (agendaContainer) {
        agendaContainer.replaceChildren();

        if (agendas.length === 0) {
          agendaContainer.innerHTML =
            '<p style="font-size: 13px; color: gray;">Belum ada agenda kegiatan tercatat.</p>';
        } else {
          agendas.forEach(item => {
            const fDate = new Date(item.event_date).toLocaleDateString('id-ID', {
              day: 'numeric',
              month: 'long',
              year: 'numeric'
            });

            const card = document.createElement('div');
            // Garis hijau pinggir dihapus dan diganti kartu bersih standar
            card.style.cssText =
              'padding: 14px 16px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 10px; display: grid; gap: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);';

            const header = document.createElement('div');
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.alignItems = 'center';

            const titleEl = document.createElement('h5');
            titleEl.textContent = item.title;
            titleEl.style.margin = '0';
            titleEl.style.fontSize = '15px';
            titleEl.style.fontWeight = '600';
            titleEl.style.color = 'var(--text-light)';

            const dateBadge = document.createElement('span');
            dateBadge.textContent = fDate;
            dateBadge.style.fontSize = '12px';
            dateBadge.style.fontWeight = 'bold';
            dateBadge.style.color = 'var(--primary-color)';
            dateBadge.style.background = 'var(--primary-light)';
            dateBadge.style.padding = '3px 8px';
            dateBadge.style.borderRadius = '6px';

            header.appendChild(titleEl);
            header.appendChild(dateBadge);

            const desc = document.createElement('p');
            desc.textContent = item.description || '';
            desc.style.margin = '0';
            desc.style.fontSize = '13px';
            desc.style.color = 'var(--text-muted)';

            card.appendChild(header);
            if (item.description) card.appendChild(desc);

            agendaContainer.appendChild(card);
          });
        }
      }
    }
  } catch (error) {
    console.warn('Gagal memuat agenda:', error);
  }
}

// ==========================================================
// PROFILE / PASSWORD / EMAIL
// ==========================================================
async function triggerUploadProfile(inputElement) {
  if (!inputElement.files || !inputElement.files[0]) return;

  if (!currentUser) {
    alert('Silakan login terlebih dahulu!');
    return;
  }

  const formData = new FormData();
  formData.append('image', inputElement.files[0]);

  try {
    const response = await apiFetch('/api/update-photo', {
      method: 'POST',
      body: formData
    });

    const data = await parseJsonResponse(response);

    if (response.ok) {
      alert(data.message || 'Foto profil berhasil diperbarui.');
      currentUser = data.user;
      localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(currentUser));
      updateUserInterface();
    } else {
      alert(data.error || 'Gagal memperbarui foto profil.');
    }
  } catch (error) {
    console.error('Error update foto profil:', error);
    alert('Terjadi kesalahan jaringan.');
  } finally {
    inputElement.value = '';
  }
}

function openChangePasswordModal() {
  const modal = document.getElementById('password-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeChangePasswordModal() {
  const modal = document.getElementById('password-modal');
  if (modal) modal.classList.add('hidden');

  const oldPw = document.getElementById('old-password');
  const newPw = document.getElementById('new-password');

  if (oldPw) oldPw.value = '';
  if (newPw) newPw.value = '';
}

async function handleChangePassword(event) {
  event.preventDefault();

  if (!currentUser) {
    alert('Silakan login terlebih dahulu!');
    return;
  }

  const oldPassword = document.getElementById('old-password')?.value || '';
  const newPassword = document.getElementById('new-password')?.value || '';

  if (!oldPassword || !newPassword) {
    alert('Password lama dan baru wajib diisi.');
    return;
  }

  try {
    const response = await apiFetch('/api/update-password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
    });

    const data = await parseJsonResponse(response);

    if (response.ok) {
      closeChangePasswordModal();
      setTimeout(() => {
        alert(data.message || 'Password berhasil diubah.');
      }, 200);
    } else {
      alert(data.error || 'Gagal mengganti password.');
    }
  } catch (error) {
    console.error('Error ganti password:', error);
    alert('Terjadi kesalahan jaringan.');
  }
}

async function handleUpdateEmail(event) {
  event.preventDefault();

  if (!currentUser) {
    alert('Silakan login terlebih dahulu!');
    return;
  }

  const email = document.getElementById('recovery-email')?.value.trim() || '';

  if (!email) {
    alert('Email wajib diisi.');
    return;
  }

  try {
    const response = await apiFetch('/api/update-email', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await parseJsonResponse(response);

    if (response.ok) {
      alert(data.message || 'Email berhasil disimpan.');
      const modal = document.getElementById('email-modal');
      if (modal) modal.classList.add('hidden');
    } else {
      alert(data.error || 'Gagal menyimpan email.');
    }
  } catch (error) {
    console.error('Error update email:', error);
    alert('Kesalahan jaringan.');
  }
}

// ==========================================================
// FORGOT PASSWORD / RESET
// ==========================================================
async function requestOTP() {
  const phone = document.getElementById('login-phone')?.value.trim() || '';

  if (!phone) {
    alert('Masukkan nomor telepon Anda terlebih dahulu.');
    return;
  }

  try {
    const response = await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });

    const data = await parseJsonResponse(response);

    if (response.ok) {
      alert(data.message || 'Kode OTP telah dikirim.');
      const otpModal = document.getElementById('otp-modal');
      if (otpModal) otpModal.classList.remove('hidden');
    } else {
      alert(data.error || 'Gagal mengirim OTP.');
    }
  } catch (error) {
    console.error('Error request OTP:', error);
    alert('Terjadi kesalahan jaringan.');
  }
}

async function handleResetPassword(event) {
  event.preventDefault();

  const phone = document.getElementById('login-phone')?.value.trim() || '';
  const otp = document.getElementById('reset-otp')?.value.trim() || '';
  const newPassword = document.getElementById('reset-new-password')?.value || '';

  if (!phone || !otp || !newPassword) {
    alert('Phone, OTP, dan password baru wajib diisi.');
    return;
  }

  try {
    const response = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp, new_password: newPassword })
    });

    const data = await parseJsonResponse(response);

    if (response.ok) {
      alert(data.message || 'Password berhasil diubah.');

      const otpModal = document.getElementById('otp-modal');
      const forgotBtn = document.getElementById('forgot-password-btn');
      const loginPw = document.getElementById('login-password');

      if (otpModal) otpModal.classList.add('hidden');
      if (forgotBtn) forgotBtn.classList.add('hidden');
      if (loginPw) loginPw.value = '';

      failedLoginAttempts = 0;
    } else {
      alert(data.error || 'Gagal reset password.');
    }
  } catch (error) {
    console.error('Error reset password:', error);
    alert('Kesalahan jaringan.');
  }
}

// ==========================================================
// CLEAR CHAT (DELETE ALL)
// ==========================================================
function clearChat() {
  if (!confirm('Yakin ingin menghapus semua riwayat obrolan Anda?')) return;

  apiFetch('/api/messages', { method: 'DELETE' })
    .then(async response => {
      const data = await parseJsonResponse(response);

      if (response.ok) {
        alert(data.message || 'Riwayat obrolan berhasil dihapus.');
        clearChatContainer();
      } else {
        alert(data.error || 'Gagal membersihkan obrolan.');
      }
    })
    .catch(error => {
      console.error('Error clear chat:', error);
      alert('Terjadi kesalahan saat membersihkan obrolan.');
    });
}

// ==========================================================
// VoIP / WebRTC
// ==========================================================
function createPeerConnection() {
  const connection = new RTCPeerConnection(rtcConfig);

  connection.onicecandidate = event => {
    if (event.candidate && targetSocketId && socket) {
      socket.emit('ice_candidate', {
        targetSocketId,
        candidate: event.candidate
      });
    }
  };

  connection.ontrack = event => {
    const remoteAudio = document.getElementById('remote-audio');

    if (!remoteAudio || !event.streams[0]) {
      return;
    }

    remoteAudio.srcObject = event.streams[0];
    remoteAudio.play().catch(() => {});
  };

  connection.oniceconnectionstatechange = () => {
    const state = connection.iceConnectionState;
    if (state === 'failed' || state === 'closed') {
      cleanupCall(false);
    }
  };

  return connection;
}

function cleanupCall(notifyPeer = false) {
  callRingtone.pause();
  callRingtone.currentTime = 0;

  const remoteAudio = document.getElementById('remote-audio');
  if (remoteAudio) {
    remoteAudio.pause();
    remoteAudio.srcObject = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  if (peerConnection) {
    peerConnection.onicecandidate = null;
    peerConnection.ontrack = null;
    peerConnection.close();
    peerConnection = null;
  }

  const modal = document.getElementById('call-modal');
  if (modal) modal.classList.add('hidden');

  if (notifyPeer && targetUserId && socket) {
    socket.emit('end_call', { toUserId: String(targetUserId) });
  }

  targetSocketId = null;
  targetUserId = null;
  incomingOffer = null;
  iceCandidateQueue = [];
}

function hangUpCall() {
  cleanupCall(true);
}

async function startCall(peerUserId, peerName) {
  if (!currentUser) {
    alert('Silakan login terlebih dahulu!');
    return;
  }

  targetUserId = peerUserId;
  targetSocketId = null;
  iceCandidateQueue = [];
  incomingOffer = null;

  const modal = document.getElementById('call-modal');
  if (modal) modal.classList.remove('hidden');

  const title = document.getElementById('call-status-title');
  const peerNameEl = document.getElementById('call-peer-name');
  const acceptBtn = document.getElementById('btn-accept-call');

  if (title) title.innerText = 'Memanggil...';
  if (peerNameEl) peerNameEl.innerText = peerName;
  if (acceptBtn) acceptBtn.style.display = 'none';

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false
    });

    peerConnection = createPeerConnection();

    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit('call_user', {
      toUserId: peerUserId,
      callerName: currentUser.name,
      offer
    });
  } catch (error) {
    console.error('Error startCall:', error);
    alert('Tidak dapat mengakses mikrofon. Pastikan izin mikrofon diberikan.');
    cleanupCall(true);
  }
}

function handleIncomingCall(data) {
  if (!currentUser || !data || String(data.toUserId) !== String(currentUser.id)) {
    return;
  }

  targetSocketId = data.fromSocketId;
  targetUserId = data.fromUserId;
  incomingOffer = data.offer;
  iceCandidateQueue = [];

  const modal = document.getElementById('call-modal');
  if (modal) modal.classList.remove('hidden');

  const title = document.getElementById('call-status-title');
  const peerNameEl = document.getElementById('call-peer-name');
  const acceptBtn = document.getElementById('btn-accept-call');

  if (title) title.innerText = 'Panggilan Masuk...';
  if (peerNameEl) peerNameEl.innerText = data.callerName || 'Keluarga';
  if (acceptBtn) acceptBtn.style.display = 'inline-block';

  callRingtone.play().catch(() => {});
}

async function acceptCall() {
  if (!incomingOffer) return;

  callRingtone.pause();
  callRingtone.currentTime = 0;

  const acceptBtn = document.getElementById('btn-accept-call');
  const title = document.getElementById('call-status-title');

  if (acceptBtn) acceptBtn.style.display = 'none';
  if (title) title.innerText = 'Terhubung';

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false
    });

    peerConnection = createPeerConnection();

    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingOffer));

    while (iceCandidateQueue.length > 0) {
      const candidate = iceCandidateQueue.shift();
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('make_answer', {
      answer,
      toSocketId: targetSocketId
    });
  } catch (error) {
    console.error('Error acceptCall:', error);
    cleanupCall(true);
  }
}

async function handleCallAnswered(data) {
  if (!peerConnection || !data || !data.answer) return;

  try {
    await peerConnection.setRemoteDescription(data.answer);

    while (iceCandidateQueue.length > 0) {
      const candidate = iceCandidateQueue.shift();
      await peerConnection.addIceCandidate(candidate);
    }

    const title = document.getElementById('call-status-title');
    if (title) title.innerText = 'Terhubung';
  } catch (error) {
    console.error('Gagal set remote description callback:', error);
    cleanupCall(false);
  }
}

async function handleIceCandidate(data) {
  if (!peerConnection || !data || !data.candidate) return;

  try {
    if (peerConnection.remoteDescription) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } else {
      iceCandidateQueue.push(data.candidate);
    }
  } catch (error) {
    console.warn('Error kandidat ICE:', error);
  }
}

// ==========================================================
// CHAT FILE INPUT
// ==========================================================
function isValidMediaFile(file) {
  if (!file) return false;

  const validType =
    file.type.startsWith('image/') ||
    file.type.startsWith('audio/');

  return validType && file.size <= 10 * 1024 * 1024;
}

const chatFileInput = document.getElementById('chat-file-input');
if (chatFileInput) {
  chatFileInput.addEventListener('change', async function () {
    const file = this.files && this.files[0];

    if (!file) return;

    if (!currentUser) {
      alert('Silakan login terlebih dahulu!');
      this.value = '';
      return;
    }

    if (!isValidMediaFile(file)) {
      alert('File harus berupa gambar atau audio dan maksimal 10MB.');
      this.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('media', file);
    formData.append(
      'client_time',
      new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
      })
    );

    try {
      const response = await apiFetch('/api/send-message', {
        method: 'POST',
        body: formData
      });

      const data = await parseJsonResponse(response);

      if (!response.ok) {
        alert(data.error || 'Gagal mengunggah media.');
      }
    } catch (error) {
      console.error('Upload media gagal:', error);
      alert('Terjadi kesalahan jaringan.');
    } finally {
      this.value = '';
    }
  });
}

// ==========================================================
// INITIALIZE
// ==========================================================
window.addEventListener('DOMContentLoaded', () => {
  applySavedTheme();

  if (currentUser && localStorage.getItem(STORAGE_KEYS.token)) {
    updateUserInterface();
    connectAuthenticatedSocket();
  } else {
    showAuthScreen();
  }
});

registerServiceWorker();

const socket = io();
let currentUser = null;
let failedLoginAttempts = 0;

// --- PEMULIHAN SESI AMAN SEBELUM APAPUN BERJALAN ---
(function() {
    const savedUser = localStorage.getItem('kitachat_user');
    const savedToken = localStorage.getItem('kitachat_session_token');
    if (savedUser && savedToken && savedUser !== "undefined") {
        try {
            currentUser = JSON.parse(savedUser);
        } catch (e) {
            console.error('Gagal memuat sesi tersimpan:', e);
        }
    }
})();

// ==========================================================
// FUNGSI API AMAN (DUAL-LAYER TOKEN DELIVERY UNTUK ANDROID & IOS)
// ==========================================================
async function apiFetch(url, options = {}) {
    const token = localStorage.getItem('kitachat_session_token') || '';
    const userId = currentUser ? String(currentUser.id) : '';

    const headers = options.headers ? { ...options.headers } : {};
    
    if (userId) headers['x-user-id'] = userId;
    if (token) headers['x-session-token'] = token;
    options.headers = headers;

    if (options.body instanceof FormData) {
        if (userId && !options.body.has('user_id')) options.body.append('user_id', userId);
        if (token && !options.body.has('session_token')) options.body.append('session_token', token);
    } else if (!options.body && options.method !== 'POST' && options.method !== 'PUT') {
        const char = url.includes('?') ? '&' : '?';
        url += `${char}user_id=${userId}&session_token=${token}`;
    }

    const response = await fetch(url, options);

    if (response.status === 401 || response.status === 403) {
        try {
            const data = await response.clone().json();
            if (data.error === 'SESSION_KICKED' || response.status === 401) {
                alert(data.message || 'Sesi tidak valid atau telah habis. Silakan login ulang.');
                logout();
            }
        } catch (e) {
            logout();
        }
    }

    return response;
}
// ==========================================================

// --- REGISTRASI SERVICE WORKER (DIPERBARUI UNTUK AUTO-UPDATE PWA) ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then((reg) => {
            console.log('Service Worker terdaftar:', reg.scope);

            // Deteksi jika ada pembaruan Service Worker di server
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        if (confirm('Versi baru Kitachat telah tersedia! Ketuk OK untuk memperbarui aplikasi.')) {
                            window.location.reload(true);
                        }
                    }
                });
            });
        }).catch(err => console.log('Gagal mendaftarkan Service Worker:', err));
    });
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installContainer = document.getElementById('install-pwa-container');
    if (installContainer) {
        installContainer.classList.remove('hidden');
    }
});

function installAppToAndroid() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') console.log('PWA Diinstal');
            deferredPrompt = null;
        });
    } else {
        alert('Aplikasi sudah terinstal atau peramban tidak mendukung instalasi otomatis.');
    }
}

const chatBeepAudio = new Audio('/audio/chat-beep.mp3');
const callRingtone = new Audio('/audio/nadadering-phone.mp3');
callRingtone.loop = true;
window.replyingToMessageId = null;

function switchTab(tab) {
    if (tab === 'login') {
        document.getElementById('login-form').classList.remove('hidden');
        document.getElementById('register-form').classList.add('hidden');
        document.getElementById('tab-login').classList.add('active');
        document.getElementById('tab-register').classList.remove('active');
    } else {
        document.getElementById('login-form').classList.add('hidden');
        document.getElementById('register-form').classList.remove('hidden');
        document.getElementById('tab-register').classList.add('active');
        document.getElementById('tab-login').classList.remove('active');
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const name = document.getElementById('reg-name').value;
    const phone = document.getElementById('reg-phone').value;
    const password = document.getElementById('reg-password').value;
    const birthdate = document.getElementById('reg-birthdate').value;

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone, password, birthdate })
        });
        const data = await response.json();
        
        if (response.ok) {
            alert(data.message);
            switchTab('login');
        } else {
            alert(data.error);
        }
    } catch (err) {
        console.error('Error register:', err);
    }
}

async function handleLogin(event) {
    event.preventDefault();
    const phone = document.getElementById('login-phone').value;
    const password = document.getElementById('login-password').value;
    const forgotBtn = document.getElementById('forgot-password-btn');

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password })
        });
        const data = await response.json();

        if (response.ok) {
            failedLoginAttempts = 0; 
            if (forgotBtn) forgotBtn.classList.add('hidden');
            
            currentUser = data.user;
            localStorage.setItem('kitachat_user', JSON.stringify(currentUser));
            if (data.session_token) localStorage.setItem('kitachat_session_token', data.session_token);

            chatBeepAudio.play().catch(() => {});
            chatBeepAudio.pause();
            chatBeepAudio.currentTime = 0;

            if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
            updateUserInterface();
            socket.emit('register_call_user', currentUser.id);
        } else {
            alert(data.error);
            if (data.error === 'Password salah!') {
                failedLoginAttempts++;
                if (failedLoginAttempts >= 3 && forgotBtn) {
                    forgotBtn.classList.remove('hidden');
                }
            }
        }
    } catch (err) { console.error('Error login:', err); }
}

function updateUserInterface() {
    if (!currentUser) return;

    const mobileName = document.getElementById('user-display-name');
    if (mobileName) mobileName.innerText = currentUser.name;
    
    const mobileAvatar = document.getElementById('user-avatar');
    if (mobileAvatar && currentUser.photo_url) mobileAvatar.src = currentUser.photo_url;

    const desktopName = document.getElementById('user-display-name-desktop');
    if (desktopName) desktopName.innerText = currentUser.name;
    
    const desktopAvatar = document.getElementById('user-avatar-desktop');
    if (desktopAvatar && currentUser.photo_url) desktopAvatar.src = currentUser.photo_url;
    
    const authScreen = document.getElementById('auth-screen');
    if (authScreen) {
        authScreen.classList.remove('active');
        authScreen.style.display = 'none';
    }
    
    const mainScreen = document.getElementById('main-screen');
    if (mainScreen) {
        mainScreen.classList.add('active');
        mainScreen.style.display = 'flex';
    }

    const settingsAvatar = document.getElementById('settings-user-avatar');
    if (settingsAvatar && currentUser.photo_url) settingsAvatar.src = currentUser.photo_url;

    const settingsName = document.getElementById('settings-user-name');
    if (settingsName) settingsName.innerText = currentUser.name;

    const settingsPhone = document.getElementById('settings-user-phone');
    if (settingsPhone) settingsPhone.innerHTML = `<i class="fa-solid fa-phone"></i> ${currentUser.phone}`;
}

window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('kitachat_user');
    const savedToken = localStorage.getItem('kitachat_session_token');
    
    if (savedUser && savedToken && savedUser !== "undefined") {
        currentUser = JSON.parse(savedUser);
        updateUserInterface();
        socket.emit('register_call_user', currentUser.id);
    } else {
        logout();
    }
});

function switchTabNav(tabName, element) {
    const contents = document.querySelectorAll('.tab-content');
    contents.forEach(el => {
        if (el.id !== 'call-modal') {
            el.classList.add('hidden');
            el.style.display = 'none';
        }
    });

    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(el => el.classList.remove('active'));

    const target = document.getElementById(`content-${tabName}`);
    if (target) {
        target.classList.remove('hidden');
        target.style.display = 'flex';
    }

    if (tabName === 'album') loadAlbumPhotos();
    else if (tabName === 'agenda') loadAgendaAndBirthdays();
    else if (tabName === 'family') loadFamilyMembers();

    if (element) element.classList.add('active');
}

function toggleTheme() {
    if (document.body.classList.contains('dark-mode')) {
        document.body.classList.remove('dark-mode');
        document.body.classList.add('light-mode');
        localStorage.setItem('kitachat_theme', 'light');
    } else {
        document.body.classList.remove('light-mode');
        document.body.classList.add('dark-mode');
        localStorage.setItem('kitachat_theme', 'dark');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('kitachat_theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        document.body.classList.remove('light-mode');
    } else {
        document.body.classList.add('light-mode');
        document.body.classList.remove('dark-mode');
    }
});

function logout() {
    currentUser = null;
    localStorage.removeItem('kitachat_user');
    localStorage.removeItem('kitachat_session_token');
    
    const mainScreen = document.getElementById('main-screen');
    if (mainScreen) {
        mainScreen.classList.remove('active');
        mainScreen.style.display = 'none';
    }
    
    const authScreen = document.getElementById('auth-screen');
    if (authScreen) {
        authScreen.classList.add('active');
        authScreen.style.display = 'flex';
    }
}

// --- FUNGSI BUKA/TUTUP FORM TAMBAH AGENDA ---
function toggleAgendaForm() {
    const form = document.getElementById('agenda-form-container');
    const label = document.getElementById('agenda-toggle-label');
    const chevron = document.getElementById('agenda-chevron-icon');
    
    if (!form) return; // Mencegah peringatan error di code editor

    form.classList.remove('hidden');
    
    if (form.style.display === 'none' || form.style.display === '') {
        form.style.display = 'flex';
        if (label) label.innerText = 'Isi detail jadwal kegiatan keluarga';
        if (chevron) chevron.style.transform = 'rotate(90deg)';
    } else {
        form.style.display = 'none';
        if (label) label.innerText = 'Ketuk untuk membuat jadwal acara baru';
        if (chevron) chevron.style.transform = 'rotate(0deg)';
    }
}

// --- FITUR KIRIM PESAN ---
async function sendMessage() {
    const input = document.getElementById('message-input');
    const messageText = input.value.trim();
    
    if (!messageText) return;
    if (!currentUser) return alert('Silakan login terlebih dahulu!');

    const localTime = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const formData = new FormData();
    formData.append('user_id', currentUser.id);
    formData.append('message', messageText);
    formData.append('client_time', localTime);

    if (window.replyingToMessageId) formData.append('reply_to_id', window.replyingToMessageId);

    try {
        const response = await apiFetch('/api/send-message', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();

        if (response.ok) {
            input.value = '';
            input.style.height = 'auto';
            cancelReply();
        } else {
            alert(result.error || 'Gagal mengirim pesan.');
        }
    } catch (err) {
        console.error('Error saat mengirim pesan:', err);
    }
}

// --- HELPER INTERAKSI KARTU ALBUM BARU ---
function onAlbumFileChange(event) {
    const file = event.target.files[0];
    if (file) {
        const formCard = document.getElementById('photo-upload-form');
        const fileNameEl = document.getElementById('selected-file-label');
        if (fileNameEl) fileNameEl.innerText = `Terpilih: ${file.name}`;
        if (formCard) formCard.style.display = 'flex';
    }
}

function cancelAlbumUpload() {
    const fileInput = document.getElementById('photo-file-input');
    const labelEl = document.getElementById('selected-file-label');
    const formEl = document.getElementById('photo-upload-form');
    if (fileInput) fileInput.value = '';
    if (labelEl) labelEl.innerText = 'Ketuk untuk pilih dari galeri atau kamera';
    if (formEl) formEl.style.display = 'none';
}

function cancelPhotoUpload() {
    // Fungsi fallback untuk dukungan kompatibilitas nama
    cancelAlbumUpload();
}

// --- FITUR PERBARUI APLIKASI MANUAL ---
async function forceUpdateApp() {
    if (confirm('Cek dan perbarui aplikasi ke versi server terbaru?')) {
        if ('serviceWorker' in navigator) {
            try {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (let reg of registrations) {
                    await reg.update();
                }
                const cacheNames = await caches.keys();
                await Promise.all(cacheNames.map(cache => caches.delete(cache)));
                alert('Pembaruan berhasil ditarik! Aplikasi akan dimuat ulang.');
                window.location.reload(true);
            } catch (err) {
                console.error('Gagal memperbarui aplikasi:', err);
                alert('Gagal menarik pembaruan. Pastikan koneksi internet stabil.');
            }
        } else {
            window.location.reload(true);
        }
    }
}

// --- FUNGSI PEMBUKA TAUTAN EKSTERNAL / DEEP LINK ---
function openExternalLink(url) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

// --- FITUR VOICE NOTE ---
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

async function toggleVoiceRecording() {
    const micBtn = document.getElementById('mic-btn');

    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            let options = { mimeType: 'audio/webm' };
            if (MediaRecorder.isTypeSupported('audio/mp4')) options = { mimeType: 'audio/mp4' };
            else if (!MediaRecorder.isTypeSupported('audio/webm')) options = {};

            mediaRecorder = new MediaRecorder(stream, options);
            audioChunks = [];

            mediaRecorder.ondataavailable = event => {
                if (event.data.size > 0) audioChunks.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(track => track.stop());
                const blobType = options.mimeType || 'audio/webm';
                const audioBlob = new Blob(audioChunks, { type: blobType });
                const localTime = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                
                const formData = new FormData();
                formData.append('user_id', currentUser.id);
                formData.append('media', audioBlob, blobType.includes('mp4') ? 'voicenote.mp4' : 'voicenote.webm');
                formData.append('client_time', localTime);

                try {
                    const response = await apiFetch('/api/send-message', { method: 'POST', body: formData });
                    if (!response.ok) alert('Gagal mengirim pesan suara.');
                } catch (err) {
                    console.error('Gagal upload voice note:', err);
                }

                isRecording = false;
                if (micBtn) micBtn.style.color = 'var(--text-light)';
            };

            mediaRecorder.start();
            isRecording = true;
            if (micBtn) micBtn.style.color = '#e74c3c';
            
        } catch (err) {
            alert('Izin mikrofon ditolak atau tidak didukung perangkat.');
            isRecording = false;
            if (micBtn) micBtn.style.color = 'var(--text-light)';
        }
    } else {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    }
}

// --- FITUR POP-UP MENU ALA WHATSAPP & REPLY/DELETE ---
function setupMessageInteraction(msgDiv, messageId, messageText, isSelf) {
    let pressTimer;
    
    const startTimer = (e) => {
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
            showWhatsAppStyleMenu(messageId, messageText, isSelf);
        }, 500);
    };

    const cancelTimer = () => {
        clearTimeout(pressTimer);
    };

    msgDiv.addEventListener('mousedown', startTimer);
    msgDiv.addEventListener('mouseup', cancelTimer);
    msgDiv.addEventListener('mouseleave', cancelTimer);
    
    msgDiv.addEventListener('touchstart', startTimer, { passive: true });
    msgDiv.addEventListener('touchend', cancelTimer);
    msgDiv.addEventListener('touchmove', cancelTimer, { passive: true });
}

function showWhatsAppStyleMenu(messageId, messageText, isSelf) {
    const existingOverlay = document.getElementById('chat-action-overlay');
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'chat-action-overlay';
    overlay.className = 'chat-popup-overlay';

    const menu = document.createElement('div');
    menu.className = 'chat-popup-menu';

    const replyItem = document.createElement('div');
    replyItem.className = 'chat-popup-item';
    replyItem.innerHTML = `<i class="fa-solid fa-reply" style="color: var(--primary-color);"></i> Balas`;
    replyItem.onclick = () => {
        overlay.remove();
        selectReplyActionDirect(messageId, messageText || 'Lampiran');
    };
    menu.appendChild(replyItem);

    if (isSelf) {
        const deleteItem = document.createElement('div');
        deleteItem.className = 'chat-popup-item danger';
        deleteItem.innerHTML = `<i class="fa-solid fa-trash-can"></i> Hapus Pesan`;
        deleteItem.onclick = () => {
            overlay.remove();
            deleteMessage(messageId);
        };
        menu.appendChild(deleteItem);
    }

    overlay.appendChild(menu);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
}

function selectReplyActionDirect(messageId, messageText) {
    window.replyingToMessageId = messageId;
    
    const chatInputArea = document.getElementById('chat-input-area');
    if (!chatInputArea) return; // Mencegah editor menampilkan peringatan error

    let banner = document.getElementById('reply-banner');
    
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'reply-banner';
        banner.style.cssText = 'background: var(--bg-light); padding: 6px 12px; font-size: 12px; border-left: 3px solid var(--primary-color); display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; border-radius: 4px; color: var(--text-light);';
        chatInputArea.parentNode.insertBefore(banner, chatInputArea);
    }
    
    banner.innerHTML = `<span>Membalas: <b>${messageText}</b></span> <button onclick="cancelReply()" style="background:none; border:none; color:red; cursor:pointer; font-weight:bold;">&times;</button>`;
}

function cancelReply() {
    window.replyingToMessageId = null;
    const banner = document.getElementById('reply-banner');
    if (banner) banner.remove();
}

async function deleteMessage(messageId) {
    try {
        const response = await apiFetch(`/api/messages/${messageId}`, { method: 'DELETE' });
        if (!response.ok) alert('Gagal menghapus pesan.');
    } catch (err) {
        console.error('Error hapus pesan:', err);
    }
}

// Socket event listeners
socket.on('chat_history', (history) => {
    const container = document.getElementById('chat-messages-container');
    if (container) {
        container.innerHTML = ''; 
        history.forEach(data => appendChatMessage(data));
    }
});

socket.on('receive_message', (data) => {
    appendChatMessage(data);
    if (currentUser && data.user_id !== currentUser.id) {
        chatBeepAudio.play().catch(() => {});
        if (Notification.permission === 'granted') {
            new Notification(`Pesan Baru dari ${data.name}`, {
                body: data.message || 'Mengirim sebuah lampiran',
                icon: '/logo-kitachat.png'
            });
        }
    }
});

socket.on('message_deleted', (data) => {
    const bubble = document.getElementById(`msg-bubble-${data.id}`);
    if (bubble) bubble.innerHTML = `<div style="font-style: italic; color: gray; font-size: 13px;"><i class="fa-solid fa-ban"></i> Pesan telah dihapus</div>`;
});

function appendChatMessage(data) {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;
    
    const msgDiv = document.createElement('div');
    msgDiv.id = `msg-bubble-${data.id}`;
    const isSelf = currentUser && data.user_id === currentUser.id;
    msgDiv.className = isSelf ? 'chat-bubble chat-outgoing' : 'chat-bubble chat-incoming';

    if (data.is_deleted) {
        msgDiv.innerHTML = `<div style="font-style: italic; color: gray; font-size: 13px;"><i class="fa-solid fa-ban"></i> Pesan telah dihapus</div>`;
        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
        return;
    }

    let contentHtml = '';
    
    if (data.reply_text) {
        contentHtml += `<div style="border-left: 3px solid var(--primary-color); background: rgba(0,0,0,0.05); padding: 4px 8px; margin-bottom: 6px; border-radius: 4px; font-size: 11px; opacity: 0.8;"><b>Membalas:</b> ${data.reply_text}</div>`;
    }

    if (data.message) {
        let formattedMsg = data.message.replace(
            /(https?:\/\/[^\s]+)/g, 
            '<span onclick="openExternalLink(\'$1\')" style="color: #3498db; text-decoration: underline; word-break: break-all; cursor: pointer;">$1</span>'
        );
        formattedMsg = formattedMsg.replace(/\n/g, '<br>');
        
        contentHtml += `<div style="line-height: 1.4;">${formattedMsg}</div>`;
    }
    
    if (data.image_url) contentHtml += `<img src="${data.image_url}" style="max-width: 220px; border-radius: 8px; display: block; margin-top: 5px; cursor: pointer;" onclick="openZoomModal('${data.image_url}')">`;
    if (data.audio_url) contentHtml += `<audio controls preload="metadata" src="${data.audio_url}" style="max-width: 200px; height: 35px; margin-top: 5px;"></audio>`;

    const displayTime = data.time || '';
    
    msgDiv.innerHTML = `
        ${!isSelf ? `<div class="chat-sender-name">${data.name}</div>` : ''}
        ${contentHtml}
        <div class="chat-time" style="margin-top: 4px; text-align: ${isSelf ? 'right' : 'left'};">
            ${displayTime}
        </div>
    `;

    setupMessageInteraction(msgDiv, data.id, data.message, isSelf);
    
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

const msgInput = document.getElementById('message-input');
if (msgInput) {
    msgInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });
    msgInput.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
            this.style.height = 'auto';
        }
    });
}

// --- FITUR KELUARGA ---
async function loadFamilyMembers() {
    try {
        const response = await apiFetch('/api/users');
        if (response.ok) {
            const users = await response.json();
            const container = document.getElementById('family-list-container');
            if (!container) return; // Mencegah error jika elemen tidak ada
            container.innerHTML = '';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '10px';
            container.style.maxWidth = '600px';
            container.style.margin = '0 auto';
            container.style.width = '100%';

            users.forEach(user => {
                const card = document.createElement('div');
                card.style.background = 'var(--card-bg)';
                card.style.border = '1px solid var(--border-color)';
                card.style.padding = '14px 18px';
                card.style.borderRadius = '14px';
                card.style.display = 'flex';
                card.style.alignItems = 'center';
                card.style.justifyContent = 'space-between';
                card.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)';
                
                const isOtherUser = currentUser && currentUser.id !== user.id;
                if (isOtherUser) {
                    card.style.cursor = 'pointer';
                    card.style.transition = 'background 0.2s';
                    card.onmouseover = () => card.style.background = 'rgba(0,0,0,0.02)';
                    card.onmouseout = () => card.style.background = 'var(--card-bg)';
                    card.onclick = () => startCall(user.id, user.name);
                }

                const bdate = user.birthdate ? new Date(user.birthdate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Tidak diisi';
                const avatarSrc = user.photo_url || 'https://via.placeholder.com/50';

                card.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 15px;">
                        <img src="${avatarSrc}" alt="Avatar" style="width: 50px; height: 50px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-color);">
                        <div>
                            <h4 style="margin: 0; color: var(--text-light); font-size: 16px; font-weight: bold;">${user.name} ${!isOtherUser ? '(Anda)' : ''}</h4>
                            <p style="margin: 2px 0 0 0; font-size: 12px; color: gray;"><i class="fa-solid fa-phone"></i> ${user.phone} &bull; <i class="fa-solid fa-cake-candles"></i> ${bdate}</p>
                        </div>
                    </div>
                    ${isOtherUser ? `<div style="color: var(--primary-color); font-size: 18px; padding-right: 5px;"><i class="fa-solid fa-phone-volume" title="Ketuk untuk menelepon"></i></div>` : ''}
                `;
                container.appendChild(card);
            });
        }
    } catch (err) {
        console.error('Gagal memuat direktori keluarga:', err);
    }
}

// --- FITUR ALBUM ---
let currentAlbumFilter = 'semua';
let globalAlbumData = [];

async function loadAlbumPhotos() {
    try {
        const response = await apiFetch('/api/albums');
        if (response.ok) {
            globalAlbumData = await response.json();
            renderAlbumGrid(globalAlbumData);
        }
    } catch (err) {
        console.error('Gagal memuat album:', err);
    }
}

function renderAlbumGrid(photos) {
    const container = document.getElementById('album-grid-container');
    if (!container) return;
    container.innerHTML = '';

    if (photos.length === 0) {
        container.innerHTML = '<p style="color: gray; grid-column: span 3; text-align: center; padding: 20px;">Belum ada foto di album.</p>';
        return;
    }

    photos.forEach((item, index) => {
        const card = document.createElement('div');
        card.style.cssText = 'position: relative; width: 100%; aspect-ratio: 1 / 1; border-radius: 4px; overflow: hidden; background: #ddd; cursor: pointer;';
        const menuId = `album-menu-${item.id || index}`;
        const isOwner = currentUser && String(currentUser.id) === String(item.user_id);

        card.innerHTML = `
            <img src="${item.image_url}" alt="Foto" style="width: 100%; height: 100%; object-fit: cover;" onclick="openZoomModal('${item.image_url}')" onerror="this.src='https://via.placeholder.com/150?text=Gagal'">
            <button class="photo-menu-btn" onclick="togglePhotoMenu(event, '${menuId}')" style="width: 26px; height: 26px; font-size: 11px; bottom: 4px; right: 4px;"><i class="fa-solid fa-ellipsis-vertical"></i></button>
            <div id="${menuId}" class="photo-dropdown">
                <button onclick="downloadPhoto('${item.image_url}')"><i class="fa-solid fa-download"></i> Simpan</button>
                ${isOwner ? `<button onclick="deleteAlbumPhoto('${item.id}')" style="color: #e74c3c;"><i class="fa-solid fa-trash"></i> Hapus</button>` : ''}
            </div>
        `;
        container.appendChild(card);
    });
}

function filterAlbum(type) {
    currentAlbumFilter = type;
    ['tahun', 'bulan', 'semua'].forEach(t => {
        const btn = document.getElementById(`filter-btn-${t}`);
        if (btn) {
            if (t === type) {
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
        }
    });

    let filtered = [...globalAlbumData];
    const now = new Date();
    if (type === 'tahun') filtered = globalAlbumData.filter(item => new Date(item.created_at).getFullYear() === now.getFullYear());
    else if (type === 'bulan') filtered = globalAlbumData.filter(item => new Date(item.created_at).getMonth() === now.getMonth() && new Date(item.created_at).getFullYear() === now.getFullYear());

    renderAlbumGrid(filtered);
}

async function handleUploadPhoto(event) {
    event.preventDefault();
    const fileInput = document.getElementById('photo-file-input');
    const caption = document.getElementById('photo-caption-input').value;

    if (!currentUser) return alert('Silakan login terlebih dahulu!');
    if (!fileInput || fileInput.files.length === 0) return alert('Pilih file gambar terlebih dahulu!');

    const formData = new FormData();
    formData.append('user_id', currentUser.id);
    formData.append('image', fileInput.files[0]);
    formData.append('caption', caption);

    try {
        const response = await apiFetch('/api/albums', { method: 'POST', body: formData });
        const data = await response.json();
        if (response.ok) {
            alert(data.message);
            cancelAlbumUpload();
            if (document.getElementById('photo-caption-input')) {
                document.getElementById('photo-caption-input').value = '';
            }
            loadAlbumPhotos();
        } else alert(data.error);
    } catch (err) {
        console.error('Error upload foto:', err);
    }
}

// --- FITUR AGENDA ---
async function handleCreateAgenda(event) {
    event.preventDefault();
    const title = document.getElementById('agenda-title').value;
    const event_date = document.getElementById('agenda-date').value;
    const description = document.getElementById('agenda-desc').value;

    if (!currentUser) return alert('Silakan login terlebih dahulu!');

    try {
        const response = await apiFetch('/api/agendas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, event_date, description })
        });
        const data = await response.json();
        
        if (response.ok) {
            alert(data.message);
            
            document.getElementById('agenda-title').value = '';
            document.getElementById('agenda-date').value = '';
            document.getElementById('agenda-desc').value = '';
            
            const form = document.getElementById('agenda-form-container');
            const label = document.getElementById('agenda-toggle-label');
            const chevron = document.getElementById('agenda-chevron-icon');
            if (form) form.style.display = 'none';
            if (label) label.innerText = 'Ketuk untuk membuat jadwal acara baru';
            if (chevron) chevron.style.transform = 'rotate(0deg)';

            loadAgendaAndBirthdays();
        } else {
            alert(data.error);
        }
    } catch (err) {
        console.error('Error create agenda:', err);
    }
}

async function loadAgendaAndBirthdays() {
    try {
        const resUsers = await apiFetch('/api/users');
        if (resUsers.ok) {
            const users = await resUsers.json();
            const bdayContainer = document.getElementById('birthday-list-container');
            if (bdayContainer) {
                bdayContainer.innerHTML = '';
                const usersWithBday = users.filter(u => u.birthdate);
                if (usersWithBday.length === 0) bdayContainer.innerHTML = '<p style="font-size: 13px; color: gray;">Belum ada data tanggal lahir.</p>';
                else {
                    usersWithBday.forEach(user => {
                        const bdate = new Date(user.birthdate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' });
                        const item = document.createElement('div');
                        item.style.cssText = 'display: flex; justify-content: space-between; padding: 8px 10px; background: var(--bg-light); border-radius: 6px; font-size: 14px;';
                        item.innerHTML = `<span><b>${user.name}</b></span> <span style="color: var(--primary-color);"><i class="fa-solid fa-gift"></i> ${bdate}</span>`;
                        bdayContainer.appendChild(item);
                    });
                }
            }
        }
    } catch (err) {}

    try {
        const resAgendas = await apiFetch('/api/agendas');
        if (resAgendas.ok) {
            const agendas = await resAgendas.json();
            const agendaContainer = document.getElementById('agenda-list-container');
            if (agendaContainer) {
                agendaContainer.innerHTML = '';
                if (agendas.length === 0) agendaContainer.innerHTML = '<p style="font-size: 13px; color: gray;">Belum ada agenda kegiatan tercatat.</p>';
                else {
                    agendas.forEach(item => {
                        const fDate = new Date(item.event_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
                        const card = document.createElement('div');
                        card.style.cssText = 'padding: 14px; background: var(--bg-light); border: 1px solid var(--border-color); border-left: 4px solid var(--primary-color); border-radius: 8px; display: flex; flex-direction: column; gap: 4px;';
                        card.innerHTML = `
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <h5 style="margin: 0; font-size: 15px; color: var(--text-light); font-weight: 600;">${item.title}</h5>
                                <span style="font-size: 12px; font-weight: bold; color: var(--primary-color); background: var(--primary-light); padding: 3px 8px; border-radius: 6px;"><i class="fa-solid fa-calendar-days"></i> ${fDate}</span>
                            </div>
                            ${item.description ? `<p style="margin: 4px 0 0 0; font-size: 13px; color: gray;">${item.description}</p>` : ''}
                        `;
                        agendaContainer.appendChild(card);
                    });
                }
            }
        }
    } catch (err) {}
}

async function triggerUploadProfile(inputElement) {
    if (inputElement.files && inputElement.files[0]) {
        if (!currentUser) return alert('Silakan login terlebih dahulu!');

        const formData = new FormData();
        formData.append('user_id', currentUser.id);
        formData.append('image', inputElement.files[0]);

        try {
            const response = await apiFetch('/api/update-photo', { method: 'POST', body: formData });
            const data = await response.json();
            if (response.ok) {
                alert(data.message);
                currentUser = data.user;
                localStorage.setItem('kitachat_user', JSON.stringify(currentUser));
                updateUserInterface();
            } else alert(data.error || 'Gagal memperbarui foto profil.');
        } catch (err) {
            alert('Terjadi kesalahan jaringan.');
        }
        inputElement.value = '';
    }
}

// --- FITUR GANTI PASSWORD ---
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
    const oldPassword = document.getElementById('old-password').value;
    const newPassword = document.getElementById('new-password').value;

    if (!currentUser) return alert('Silakan login terlebih dahulu!');

    try {
        const response = await apiFetch('/api/update-password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                old_password: oldPassword,
                new_password: newPassword
            })
        });
        const data = await response.json();

        if (response.ok) {
            closeChangePasswordModal();
            setTimeout(() => {
                alert(data.message || 'Status: Password berhasil diubah!');
                const oldPw = document.getElementById('old-password');
                const newPw = document.getElementById('new-password');
                if (oldPw) oldPw.value = '';
                if (newPw) newPw.value = '';
            }, 300);
        } else {
            alert(data.error || 'Gagal mengganti password.');
        }
    } catch (err) {
        console.error('Error ganti password:', err);
        alert('Terjadi kesalahan jaringan.');
    }
}

// --- FITUR TELEPON / VOICE CALL (WebRTC) ---
let localStream = null;
let peerConnection = null;
let targetSocketId = null;
let targetUserId = null;

let iceCandidateQueue = []; 

socket.on('connect', () => {
    if (currentUser && currentUser.id) {
        socket.emit('register_call_user', currentUser.id);
    }
});

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.miwifi.com:3478' }
    ],
    iceCandidatePoolSize: 10
};

function monitorPeerConnection() {
    if (!peerConnection) return;
    peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection.iceConnectionState;
        if (state === 'closed' || state === 'failed') hangUpCall();
    };
}

async function startCall(peerUserId, peerName) {
    targetUserId = peerUserId;
    iceCandidateQueue = []; 
    
    const modal = document.getElementById('call-modal');
    if (modal) modal.classList.remove('hidden');
    
    const title = document.getElementById('call-status-title');
    const peerNameEl = document.getElementById('call-peer-name');
    const acceptBtn = document.getElementById('btn-accept-call');
    
    if (title) title.innerText = 'Memanggil...';
    if (peerNameEl) peerNameEl.innerText = peerName;
    if (acceptBtn) acceptBtn.style.display = 'none';

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        peerConnection = new RTCPeerConnection(rtcConfig);
        monitorPeerConnection();
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        peerConnection.onicecandidate = (event) => {
            if (event.candidate && targetSocketId) socket.emit('ice_candidate', { targetSocketId, candidate: event.candidate });
        };
        
        peerConnection.ontrack = (event) => { 
            const remoteAudio = document.getElementById('remote-audio');
            if (remoteAudio) {
                remoteAudio.srcObject = event.streams[0]; 
                remoteAudio.play().catch(e => console.warn('Browser menunda pemutaran otomatis', e));
            }
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        socket.emit('call_user', { toUserId: peerUserId, callerName: currentUser.name, offer: offer });
    } catch (err) {
        alert('Tidak dapat mengakses mikrofon. Pastikan izin mikrofon diberikan.');
        hangUpCall();
    }
}

socket.on('incoming_call', async (data) => {
    if (currentUser && data.toUserId == currentUser.id) {
        targetSocketId = data.fromSocketId;
        targetUserId = data.fromUserId;
        iceCandidateQueue = []; 
        
        const modal = document.getElementById('call-modal');
        if (modal) modal.classList.remove('hidden');
        
        const title = document.getElementById('call-status-title');
        const peerNameEl = document.getElementById('call-peer-name');
        const acceptBtn = document.getElementById('btn-accept-call');

        if (title) title.innerText = 'Panggilan Masuk...';
        if (peerNameEl) peerNameEl.innerText = data.callerName;
        if (acceptBtn) acceptBtn.style.display = 'inline-block';

        callRingtone.play().catch(() => {});
        window.incomingOffer = data.offer;
    }
});

async function acceptCall() {
    callRingtone.pause();
    callRingtone.currentTime = 0;

    const acceptBtn = document.getElementById('btn-accept-call');
    const title = document.getElementById('call-status-title');
    
    if (acceptBtn) acceptBtn.style.display = 'none';
    if (title) title.innerText = 'Terhubung';

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        peerConnection = new RTCPeerConnection(rtcConfig);
        monitorPeerConnection();
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        peerConnection.onicecandidate = (event) => {
            if (event.candidate && targetSocketId) socket.emit('ice_candidate', { targetSocketId, candidate: event.candidate });
        };
        
        peerConnection.ontrack = (event) => { 
            const remoteAudio = document.getElementById('remote-audio');
            if (remoteAudio) {
                remoteAudio.srcObject = event.streams[0]; 
                remoteAudio.play().catch(e => console.warn('Browser menunda pemutaran otomatis', e));
            }
        };

        await peerConnection.setRemoteDescription(new RTCSessionDescription(window.incomingOffer));
        
        while (iceCandidateQueue.length) {
            const candidate = iceCandidateQueue.shift();
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('make_answer', { answer, toSocketId: targetSocketId });
    } catch (err) {
        hangUpCall();
    }
}

socket.on('call_answered', async (data) => {
    if (data.targetSocketId) targetSocketId = data.targetSocketId;
    const title = document.getElementById('call-status-title');
    if (title) title.innerText = 'Terhubung';
    
    try { 
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer)); 
        
        while (iceCandidateQueue.length) {
            const candidate = iceCandidateQueue.shift();
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    } catch (err) {}
});

socket.on('ice_candidate', async (data) => {
    try { 
        if (peerConnection) {
            if (peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } else {
                iceCandidateQueue.push(data.candidate);
            }
        }
    } catch (err) {}
});

function hangUpCall() {
    callRingtone.pause();
    callRingtone.currentTime = 0;
    
    const remoteAudio = document.getElementById('remote-audio');
    if (remoteAudio) remoteAudio.srcObject = null;

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    const modal = document.getElementById('call-modal');
    if (modal) modal.classList.add('hidden');
    if (targetUserId) socket.emit('end_call', { toUserId: targetUserId });
    
    targetSocketId = null;
    targetUserId = null;
    window.incomingOffer = null;
    iceCandidateQueue = [];
}

// --- FITUR LAINNYA ---
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

function togglePhotoMenu(event, menuId) {
    event.stopPropagation();
    document.querySelectorAll('.photo-dropdown').forEach(el => { if (el.id !== menuId) el.classList.remove('active'); });
    const dropdown = document.getElementById(menuId);
    if (dropdown) dropdown.classList.toggle('active');
}

window.addEventListener('click', () => { document.querySelectorAll('.photo-dropdown').forEach(el => el.classList.remove('active')); });

async function downloadPhoto(imageUrl) {
    try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `kitachat-foto-${Date.now()}.jpg`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
    } catch (err) {
        alert('Gagal menyimpan foto.');
    }
}

async function deleteAlbumPhoto(photoId) {
    if (!confirm('Apakah Anda yakin ingin menghapus foto ini?')) return;
    try {
        const response = await apiFetch(`/api/albums/${photoId}`, { method: 'DELETE' });
        const data = await response.json();
        if (response.ok) {
            alert(data.message);
            loadAlbumPhotos();
        } else alert(data.error || 'Gagal menghapus foto.');
    } catch (err) {}
}

const chatFileInput = document.getElementById('chat-file-input');
if (chatFileInput) {
    chatFileInput.addEventListener('change', async function() {
        if (this.files && this.files[0]) {
            if (!currentUser) return alert('Silakan login terlebih dahulu!');

            const formData = new FormData();
            formData.append('media', this.files[0]);
            formData.append('user_id', currentUser.id);
            formData.append('client_time', new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));

            try {
                const response = await apiFetch('/api/send-message', { method: 'POST', body: formData });
                if (!response.ok) alert('Gagal mengunggah gambar di obrolan.');
            } catch (err) {
                alert('Terjadi kesalahan jaringan.');
            }
            this.value = '';
        }
    });
}

// --- FITUR EMAIL PEMULIHAN & LUPA PASSWORD ---
async function handleUpdateEmail(event) {
    event.preventDefault();
    const emailInput = document.getElementById('recovery-email');
    if (!emailInput) return;
    
    const email = emailInput.value;
    if (!currentUser) return alert('Silakan login terlebih dahulu!');

    try {
        const response = await apiFetch('/api/update-email', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await response.json();
        if (response.ok) {
            alert(data.message);
            const modal = document.getElementById('email-modal');
            if (modal) modal.classList.add('hidden');
        } else alert(data.error);
    } catch (err) { alert('Kesalahan jaringan.'); }
}

async function requestOTP() {
    const phoneInput = document.getElementById('login-phone');
    if (!phoneInput) return;
    
    const phone = phoneInput.value;
    if (!phone) return alert('Masukkan nomor telepon Anda di form login terlebih dahulu.');

    try {
        const response = await fetch('/api/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        const data = await response.json();
        
        if (response.ok) {
            alert(data.message);
            const otpModal = document.getElementById('otp-modal');
            if (otpModal) otpModal.classList.remove('hidden');
        } else alert(data.error);
    } catch (err) { alert('Terjadi kesalahan jaringan.'); }
}

async function handleResetPassword(event) {
    event.preventDefault();
    const phone = document.getElementById('login-phone').value;
    const otp = document.getElementById('reset-otp').value;
    const new_password = document.getElementById('reset-new-password').value;

    try {
        const response = await fetch('/api/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, otp, new_password })
        });
        const data = await response.json();

        if (response.ok) {
            alert(data.message);
            
            const otpModal = document.getElementById('otp-modal');
            const forgotBtn = document.getElementById('forgot-password-btn');
            const loginPw = document.getElementById('login-password');
            
            if (otpModal) otpModal.classList.add('hidden');
            if (forgotBtn) forgotBtn.classList.add('hidden');
            if (loginPw) loginPw.value = '';
            
            failedLoginAttempts = 0;
        } else alert(data.error);
    } catch (err) { alert('Kesalahan jaringan.'); }
}

function clearChat() {
    if (confirm('Yakin ingin menghapus semua riwayat obrolan?')) {
        apiFetch('/api/messages', { method: 'DELETE' }).catch(() => alert('Terjadi kesalahan saat membersihkan obrolan.'));
    }
}

socket.on('chat_cleared', () => {
    const chatContainer = document.getElementById('chat-messages-container');
    if (chatContainer) chatContainer.innerHTML = '';
});

socket.on('call_ended', () => hangUpCall());

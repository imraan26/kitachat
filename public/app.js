const socket = io();
let currentUser = null;

// --- INTERCEPTOR FETCH UNTUK SINGLE DEVICE LOGIN ---
const originalFetch = window.fetch;
window.fetch = async function(resource, options = {}) {
    if (typeof resource === 'string' && resource.startsWith('/api/') && !resource.includes('/login') && !resource.includes('/register')) {
        
        // Cara paling aman menyisipkan token tanpa merusak FormData bawaan browser
        options.headers = {
            ...(options.headers || {}),
            'x-user-id': currentUser ? String(currentUser.id) : '',
            'x-session-token': localStorage.getItem('kitachat_session_token') || ''
        };
    }
    
    const response = await originalFetch(resource, options);
    
    if (response.status === 403) {
        const clonedResponse = response.clone();
        try {
            const data = await clonedResponse.json();
            if (data.error === 'SESSION_KICKED') {
                alert(data.message);
                logout();
            }
        } catch (e) {
            console.error('Gagal membaca respons 403:', e);
        }
    }
    
    return response;
};
// ---------------------------------------------------

// Registrasi Service Worker Sederhana untuk PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker terdaftar:', reg.scope))
            .catch(err => console.log('Gagal mendaftarkan Service Worker:', err));
    });
}

let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    // Cegah banner bawaan browser muncul otomatis
    e.preventDefault();
    deferredPrompt = e;
    
    // Tampilkan menu tombol instal di halaman Pengaturan
    const installContainer = document.getElementById('install-pwa-container');
    if (installContainer) {
        installContainer.classList.remove('hidden');
    }
});

function installAppToAndroid() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                console.log('Pengguna menerima instalasi PWA');
            } else {
                console.log('Pengguna menolak instalasi PWA');
            }
            deferredPrompt = null;
        });
    } else {
        alert('Aplikasi sudah terinstal atau peramban Anda tidak mendukung instalasi otomatis. Gunakan menu "Tambahkan ke Layar Utama" di peramban.');
    }
}

// Objek Audio untuk Nada Dering
const chatBeepAudio = new Audio('/audio/chat-beep.mp3');
const callRingtone = new Audio('/audio/nadadering-phone.mp3');
callRingtone.loop = true;

// Variabel Global untuk Fitur Reply Pesan
window.replyingToMessageId = null;

// Ganti Tab Login / Register
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

// Proses Register
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

// Proses Login
async function handleLogin(event) {
    event.preventDefault();
    const phone = document.getElementById('login-phone').value;
    const password = document.getElementById('login-password').value;

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password })
        });
        const data = await response.json();

        if (response.ok) {
            currentUser = data.user;
            localStorage.setItem('kitachat_user', JSON.stringify(currentUser));
            
            // SIMPAN TOKEN SESI SINGLE DEVICE
            if (data.session_token) {
                localStorage.setItem('kitachat_session_token', data.session_token);
            }

            chatBeepAudio.play().catch(() => {});
            chatBeepAudio.pause();
            chatBeepAudio.currentTime = 0;

            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }

            updateUserInterface();
            socket.emit('register_call_user', currentUser.id);
        } else {
            alert(data.error);
        }
    } catch (err) {
        console.error('Error login:', err);
    }
}

function updateUserInterface() {
    if (!currentUser) return;

    const mobileName = document.getElementById('user-display-name');
    if (mobileName) mobileName.innerText = currentUser.name;
    
    const mobileAvatar = document.getElementById('user-avatar');
    if (mobileAvatar && currentUser.photo_url) {
        mobileAvatar.src = currentUser.photo_url;
    }

    const desktopName = document.getElementById('user-display-name-desktop');
    if (desktopName) desktopName.innerText = currentUser.name;
    
    const desktopAvatar = document.getElementById('user-avatar-desktop');
    if (desktopAvatar && currentUser.photo_url) {
        desktopAvatar.src = currentUser.photo_url;
    }
    
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
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        updateUserInterface();
        socket.emit('register_call_user', currentUser.id);
    }
});

// Penyesuaian Navigasi Tab Agar Tampil Sempurna
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

    if (tabName === 'chat') {
        // Chat aktif
    } else if (tabName === 'album') {
        loadAlbumPhotos();
    } else if (tabName === 'agenda') {
        loadAgendaAndBirthdays();
    } else if (tabName === 'family') {
        loadFamilyMembers();
    } else if (tabName === 'settings') {
        // Pengaturan aktif
    }

    if (element) {
        element.classList.add('active');
    }
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

    const savedUser = localStorage.getItem('kitachat_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        updateUserInterface();
        socket.emit('register_call_user', currentUser.id);
    }
});

function logout() {
    currentUser = null;
    localStorage.removeItem('kitachat_user');
    localStorage.removeItem('kitachat_session_token'); // HAPUS TOKEN SAAT KELUAR
    
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

// --- FITUR KIRIM PESAN & WAKTU LOKAL PONSEL ---
async function sendMessage() {
    const input = document.getElementById('message-input');
    const messageText = input.value.trim();
    
    if (!messageText) return;

    if (!currentUser) {
        alert('Silakan login terlebih dahulu!');
        return;
    }

    const localTime = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    const formData = new FormData();
    formData.append('user_id', currentUser.id);
    formData.append('message', messageText);
    formData.append('client_time', localTime);

    if (window.replyingToMessageId) {
        formData.append('reply_to_id', window.replyingToMessageId);
    }

    try {
        const response = await fetch('/api/send-message', {
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

// --- FITUR STIKER ---
async function sendSticker(stickerUrl) {
    if (!currentUser) return;
    
    const localTime = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const formData = new FormData();
    formData.append('user_id', currentUser.id);
    formData.append('message', '');
    formData.append('sticker_url', stickerUrl);
    formData.append('client_time', localTime);

    try {
        await fetch('/api/send-message', { method: 'POST', body: formData });
    } catch (err) {
        console.error('Gagal mengirim stiker:', err);
    }
}

// --- FITUR VOICE NOTE (REKAM SUARA) YANG DIOPTIMALKAN UNTUK ANDROID & IOS ---
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

async function toggleVoiceRecording() {
    const micBtn = document.getElementById('mic-btn');

    if (!isRecording) {
        // --- MULAI MEREKAM ---
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Deteksi dukungan MIME type untuk Android / iOS / Desktop
            let options = { mimeType: 'audio/webm' };
            if (MediaRecorder.isTypeSupported('audio/mp4')) {
                options = { mimeType: 'audio/mp4' }; // Lebih optimal untuk iOS
            } else if (!MediaRecorder.isTypeSupported('audio/webm')) {
                options = {}; // Gunakan default browser jika tidak didukung
            }

            mediaRecorder = new MediaRecorder(stream, options);
            audioChunks = [];

            mediaRecorder.ondataavailable = event => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                // Hentikan seluruh Jalur Media (Microphone Stream) agar indikator mic di HP/Laptop tertutup otomatis
                stream.getTracks().forEach(track => track.stop());

                const blobType = options.mimeType || 'audio/webm';
                const audioBlob = new Blob(audioChunks, { type: blobType });
                const localTime = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                
                const formData = new FormData();
                formData.append('user_id', currentUser.id);
                formData.append('media', audioBlob, blobType.includes('mp4') ? 'voicenote.mp4' : 'voicenote.webm');
                formData.append('client_time', localTime);

                try {
                    const response = await fetch('/api/send-message', { method: 'POST', body: formData });
                    if (!response.ok) alert('Gagal mengirim pesan suara.');
                } catch (err) {
                    console.error('Gagal upload voice note:', err);
                }

                // Kembalikan status tombol mic ke normal
                isRecording = false;
                if (micBtn) micBtn.style.color = 'var(--text-light)';
            };

            mediaRecorder.start();
            isRecording = true;
            if (micBtn) micBtn.style.color = '#e74c3c'; // Indikator merah saat merekam
            
        } catch (err) {
            console.error('Mikrofon tidak dapat diakses:', err);
            alert('Izin mikrofon ditolak atau tidak didukung perangkat.');
            isRecording = false;
            if (micBtn) micBtn.style.color = 'var(--text-light)';
        }
    } else {
        // --- HENTIKAN PEREKAMAN SECARA MANUAL ---
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
    }
}

// --- FITUR REPLY & DELETE PESAN ---
function setupMessageInteraction(msgDiv, messageId, messageText) {
    let pressTimer;

    msgDiv.addEventListener('mousedown', () => {
        pressTimer = setTimeout(() => showMessageActionModal(messageId, messageText), 600);
    });

    msgDiv.addEventListener('mouseup', () => clearTimeout(pressTimer));
    msgDiv.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => showMessageActionModal(messageId, messageText), 600);
    });
    msgDiv.addEventListener('touchend', () => clearTimeout(pressTimer));
}

function showMessageActionModal(messageId, messageText) {
    const choice = confirm(`Pilih aksi untuk pesan ini:\n[OK] Balas (Reply)\n[Cancel] Hapus Pesan`);
    if (choice) {
        window.replyingToMessageId = messageId;
        const chatInputArea = document.getElementById('chat-input-area');
        
        let banner = document.getElementById('reply-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'reply-banner';
            banner.style.cssText = 'background: var(--bg-light); padding: 6px 12px; font-size: 12px; border-left: 3px solid var(--primary-color); display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; border-radius: 4px; color: var(--text-light);';
            chatInputArea.parentNode.insertBefore(banner, chatInputArea);
        }
        banner.innerHTML = `<span>Membalas: <b>${messageText || 'Lampiran'}</b></span> <button onclick="cancelReply()" style="background:none; border:none; color:red; cursor:pointer; font-weight:bold;">&times;</button>`;
    } else {
        deleteMessage(messageId);
    }
}

function cancelReply() {
    window.replyingToMessageId = null;
    const banner = document.getElementById('reply-banner');
    if (banner) banner.remove();
}

async function deleteMessage(messageId) {
    try {
        const response = await fetch(`/api/messages/${messageId}`, { method: 'DELETE' });
        if (!response.ok) alert('Gagal menghapus pesan.');
    } catch (err) {
        console.error('Error hapus pesan:', err);
    }
}

// Socket event listeners untuk obrolan
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
    if (bubble) {
        bubble.innerHTML = `<div style="font-style: italic; color: gray; font-size: 13px;">Pesan telah dihapus</div>`;
    }
});

function appendChatMessage(data) {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;
    
    const msgDiv = document.createElement('div');
    msgDiv.id = `msg-bubble-${data.id}`;
    const isSelf = currentUser && data.user_id === currentUser.id;
    msgDiv.className = isSelf ? 'chat-bubble chat-outgoing' : 'chat-bubble chat-incoming';

    if (data.is_deleted) {
        msgDiv.innerHTML = `<div style="font-style: italic; color: gray; font-size: 13px;">Pesan telah dihapus</div>`;
        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
        return;
    }

    let contentHtml = '';

    // Tampilkan kutipan balasan (reply) agar terlihat oleh semua anggota keluarga
    if (data.reply_text) {
        contentHtml += `
            <div style="border-left: 3px solid var(--primary-color); background: rgba(0,0,0,0.05); padding: 4px 8px; margin-bottom: 6px; border-radius: 4px; font-size: 11px; opacity: 0.8;">
                <b>Membalas:</b> ${data.reply_text}
            </div>`;
    }

    if (data.message) {
        contentHtml += `<div>${data.message}</div>`;
    }
    if (data.image_url) {
        contentHtml += `<img src="${data.image_url}" style="max-width: 220px; border-radius: 8px; display: block; margin-top: 5px; cursor: pointer;" onclick="openZoomModal('${data.image_url}')">`;
    }
    if (data.sticker_url) {
        contentHtml += `<img src="${data.sticker_url}" style="width: 120px; height: 120px; display: block; margin-top: 5px;">`;
    }
    
    // Pemutar Voice Note yang optimal di iOS dan Android (Bisa didengar pengirim & anggota lain)
    if (data.audio_url) {
        contentHtml += `<audio controls preload="metadata" src="${data.audio_url}" style="max-width: 200px; height: 35px; margin-top: 5px;"></audio>`;
    }

    const displayTime = data.time || '';

    msgDiv.innerHTML = `
        ${!isSelf ? `<div class="chat-sender-name">${data.name}</div>` : ''}
        ${contentHtml}
        <div class="chat-time">${displayTime}</div>
    `;

    setupMessageInteraction(msgDiv, data.id, data.message);

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

async function loadFamilyMembers() {
    try {
        const response = await fetch('/api/users');
        const users = await response.json();

        if (response.ok) {
            const container = document.getElementById('family-list-container');
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

// --- FITUR ALBUM GALERI MODERN ---
let currentAlbumFilter = 'semua';
let globalAlbumData = [];

async function loadAlbumPhotos() {
    try {
        const response = await fetch('/api/albums');
        const photos = await response.json();

        if (response.ok) {
            globalAlbumData = photos;
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

    if (type === 'tahun') {
        filtered = globalAlbumData.filter(item => new Date(item.created_at).getFullYear() === now.getFullYear());
    } else if (type === 'bulan') {
        filtered = globalAlbumData.filter(item => {
            const d = new Date(item.created_at);
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });
    }

    renderAlbumGrid(filtered);
}

async function handleUploadPhoto(event) {
    event.preventDefault();
    const fileInput = document.getElementById('photo-file-input');
    const caption = document.getElementById('photo-caption-input').value;

    if (!currentUser) {
        alert('Silakan login terlebih dahulu!');
        return;
    }

    if (fileInput.files.length === 0) {
        alert('Pilih file gambar terlebih dahulu!');
        return;
    }

    const formData = new FormData();
    formData.append('user_id', currentUser.id);
    formData.append('image', fileInput.files[0]);
    formData.append('caption', caption);

    try {
        const response = await fetch('/api/albums', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();

        if (response.ok) {
            alert(data.message);
            fileInput.value = '';
            document.getElementById('photo-caption-input').value = '';
            loadAlbumPhotos();
        } else {
            alert(data.error);
        }
    } catch (err) {
        console.error('Error upload foto:', err);
    }
}

async function loadAgendaAndBirthdays() {
    try {
        const resUsers = await fetch('/api/users');
        const users = await resUsers.json();
        const bdayContainer = document.getElementById('birthday-list-container');
        if (bdayContainer) {
            bdayContainer.innerHTML = '';

            const usersWithBday = users.filter(u => u.birthdate);
            if (usersWithBday.length === 0) {
                bdayContainer.innerHTML = '<p style="font-size: 13px; color: gray;">Belum ada data tanggal lahir.</p>';
            } else {
                usersWithBday.forEach(user => {
                    const bdate = new Date(user.birthdate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' });
                    const item = document.createElement('div');
                    item.style.display = 'flex';
                    item.style.justifyContent = 'space-between';
                    item.style.padding = '8px 10px';
                    item.style.background = 'var(--bg-light)';
                    item.style.borderRadius = '6px';
                    item.style.fontSize = '14px';

                    item.innerHTML = `<span><b>${user.name}</b></span> <span style="color: var(--primary-color);"><i class="fa-solid fa-gift"></i> ${bdate}</span>`;
                    bdayContainer.appendChild(item);
                });
            }
        }
    } catch (err) {
        console.error('Gagal memuat ulang tahun:', err);
    }

    try {
        const resAgendas = await fetch('/api/agendas');
        const agendas = await resAgendas.json();
        const agendaContainer = document.getElementById('agenda-list-container');
        if (agendaContainer) {
            agendaContainer.innerHTML = '';

            if (agendas.length === 0) {
                agendaContainer.innerHTML = '<p style="font-size: 13px; color: gray;">Belum ada agenda kegiatan tercatat.</p>';
                return;
            }

            agendas.forEach(item => {
                const fDate = new Date(item.event_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
                const card = document.createElement('div');
                card.style.padding = '10px 12px';
                card.style.background = 'var(--bg-light)';
                card.style.borderLeft = '4px solid var(--primary-color)';
                card.style.borderRadius = '4px';

                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h5 style="margin: 0; font-size: 15px; color: var(--text-light);">${item.title}</h5>
                        <span style="font-size: 12px; font-weight: bold; color: var(--primary-color);">${fDate}</span>
                    </div>
                    ${item.description ? `<p style="margin: 5px 0 0 0; font-size: 13px; color: gray;">${item.description}</p>` : ''}
                `;
                agendaContainer.appendChild(card);
            });
        }
    } catch (err) {
        console.error('Gagal memuat agenda:', err);
    }
}

// --- FITUR GANTI FOTO PROFIL ---
async function triggerUploadProfile(inputElement) {
    if (inputElement.files && inputElement.files[0]) {
        const file = inputElement.files[0];

        if (!currentUser) {
            alert('Silakan login terlebih dahulu!');
            return;
        }

        const formData = new FormData();
        formData.append('user_id', currentUser.id);
        formData.append('image', file);

        try {
            const response = await fetch('/api/update-photo', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();

            if (response.ok) {
                alert(data.message);
                currentUser = data.user;
                localStorage.setItem('kitachat_user', JSON.stringify(currentUser));

                const mobileAvatar = document.getElementById('user-avatar');
                if (mobileAvatar) mobileAvatar.src = currentUser.photo_url;

                const desktopAvatar = document.getElementById('user-avatar-desktop');
                if (desktopAvatar) desktopAvatar.src = currentUser.photo_url;

                const settingsAvatar = document.getElementById('settings-user-avatar');
                if (settingsAvatar) settingsAvatar.src = currentUser.photo_url;
            } else {
                alert(data.error || 'Gagal memperbarui foto profil.');
            }
        } catch (err) {
            console.error('Error update foto profil:', err);
            alert('Terjadi kesalahan jaringan.');
        }

        inputElement.value = '';
    }
}

// --- FITUR TELEPON / VOICE CALL (WebRTC) ---
let localStream = null;
let peerConnection = null;
let targetSocketId = null;
let targetUserId = null;

// Konfigurasi WebRTC yang Dioptimalkan untuk Wi-Fi & Data Seluler (Multi-STUN)
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.ekiga.net' },
        { urls: 'stun:stun.sipgate.net' }
    ],
    iceCandidatePoolSize: 10
};

// Pemantau status koneksi jaringan/panggilan
function monitorPeerConnection() {
    if (!peerConnection) return;

    peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection.iceConnectionState;
        console.log('Status Jaringan Panggilan:', state);

        if (state === 'disconnected' || state === 'failed') {
            console.warn('Jaringan berpindah (Wi-Fi/Seluler) atau melemah, mencoba menyambungkan ulang...');
        } else if (state === 'closed') {
            hangUpCall();
        }
    };
}

async function startCall(peerUserId, peerName) {
    targetUserId = peerUserId;
    const modal = document.getElementById('call-modal');
    modal.classList.remove('hidden');
    document.getElementById('call-status-title').innerText = 'Memanggil...';
    document.getElementById('call-peer-name').innerText = peerName;
    document.getElementById('btn-accept-call').style.display = 'none';

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        
        peerConnection = new RTCPeerConnection(rtcConfig);
        monitorPeerConnection(); // Diaktifkan untuk memantau kestabilan Wi-Fi/Seluler
        
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        peerConnection.onicecandidate = (event) => {
            if (event.candidate && targetSocketId) {
                socket.emit('ice_candidate', { targetSocketId, candidate: event.candidate });
            }
        };

        peerConnection.ontrack = (event) => {
            const remoteAudio = document.getElementById('remote-audio');
            remoteAudio.srcObject = event.streams[0];
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        socket.emit('call_user', {
            toUserId: peerUserId,
            callerName: currentUser.name,
            offer: offer
        });

    } catch (err) {
        console.error('Gagal mengakses mikrofon:', err);
        alert('Tidak dapat mengakses mikrofon untuk menelepon.');
        hangUpCall();
    }
}

socket.on('incoming_call', async (data) => {
    if (currentUser && data.toUserId == currentUser.id) {
        targetSocketId = data.fromSocketId;
        targetUserId = data.fromUserId;
        
        const modal = document.getElementById('call-modal');
        modal.classList.remove('hidden');
        document.getElementById('call-status-title').innerText = 'Panggilan Masuk...';
        document.getElementById('call-peer-name').innerText = data.callerName;
        document.getElementById('btn-accept-call').style.display = 'inline-block';

        callRingtone.play().catch(() => {});
        if (Notification.permission === 'granted') {
            new Notification('Panggilan Masuk', {
                body: `${data.callerName} sedang memanggil...`,
                icon: '/logo-kitachat.png'
            });
        }

        window.incomingOffer = data.offer;
    }
});

async function acceptCall() {
    callRingtone.pause();
    callRingtone.currentTime = 0;

    document.getElementById('btn-accept-call').style.display = 'none';
    document.getElementById('call-status-title').innerText = 'Terhubung';

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        
        peerConnection = new RTCPeerConnection(rtcConfig);
        monitorPeerConnection(); // Diaktifkan untuk memantau kestabilan Wi-Fi/Seluler

        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        peerConnection.onicecandidate = (event) => {
            if (event.candidate && targetSocketId) {
                socket.emit('ice_candidate', { targetSocketId, candidate: event.candidate });
            }
        };

        peerConnection.ontrack = (event) => {
            const remoteAudio = document.getElementById('remote-audio');
            remoteAudio.srcObject = event.streams[0];
        };

        await peerConnection.setRemoteDescription(new RTCSessionDescription(window.incomingOffer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('make_answer', { answer, toSocketId: targetSocketId });

    } catch (err) {
        console.error('Error saat menerima panggilan:', err);
        hangUpCall();
    }
}

socket.on('call_answered', async (data) => {
    if (data.targetSocketId) {
        targetSocketId = data.targetSocketId;
    }
    document.getElementById('call-status-title').innerText = 'Terhubung';
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } catch (err) {
        console.error('Error setting remote description:', err);
    }
});

socket.on('ice_candidate', async (data) => {
    try {
        if (peerConnection) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (err) {
        console.error('Error adding received ice candidate', err);
    }
});

function hangUpCall() {
    callRingtone.pause();
    callRingtone.currentTime = 0;

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
    
    if (targetUserId) {
        socket.emit('end_call', { toUserId: targetUserId });
    }
    
    targetSocketId = null;
    targetUserId = null;
    window.incomingOffer = null;
}

// --- FITUR ZOOM, SIMPAN, DAN HAPUS FOTO ALBUM ---
function openZoomModal(imageUrl) {
    const modal = document.getElementById('photo-zoom-modal');
    const zoomedImg = document.getElementById('zoomed-img-element');
    zoomedImg.src = imageUrl;
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

function closeZoomModal() {
    const modal = document.getElementById('photo-zoom-modal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
}

function togglePhotoMenu(event, menuId) {
    event.stopPropagation();
    document.querySelectorAll('.photo-dropdown').forEach(el => {
        if (el.id !== menuId) el.classList.remove('active');
    });

    const dropdown = document.getElementById(menuId);
    if (dropdown) {
        dropdown.classList.toggle('active');
    }
}

window.addEventListener('click', () => {
    document.querySelectorAll('.photo-dropdown').forEach(el => {
        el.classList.remove('active');
    });
});

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
        console.error('Gagal mengunduh foto:', err);
        alert('Gagal menyimpan foto.');
    }
}

async function deleteAlbumPhoto(photoId) {
    if (!confirm('Apakah Anda yakin ingin menghapus foto ini dari album?')) return;

    try {
        const response = await fetch(`/api/albums/${photoId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: currentUser.id })
        });
        const data = await response.json();

        if (response.ok) {
            alert(data.message);
            loadAlbumPhotos();
        } else {
            alert(data.error || 'Gagal menghapus foto.');
        }
    } catch (err) {
        console.error('Error hapus foto:', err);
    }
}

// --- KIRIM GAMBAR DI OBROLAN ---
const chatFileInput = document.getElementById('chat-file-input');
if (chatFileInput) {
    chatFileInput.addEventListener('change', async function() {
        if (this.files && this.files[0]) {
            const file = this.files[0];

            if (!currentUser) {
                alert('Silakan login terlebih dahulu!');
                return;
            }

            const localTime = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            const formData = new FormData();
            formData.append('media', file);
            formData.append('user_id', currentUser.id);
            formData.append('message', '');
            formData.append('client_time', localTime);

            try {
                const response = await fetch('/api/send-message', {
                    method: 'POST',
                    body: formData
                });
                const result = await response.json();

                if (!response.ok) {
                    alert(result.error || 'Gagal mengunggah gambar di obrolan.');
                }
            } catch (err) {
                console.error('Error saat mengirim gambar di chat:', err);
                alert('Terjadi kesalahan jaringan.');
            }

            this.value = '';
        }
    });
}

// --- BERSIHKAN SELURUH OBROLAN ---
function clearChat() {
    if (confirm('Apakah Anda yakin ingin menghapus semua riwayat obrolan untuk semua anggota keluarga?')) {
        fetch('/api/messages', {
            method: 'DELETE',
        })
        .then(response => response.json())
        .then(data => console.log(data.message))
        .catch(err => {
            console.error('Gagal menghapus obrolan:', err);
            alert('Terjadi kesalahan saat membersihkan obrolan.');
        });
    }
}

socket.on('chat_cleared', () => {
    const chatContainer = document.getElementById('chat-messages-container');
    if (chatContainer) chatContainer.innerHTML = '';
});

socket.on('call_ended', () => {
    hangUpCall();
});

const socket = io();
let currentUser = null;

// Objek Audio untuk Nada Dering
const chatBeepAudio = new Audio('/audio/chat-beep.mp3');
const callRingtone = new Audio('/audio/nadadering-phone.mp3');
callRingtone.loop = true;

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
            
            // [OPTIMALISASI A] Menggunakan localStorage agar sesi tidak hilang saat browser ditutup
            localStorage.setItem('kitachat_user', JSON.stringify(currentUser));

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
}

// [OPTIMALISASI A] Memuat sesi dari localStorage saat halaman dimuat
window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('kitachat_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        updateUserInterface();
        socket.emit('register_call_user', currentUser.id);
    }
});

function switchTabNav(tabName, element) {
    const contents = document.querySelectorAll('.tab-content');
    contents.forEach(el => el.classList.add('hidden'));

    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(el => el.classList.remove('active'));

    if (tabName === 'chat') {
        document.getElementById('content-chat').classList.remove('hidden');
    } else if (tabName === 'album') {
        document.getElementById('content-album').classList.remove('hidden');
        loadAlbumPhotos();
    } else if (tabName === 'agenda') {
        document.getElementById('content-agenda').classList.remove('hidden');
        loadAgendaAndBirthdays();
    } else if (tabName === 'family') {
        document.getElementById('content-family').classList.remove('hidden');
        loadFamilyMembers();
    } else if (tabName === 'settings') {
        document.getElementById('content-settings').classList.remove('hidden');
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
    localStorage.removeItem('kitachat_user'); // [OPTIMALISASI A] Hapus dari localStorage
    
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

    const loginPhone = document.getElementById('login-phone');
    const loginPassword = document.getElementById('login-password');
    if (loginPhone) loginPhone.value = '';
    if (loginPassword) loginPassword.value = '';
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const messageText = input.value.trim();
    if (!messageText) return;

    if (!currentUser) {
        alert('Silakan login terlebih dahulu!');
        return;
    }

    const messageData = {
        userId: currentUser.id,
        name: currentUser.name,
        message: messageText
    };

    socket.emit('send_message', messageData);
    input.value = '';
}

// [OPTIMALISASI B] Event listener chat_history aktif untuk memuat riwayat obrolan otomatis
socket.on('chat_history', (history) => {
    const container = document.getElementById('chat-messages-container');
    if (container) {
        container.innerHTML = ''; 
        history.forEach(data => {
            appendChatMessage(data);
        });
    }
});

socket.on('receive_message', (data) => {
    appendChatMessage(data);

    if (currentUser && data.name !== currentUser.name) {
        chatBeepAudio.play().catch(() => {});
        
        if (Notification.permission === 'granted') {
            new Notification(`Pesan Baru dari ${data.name}`, {
                body: data.message || 'Mengirim sebuah gambar',
                icon: '/logo-kitachat.png'
            });
        }
    }
});

function appendChatMessage(data) {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;
    
    const msgDiv = document.createElement('div');
    const isSelf = currentUser && data.name === currentUser.name;

    msgDiv.className = isSelf ? 'chat-bubble chat-outgoing' : 'chat-bubble chat-incoming';

    let contentHtml = '';
    if (data.message) {
        contentHtml += `<div>${data.message}</div>`;
    }
    if (data.image_url) {
        contentHtml += `<img src="${data.image_url}" style="max-width: 220px; border-radius: 8px; display: block; margin-top: 5px; cursor: pointer;" onclick="openZoomModal('${data.image_url}')">`;
    }

    msgDiv.innerHTML = `
        ${!isSelf ? `<div class="chat-sender-name">${data.name}</div>` : ''}
        ${contentHtml}
        <div class="chat-time">${data.time}</div>
    `;

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

            users.forEach(user => {
                const card = document.createElement('div');
                card.style.background = 'var(--card-bg)';
                card.style.border = '1px solid var(--border-color)';
                card.style.padding = '15px';
                card.style.borderRadius = '8px';
                card.style.boxShadow = '0 2px 5px rgba(0,0,0,0.05)';

                const bdate = user.birthdate ? new Date(user.birthdate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Tidak diisi';

                card.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px;">
                        <i class="fa-solid fa-user-circle" style="font-size: 35px; color: var(--primary-color);"></i>
                        <div>
                            <h4 style="margin: 0; color: var(--text-light);">${user.name}</h4>
                            <p style="margin: 0; font-size: 13px; color: gray;"><i class="fa-solid fa-phone"></i> ${user.phone}</p>
                        </div>
                    </div>
                    <p style="margin: 5px 0 0 0; font-size: 12px;"><i class="fa-solid fa-cake-candles"></i> Lahir: ${bdate}</p>
                    ${currentUser && currentUser.id !== user.id ? `<button onclick="startCall('${user.id}', '${user.name}')" class="btn-primary" style="width: 100%; margin-top: 10px; padding: 6px; font-size: 12px;"><i class="fa-solid fa-phone"></i> Telepon</button>` : ''}
                `;
                container.appendChild(card);
            });
        }
    } catch (err) {
        console.error('Gagal memuat direktori keluarga:', err);
    }
}

async function loadAlbumPhotos() {
    try {
        const response = await fetch('/api/albums');
        const photos = await response.json();

        if (response.ok) {
            const container = document.getElementById('album-grid-container');
            container.innerHTML = '';

            if (photos.length === 0) {
                container.innerHTML = '<p style="color: gray;">Belum ada foto yang diunggah ke album.</p>';
                return;
            }

            photos.forEach((item, index) => {
                const card = document.createElement('div');
                card.style.background = 'var(--card-bg)';
                card.style.border = '1px solid var(--border-color)';
                card.style.borderRadius = '8px';
                card.style.overflow = 'hidden';
                card.style.boxShadow = '0 2px 5px rgba(0,0,0,0.05)';
                card.style.position = 'relative';

                const menuId = `album-menu-${item.id || index}`;
                const isOwner = currentUser && String(currentUser.id) === String(item.user_id);

                card.innerHTML = `
                    <div class="media-wrapper" style="width: 100%;">
                        <img src="${item.image_url}" alt="Foto Album" onclick="openZoomModal('${item.image_url}')" onerror="this.src='https://via.placeholder.com/220?text=Gagal+Muat+Gambar'">
                        <button class="photo-menu-btn" onclick="togglePhotoMenu(event, '${menuId}')"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                        <div id="${menuId}" class="photo-dropdown">
                            <button onclick="downloadPhoto('${item.image_url}')"><i class="fa-solid fa-download"></i> Simpan</button>
                            ${isOwner ? `<button onclick="deleteAlbumPhoto('${item.id}')" style="color: #e74c3c;"><i class="fa-solid fa-trash"></i> Hapus</button>` : ''}
                        </div>
                    </div>
                    <div style="padding: 10px;">
                        <p style="margin: 0; font-size: 14px; font-weight: bold; color: var(--text-light);">${item.caption || 'Tanpa keterangan'}</p>
                        <p style="margin: 5px 0 0 0; font-size: 11px; color: gray;">Oleh: ${item.uploader_name}</p>
                    </div>
                `;
                container.appendChild(card);
            });
        }
    } catch (err) {
        console.error('Gagal memuat album:', err);
    }
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
    } catch (err) {
        console.error('Gagal memuat ulang tahun:', err);
    }

    try {
        const resAgendas = await fetch('/api/agendas');
        const agendas = await resAgendas.json();
        const agendaContainer = document.getElementById('agenda-list-container');
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
    } catch (err) {
        console.error('Gagal memuat agenda:', err);
    }
}

async function handleCreateAgenda(event) {
    event.preventDefault();
    const title = document.getElementById('agenda-title').value;
    const event_date = document.getElementById('agenda-date').value;
    const description = document.getElementById('agenda-desc').value;

    try {
        const response = await fetch('/api/agendas', {
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
            loadAgendaAndBirthdays();
        } else {
            alert(data.error);
        }
    } catch (err) {
        console.error('Error tambah agenda:', err);
    }
}

async function handleUpdateProfilePhoto(event) {
    event.preventDefault();
    const fileInput = document.getElementById('profile-file-input');

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

    try {
        const response = await fetch('/api/update-photo', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();

        if (response.ok) {
            alert(data.message);
            currentUser = data.user;
            
            // [OPTIMALISASI A] Perbarui localStorage saat foto profil diganti
            localStorage.setItem('kitachat_user', JSON.stringify(currentUser));

            const mobileAvatar = document.getElementById('user-avatar');
            if (mobileAvatar) mobileAvatar.src = currentUser.photo_url;

            const desktopAvatar = document.getElementById('user-avatar-desktop');
            if (desktopAvatar) desktopAvatar.src = currentUser.photo_url;

            fileInput.value = '';
        } else {
            alert(data.error);
        }
    } catch (err) {
        console.error('Error update foto profil:', err);
    }
}

// --- FITUR TELEPON / VOICE CALL (WebRTC) ---

let localStream = null;
let peerConnection = null;
let targetSocketId = null;
let targetUserId = null;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

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
        targetSocketId = data.fromSocketId; // Pastikan backend mengirim fromSocketId
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

// --- FITUR ZOOM, SIMPAN, DAN HAPUS FOTO ---

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

// --- FITUR KIRIM GAMBAR DI OBROLAN (DIREVISI MENGGUNAKAN /api/send-message) ---
const chatFileInput = document.getElementById('chat-file-input');

if (chatFileInput) {
    chatFileInput.addEventListener('change', async function() {
        if (this.files && this.files[0]) {
            const file = this.files[0];

            if (!currentUser) {
                alert('Silakan login terlebih dahulu!');
                return;
            }

            const formData = new FormData();
            formData.append('image', file);
            formData.append('user_id', currentUser.id);
            formData.append('message', ''); // Kosongkan teks jika hanya kirim gambar

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

// --- FITUR BERSIHKAN OBROLAN ---
function clearChat() {
    if (confirm('Apakah Anda yakin ingin menghapus semua riwayat obrolan untuk semua anggota keluarga?')) {
        fetch('/api/messages', {
            method: 'DELETE',
        })
        .then(response => response.json())
        .then(data => {
            console.log(data.message);
        })
        .catch(err => {
            console.error('Gagal menghapus obrolan:', err);
            alert('Terjadi kesalahan saat membersihkan obrolan.');
        });
    }
}

socket.on('chat_cleared', () => {
    const chatContainer = document.getElementById('chat-messages-container');
    if (chatContainer) {
        chatContainer.innerHTML = '';
    }
});

socket.on('call_ended', () => {
    hangUpCall();
});

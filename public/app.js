let currentUser = null;
let socket = null;
let failedLoginAttempts = 0;
let isLoggingOut = false;
let socketBound = false;

// ==========================================================
// SUPABASE REALTIME CONFIGURATION
// ==========================================================
const SUPABASE_URL = 'sb_publishable_Zx1LSh2pPQFgF0JP8B5IJA_wnN57JjD';
// PERBAIKAN: Gunakan Publishable / Anon Key asli dari Project Settings -> API Keys Supabase Anda
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4ZnVra3R4aWhma2ZvbG5iaGxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MzIyNjIsImV4cCI6MjEwNjAwODI2Mn0.6q0n_W6pqV74xmHg_VrjNfepL_QnGGlzoL9XYXWCUdY'; 

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Buat channel broadcast khusus panggilan keluarga
const callChannel = supabaseClient.channel('kitachat-family-calls', {
  config: { broadcast: { self: false } }
});

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

  socket.on('online_users_update', (onlineUserIds) => {
    const familyTab = document.getElementById('content-family');
    if (familyTab && familyTab.classList.contains('active')) {
      loadFamilyMembers();
    }
  });

  // Event WebRTC dari Socket lama sudah dialihkan ke Supabase Realtime Broadcast
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
// SERVICE WORKER / PWA & WEB PUSH NOTIFICATION
// ==========================================================
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      registerPushNotification();

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

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function registerPushNotification() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const permissionResult = await Notification.requestPermission();
    if (permissionResult !== 'granted') return;

    const publicVapidKey = 'BJKdEnjNr4C-Rc0WJi05pmu3Uf__jj941_2GiWesMmqRDM267mq3lfi--P7owdTfIDdEqNqNTV3xNe0bAQS_i8g';

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
    });

    if (!currentUser) return;

    await apiFetch('/api/save-subscription', {
      method: 'POST',
      body: JSON.stringify(subscription),
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Gagal memproses Push Notification:', err);
  }
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
      deferredPrompt = null;
    });
  } else {
    alert('Aplikasi sudah terinstal atau browser tidak mendukung instalasi otomatis.');
  }
}

async function forceUpdateApp() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.update();
        window.location.reload();
      }
    } catch (error) {
      console.error('Gagal memeriksa pembaruan:', error);
    }
  }
}

// ==========================================================
// SUPABASE REALTIME CALL LISTENERS (DIOPTIMALKAN)
// ==========================================================
function initSupabaseCallListeners() {
  callChannel
    .on('broadcast', { event: 'webrtc_signal' }, ({ payload }) => {
      if (!currentUser || String(payload.toUserId) !== String(currentUser.id)) return;

      switch (payload.type) {
        case 'offer':
          // Menyesuaikan format data agar cocok dengan handler incoming call yang ada
          handleIncomingCall({
            toUserId: payload.toUserId,
            fromUserId: payload.fromUserId,
            callerName: payload.callerName,
            offer: payload.offer
          });
          break;
        case 'answer':
          handleCallAnswered({ answer: payload.answer });
          break;
        case 'ice_candidate':
          handleIceCandidate({ candidate: payload.candidate });
          break;
        case 'end_call':
          cleanupCall(false);
          break;
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('Terhubung ke Supabase Realtime Call Channel!');
      }
    });
}

// ==========================================================
// THEME & UI HELPERS (TETAP UTUH)
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
  localStorage.setItem(STORAGE_KEYS.theme, document.body.classList.contains('dark-mode') ? 'dark' : 'light');
}

function showAuthScreen() {
  const authScreen = document.getElementById('auth-screen');
  const mainScreen = document.getElementById('main-screen');
  if (mainScreen) { mainScreen.classList.remove('active'); mainScreen.style.display = 'none'; }
  if (authScreen) { authScreen.classList.add('active'); authScreen.style.display = 'flex'; }
}

function showMainScreen() {
  const authScreen = document.getElementById('auth-screen');
  const mainScreen = document.getElementById('main-screen');
  if (authScreen) { authScreen.classList.remove('active'); authScreen.style.display = 'none'; }
  if (mainScreen) { mainScreen.classList.add('active'); mainScreen.style.display = 'flex'; }
}

function switchTab(tab) {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  if (!loginForm || !registerForm) return;

  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    tabLogin?.classList.add('active');
    tabRegister?.classList.remove('active');
  } else {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    tabRegister?.classList.add('active');
    tabLogin?.classList.remove('active');
  }
}

function switchTabNav(tabName) {
  const contents = document.querySelectorAll('.tab-content');
  contents.forEach(content => {
    content.classList.remove('active');
    content.classList.add('hidden');
  });

  const targetContent = document.getElementById(`content-${tabName}`);
  if (targetContent) {
    targetContent.classList.remove('hidden');
    targetContent.classList.add('active');
  }

  if (tabName === 'album') loadAlbumPhotos();
  else if (tabName === 'agenda') loadAgendaAndBirthdays();
  else if (tabName === 'family') loadFamilyMembers();
}

function updateUserInterface() {
  if (!currentUser) return;
  document.querySelectorAll('#user-display-name, #user-display-name-desktop, #settings-user-name').forEach(el => {
    if (el) el.textContent = currentUser.name || '';
  });
  document.querySelectorAll('#user-avatar, #user-avatar-desktop, #settings-user-avatar').forEach(el => {
    if (el && currentUser.photo_url) el.src = currentUser.photo_url;
  });
  showMainScreen();
}

// ==========================================================
// AUTH & CHAT ACTIONS (TETAP UTUH)
// ==========================================================
async function handleLogin(event) {
  event.preventDefault();
  const phone = document.getElementById('login-phone')?.value.trim() || '';
  const password = document.getElementById('login-password')?.value || '';

  if (!phone || !password) return alert('Nomor telepon dan password wajib diisi.');

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password })
    });
    const data = await parseJsonResponse(response);

    if (!response.ok) return alert(data.error || 'Login gagal.');

    currentUser = data.user;
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(currentUser));
    localStorage.setItem(STORAGE_KEYS.token, data.session_token);

    updateUserInterface();
    connectAuthenticatedSocket();
    registerPushNotification();
  } catch (error) {
    console.error('Error login:', error);
  }
}

function logout() {
  if (isLoggingOut) return;
  isLoggingOut = true;
  cleanupCall(false);
  if (socket) { socket.disconnect(); socket = null; socketBound = false; }
  currentUser = null;
  clearSavedSession();
  showAuthScreen();
  isLoggingOut = false;
}

function clearChatContainer() {
  document.getElementById('chat-messages-container')?.replaceChildren();
}

function renderChatHistory(history) {
  const container = document.getElementById('chat-messages-container');
  if (!container) return;
  container.replaceChildren();
  history.forEach(item => renderIncomingMessage(item, true));
}

function renderIncomingMessage(message, silent = false) {
  const container = document.getElementById('chat-messages-container');
  if (!container || !message) return;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  if (message.id) bubble.setAttribute('data-message-id', String(message.id));

  const isMe = currentUser && (message.name === currentUser.name || message.user_id === currentUser.id);
  bubble.classList.add(isMe ? 'chat-outgoing' : 'chat-incoming');

  if (message.message) {
    const text = document.createElement('div');
    text.className = 'chat-text';
    text.textContent = message.message;
    bubble.appendChild(text);
  }

  if (message.reply_to_id && message.reply_text) {
    const reply = document.createElement('div');
    reply.className = 'chat-reply';
    reply.textContent = `Balasan: ${message.reply_text}`;
    bubble.appendChild(reply);
  }

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

// ==========================================================
// VoIP / WebRTC (SUPABASE REALTIME BROADCAST INTEGRATED)
// ==========================================================
function createPeerConnection() {
  const connection = new RTCPeerConnection(rtcConfig);

  connection.onicecandidate = event => {
    if (event.candidate && targetUserId && currentUser) {
      callChannel.send({
        type: 'broadcast',
        event: 'webrtc_signal',
        payload: {
          type: 'ice_candidate',
          toUserId: targetUserId,
          candidate: event.candidate
        }
      });
    }
  };

  connection.ontrack = event => {
    const remoteAudio = document.getElementById('remote-audio');
    if (!remoteAudio || !event.streams[0]) return;
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
    localStream.getTracks().forEach(track => { track.stop(); });
    localStream = null;
  }

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  document.getElementById('call-modal')?.classList.add('hidden');

  if (notifyPeer && targetUserId && currentUser) {
    callChannel.send({
      type: 'broadcast',
      event: 'webrtc_signal',
      payload: {
        type: 'end_call',
        toUserId: String(targetUserId)
      }
    });
  }

  targetUserId = null;
  incomingOffer = null;
  iceCandidateQueue = [];
}

function hangUpCall() {
  cleanupCall(true);
}

async function startCall(peerUserId, peerName) {
  if (!currentUser) return alert('Silakan login terlebih dahulu!');

  targetUserId = peerUserId;
  iceCandidateQueue = [];
  incomingOffer = null;

  const modal = document.getElementById('call-modal');
  modal?.classList.remove('hidden');

  const title = document.getElementById('call-status-title');
  const peerNameEl = document.getElementById('call-peer-name');
  const acceptBtn = document.getElementById('btn-accept-call');

  if (title) title.innerText = 'Memanggil...';
  if (peerNameEl) peerNameEl.innerText = peerName;
  if (acceptBtn) acceptBtn.style.display = 'none';

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    peerConnection = createPeerConnection();

    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await callChannel.send({
      type: 'broadcast',
      event: 'webrtc_signal',
      payload: {
        type: 'offer',
        toUserId: peerUserId,
        fromUserId: currentUser.id,
        callerName: currentUser.name,
        offer
      }
    });
  } catch (error) {
    console.error('Error startCall:', error);
    alert('Tidak dapat mengakses mikrofon.');
    cleanupCall(true);
  }
}

function handleIncomingCall(data) {
  if (!currentUser || !data || String(data.toUserId) !== String(currentUser.id)) return;

  targetUserId = data.fromUserId;
  incomingOffer = data.offer;
  iceCandidateQueue = [];

  const modal = document.getElementById('call-modal');
  modal?.classList.remove('hidden');

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
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
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

    await callChannel.send({
      type: 'broadcast',
      event: 'webrtc_signal',
      payload: {
        type: 'answer',
        toUserId: targetUserId,
        answer
      }
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
    console.error('Gagal set remote description:', error);
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

  // AKTIFKAN LISTENER SUPABASE REALTIME
  initSupabaseCallListeners();
});

registerServiceWorker();

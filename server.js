const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const webpush = require('web-push');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Deklarasikan allowedOrigins DI SINI (sebelum io menggunakannya)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : '*';

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// ==========================================
// KONFIGURASI DASAR & VAPID SETUP
// ==========================================

const PORT = Number(process.env.PORT) || 3000;
const uploadDir = process.env.UPLOAD_DIR ||
  path.join(__dirname, 'data', 'uploads');

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const PASSWORD_MIN_LENGTH = 8;

// Konfigurasi Web Push menggunakan Environment Variables dari Railway
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.EMAIL_CONTACT || 'mailto:admin@kitachat.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

function ensureUploadDirectory() {
  try {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      console.log(`Folder upload berhasil dibuat: ${uploadDir}`);
    }
  } catch (error) {
    console.error('Gagal membuat folder upload:', error);
    throw error;
  }
}

ensureUploadDirectory();

// ==========================================
// DATABASE
// ==========================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

pool.on('error', error => {
  console.error('Unexpected PostgreSQL pool error:', error);
});

// ==========================================
// MIDDLEWARE DASAR
// ==========================================

app.disable('x-powered-by');

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-user-id',
    'x-session-token'
  ],
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({
  extended: true,
  limit: '1mb'
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use((req, res, next) => {
  const requestPath = req.path;

  if (requestPath === '/sw.js' || requestPath === '/app.js') {
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use(
  '/uploads',
  express.static(uploadDir, {
    dotfiles: 'deny',
    index: false,
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
  })
);

// ==========================================
// MULTER UPLOAD
// ==========================================

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, uploadDir);
  },

  filename: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${crypto.randomUUID()}${extension}`);
  }
});

const imageUpload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  },
  fileFilter: (req, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      return callback(new Error('Hanya file gambar yang diizinkan.'));
    }

    callback(null, true);
  }
});

const mediaUpload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  },
  fileFilter: (req, file, callback) => {
    const isImage = file.mimetype.startsWith('image/');
    const isAudio = file.mimetype.startsWith('audio/') || 
                    file.mimetype === 'video/webm' || 
                    file.mimetype === 'application/octet-stream';

    if (!isImage && !isAudio) {
      return callback(new Error(
        'Hanya file gambar atau audio yang diizinkan.'
      ));
    }

    callback(null, true);
  }
});

// ==========================================
// HELPER
// ==========================================

function escapeHTML(value) {
  if (typeof value !== 'string') {
    return value;
  }

  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^0-9]/g, '');
}

function isValidPassword(password) {
  return typeof password === 'string' &&
    password.length >= PASSWORD_MIN_LENGTH;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getRequestUserId(req) {
  return req.userId || req.headers['x-user-id'];
}

function getUploadUrl(filename) {
  return `/uploads/${filename}`;
}

function deleteUploadedFile(file) {
  if (!file || !file.path) {
    return;
  }

  fs.unlink(file.path, error => {
    if (error && error.code !== 'ENOENT') {
      console.error('Gagal menghapus file upload:', error);
    }
  });
}

function getSafeMessageText(message) {
  return message || '(Lampiran Media)';
}

// ==========================================
// DATABASE INITIALIZATION
// ==========================================

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      phone VARCHAR(20) UNIQUE NOT NULL,
      name VARCHAR(100) NOT NULL,
      password VARCHAR(255) NOT NULL,
      birthdate DATE,
      photo_url TEXT,
      session_token TEXT,
      email VARCHAR(255) UNIQUE,
      reset_token VARCHAR(255),
      reset_token_expiry BIGINT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS albums (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      image_url TEXT NOT NULL,
      caption TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agendas (
      id SERIAL PRIMARY KEY,
      title VARCHAR(150) NOT NULL,
      event_date DATE NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      family_id INT,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      message TEXT,
      image_url TEXT,
      sticker_url TEXT,
      audio_url TEXT,
      reply_to_id INT REFERENCES messages(id) ON DELETE SET NULL,
      is_deleted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      client_time VARCHAR(50)
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email VARCHAR(255)
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255)
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS reset_token_expiry BIGINT
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS reply_to_id INT
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_created_at
    ON messages(created_at)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_user_id
    ON messages(user_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_albums_created_at
    ON albums(created_at)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_session_token
    ON users(session_token)
  `);

  console.log('Database berhasil diinisialisasi.');
}

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================

async function checkSingleDevice(req, res, next) {
  const userId = req.headers['x-user-id'];
  const clientToken = req.headers['x-session-token'];

  if (!userId || !clientToken) {
    return res.status(401).json({
      error: 'Akses ditolak. Sesi tidak valid atau belum login.'
    });
  }

  try {
    const result = await pool.query(
      `
        SELECT id, session_token
        FROM users
        WHERE id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Pengguna tidak ditemukan.'
      });
    }

    const dbToken = result.rows[0].session_token;

    if (!dbToken || dbToken !== clientToken) {
      return res.status(403).json({
        error: 'SESSION_KICKED',
        message: 'Akun Anda telah login di perangkat lain.'
      });
    }

    req.userId = result.rows[0].id;
    req.sessionToken = clientToken;

    next();
  } catch (error) {
    console.error('Error checkSingleDevice:', error);

    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.'
    });
  }
}

// ==========================================
// ROUTE STATUS & PUSH SUBSCRIPTION
// ==========================================

app.get('/api/status', (req, res) => {
  res.json({
    status: 'Server Kitachat berjalan dengan lancar!'
  });
});

app.post('/api/save-subscription', checkSingleDevice, async (req, res) => {
  const userId = req.userId;
  const { endpoint, keys } = req.body;
  
  if (!endpoint || !keys) {
    return res.status(400).json({ error: 'Data langganan tidak valid.' });
  }

  try {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (endpoint) DO NOTHING`,
      [userId, endpoint, keys.p256dh, keys.auth]
    );
    res.json({ message: 'Langganan push notification berhasil disimpan.' });
  } catch (err) {
    console.error('Error save subscription:', err);
    res.status(500).json({ error: 'Gagal menyimpan langganan push.' });
  }
});

// ==========================================
// REGISTER & LOGIN
// ==========================================

app.post('/api/register', async (req, res) => {
  let { phone, name, password, birthdate, photo_url } = req.body;

  if (!phone || !name || !password) {
    return res.status(400).json({
      error: 'Nomor telepon, nama, dan password wajib diisi.'
    });
  }

  phone = normalizePhone(phone);
  name = String(name).trim();

  try {
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE phone = $1',
      [phone]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: 'Nomor telepon sudah terdaftar di Kitachat.'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const sessionToken = crypto.randomBytes(32).toString('hex');

    const result = await pool.query(
      `
        INSERT INTO users (phone, name, password, birthdate, photo_url, session_token)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, phone, name, birthdate, photo_url, created_at
      `,
      [phone, escapeHTML(name), hashedPassword, birthdate || null, photo_url || null, sessionToken]
    );

    return res.status(201).json({
      message: 'Registrasi berhasil! Selamat bergabung di Kitachat.',
      session_token: sessionToken,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Error register:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

app.post('/api/login', async (req, res) => {
  let { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({
      error: 'Nomor telepon dan password wajib diisi.'
    });
  }

  phone = normalizePhone(phone);

  try {
    const result = await pool.query(
      `SELECT id, phone, name, password, birthdate, photo_url FROM users WHERE phone = $1`,
      [phone]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Nomor telepon belum terdaftar.' });
    }

    const user = result.rows[0];
    const passwordValid = await bcrypt.compare(password, user.password);

    if (!passwordValid) {
      return res.status(401).json({ error: 'Password salah.' });
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');

    await pool.query(
      'UPDATE users SET session_token = $1 WHERE id = $2',
      [sessionToken, user.id]
    );

    return res.json({
      message: 'Login berhasil!',
      session_token: sessionToken,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        birthdate: user.birthdate,
        photo_url: user.photo_url
      }
    });
  } catch (error) {
    console.error('Error login:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// ==========================================
// USERS, ALBUMS, & AGENDAS
// ==========================================

app.get('/api/users', checkSingleDevice, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, phone, birthdate, photo_url, created_at
      FROM users
      ORDER BY name ASC
    `);

    const usersWithMaskedPhone = result.rows.map(user => {
      let phone = user.phone || '';
      if (phone.length > 6 && Number(req.userId) !== Number(user.id)) {
        phone = phone.substring(0, 4) + '****' + phone.substring(phone.length - 3);
      }
      return {
        ...user,
        phone,
        is_online: activeUsers.has(String(user.id))
      };
    });

    return res.json(usersWithMaskedPhone);
  } catch (error) {
    console.error('Error mengambil users:', error);
    return res.status(500).json({ error: 'Gagal memuat daftar keluarga.' });
  }
});

app.get('/api/albums', checkSingleDevice, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT albums.id, albums.user_id, albums.image_url, albums.caption, albums.created_at, users.name AS uploader_name
      FROM albums
      JOIN users ON albums.user_id = users.id
      ORDER BY albums.created_at DESC
    `);
    return res.json(result.rows);
  } catch (error) {
    console.error('Error mengambil album:', error);
    return res.status(500).json({ error: 'Gagal memuat album foto.' });
  }
});

app.post('/api/albums', checkSingleDevice, imageUpload.single('image'), async (req, res) => {
  const userId = req.userId;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File gambar wajib diunggah.' });
    }
    const caption = String(req.body.caption || '').trim();
    const imageUrl = getUploadUrl(req.file.filename);

    const result = await pool.query(
      `INSERT INTO albums (user_id, image_url, caption) VALUES ($1, $2, $3) RETURNING id, user_id, image_url, caption, created_at`,
      [userId, imageUrl, escapeHTML(caption)]
    );

    return res.status(201).json({ message: 'Foto berhasil diunggah.', photo: result.rows[0] });
  } catch (error) {
    deleteUploadedFile(req.file);
    console.error('Error upload album:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

app.delete('/api/albums/:id', checkSingleDevice, async (req, res) => {
  const albumId = Number(req.params.id);
  const userId = req.userId;
  try {
    const result = await pool.query(`DELETE FROM albums WHERE id = $1 AND user_id = $2 RETURNING image_url`, [albumId, userId]);
    if (result.rowCount === 0) {
      return res.status(403).json({ error: 'Anda tidak memiliki izin menghapus foto ini.' });
    }
    if (result.rows[0].image_url) {
      deleteUploadedFile({ path: path.join(__dirname, result.rows[0].image_url.replace(/^\//, '')) });
    }
    return res.json({ message: 'Foto berhasil dihapus.' });
  } catch (error) {
    console.error('Error menghapus album:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

app.get('/api/agendas', checkSingleDevice, async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, title, event_date, description, created_at FROM agendas ORDER BY event_date ASC, created_at ASC`);
    return res.json(result.rows);
  } catch (error) {
    console.error('Error mengambil agenda:', error);
    return res.status(500).json({ error: 'Gagal memuat agenda.' });
  }
});

app.post('/api/agendas', checkSingleDevice, async (req, res) => {
  let { title, event_date, description } = req.body;
  if (!title || !event_date) {
    return res.status(400).json({ error: 'Judul dan tanggal wajib diisi.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO agendas (title, event_date, description) VALUES ($1, $2, $3) RETURNING id, title, event_date, description, created_at`,
      [escapeHTML(title.trim()), event_date, escapeHTML(String(description || '').trim())]
    );
    return res.status(201).json({ message: 'Agenda berhasil ditambahkan.', agenda: result.rows[0] });
  } catch (error) {
    console.error('Error menambah agenda:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

app.delete('/api/agendas/:id', checkSingleDevice, async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM agendas WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Agenda tidak ditemukan.' });
    return res.json({ message: 'Agenda berhasil dihapus.' });
  } catch (error) {
    console.error('Error menghapus agenda:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

app.get('/api/family-birthdays', checkSingleDevice, async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, name, photo_url AS profile_picture, birthdate AS birth_date FROM users ORDER BY birthdate ASC NULLS LAST, name ASC`);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching birthdays:", err);
    res.status(500).json({ error: "Gagal memuat data ulang tahun." });
  }
});

app.post('/api/update-photo', checkSingleDevice, imageUpload.single('image'), async (req, res) => {
  const userId = req.userId;
  try {
    if (!req.file) return res.status(400).json({ error: 'File foto wajib diunggah.' });
    const oldUser = await pool.query('SELECT photo_url FROM users WHERE id = $1', [userId]);
    const photoUrl = getUploadUrl(req.file.filename);

    const result = await pool.query(
      `UPDATE users SET photo_url = $1 WHERE id = $2 RETURNING id, phone, name, birthdate, photo_url`,
      [photoUrl, userId]
    );

    if (oldUser.rows[0]?.photo_url) {
      deleteUploadedFile({ path: path.join(__dirname, oldUser.rows[0].photo_url.replace(/^\//, '')) });
    }
    return res.json({ message: 'Foto profil diperbarui.', user: result.rows[0] });
  } catch (error) {
    deleteUploadedFile(req.file);
    console.error('Error update foto:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

app.put('/api/update-profile', checkSingleDevice, async (req, res) => {
  const userId = req.userId;
  let { name, birthdate } = req.body;
  if (!name) return res.status(400).json({ error: 'Nama profil wajib diisi.' });

  try {
    const result = await pool.query(
      `UPDATE users SET name = $1, birthdate = $2 WHERE id = $3 RETURNING id, phone, name, birthdate, photo_url`,
      [escapeHTML(name.trim()), birthdate || null, userId]
    );
    return res.json({ message: 'Profil diperbarui.', user: result.rows[0] });
  } catch (error) {
    console.error('Error update profile:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// ==========================================
// MESSAGES & PUSH TRIGGER
// ==========================================

app.post('/api/send-message', checkSingleDevice, mediaUpload.single('media'), async (req, res) => {
  const userId = req.userId;

  try {
    let { message, sticker_url, reply_to_id, client_time } = req.body;
    message = typeof message === 'string' ? escapeHTML(message.trim()) : '';

    let imageUrl = null;
    let audioUrl = null;

    if (req.file) {
      const isAudioFile = req.file.mimetype.startsWith('audio/') || 
                          req.file.mimetype === 'video/webm' || 
                          /\.(webm|m4a|mp3|wav|ogg|aac)$/i.test(req.file.originalname);
      if (isAudioFile) audioUrl = getUploadUrl(req.file.filename);
      else imageUrl = getUploadUrl(req.file.filename);
    }

    const stickerUrl = sticker_url ? String(sticker_url).trim() : null;
    const replyToId = reply_to_id ? Number.parseInt(reply_to_id, 10) : null;

    if (!message && !imageUrl && !audioUrl && !stickerUrl) {
      deleteUploadedFile(req.file);
      return res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
    }

    const result = await pool.query(
      `INSERT INTO messages (user_id, message, image_url, sticker_url, audio_url, reply_to_id, client_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, message, image_url, sticker_url, audio_url, reply_to_id, is_deleted, created_at, client_time`,
      [userId, message, imageUrl, stickerUrl, audioUrl, replyToId, client_time || null]
    );

    const savedMessage = result.rows[0];
    const userResult = await pool.query('SELECT name FROM users WHERE id = $1', [userId]);

    // Tambahkan pencarian teks pesan yang sedang dibalas (jika ada)
    let replyText = null;
    if (savedMessage.reply_to_id) {
      const parentMsgQuery = await pool.query('SELECT message FROM messages WHERE id = $1', [savedMessage.reply_to_id]);
      if (parentMsgQuery.rows.length > 0) {
        replyText = parentMsgQuery.rows[0].message || '(Lampiran Media)';
      }
    }

    const messagePayload = {
      id: savedMessage.id,
      user_id: savedMessage.user_id,
      name: userResult.rows[0]?.name || 'Keluarga',
      message: savedMessage.message,
      image_url: savedMessage.image_url,
      audio_url: savedMessage.audio_url,
      reply_to_id: savedMessage.reply_to_id, // <-- Sertakan ini
      reply_text: replyText,               // <-- Sertakan teks balasannya
      time: savedMessage.client_time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    io.emit('receive_message', messagePayload);

    // Kirim Web Push Notification ke anggota keluarga lain di latar belakang
    try {
      const subs = await pool.query('SELECT * FROM push_subscriptions WHERE user_id != $1', [userId]);
      const pushPayload = JSON.stringify({
        title: messagePayload.name,
        body: savedMessage.message || 'Mengirim lampiran media',
        url: '/'
      });

      subs.rows.forEach(sub => {
        const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
        webpush.sendNotification(pushSub, pushPayload).catch(err => console.error('Push error:', err));
      });
    } catch (pushErr) {
      console.error('Gagal mengirim push notification:', pushErr);
    }

    return res.status(201).json({ message: 'Pesan dikirim.', data: messagePayload });
  } catch (error) {
    deleteUploadedFile(req.file);
    console.error('Error mengirim pesan:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

app.delete('/api/messages/:id', checkSingleDevice, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE messages SET is_deleted = TRUE, message = 'Pesan telah dihapus', image_url = NULL, sticker_url = NULL, audio_url = NULL WHERE id = $1 AND user_id = $2 RETURNING id`,
      [Number(req.params.id), req.userId]
    );
    if (result.rowCount === 0) return res.status(403).json({ error: 'Tidak memiliki hak.' });
    io.emit('message_deleted', { id: Number(req.params.id) });
    return res.json({ message: 'Pesan dihapus.' });
  } catch (error) {
    console.error('Error hapus pesan:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

app.delete('/api/messages', checkSingleDevice, async (req, res) => {
  try {
    await pool.query('DELETE FROM messages WHERE user_id = $1', [req.userId]);
    io.emit('messages_deleted_by_user', { user_id: req.userId });
    return res.json({ message: 'Riwayat pesan dibersihkan.' });
  } catch (error) {
    console.error('Error clear messages:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// ==========================================
// EMAIL & PASSWORD AUTH
// ==========================================

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: Number(process.env.EMAIL_PORT) || 465,
  secure: process.env.EMAIL_SECURE !== 'false',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

app.put('/api/update-email', checkSingleDevice, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Email tidak valid.' });
  try {
    await pool.query('UPDATE users SET email = $1 WHERE id = $2', [email, req.userId]);
    return res.json({ message: 'Email disimpan.' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Email sudah digunakan.' });
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

app.put('/api/update-password', checkSingleDevice, async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!isValidPassword(new_password)) return res.status(400).json({ error: 'Password minimal 8 karakter.' });
  try {
    const user = await pool.query('SELECT password FROM users WHERE id = $1', [req.userId]);
    if (user.rows.length === 0 || !(await bcrypt.compare(old_password, user.rows[0].password))) {
      return res.status(401).json({ error: 'Password lama salah.' });
    }
    const hashed = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.userId]);
    return res.json({ message: 'Password diperbarui.' });
  } catch (error) {
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// ==========================================
// SOCKET.IO & START SERVER
// ==========================================

const activeUsers = new Map();

io.use(async (socket, next) => {
  const auth = socket.handshake.auth || {};
  if (!auth.userId || !auth.sessionToken) return next(new Error('Unauthorized'));
  try {
    const res = await pool.query('SELECT id FROM users WHERE id = $1 AND session_token = $2', [auth.userId, auth.sessionToken]);
    if (res.rows.length === 0) return next(new Error('Unauthorized'));
    socket.userId = String(auth.userId);
    next();
  } catch (e) {
    next(new Error('Authentication failed'));
  }
});

io.on('connection', socket => {
  activeUsers.set(socket.userId, socket.id);
  io.emit('online_users_update', Array.from(activeUsers.keys()));

  socket.on('disconnect', () => {
    if (activeUsers.get(socket.userId) === socket.id) {
      activeUsers.delete(socket.userId);
      io.emit('online_users_update', Array.from(activeUsers.keys()));
    }
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Ukuran file maksimal 10MB.' });
  }
  return res.status(400).json({ error: error.message || 'Permintaan tidak valid.' });
});

async function startServer() {
  try {
    await initDB();
    server.listen(PORT, () => {
      console.log(`Server Kitachat aktif di port ${PORT}.`);
    });
  } catch (error) {
    console.error('Server gagal dijalankan:', error);
    await pool.end();
    process.exit(1);
  }
}

startServer();

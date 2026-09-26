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
require('dotenv').config();

const app = express();
const server = http.createServer(app);

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
// KONFIGURASI DASAR
// ==========================================

const PORT = Number(process.env.PORT) || 3000;
const uploadDir = process.env.UPLOAD_DIR ||
  path.join(__dirname, 'data', 'uploads');

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const PASSWORD_MIN_LENGTH = 8;

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
// MULTER UPLOAD (Dioptimalkan untuk Dukungan Audio Lintas Platform)
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
    // Diperluas mencakup seluruh mimetype audio standar agar iOS & Chromium tidak tertolak
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
// ROUTE STATUS
// ==========================================

app.get('/api/status', (req, res) => {
  res.json({
    status: 'Server Kitachat berjalan dengan lancar!'
  });
});

// ==========================================
// REGISTER
// ==========================================

app.post('/api/register', async (req, res) => {
  let {
    phone,
    name,
    password,
    birthdate,
    photo_url
  } = req.body;

  if (!phone || !name || !password) {
    return res.status(400).json({
      error: 'Nomor telepon, nama, dan password wajib diisi.'
    });
  }

  phone = normalizePhone(phone);
  name = String(name).trim();

  if (!phone) {
    return res.status(400).json({
      error: 'Nomor telepon tidak valid.'
    });
  }

  if (!name || name.length > 100) {
    return res.status(400).json({
      error: 'Nama wajib diisi dan maksimal 100 karakter.'
    });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({
      error: `Password minimal ${PASSWORD_MIN_LENGTH} karakter.`
    });
  }

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
        INSERT INTO users (
          phone,
          name,
          password,
          birthdate,
          photo_url,
          session_token
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, phone, name, birthdate, photo_url, created_at
      `,
      [
        phone,
        escapeHTML(name),
        hashedPassword,
        birthdate || null,
        photo_url || null,
        sessionToken
      ]
    );

    return res.status(201).json({
      message: 'Registrasi berhasil! Selamat bergabung di Kitachat.',
      session_token: sessionToken,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Error register:', error);

    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.'
    });
  }
});

// ==========================================
// LOGIN
// ==========================================

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
      `
        SELECT
          id,
          phone,
          name,
          password,
          birthdate,
          photo_url
        FROM users
        WHERE phone = $1
      `,
      [phone]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Nomor telepon belum terdaftar.'
      });
    }

    const user = result.rows[0];
    const passwordValid = await bcrypt.compare(password, user.password);

    if (!passwordValid) {
      return res.status(401).json({
        error: 'Password salah.'
      });
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

    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.'
    });
  }
});

// ==========================================
// USERS (Dioptimalkan dengan status is_online)
// ==========================================

app.get('/api/users', checkSingleDevice, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, phone, birthdate, photo_url, created_at
      FROM users
      ORDER BY name ASC
    `);

    // Samarkan nomor telepon untuk anggota lain (kecuali akun sendiri)
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


// ==========================================
// ALBUMS
// ==========================================

app.get('/api/albums', checkSingleDevice, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        albums.id,
        albums.user_id,
        albums.image_url,
        albums.caption,
        albums.created_at,
        users.name AS uploader_name
      FROM albums
      JOIN users ON albums.user_id = users.id
      ORDER BY albums.created_at DESC
    `);

    return res.json(result.rows);
  } catch (error) {
    console.error('Error mengambil album:', error);

    return res.status(500).json({
      error: 'Gagal memuat album foto.'
    });
  }
});

app.post(
  '/api/albums',
  checkSingleDevice,
  imageUpload.single('image'),
  async (req, res) => {
    const userId = req.userId;

    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'File gambar wajib diunggah.'
        });
      }

      const caption = String(req.body.caption || '').trim();
      const imageUrl = getUploadUrl(req.file.filename);

      const result = await pool.query(
        `
          INSERT INTO albums (user_id, image_url, caption)
          VALUES ($1, $2, $3)
          RETURNING id, user_id, image_url, caption, created_at
        `,
        [userId, imageUrl, escapeHTML(caption)]
      );

      return res.status(201).json({
        message: 'Foto berhasil diunggah ke album keluarga.',
        photo: result.rows[0]
      });
    } catch (error) {
      deleteUploadedFile(req.file);
      console.error('Error upload album:', error);

      return res.status(500).json({
        error: 'Terjadi kesalahan pada server.'
      });
    }
  }
);

app.delete('/api/albums/:id', checkSingleDevice, async (req, res) => {
  const albumId = Number(req.params.id);
  const userId = req.userId;

  if (!Number.isInteger(albumId)) {
    return res.status(400).json({
      error: 'ID album tidak valid.'
    });
  }

  try {
    const result = await pool.query(
      `
        DELETE FROM albums
        WHERE id = $1 AND user_id = $2
        RETURNING image_url
      `,
      [albumId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(403).json({
        error: 'Anda tidak memiliki izin untuk menghapus foto ini.'
      });
    }

    const imageUrl = result.rows[0].image_url;

    if (imageUrl) {
      deleteUploadedFile({
        path: path.join(__dirname, imageUrl.replace(/^\//, ''))
      });
    }

    return res.json({
      message: 'Foto berhasil dihapus dari album.'
    });
  } catch (error) {
    console.error('Error menghapus album:', error);

    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.'
    });
  }
});

// ==========================================
// AGENDAS
// ==========================================

app.get('/api/agendas', checkSingleDevice, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, event_date, description, created_at
      FROM agendas
      ORDER BY event_date ASC, created_at ASC
    `);

    return res.json(result.rows);
  } catch (error) {
    console.error('Error mengambil agenda:', error);

    return res.status(500).json({
      error: 'Gagal memuat agenda keluarga.'
    });
  }
});

app.post('/api/agendas', checkSingleDevice, async (req, res) => {
  let {
    title,
    event_date,
    description
  } = req.body;

  if (!title || !event_date) {
    return res.status(400).json({
      error: 'Judul dan tanggal acara wajib diisi.'
    });
  }

  title = String(title).trim();
  description = String(description || '').trim();

  if (title.length > 150) {
    return res.status(400).json({
      error: 'Judul maksimal 150 karakter.'
    });
  }

  try {
    const result = await pool.query(
      `
        INSERT INTO agendas (title, event_date, description)
        VALUES ($1, $2, $3)
        RETURNING id, title, event_date, description, created_at
      `,
      [
        escapeHTML(title),
        event_date,
        escapeHTML(description)
      ]
    );

    return res.status(201).json({
      message: 'Agenda keluarga berhasil ditambahkan.',
      agenda: result.rows[0]
    });
  } catch (error) {
    console.error('Error menambah agenda:', error);

    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.'
    });
  }
});

// ==========================================
// ENDPOINT: FAMILY BIRTHDAYS (DIOPTIMALKAN - SEMUA USER TAMPIL)
// ==========================================
app.get('/api/family-birthdays', checkSingleDevice, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, photo_url AS profile_picture, birthdate AS birth_date 
       FROM users 
       ORDER BY birthdate ASC NULLS LAST, name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching birthdays:", err);
    res.status(500).json({ error: "Gagal memuat data ulang tahun." });
  }
});


// ==========================================================
// AGENDA (DELETE)
// ==========================================================

app.delete('/api/agendas/:id', checkSingleDevice, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM agendas WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Agenda tidak ditemukan.'
      });
    }

    return res.json({
      message: 'Agenda keluarga berhasil dihapus.'
    });
  } catch (error) {
    console.error('Error menghapus agenda:', error);

    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.'
    });
  }
});


// ==========================================
// UPDATE PHOTO
// ==========================================

app.post(
  '/api/update-photo',
  checkSingleDevice,
  imageUpload.single('image'),
  async (req, res) => {
    const userId = req.userId;

    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'File foto profil wajib diunggah.'
        });
      }

      const oldUserResult = await pool.query(
        'SELECT photo_url FROM users WHERE id = $1',
        [userId]
      );

      if (oldUserResult.rows.length === 0) {
        deleteUploadedFile(req.file);

        return res.status(404).json({
          error: 'Pengguna tidak ditemukan.'
        });
      }

      const oldPhotoUrl = oldUserResult.rows[0].photo_url;
      const photoUrl = getUploadUrl(req.file.filename);

      const result = await pool.query(
        `
          UPDATE users
          SET photo_url = $1
          WHERE id = $2
          RETURNING id, phone, name, birthdate, photo_url
        `,
        [photoUrl, userId]
      );

      if (oldPhotoUrl) {
        deleteUploadedFile({
          path: path.join(__dirname, oldPhotoUrl.replace(/^\//, ''))
        });
      }

      return res.json({
        message: 'Foto profil berhasil diperbarui.',
        user: result.rows[0]
      });
    } catch (error) {
      deleteUploadedFile(req.file);
      console.error('Error update foto profil:', error);

      return res.status(500).json({
        error: 'Terjadi kesalahan pada server.'
      });
    }
  }
);

// ==========================================
// UPDATE PROFILE (Name & Birthdate)
// ==========================================
app.put('/api/update-profile', checkSingleDevice, async (req, res) => {
  const userId = req.userId;
  let { name, birthdate } = req.body;

  if (!name) {
    return res.status(400).json({
      error: 'Nama profil wajib diisi.'
    });
  }

  name = String(name).trim();

  if (name.length > 100) {
    return res.status(400).json({
      error: 'Nama maksimal 100 karakter.'
    });
  }

  try {
    const result = await pool.query(
      `
        UPDATE users
        SET name = $1, birthdate = $2
        WHERE id = $3
        RETURNING id, phone, name, birthdate, photo_url
      `,
      [
        escapeHTML(name),
        birthdate || null,
        userId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Pengguna tidak ditemukan.'
      });
    }

    return res.json({
      message: 'Informasi profil berhasil diperbarui.',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Error update profile:', error);

    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.'
    });
  }
});


// ==========================================
// MESSAGES
// ==========================================

app.post(
  '/api/send-message',
  checkSingleDevice,
  mediaUpload.single('media'),
  async (req, res) => {
    const userId = req.userId;

    try {
      let {
        message,
        sticker_url,
        reply_to_id,
        client_time
      } = req.body;

      message = typeof message === 'string'
        ? escapeHTML(message.trim())
        : '';

      let imageUrl = null;
      let audioUrl = null;

      if (req.file) {
        // Deteksi file media berdasarkan mimetype atau ekstensi file yang diunggah
        const isAudioFile = req.file.mimetype.startsWith('audio/') || 
                            req.file.mimetype === 'video/webm' || 
                            /\.(webm|m4a|mp3|wav|ogg|aac)$/i.test(req.file.originalname);

        if (isAudioFile) {
          audioUrl = getUploadUrl(req.file.filename);
        } else {
          imageUrl = getUploadUrl(req.file.filename);
        }
      }

      const stickerUrl = sticker_url
        ? String(sticker_url).trim()
        : null;

      const replyToId = reply_to_id
        ? Number.parseInt(reply_to_id, 10)
        : null;

      if (
        !message &&
        !imageUrl &&
        !audioUrl &&
        !stickerUrl
      ) {
        deleteUploadedFile(req.file);

        return res.status(400).json({
          error: 'Pesan tidak boleh kosong.'
        });
      }

      if (replyToId !== null && !Number.isInteger(replyToId)) {
        deleteUploadedFile(req.file);

        return res.status(400).json({
          error: 'ID pesan balasan tidak valid.'
        });
      }

      const result = await pool.query(
        `
          INSERT INTO messages (
            user_id,
            message,
            image_url,
            sticker_url,
            audio_url,
            reply_to_id,
            client_time
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING
            id,
            user_id,
            message,
            image_url,
            sticker_url,
            audio_url,
            reply_to_id,
            is_deleted,
            created_at,
            client_time
        `,
        [
          userId,
          message,
          imageUrl,
          stickerUrl,
          audioUrl,
          replyToId,
          client_time || null
        ]
      );

      const savedMessage = result.rows[0];

      const userResult = await pool.query(
        'SELECT name FROM users WHERE id = $1',
        [userId]
      );

      const replyResult = savedMessage.reply_to_id
        ? await pool.query(
          'SELECT message FROM messages WHERE id = $1',
          [savedMessage.reply_to_id]
        )
        : { rows: [] };

      const replyText = replyResult.rows.length > 0
        ? getSafeMessageText(replyResult.rows[0].message)
        : null;

      const displayTime = savedMessage.client_time ||
        new Date(savedMessage.created_at).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });

      const messagePayload = {
        id: savedMessage.id,
        user_id: savedMessage.user_id,
        name: userResult.rows[0]?.name || 'Keluarga',
        message: savedMessage.message,
        image_url: savedMessage.image_url,
        sticker_url: savedMessage.sticker_url,
        audio_url: savedMessage.audio_url,
        reply_to_id: savedMessage.reply_to_id,
        reply_text: replyText,
        time: displayTime,
        is_deleted: savedMessage.is_deleted
      };

      io.emit('receive_message', messagePayload);

      return res.status(201).json({
        message: 'Pesan berhasil dikirim.',
        data: messagePayload
      });
    } catch (error) {
      deleteUploadedFile(req.file);
      console.error('Error mengirim pesan:', error);

      return res.status(500).json({
        error: 'Terjadi kesalahan pada server.'
      });
    }
  }
);

app.delete('/api/messages/:id', checkSingleDevice, async (req, res) => {
  const messageId = Number(req.params.id);
  const userId = req.userId;

  if (!Number.isInteger(messageId)) {
    return res.status(400).json({
      error: 'ID pesan tidak valid.'
    });
  }

  try {
    const result = await pool.query(
      `
        UPDATE messages
        SET
          is_deleted = TRUE,
          message = $1,
          image_url = NULL,
          sticker_url = NULL,
          audio_url = NULL
        WHERE id = $2 AND user_id = $3
        RETURNING id
      `,
      [
        'Pesan telah dihapus',
        messageId,
        userId
      ]
    );

    if (result.rowCount === 0) {
      return res.status(403).json({
        error: 'Anda tidak memiliki hak untuk menghapus pesan ini.'
      });
    }

    io.emit('message_deleted', {
      id: messageId
    });

    return res.json({
      message: 'Pesan berhasil dihapus.'
    });
  } catch (error) {
    console.error('Error menghapus pesan:', error);

    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.'
    });
  }
});

app.delete('/api/messages', checkSingleDevice, async (req, res) => {
  const userId = req.userId;

  try {
    const result = await pool.query(
      'DELETE FROM messages WHERE user_id = $1',
      [userId]
    );

    io.emit('messages_deleted_by_user', {
      user_id: userId
    });

    return res.json({
      message: `${result.rowCount} pesan berhasil dihapus.`
    });
  } catch (error) {
    console.error('Error membersihkan pesan:', error);

    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.'
    });
  }
});

// ==========================================
// EMAIL DAN PEMULIHAN PASSWORD
// ==========================================

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: Number(process.env.EMAIL_PORT) || 465,
  secure: process.env.EMAIL_SECURE !== 'false',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

app.put('/api/update-email', checkSingleDevice, async (req, res) => {
  const userId = req.userId;
  const email = String(req.body.email || '').trim().toLowerCase();

  if (!email) {
    return res.status(400).json({
      error: 'Email wajib diisi.'
    });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({
      error: 'Format email tidak valid.'
    });
  }

  try {
    await pool.query(
      'UPDATE users SET email = $1 WHERE id = $2',
      [email, userId]
    );

    return res.json({
      message: 'Email pemulihan berhasil disimpan.'
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'Email sudah digunakan oleh akun lain.'
      });
    }

    console.error('Error update email:', error);

    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.'
    });
  }
});

app.post('/api/forgot-password', async (req, res) => {
  const phone = normalizePhone(req.body.phone);

  if (!phone) {
    return res.status(400).json({
      error: 'Nomor telepon wajib diisi.'
    });
  }

  try {
    const result = await pool.query(
      `
        SELECT id, email, name
        FROM users
        WHERE phone = $1
      `,
      [phone]
    );

    if (result.rows.length === 0 || !result.rows[0].email) {
      return res.status(200).json({
        message: 'Jika data cocok, kode pemulihan akan dikirim ke email.'
      });
    }

    const user = result.rows[0];
    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiry = Date.now() + (15 * 60 * 1000);

    await pool.query(
      `
        UPDATE users
        SET reset_token = $1, reset_token_expiry = $2
        WHERE id = $3
      `,
      [otp, expiry, user.id]
    );

    const mailOptions = {
      from: `"Kitachat Family Hub" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Kode Pemulihan Password - Kitachat',
      text: [
        `Halo ${user.name},`,
        '',
        'Seseorang mencoba mereset password akun Kitachat Anda.',
        'Gunakan kode OTP berikut untuk melanjutkan:',
        '',
        otp,
        '',
        'Kode ini berlaku selama 15 menit.',
        'Jangan berikan kode ini kepada siapa pun.'
      ].join('\n')
    };

    await transporter.sendMail(mailOptions);

    return res.json({
      message: 'Kode OTP telah dikirim ke email pemulihan Anda.'
    });
  } catch (error) {
    console.error('Error forgot-password:', error);

    return res.status(500).json({
      error: 'Gagal mengirim email OTP.'
    });
  }
});

app.post('/api/reset-password', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const otp = String(req.body.otp || '').trim();
  const newPassword = req.body.new_password;

  if (!phone || !otp || !newPassword) {
    return res.status(400).json({
      error: 'Data reset password tidak lengkap.'
    });
  }

  if (!isValidPassword(newPassword)) {
    return res.status(400).json({
      error: `Password minimal ${PASSWORD_MIN_LENGTH} karakter.`
    });
  }

  try {
    const result = await pool.query(
      `
        SELECT id, reset_token, reset_token_expiry
        FROM users
        WHERE phone = $1
      `,
      [phone]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: 'Kode OTP salah atau tidak valid.'
      });
    }

    const user = result.rows[0];

    if (
      !user.reset_token ||
      user.reset_token !== otp ||
      !user.reset_token_expiry ||
      Date.now() > Number(user.reset_token_expiry)
    ) {
      return res.status(400).json({
        error: 'Kode OTP salah atau sudah kedaluwarsa.'
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await pool.query(
      `
        UPDATE users
        SET
          password = $1,
          reset_token = NULL,
          reset_token_expiry = NULL,
          session_token = NULL
        WHERE id = $2
      `,
      [hashedPassword, user.id]
    );

    return res.json({
      message: 'Password berhasil diubah. Silakan login kembali.'
    });
  } catch (error) {
    console.error('Error reset-password:', error);

    return res.status(500).json({
      error: 'Terjadi kesalahan saat memperbarui password.'
    });
  }
});

// ==========================================
// SOCKET.IO AUTHENTICATION & ONLINE STATUS
// ==========================================

const activeUsers = new Map();

io.use(async (socket, next) => {
  const auth = socket.handshake.auth || {};
  const userId = auth.userId;
  const sessionToken = auth.sessionToken;

  if (!userId || !sessionToken) {
    return next(new Error('Unauthorized'));
  }

  try {
    const result = await pool.query(
      `
        SELECT id
        FROM users
        WHERE id = $1 AND session_token = $2
      `,
      [userId, sessionToken]
    );

    if (result.rows.length === 0) {
      return next(new Error('Unauthorized'));
    }

    socket.userId = String(userId);
    next();
  } catch (error) {
    console.error('Socket authentication error:', error);
    next(new Error('Authentication failed'));
  }
});

io.on('connection', async socket => {
  console.log('Anggota keluarga terhubung:', socket.id);

  activeUsers.set(socket.userId, socket.id);
  
  // Broadcast update status online ke seluruh klien yang terhubung
  io.emit('online_users_update', Array.from(activeUsers.keys()));

  try {
    const result = await pool.query(`
      SELECT *
      FROM (
        SELECT
          m.id,
          m.user_id,
          m.message,
          m.image_url,
          m.sticker_url,
          m.audio_url,
          m.reply_to_id,
          m.is_deleted,
          m.created_at,
          m.client_time,
          u.name
        FROM messages m
        JOIN users u ON m.user_id = u.id
        ORDER BY m.created_at DESC
        LIMIT 50
      ) recent_messages
      ORDER BY created_at ASC
    `);

    const messageMap = new Map();

    result.rows.forEach(row => {
      messageMap.set(
        row.id,
        row.is_deleted
          ? 'Pesan telah dihapus'
          : getSafeMessageText(row.message)
      );
    });

    const history = result.rows.map(row => ({
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      message: row.is_deleted
        ? 'Pesan telah dihapus'
        : row.message,
      image_url: row.is_deleted ? null : row.image_url,
      sticker_url: row.is_deleted ? null : row.sticker_url,
      audio_url: row.is_deleted ? null : row.audio_url,
      reply_to_id: row.reply_to_id,
      reply_text: row.reply_to_id
        ? messageMap.get(row.reply_to_id) || '(Pesan tidak tersedia)'
        : null,
      time: row.client_time || new Date(row.created_at)
        .toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        }),
      is_deleted: row.is_deleted
    }));

    socket.emit('chat_history', history);
  } catch (error) {
    console.error('Gagal memuat histori chat:', error);
  }

  socket.on('call_user', data => {
    if (!data || !data.toUserId || !data.offer) {
      return;
    }

    const targetSocketId = activeUsers.get(String(data.toUserId));

    if (!targetSocketId) {
      return;
    }

    io.to(targetSocketId).emit('incoming_call', {
      fromSocketId: socket.id,
      fromUserId: socket.userId,
      callerName: data.callerName,
      offer: data.offer,
      toUserId: String(data.toUserId)
    });
  });

  socket.on('make_answer', data => {
    if (!data || !data.toSocketId || !data.answer) {
      return;
    }

    io.to(data.toSocketId).emit('call_answered', {
      answer: data.answer
    });
  });

  socket.on('ice_candidate', data => {
    if (!data || !data.targetSocketId || !data.candidate) {
      return;
    }

    io.to(data.targetSocketId).emit('ice_candidate', {
      candidate: data.candidate
    });
  });

  socket.on('end_call', data => {
    if (data && data.toUserId) {
      const targetSocketId = activeUsers.get(String(data.toUserId));

      if (targetSocketId) {
        io.to(targetSocketId).emit('call_ended');
      }
    }

    socket.emit('call_ended');
  });

  socket.on('disconnect', () => {
    if (
      socket.userId &&
      activeUsers.get(socket.userId) === socket.id
    ) {
      activeUsers.delete(socket.userId);
      // Broadcast update status online saat user terputus
      io.emit('online_users_update', Array.from(activeUsers.keys()));
    }

    console.log('Anggota keluarga terputus:', socket.id);
  });
});

// ==========================================
// UPDATE PASSWORD
// ==========================================

app.put('/api/update-password', checkSingleDevice, async (req, res) => {
  const userId = req.userId;
  const {
    old_password,
    new_password
  } = req.body;

  if (!old_password || !new_password) {
    return res.status(400).json({
      error: 'Password lama dan password baru wajib diisi.'
    });
  }

  if (!isValidPassword(new_password)) {
    return res.status(400).json({
      error: `Password baru minimal ${PASSWORD_MIN_LENGTH} karakter.`
    });
  }

  try {
    const result = await pool.query(
      'SELECT password FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Pengguna tidak ditemukan.'
      });
    }

    const passwordValid = await bcrypt.compare(
      old_password,
      result.rows[0].password
    );

    if (!passwordValid) {
      return res.status(401).json({
        error: 'Password lama salah.'
      });
    }

    const hashedPassword = await bcrypt.hash(new_password, 12);

    await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2',
      [hashedPassword, userId]
    );

    return res.json({
      message: 'Password berhasil diperbarui.'
    });
  } catch (error) {
    console.error('Error update password:', error);

    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.'
    });
  }
});

// ==========================================
// ERROR HANDLER
// ==========================================

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'Ukuran file terlalu besar. Maksimal 10MB.'
      });
    }

    return res.status(400).json({
      error: `Upload gagal: ${error.message}`
    });
  }

  if (error) {
    console.error('Unhandled server error:', error);

    return res.status(400).json({
      error: error.message || 'Permintaan tidak valid.'
    });
  }

  next();
});

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================

async function shutdown(signal) {
  console.log(`${signal} diterima. Menutup server...`);

  server.close(async () => {
    try {
      await pool.end();
      console.log('Database pool berhasil ditutup.');
      process.exit(0);
    } catch (error) {
      console.error('Gagal menutup database pool:', error);
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ==========================================
// START SERVER
// ==========================================

async function startServer() {
  try {
    await initDB();

    server.listen(PORT, () => {
      console.log(
        `Server Kitachat aktif di port ${PORT}.`
      );
    });
  } catch (error) {
    console.error('Server gagal dijalankan:', error);
    await pool.end();
    process.exit(1);
  }
}

startServer();

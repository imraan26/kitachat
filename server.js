const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto'); // Ditambahkan untuk generate token sesi single-device
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Pastikan folder public/uploads otomatis dibuat secara aman jika belum ada di server
try {
  const uploadDir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('Folder public/uploads berhasil dibuat secara otomatis.');
  }
} catch (err) {
  console.error('Gagal membuat folder uploads:', err);
}

// Konfigurasi Penyimpanan File Upload menggunakan Multer (Mendukung gambar & audio voice note)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || (file.mimetype === 'audio/webm' ? '.webm' : '.png');
    cb(null, 'file-' + uniqueSuffix + ext);
  }
});
const upload = multer({ storage: storage });

// Koneksi Database PostgreSQL menggunakan DATABASE_URL dari Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  family: 4
});

// Fungsi Inisialisasi Otomatis Tabel Database (Diperbarui dengan kolom session_token untuk Single Device)
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        password VARCHAR(255) NOT NULL,
        birthdate DATE,
        photo_url TEXT,
        session_token TEXT,
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
        reply_to_id INT,
        is_deleted BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        client_time VARCHAR(50)
      );
    `);
    console.log('Berhasil terhubung ke database PostgreSQL dan memverifikasi tabel!');
  } catch (err) {
    console.error('Gagal menginisialisasi skema database:', err);
  }
}

// ==========================================
// MIDDLEWARE: KEAMANAN SINGLE DEVICE LOGIN
// ==========================================
async function checkSingleDevice(req, res, next) {
  const userId = req.headers['x-user-id'] || req.body.user_id;
  const clientToken = req.headers['x-session-token'];

  if (!userId || !clientToken) {
    return res.status(401).json({ error: 'Akses ditolak. Sesi tidak valid atau belum login.' });
  }

  try {
    const result = await pool.query('SELECT session_token FROM users WHERE id = $1', [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    }

    const dbToken = result.rows[0].session_token;

    // Jika token berbeda, berarti akun sudah login di perangkat/browser lain
    if (dbToken !== clientToken) {
      return res.status(403).json({ 
        error: 'SESSION_KICKED', 
        message: 'Akun Anda telah login di perangkat lain. Sesi di perangkat ini dihentikan.' 
      });
    }

    next();
  } catch (err) {
    console.error('Error di middleware checkSingleDevice:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
}

// ==========================================
// FUNGSI SANITASI: MENCEGAH SERANGAN XSS
// ==========================================
function escapeHTML(str) {
    if (typeof str !== 'string' || !str) return str;
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag]));
}

// Route Uji Coba Server
app.get('/api/status', (req, res) => {
  res.json({ status: 'Server Kitachat berjalan dengan lancar!' });
});

// 1. API REGISTER (Diperbarui dengan Sanitasi & Validasi)
app.post('/api/register', async (req, res) => {
  let { phone, name, password, birthdate, photo_url } = req.body;

  // Validasi Input Dasar
  if (!phone || !name || !password) {
    return res.status(400).json({ error: 'Nomor telepon, nama, dan password wajib diisi!' });
  }

  // Sanitasi Input (Membersihkan karakter berbahaya)
  name = escapeHTML(name.trim());
  phone = phone.replace(/[^0-9]/g, ''); // Pastikan nomor telepon hanya berisi angka

  try {
    const existingUser = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Nomor telepon sudah terdaftar di Kitachat!' });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const sessionToken = crypto.randomBytes(32).toString('hex'); // Token unik perangkat

    const newUser = await pool.query(
      `INSERT INTO users (phone, name, password, birthdate, photo_url, session_token) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, phone, name, birthdate, photo_url, session_token, created_at`,
      [phone, name, hashedPassword, birthdate || null, photo_url || null, sessionToken]
    );

    res.status(201).json({
      message: 'Registrasi berhasil! Selamat bergabung di Kitachat.',
      user: newUser.rows[0]
    });
  } catch (err) {
    console.error('Error saat register:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// 2. API LOGIN (Diperbarui: Timpa session_token lama agar perangkat sebelumnya otomatis tertendang)
app.post('/api/login', async (req, res) => {
  const { phone, password } = req.body;

  try {
    const userResult = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Nomor telepon belum terdaftar.' });
    }

    const user = userResult.rows[0];

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Password salah!' });
    }

    // Generate token sesi baru untuk perangkat ini (menimpa token perangkat sebelumnya)
    const newSessionToken = crypto.randomBytes(32).toString('hex');
    await pool.query('UPDATE users SET session_token = $1 WHERE id = $2', [newSessionToken, user.id]);

    res.status(200).json({
      message: 'Login berhasil!',
      session_token: newSessionToken, // Dikirim ke client untuk disimpan di localStorage
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        birthdate: user.birthdate,
        photo_url: user.photo_url
      }
    });
  } catch (err) {
    console.error('Error saat login:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// 3. API GET /api/users (Dilindungi Middleware Single Device)
app.get('/api/users', checkSingleDevice, async (req, res) => {
  try {
    const usersResult = await pool.query(
      'SELECT id, name, phone, birthdate, photo_url, created_at FROM users ORDER BY name ASC'
    );
    res.status(200).json(usersResult.rows);
  } catch (err) {
    console.error('Error mengambil data keluarga:', err);
    res.status(500).json({ error: 'Gagal memuat daftar keluarga.' });
  }
});

// 4. API GET /api/albums (Dilindungi Middleware Single Device)
app.get('/api/albums', checkSingleDevice, async (req, res) => {
  try {
    const albumsResult = await pool.query(
      `SELECT albums.id, albums.user_id, albums.image_url, albums.caption, albums.created_at, users.name as uploader_name 
       FROM albums 
       JOIN users ON albums.user_id = users.id 
       ORDER BY albums.created_at DESC`
    );
    res.status(200).json(albumsResult.rows);
  } catch (err) {
    console.error('Error mengambil data album:', err);
    res.status(500).json({ error: 'Gagal memuat album foto.' });
  }
});

// 5. API POST /api/albums (Dilindungi Middleware Single Device)
app.post('/api/albums', checkSingleDevice, upload.single('image'), async (req, res) => {
  try {
    const body = req.body || {};
    const user_id = body.user_id;
    const caption = body.caption || '';

    if (!req.file) {
      return res.status(400).json({ error: 'File gambar wajib diunggah!' });
    }

    if (!user_id) {
      return res.status(400).json({ error: 'User ID tidak ditemukan. Silakan login ulang.' });
    }

    const image_url = `/uploads/${req.file.filename}`;

    const newPhoto = await pool.query(
      `INSERT INTO albums (user_id, image_url, caption) 
       VALUES ($1, $2, $3) RETURNING *`,
      [user_id, image_url, caption]
    );

    res.status(201).json({
      message: 'Foto berhasil diunggah ke album keluarga!',
      photo: newPhoto.rows[0]
    });
  } catch (err) {
    console.error('Error saat upload foto:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// 6. API DELETE /api/albums/:id (Dilindungi Middleware Single Device)
app.delete('/api/albums/:id', checkSingleDevice, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM albums WHERE id = $1', [id]);
        res.json({ message: 'Foto berhasil dihapus dari album.' });
    } catch (err) {
        console.error('Gagal menghapus foto:', err);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// 7. API GET /api/agendas (Dilindungi Middleware Single Device)
app.get('/api/agendas', checkSingleDevice, async (req, res) => {
  try {
    const agendasResult = await pool.query('SELECT * FROM agendas ORDER BY event_date ASC');
    res.status(200).json(agendasResult.rows);
  } catch (err) {
    console.error('Error mengambil data agenda:', err);
    res.status(500).json({ error: 'Gagal memuat agenda keluarga.' });
  }
});

// 8. API POST /api/agendas (Dilindungi Middleware Single Device)
app.post('/api/agendas', checkSingleDevice, async (req, res) => {
  const { title, event_date, description } = req.body;

  if (!title || !event_date) {
    return res.status(400).json({ error: 'Judul dan tanggal acara wajib diisi!' });
  }

  try {
    const newAgenda = await pool.query(
      `INSERT INTO agendas (title, event_date, description) 
       VALUES ($1, $2, $3) RETURNING *`,
      [title, event_date, description || '']
    );

    res.status(201).json({
      message: 'Agenda keluarga berhasil ditambahkan!',
      agenda: newAgenda.rows[0]
    });
  } catch (err) {
    console.error('Error saat menambah agenda:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// 9. API POST /api/update-photo (Dilindungi Middleware Single Device)
app.post('/api/update-photo', checkSingleDevice, upload.single('image'), async (req, res) => {
  try {
    const { user_id } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'File foto profil wajib diunggah!' });
    }

    if (!user_id) {
      return res.status(400).json({ error: 'User ID tidak ditemukan!' });
    }

    const photo_url = `/uploads/${req.file.filename}`;

    const updateResult = await pool.query(
      `UPDATE users SET photo_url = $1 WHERE id = $2 RETURNING id, phone, name, birthdate, photo_url`,
      [photo_url, user_id]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    }

    res.status(200).json({
      message: 'Foto profil berhasil diperbarui!',
      user: updateResult.rows[0]
    });
  } catch (err) {
    console.error('Error saat memperbarui foto profil:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// 10. API POST /api/send-message (Dilindungi Middleware Single Device)
app.post('/api/send-message', checkSingleDevice, upload.single('media'), async (req, res) => {
  try {
    const { user_id, message, sticker_url, reply_to_id, client_time } = req.body;
    let image_url = null;
    let audio_url = null;

    if (req.file) {
      if (req.file.mimetype.startsWith('audio/') || req.file.originalname.endsWith('.webm')) {
        audio_url = `/uploads/${req.file.filename}`;
      } else {
        image_url = `/uploads/${req.file.filename}`;
      }
    }

    const finalStickerUrl = sticker_url || null;

    if (!user_id || (!message && !image_url && !finalStickerUrl && !audio_url)) {
      return res.status(400).json({ error: 'Pesan tidak boleh kosong!' });
    }

    const insertResult = await pool.query(
      `INSERT INTO messages (user_id, message, image_url, sticker_url, audio_url, reply_to_id, client_time) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        user_id, 
        message || '', 
        image_url, 
        finalStickerUrl, 
        audio_url, 
        reply_to_id ? parseInt(reply_to_id) : null, 
        client_time || null
      ]
    );

    const userResult = await pool.query('SELECT name FROM users WHERE id = $1', [user_id]);
    const userName = userResult.rows[0] ? userResult.rows[0].name : 'Keluarga';

    const savedMsg = insertResult.rows[0];

    let replyText = null;
    if (savedMsg.reply_to_id) {
      const replyQuery = await pool.query('SELECT message FROM messages WHERE id = $1', [savedMsg.reply_to_id]);
      if (replyQuery.rows.length > 0) {
        replyText = replyQuery.rows[0].message || '(Lampiran Media)';
      }
    }

    const displayTime = savedMsg.client_time || new Date(savedMsg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const messagePayload = {
      id: savedMsg.id,
      user_id: savedMsg.user_id,
      name: userName,
      message: savedMsg.message,
      image_url: savedMsg.image_url,
      sticker_url: savedMsg.sticker_url,
      audio_url: savedMsg.audio_url,
      reply_to_id: savedMsg.reply_to_id,
      reply_text: replyText,
      time: displayTime,
      is_deleted: savedMsg.is_deleted
    };

    io.emit('receive_message', messagePayload);

    res.status(201).json({ message: 'Pesan berhasil dikirim!', data: messagePayload });
  } catch (err) {
    console.error('Gagal mengirim pesan:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// Map untuk pemetaan pengguna aktif WebRTC (userId -> socket.id)
const activeUsers = new Map();

// 11. API DELETE /api/messages/:id (Dilindungi Middleware Single Device)
app.delete('/api/messages/:id', checkSingleDevice, async (req, res) => {
  try {
    const { id } = req.params;
    // PERBAIKAN: Menggunakan single quotes atau melemparkannya sebagai parameter $1
    await pool.query(
        `UPDATE messages 
         SET is_deleted = TRUE, 
             message = $1, 
             image_url = NULL, 
             sticker_url = NULL, 
             audio_url = NULL 
         WHERE id = $2`, 
        ['Pesan telah dihapus', id]
    );
    
    io.emit('message_deleted', { id: parseInt(id) });
    res.status(200).json({ message: 'Pesan berhasil dihapus.' });
  } catch (err) {
    console.error('Gagal menghapus pesan:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// 12. API DELETE /api/messages (Dilindungi Middleware Single Device)
app.delete('/api/messages', checkSingleDevice, async (req, res) => {
  try {
    await pool.query('DELETE FROM messages');
    io.emit('chat_cleared');
    res.status(200).json({ message: 'Semua riwayat obrolan berhasil dibersihkan!' });
  } catch (err) {
    console.error('Gagal membersihkan obrolan:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// Konfigurasi Socket.io
io.on('connection', async (socket) => {
  console.log('Seorang anggota keluarga terhubung:', socket.id);

  try {
    const historyResult = await pool.query(
      `SELECT m.id, m.user_id, m.message, m.image_url, m.sticker_url, m.audio_url, m.reply_to_id, m.is_deleted, m.created_at, m.client_time, u.name 
       FROM messages m
       JOIN users u ON m.user_id = u.id 
       ORDER BY m.created_at ASC LIMIT 50`
    );
    
    const messageMap = new Map();
    historyResult.rows.forEach(row => messageMap.set(row.id, row.message || '(Media)'));

    const formattedHistory = historyResult.rows.map(row => ({
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      message: row.is_deleted ? 'Pesan telah dihapus' : row.message,
      image_url: row.is_deleted ? null : row.image_url,
      sticker_url: row.is_deleted ? null : row.sticker_url,
      audio_url: row.is_deleted ? null : row.audio_url,
      reply_to_id: row.reply_to_id,
      reply_text: row.reply_to_id ? messageMap.get(row.reply_to_id) : null,
      time: row.client_time || new Date(row.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      is_deleted: row.is_deleted
    }));

    socket.emit('chat_history', formattedHistory);
  } catch (err) {
    console.error('Gagal memuat riwayat chat:', err);
  }

  // --- SIGNALING TELEPON (WebRTC) ---
  socket.on('register_call_user', (userId) => {
    if (userId) {
      socket.userId = String(userId);
      activeUsers.set(socket.userId, socket.id);
    }
  });

  socket.on('call_user', (data) => {
    const targetSocketId = activeUsers.get(String(data.toUserId));
    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming_call', {
        fromSocketId: socket.id,
        fromUserId: socket.userId,
        callerName: data.callerName,
        offer: data.offer,
        toUserId: data.toUserId
      });
    }
  });

  socket.on('make_answer', (data) => {
    io.to(data.toSocketId).emit('call_answered', {
      answer: data.answer
    });
  });

  socket.on('ice_candidate', (data) => {
    io.to(data.targetSocketId).emit('ice_candidate', {
      candidate: data.candidate
    });
  });

  socket.on('end_call', (data) => {
    if (data && data.toUserId) {
      const targetSocketId = activeUsers.get(String(data.toUserId));
      if (targetSocketId) {
        io.to(targetSocketId).emit('call_ended');
      }
    }
    socket.emit('call_ended');
  });

  socket.on('disconnect', () => {
    if (socket.userId && activeUsers.get(socket.userId) === socket.id) {
      activeUsers.delete(socket.userId);
    }
    console.log('Anggota keluarga terputus:', socket.id);
  });
});

// Jalankan Inisialisasi DB lalu Nyalakan Server
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Server Kitachat aktif di port ${PORT}`);
  });
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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

// Konfigurasi Penyimpanan File Upload menggunakan Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'photo-' + uniqueSuffix + path.extname(file.originalname));
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

// Fungsi Inisialisasi Otomatis Tabel Database (Diperbarui dengan image_url)
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
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        message TEXT,
        image_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Berhasil terhubung ke database PostgreSQL dan memverifikasi tabel!');
  } catch (err) {
    console.error('Gagal menginisialisasi skema database:', err);
  }
}

// Route Uji Coba Server
app.get('/api/status', (req, res) => {
  res.json({ status: 'Server Kitachat berjalan dengan lancar!' });
});

// 1. API REGISTER
app.post('/api/register', async (req, res) => {
  const { phone, name, password, birthdate, photo_url } = req.body;

  try {
    const existingUser = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Nomor telepon sudah terdaftar di Kitachat!' });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = await pool.query(
      `INSERT INTO users (phone, name, password, birthdate, photo_url) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id, phone, name, birthdate, photo_url, created_at`,
      [phone, name, hashedPassword, birthdate || null, photo_url || null]
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

// 2. API LOGIN
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

    res.status(200).json({
      message: 'Login berhasil!',
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

// 3. API GET /api/users
app.get('/api/users', async (req, res) => {
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

// 4. API GET /api/albums
app.get('/api/albums', async (req, res) => {
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

// 5. API POST /api/albums
app.post('/api/albums', upload.single('image'), async (req, res) => {
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

// 6. API DELETE /api/albums/:id
app.delete('/api/albums/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM albums WHERE id = $1', [id]);
        res.json({ message: 'Foto berhasil dihapus dari album.' });
    } catch (err) {
        console.error('Gagal menghapus foto:', err);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// 7. API GET /api/agendas
app.get('/api/agendas', async (req, res) => {
  try {
    const agendasResult = await pool.query('SELECT * FROM agendas ORDER BY event_date ASC');
    res.status(200).json(agendasResult.rows);
  } catch (err) {
    console.error('Error mengambil data agenda:', err);
    res.status(500).json({ error: 'Gagal memuat agenda keluarga.' });
  }
});

// 8. API POST /api/agendas
app.post('/api/agendas', async (req, res) => {
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

// 9. API POST /api/update-photo
app.post('/api/update-photo', upload.single('image'), async (req, res) => {
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

// 10. API POST /api/send-message (Baru: Mendukung Teks dan Gambar di Chat)
app.post('/api/send-message', upload.single('image'), async (req, res) => {
  try {
    const { user_id, message } = req.body;
    let image_url = null;

    if (req.file) {
      image_url = `/uploads/${req.file.filename}`;
    }

    if (!user_id || (!message && !image_url)) {
      return res.status(400).json({ error: 'Pesan atau gambar tidak boleh kosong!' });
    }

    const insertResult = await pool.query(
      `INSERT INTO messages (user_id, message, image_url) VALUES ($1, $2, $3) RETURNING *`,
      [user_id, message || '', image_url]
    );

    const userResult = await pool.query('SELECT name FROM users WHERE id = $1', [user_id]);
    const userName = userResult.rows[0] ? userResult.rows[0].name : 'Keluarga';

    const savedMsg = insertResult.rows[0];
    const formattedTime = new Date(savedMsg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    io.emit('receive_message', {
      name: userName,
      message: savedMsg.message,
      image_url: savedMsg.image_url,
      time: formattedTime
    });

    res.status(201).json({ message: 'Pesan berhasil dikirim!', data: savedMsg });
  } catch (err) {
    console.error('Gagal mengirim pesan bergambar:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// Map untuk pemetaan pengguna aktif WebRTC (userId -> socket.id)
const activeUsers = new Map();

// 11. API DELETE /api/messages (Bersihkan Obrolan Keluarga)
app.delete('/api/messages', async (req, res) => {
  try {
    // Hapus seluruh baris data dari tabel messages
    await pool.query('DELETE FROM messages');

    // Beritahu semua client yang terhubung via Socket.io bahwa chat telah dikosongkan
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

  // Ambil Riwayat Chat dari Database (Diperbarui mengambil image_url)
  try {
    const historyResult = await pool.query(
      `SELECT messages.message, messages.image_url, messages.created_at, users.name 
       FROM messages 
       JOIN users ON messages.user_id = users.id 
       ORDER BY messages.created_at ASC LIMIT 50`
    );
    
    const formattedHistory = historyResult.rows.map(row => ({
      name: row.name,
      message: row.message,
      image_url: row.image_url,
      time: new Date(row.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }));

    socket.emit('chat_history', formattedHistory);
  } catch (err) {
    console.error('Gagal memuat riwayat chat:', err);
  }

  // Kirim dan Simpan Pesan Teks via Socket (Opsional jika masih pakai socket murni)
  socket.on('send_message', async (data) => {
    try {
      const insertResult = await pool.query(
        `INSERT INTO messages (user_id, message) VALUES ($1, $2) RETURNING created_at`,
        [data.userId, data.message]
      );

      const formattedTime = new Date(insertResult.rows[0].created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      io.emit('receive_message', {
        name: data.name,
        message: data.message,
        image_url: null,
        time: formattedTime
      });
    } catch (err) {
      console.error('Gagal menyimpan pesan ke database:', err);
    }
  });

  // --- SIGNALING TELEPON (WebRTC) DENGAN PEMETAAN BERSIH ---
  socket.on('register_call_user', (userId) => {
    if (userId) {
      socket.userId = String(userId);
      activeUsers.set(socket.userId, socket.id);
      console.log(`User ID ${socket.userId} terdaftar untuk panggilan dengan Socket ID: ${socket.id}`);
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

  // Membersihkan pemetaan secara total saat terjadi disconnect
  socket.on('disconnect', () => {
    if (socket.userId && activeUsers.get(socket.userId) === socket.id) {
      activeUsers.delete(socket.userId);
      console.log(`User ID ${socket.userId} dihapus dari activeUsers karena disconnect.`);
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

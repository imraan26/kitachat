const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const express = require('express');
const fs = require('fs'); // Tambahkan modul File System
const path = require('path');
// ... (kode lainnya tetap sama)

const app = express();

// Pastikan folder public/uploads otomatis dibuat jika belum ada di server
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('Folder public/uploads berhasil dibuat secara otomatis.');
}


// Konfigurasi Penyimpanan File Upload menggunakan Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/'); // Pastikan folder public/uploads sudah ada
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

// Tes Koneksi Database
pool.connect()
  .then(() => console.log('Berhasil terhubung ke database PostgreSQL Railway!'))
  .catch(err => console.error('Koneksi database gagal:', err));

// Route Uji Coba Server
app.get('/api/status', (req, res) => {
  res.json({ status: 'Server Kitachat berjalan dengan lancar!' });
});

// 1. API REGISTER (Pendaftaran Anggota Keluarga Baru)
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

// 2. API LOGIN (Masuk ke Aplikasi)
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

// 3. API GET /api/users (Mengambil daftar anggota keluarga)
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

// 4. API GET /api/albums (Mengambil daftar foto album keluarga)
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

// 5. API POST /api/albums (Mengunggah foto baru ke album dengan Multer)
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

// 6. API DELETE /api/albums/:id (Menghapus foto album keluarga)
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

// 7. API GET /api/agendas (Mengambil daftar agenda keluarga)
app.get('/api/agendas', async (req, res) => {
  try {
    const agendasResult = await pool.query('SELECT * FROM agendas ORDER BY event_date ASC');
    res.status(200).json(agendasResult.rows);
  } catch (err) {
    console.error('Error mengambil data agenda:', err);
    res.status(500).json({ error: 'Gagal memuat agenda keluarga.' });
  }
});

// 8. API POST /api/agendas (Menambah agenda baru)
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

// 9. API POST /api/update-photo (Memperbarui foto profil pengguna secara sinkron ke database)
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

// Konfigurasi Socket.io untuk chat real-time dan signaling telepon (WebRTC)
io.on('connection', async (socket) => {
  console.log('Seorang anggota keluarga terhubung:', socket.id);

  try {
    const historyResult = await pool.query(
      `SELECT messages.message, messages.created_at, users.name 
       FROM messages 
       JOIN users ON messages.user_id = users.id 
       ORDER BY messages.created_at ASC LIMIT 50`
    );
    
    const formattedHistory = historyResult.rows.map(row => ({
      name: row.name,
      message: row.message,
      time: new Date(row.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }));

    socket.emit('chat_history', formattedHistory);
  } catch (err) {
    console.error('Gagal memuat riwayat chat:', err);
  }

  socket.on('send_message', async (data) => {
    try {
      await pool.query(
        `INSERT INTO messages (user_id, message) VALUES ($1, $2)`,
        [data.userId, data.message]
      );

      io.emit('receive_message', {
        name: data.name,
        message: data.message,
        time: data.time
      });
    } catch (err) {
      console.error('Gagal menyimpan pesan ke database:', err);
    }
  });

  // --- SIGNALING TELEPON (WebRTC) ---
  socket.on('register_call_user', (userId) => {
    socket.userId = userId;
  });

  socket.on('call_user', (data) => {
    io.emit('incoming_call', {
      fromSocketId: socket.id,
      callerName: data.callerName,
      offer: data.offer,
      toUserId: data.toUserId
    });
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
    io.emit('call_ended', data);
  });

  socket.on('disconnect', () => {
    console.log('Anggota keluarga terputus:', socket.id);
  });
});

// Jalankan Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server Kitachat aktif di port ${PORT}`);
});
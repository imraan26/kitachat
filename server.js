const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware (Limit diperbesar menjadi 50mb agar mampu menerima teks Base64 gambar)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Koneksi Database PostgreSQL menggunakan DATABASE_URL dari Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 4
});

pool.connect()
  .then(() => console.log('Berhasil terhubung ke database PostgreSQL Railway!'))
  .catch(err => console.error('Koneksi database gagal:', err));

app.get('/api/status', (req, res) => {
  res.json({ status: 'Server Kitachat berjalan dengan lancar!' });
});

// API REGISTER
app.post('/api/register', async (req, res) => {
  const { phone, name, password, birthdate, photo_url } = req.body;
  try {
    const existingUser = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (existingUser.rows.length > 0) return res.status(400).json({ error: 'Nomor telepon sudah terdaftar!' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await pool.query(
      `INSERT INTO users (phone, name, password, birthdate, photo_url) VALUES ($1, $2, $3, $4, $5) RETURNING id, phone, name, birthdate, photo_url, created_at`,
      [phone, name, hashedPassword, birthdate || null, photo_url || null]
    );
    res.status(201).json({ message: 'Registrasi berhasil!', user: newUser.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// API LOGIN
app.post('/api/login', async (req, res) => {
  const { phone, password } = req.body;
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'Nomor telepon belum terdaftar.' });

    const user = userResult.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(401).json({ error: 'Password salah!' });

    res.status(200).json({
      message: 'Login berhasil!',
      user: { id: user.id, phone: user.phone, name: user.name, birthdate: user.birthdate, photo_url: user.photo_url }
    });
  } catch (err) {
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// API GET /api/users
app.get('/api/users', async (req, res) => {
  try {
    const usersResult = await pool.query('SELECT id, name, phone, birthdate, photo_url, created_at FROM users ORDER BY name ASC');
    res.status(200).json(usersResult.rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat daftar keluarga.' });
  }
});

// API GET /api/albums
app.get('/api/albums', async (req, res) => {
  try {
    const albumsResult = await pool.query(
      `SELECT albums.id, albums.user_id, albums.image_url, albums.caption, albums.created_at, users.name as uploader_name 
       FROM albums JOIN users ON albums.user_id = users.id ORDER BY albums.created_at DESC`
    );
    res.status(200).json(albumsResult.rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat album foto.' });
  }
});

// API POST /api/albums (Menerima Base64 langsung ke Database)
app.post('/api/albums', async (req, res) => {
  try {
    const { user_id, image_base64, caption } = req.body;
    if (!image_base64) return res.status(400).json({ error: 'Gambar wajib diunggah!' });
    if (!user_id) return res.status(400).json({ error: 'User ID tidak ditemukan. Silakan login ulang.' });

    const newPhoto = await pool.query(
      `INSERT INTO albums (user_id, image_url, caption) VALUES ($1, $2, $3) RETURNING *`,
      [user_id, image_base64, caption || '']
    );

    res.status(201).json({ message: 'Foto berhasil diunggah!', photo: newPhoto.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// API DELETE /api/albums/:id
app.delete('/api/albums/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM albums WHERE id = $1', [req.params.id]);
        res.json({ message: 'Foto berhasil dihapus dari album.' });
    } catch (err) {
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// API GET & POST Agendas
app.get('/api/agendas', async (req, res) => {
  try {
    const agendasResult = await pool.query('SELECT * FROM agendas ORDER BY event_date ASC');
    res.status(200).json(agendasResult.rows);
  } catch (err) { res.status(500).json({ error: 'Gagal memuat agenda.' }); }
});

app.post('/api/agendas', async (req, res) => {
  const { title, event_date, description } = req.body;
  if (!title || !event_date) return res.status(400).json({ error: 'Judul dan tanggal wajib diisi!' });
  try {
    const newAgenda = await pool.query(
      `INSERT INTO agendas (title, event_date, description) VALUES ($1, $2, $3) RETURNING *`,
      [title, event_date, description || '']
    );
    res.status(201).json({ message: 'Agenda ditambahkan!', agenda: newAgenda.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Terjadi kesalahan pada server.' }); }
});

// API POST /api/update-photo (Menerima Base64)
app.post('/api/update-photo', async (req, res) => {
  try {
    const { user_id, image_base64 } = req.body;
    if (!image_base64) return res.status(400).json({ error: 'Gambar profil wajib diunggah!' });
    if (!user_id) return res.status(400).json({ error: 'User ID tidak ditemukan!' });

    const updateResult = await pool.query(
      `UPDATE users SET photo_url = $1 WHERE id = $2 RETURNING id, phone, name, birthdate, photo_url`,
      [image_base64, user_id]
    );

    if (updateResult.rows.length === 0) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    res.status(200).json({ message: 'Foto profil berhasil diperbarui!', user: updateResult.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// --- OPTIMALISASI KOMUNIKASI (Direct Routing Map) ---
const onlineUsers = new Map();

io.on('connection', async (socket) => {
  console.log('Seorang anggota keluarga terhubung:', socket.id);

  // Muat riwayat chat
  try {
    const historyResult = await pool.query(
      `SELECT messages.message, messages.created_at, users.name FROM messages JOIN users ON messages.user_id = users.id ORDER BY messages.created_at ASC LIMIT 50`
    );
    const formattedHistory = historyResult.rows.map(row => ({
      name: row.name, message: row.message, time: new Date(row.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }));
    socket.emit('chat_history', formattedHistory);
  } catch (err) { console.error('Gagal memuat riwayat chat:', err); }

  // Fitur Chat Teks & Gambar
  socket.on('send_message', async (data) => {
    try {
      await pool.query(`INSERT INTO messages (user_id, message) VALUES ($1, $2)`, [data.userId, data.message]);
      io.emit('receive_message', { name: data.name, message: data.message, time: data.time });
    } catch (err) { console.error('Gagal menyimpan pesan:', err); }
  });

  // --- SIGNALING TELEPON WEBRTC (Dioptimalkan) ---
  socket.on('register_call_user', (userId) => {
    socket.userId = userId;
    onlineUsers.set(String(userId), socket.id); // Petakan User ID ke Socket ID
  });

  socket.on('call_user', (data) => {
    const targetSocketId = onlineUsers.get(String(data.toUserId));
    if (targetSocketId) {
      // Direct Routing: Hanya kirim dering ke perangkat tujuan
      io.to(targetSocketId).emit('incoming_call', {
        fromSocketId: socket.id,
        callerName: data.callerName,
        offer: data.offer,
        toUserId: data.toUserId
      });
    } else {
      // Fallback aman jika map tidak tersinkronisasi
      socket.broadcast.emit('incoming_call', {
        fromSocketId: socket.id,
        callerName: data.callerName,
        offer: data.offer,
        toUserId: data.toUserId
      });
    }
  });

  socket.on('make_answer', (data) => {
    io.to(data.toSocketId).emit('call_answered', { answer: data.answer });
  });

  socket.on('ice_candidate', (data) => {
    io.to(data.targetSocketId).emit('ice_candidate', { candidate: data.candidate });
  });

  socket.on('end_call', (data) => {
    io.emit('call_ended', data);
  });

  // Pembersihan memori saat terputus
  socket.on('disconnect', () => {
    if (socket.userId) {
      onlineUsers.delete(String(socket.userId));
    }
    console.log('Anggota keluarga terputus:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server Kitachat aktif di port ${PORT}`));
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  family: 4 // Memaksa IPv4 untuk menghindari masalah DNS lokal
});

const createTableQuery = `
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
`;

async function setupDatabase() {
  try {
    await pool.query(createTableQuery);
    console.log('Seluruh skema tabel (users, albums, agendas, messages) berhasil dibuat di database PostgreSQL Railway!');
    process.exit(0);
  } catch (err) {
    console.error('Gagal membuat tabel:', err);
    process.exit(1);
  }
}

setupDatabase();

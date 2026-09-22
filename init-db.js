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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

async function setupDatabase() {
  try {
    await pool.query(createTableQuery);
    console.log('Tabel "users" berhasil dibuat di database PostgreSQL Railway!');
    process.exit(0);
  } catch (err) {
    console.error('Gagal membuat tabel:', err);
    process.exit(1);
  }
}

setupDatabase();
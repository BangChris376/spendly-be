# 🧾 Spendly Backend API

REST API untuk aplikasi **Spendly Financial Tracker** — dibangun dengan Node.js, Express, dan PostgreSQL.

---

## 🛠️ Tech Stack

| Layer      | Technology          |
|------------|---------------------|
| Runtime    | Node.js 18+         |
| Framework  | Express.js 4        |
| Database   | PostgreSQL 14+      |
| Auth       | JWT + Refresh Token |
| Upload     | Multer              |
| Validation | express-validator   |

---

## 🚀 Setup & Instalasi

### 1. Clone & Install
```bash
git clone <repo>
cd spendly-backend
npm install
```

### 2. Environment
```bash
cp .env.example .env
# Edit .env dengan konfigurasi database Anda
```

### 3. Buat Database PostgreSQL
```sql
CREATE DATABASE spendly_db;
```

### 4. Jalankan Migrasi
```bash
npm run migrate
```

### 5. Seed Data Demo (opsional)
```bash
npm run seed
# Demo: alex.graham@spendly.io / password123
```

### 6. Jalankan Server
```bash
npm run dev     # Development (auto-reload)
npm start       # Production
```

---

## 📁 Struktur Proyek

```
spendly-backend/
├── src/
│   ├── app.js                    # Entry point
│   ├── config/
│   │   ├── database.js           # PostgreSQL pool
│   │   ├── migrate.js            # DDL migrations
│   │   └── seed.js               # Demo data seeder
│   ├── controllers/
│   │   ├── authController.js     # Auth & user profile
│   │   ├── transactionController.js
│   │   ├── categoryController.js
│   │   ├── walletController.js
│   │   ├── budgetController.js
│   │   ├── scanController.js     # Receipt OCR
│   │   └── analysisController.js # AI insights & analytics
│   ├── middlewares/
│   │   ├── auth.js               # JWT authentication
│   │   ├── errorHandler.js       # Global error handler
│   │   └── upload.js             # Multer file upload
│   ├── routes/
│   │   ├── auth.js
│   │   ├── transactions.js
│   │   └── index.js              # categories, wallets, budgets, scans, analysis
│   └── utils/
│       └── response.js           # Standard response helpers
├── uploads/                      # Receipt images
├── .env.example
└── package.json
```

---

## 📋 API Endpoints

**Base URL:** `http://localhost:3000/api/v1`

### 🔐 Auth
| Method | Endpoint                  | Auth | Description           |
|--------|---------------------------|------|-----------------------|
| POST   | /auth/register            | ❌   | Daftar akun baru      |
| POST   | /auth/login               | ❌   | Login                 |
| POST   | /auth/refresh             | ❌   | Refresh access token  |
| POST   | /auth/logout              | ❌   | Logout                |
| GET    | /auth/me                  | ✅   | Profil user           |
| PUT    | /auth/me                  | ✅   | Update profil         |
| PUT    | /auth/me/password         | ✅   | Ganti password        |
| PUT    | /auth/me/preferences      | ✅   | Update preferensi     |

### 💸 Transactions
| Method | Endpoint                          | Description               |
|--------|-----------------------------------|---------------------------|
| GET    | /transactions                     | List (filter, sort, page) |
| GET    | /transactions/:id                 | Detail transaksi          |
| POST   | /transactions                     | Tambah transaksi          |
| PUT    | /transactions/:id                 | Update transaksi          |
| DELETE | /transactions/:id                 | Hapus transaksi           |
| GET    | /transactions/summary             | Ringkasan bulan ini       |
| GET    | /transactions/cash-flow           | Cash flow 6 bulan         |
| GET    | /transactions/spending-by-day     | Spending per hari         |

**Query params GET /transactions:**
```
?page=1&limit=10&type=expense&category_id=uuid&wallet_id=uuid
&date_from=2026-01-01&date_to=2026-12-31
&amount_min=10000&amount_max=1000000
&search=indomaret&sort=date&order=DESC
```

### 📂 Categories
| Method | Endpoint              | Description         |
|--------|-----------------------|---------------------|
| GET    | /categories           | Semua kategori      |
| GET    | /categories/stats     | Statistik per kategori |
| GET    | /categories/:id       | Detail kategori     |
| POST   | /categories           | Buat kategori       |
| PUT    | /categories/:id       | Update kategori     |
| DELETE | /categories/:id       | Hapus kategori      |

### 💳 Wallets
| Method | Endpoint            | Description         |
|--------|---------------------|---------------------|
| GET    | /wallets            | Semua wallet        |
| GET    | /wallets/balance    | Total saldo         |
| GET    | /wallets/:id        | Detail wallet       |
| POST   | /wallets            | Tambah wallet       |
| PUT    | /wallets/:id        | Update wallet       |
| DELETE | /wallets/:id        | Hapus wallet        |

### 🎯 Budgets
| Method | Endpoint            | Description         |
|--------|---------------------|---------------------|
| GET    | /budgets            | Semua budget        |
| GET    | /budgets/summary    | Ringkasan budget    |
| GET    | /budgets/:id        | Detail budget       |
| POST   | /budgets            | Buat budget         |
| PUT    | /budgets/:id        | Update budget       |
| DELETE | /budgets/:id        | Hapus budget        |

### 🔍 Scan Receipt (OCR)
| Method | Endpoint              | Description              |
|--------|-----------------------|--------------------------|
| GET    | /scans                | Riwayat scan             |
| POST   | /scans/upload         | Upload struk (multipart) |
| GET    | /scans/:id            | Hasil scan               |
| POST   | /scans/:id/confirm    | Simpan ke transaksi      |
| DELETE | /scans/:id            | Hapus scan               |

### 📊 Analysis & AI Insights
| Method | Endpoint                    | Description              |
|--------|-----------------------------|--------------------------|
| GET    | /analysis/dashboard         | Overview dashboard       |
| GET    | /analysis/insights          | Cash flow + AI insights  |
| GET    | /analysis/unusual-spending  | Deteksi anomali belanja  |

---

## 🔑 Authentication

Semua endpoint (kecuali `/auth/register`, `/auth/login`, `/auth/refresh`) memerlukan header:

```http
Authorization: Bearer <access_token>
```

---

## 📦 Request / Response Examples

### Register
```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "first_name": "Budi",
  "last_name": "Santoso"
}
```

### Tambah Transaksi
```http
POST /api/v1/transactions
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "expense",
  "amount": 85000,
  "merchant_name": "Indomaret",
  "category_id": "uuid-kategori",
  "wallet_id": "uuid-wallet",
  "date": "2026-05-07",
  "notes": "Belanja harian"
}
```

### Upload Struk
```http
POST /api/v1/scans/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

receipt=<file.jpg>
```

---

## 🗄️ Schema Database

```
users              → profil & auth
user_preferences   → notifikasi, dark mode, currency
refresh_tokens     → token management
wallets            → rekening / dompet
categories         → kategori transaksi (system + custom)
transactions       → semua transaksi
budgets            → anggaran per kategori
receipt_scans      → hasil scan struk OCR
```

---

## 📝 Catatan Pengembangan

- **OCR:** Saat ini menggunakan simulasi. Integrasikan **Google Vision API** atau **AWS Textract** di `scanController.js → simulateOCR()`.
- **AI Insights:** Logic berbasis query SQL. Dapat ditingkatkan dengan integrasi **OpenAI / Claude API**.
- **Rate Limiting:** Tambahkan `express-rate-limit` untuk production.
- **File Storage:** Ganti `multer` disk storage dengan **AWS S3** atau **Cloudinary** untuk production.

# Spendly Backend API

REST API untuk aplikasi Spendly Financial Tracker. Dibangun dengan Node.js, Express, dan PostgreSQL, dengan integrasi layanan AI eksternal (FastAPI) untuk OCR struk, klasifikasi kategori, dan forecasting pengeluaran berbasis LSTM.

## Tech Stack

- Node.js 18+
- Express 5
- PostgreSQL 14+
- JWT (access) + UUID refresh token
- Multer (upload struk)
- express-validator
- node-fetch + form-data (bridge ke layanan AI)

## Setup

```bash
# 1. install dependency
npm install

# 2. siapkan env
cp .env.example .env
# edit DB_PASSWORD dan AI_SERVICE_URL sesuai environment

# 3. siapkan database PostgreSQL
psql -U postgres -c "CREATE DATABASE spendly_db;"

# 4. jalankan migrasi
npm run migrate

# 5. seed data demo (opsional)
npm run seed
# demo login: alex.graham@spendly.io / password123

# 6. jalankan server
npm run dev    # mode development (nodemon)
npm start      # mode production
```

Server berjalan di `http://localhost:3000` dengan base path `/api/v1`.

## Struktur Proyek

```
spendly-be/
├── src/
│   ├── server.js                 # entry point, listen + graceful shutdown
│   ├── app.js                    # express app builder
│   ├── config/
│   │   ├── env.js                # env loader & defaults
│   │   └── database.js           # pg pool & query helper
│   ├── controllers/              # request handlers (thin)
│   ├── db/
│   │   ├── migrate.js            # ddl migrations
│   │   └── seed.js               # demo data
│   ├── middlewares/
│   │   ├── auth.js               # jwt authenticate
│   │   ├── errorHandler.js       # global error mapper + notFound
│   │   ├── upload.js             # multer config
│   │   └── validate.js           # express-validator runner
│   ├── routes/                   # one router per resource
│   │   ├── index.js              # mounts all sub-routers
│   │   ├── auth.js
│   │   ├── transactions.js
│   │   ├── categories.js
│   │   ├── wallets.js
│   │   ├── budgets.js
│   │   ├── scans.js
│   │   └── analysis.js
│   ├── services/
│   │   ├── aiService.js          # bridge ke fastapi (ocr, classify, forecast)
│   │   └── tokenService.js       # access/refresh token helpers
│   └── utils/
│       ├── response.js           # success/failure/paginated envelope
│       └── AppError.js
├── uploads/                      # struk yang diupload
├── .env.example
└── package.json
```

## Format Response

```json
{ "success": true, "message": "Success", "data": { } }
```

Error:
```json
{ "success": false, "message": "Validation failed", "errors": [{ "field": "email", "message": "Invalid email" }] }
```

Pagination (untuk list endpoint):
```json
{
  "success": true,
  "data": [],
  "pagination": { "total": 100, "page": 1, "limit": 10, "totalPages": 10, "hasNext": true, "hasPrev": false }
}
```

## API Endpoints

Base: `http://localhost:3000/api/v1`

### Auth
| Method | Path | Auth | Keterangan |
|---|---|---|---|
| POST | /auth/register | - | Registrasi akun |
| POST | /auth/login | - | Login |
| POST | /auth/refresh | - | Refresh access token |
| POST | /auth/logout | - | Logout |
| POST | /auth/forgot-password | - | Mulai reset password |
| POST | /auth/reset-password | - | Set password baru via token |
| GET | /auth/me | ✓ | Profil user aktif |
| PUT | /auth/me | ✓ | Update profil (multipart untuk avatar) |
| PUT | /auth/me/password | ✓ | Ganti password |
| PUT | /auth/me/preferences | ✓ | Update preferensi |

### Transactions
| Method | Path | Keterangan |
|---|---|---|
| GET | /transactions | List dengan filter, sort, pagination |
| GET | /transactions/summary | Ringkasan bulan/tahun |
| GET | /transactions/cash-flow | Cash flow N bulan terakhir |
| GET | /transactions/spending-by-day | Pengeluaran per hari (30 hari) |
| GET | /transactions/export-csv | Export CSV semua transaksi |
| GET | /transactions/:id | Detail |
| POST | /transactions | Tambah transaksi |
| PUT | /transactions/:id | Update transaksi |
| DELETE | /transactions/:id | Hapus transaksi |

Query GET /transactions:
`page, limit, type, category_id, wallet_id, date_from, date_to, amount_min, amount_max, search, sort, order`

### Categories
| Method | Path | Keterangan |
|---|---|---|
| GET | /categories | List (system + custom user) |
| GET | /categories/stats | Statistik per kategori |
| GET | /categories/:id | Detail |
| POST | /categories | Buat kategori custom |
| PUT | /categories/:id | Update (kategori system tidak bisa diubah) |
| DELETE | /categories/:id | Hapus (kategori system tidak bisa dihapus) |

### Wallets
| Method | Path | Keterangan |
|---|---|---|
| GET | /wallets | List wallet user |
| GET | /wallets/balance | Total saldo + total income/expense |
| GET | /wallets/:id | Detail + 5 transaksi terbaru |
| POST | /wallets | Tambah wallet |
| PUT | /wallets/:id | Update wallet |
| DELETE | /wallets/:id | Hapus (default wallet tidak bisa dihapus) |

### Budgets
| Method | Path | Keterangan |
|---|---|---|
| GET | /budgets | List budget dengan status (healthy/warning/exceeded) |
| GET | /budgets/summary | Ringkasan |
| GET | /budgets/:id | Detail |
| POST | /budgets | Buat budget |
| PUT | /budgets/:id | Update |
| DELETE | /budgets/:id | Hapus |

### Scans (OCR + AI Classifier)
| Method | Path | Keterangan |
|---|---|---|
| GET | /scans | Riwayat scan (20 terakhir) |
| POST | /scans/upload | Upload struk (multipart `receipt`) |
| GET | /scans/:id | Polling hasil scan |
| POST | /scans/:id/confirm | Simpan hasil scan jadi transaksi |
| DELETE | /scans/:id | Hapus scan |

Flow: upload mengembalikan `scan_id` dengan `status: "processing"`. Frontend polling `GET /scans/:id` setiap ~2 detik sampai `status: "completed"` atau `"failed"`.

### Analysis & AI
| Method | Path | Keterangan |
|---|---|---|
| GET | /analysis/dashboard | Data home (balance, recent, budgets, growth) |
| GET | /analysis/insights | Cash flow, heatmap, clusters, recurring, forecast, insights |
| GET | /analysis/forecast | Prediksi pengeluaran minggu depan (LSTM dari FastAPI) |
| GET | /analysis/unusual-spending | Deteksi transaksi anomali |
| GET | /analysis/ai-health | Status layanan FastAPI |

## Skema Database

| Tabel | Keterangan |
|---|---|
| users | Profil & auth |
| user_preferences | Notifikasi, dark mode, currency |
| refresh_tokens | Manajemen refresh token |
| wallets | Rekening / dompet user |
| categories | Kategori transaksi (system & custom) |
| transactions | Semua transaksi |
| budgets | Anggaran per kategori |
| receipt_scans | Hasil scan struk OCR |

System categories yang harus sinkron dengan model AI: `Beauty`, `F&B`, `Gas`, `Groceries`, `Health`, `HouseHold`, `Lifestyle`, `Listrik`, `Income`.

## Integrasi AI (FastAPI)

Backend memanggil layanan AI eksternal lewat `src/services/aiService.js`:

| Endpoint AI | Dipakai untuk |
|---|---|
| `POST /scan` | OCR + klasifikasi sekaligus (utama) |
| `POST /ocr` | Fallback ekstraksi teks |
| `POST /classify` | Fallback klasifikasi kategori |
| `POST /forecast` | Prediksi pengeluaran mingguan |
| `GET /health` | Health check |

URL & timeout dikonfigurasi via `AI_SERVICE_URL` dan `AI_TIMEOUT_MS` di `.env`.

## Demo Account

```
email    : alex.graham@spendly.io
password : password123
```

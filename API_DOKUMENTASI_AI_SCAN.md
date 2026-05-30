*** DOKUMENTASI API - PAGE AI ANALISIS & SCAN ***

[!] PERHATIAN UMUM: 
Semua endpoint di bawah ini WAJIB menyertakan header otorisasi:
Authorization: Bearer <token_jwt_dari_login>


=========================================
BAGIAN 1: AI ANALISIS (DASHBOARD & DATA)
=========================================

1. Get Dashboard Overview
- Method : GET
- Path   : /analysis/dashboard
- Kegunaan: Menampilkan ringkasan data dashboard AI.

2. Get AI Insights
- Method : GET
- Path   : /analysis/insights
- Kegunaan: Menarik data teks/hasil analisis dari AI.

3. Get Unusual Spending
- Method : GET
- Path   : /analysis/unusual-spending
- Kegunaan: Menampilkan list pengeluaran tidak wajar.

4. Get Forecast
- Method : GET
- Path   : /analysis/forecast
- Kegunaan: Menampilkan prediksi pengeluaran/keuangan.

5. Get AI Health Score
- Method : GET
- Path   : /analysis/ai-health
- Kegunaan: Menampilkan skor kesehatan keuangan.


=========================================
BAGIAN 2: SCANNER (UPLOAD & VALIDASI STRUK)
=========================================

6. Get All Scans
- Method : GET
- Path   : /scans/
- Kegunaan: Menarik riwayat semua struk yang pernah discan.

7. Upload Receipt
- Method : POST
- Path   : /scans/upload
- Body   : form-data
  -> Key : receipt (Type: File)
- Kegunaan: Mengunggah gambar/foto struk belanja.

8. Get Scan Result by ID
- Method : GET
- Path   : /scans/:id
- Params : id (wajib berformat UUID)
- Kegunaan: Mengambil detail hasil bacaan AI dari satu struk.

9. Confirm/Edit Scan Result
- Method : POST
- Path   : /scans/:id/confirm
- Params : id (wajib berformat UUID)
- Body   : raw (JSON)
  {
    "total_amount": 150000.50,   // Opsional (Float/Angka desimal, min: 1)
    "wallet_id": "uuid-wallet",  // Opsional (UUID)
    "category_id": "uuid-cat",   // Opsional (UUID)
    "date": "2026-05-30T10:00:00Z" // Opsional (Format ISO8601)
  }
- Kegunaan: Validasi atau edit hasil scan sebelum masuk database.

10. Delete Scan
- Method : DELETE
- Path   : /scans/:id
- Params : id (wajib berformat UUID)
- Kegunaan: Menghapus data scan struk.

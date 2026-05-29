# 🚀 Panduan Integrasi API — Tim Fullstack

> Spendly | CC26-PSU276

---

## Setup Awal (5 menit)

### 1. Install dependency
```bash
npm install axios
```

### 2. Buat file `.env` di root project React
```env
VITE_API_URL=http://localhost:3000/api/v1
```

### 3. Copy 2 file ke project React
```
react-client/api.js     → src/services/api.js
react-client/useApi.js  → src/hooks/useApi.js
```

---

## Cara Pakai

### Login
```jsx
import { useLogin } from '@/hooks/useApi'

function LoginPage() {
  const { mutate: login, loading, error } = useLogin()

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      await login({ email: 'alex.graham@spendly.io', password: 'password123' })
      navigate('/dashboard')
    } catch (err) {
      // error sudah ada di state `error`
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button disabled={loading}>
        {loading ? 'Loading...' : 'Login'}
      </button>
    </form>
  )
}
```

---

### Dashboard (Halaman Home)
```jsx
import { useDashboard } from '@/hooks/useApi'

function HomePage() {
  const { data, loading, error } = useDashboard()

  if (loading) return <Spinner />
  if (error)   return <ErrorMessage message={error} />

  const { balance, recent_transactions, budgets, wealth_growth } = data

  return (
    <div>
      {/* Balance Card */}
      <h1>Rp {balance.total.toLocaleString('id-ID')}</h1>
      <p>Income: Rp {balance.income.toLocaleString('id-ID')}</p>
      <p>Expense: Rp {balance.expense.toLocaleString('id-ID')}</p>
      <p>Perubahan income: {balance.income_change_pct}%</p>

      {/* Recent Transactions */}
      {recent_transactions.map(txn => (
        <div key={txn.id}>
          <span>{txn.category_icon} {txn.merchant_name}</span>
          <span style={{ color: txn.type === 'expense' ? 'red' : 'green' }}>
            {txn.type === 'expense' ? '-' : '+'}
            Rp {txn.amount.toLocaleString('id-ID')}
          </span>
        </div>
      ))}

      {/* Budget Tracking */}
      {budgets.map(b => (
        <div key={b.id}>
          <span>{b.name}</span>
          <progress value={b.percentage} max={100} />
          <span>{b.percentage}%</span>
        </div>
      ))}
    </div>
  )
}
```

---

### Daftar Transaksi + Filter
```jsx
import { useTransactions } from '@/hooks/useApi'

function HistoryPage() {
  const { data, loading, updateFilters, goToPage, params } = useTransactions({
    type: 'expense',
    limit: 10,
  })

  return (
    <div>
      {/* Filter */}
      <select onChange={(e) => updateFilters({ type: e.target.value })}>
        <option value="">Semua</option>
        <option value="expense">Pengeluaran</option>
        <option value="income">Pemasukan</option>
      </select>

      <input
        placeholder="Cari merchant..."
        onChange={(e) => updateFilters({ search: e.target.value })}
      />

      {/* Tabel */}
      {loading ? <Spinner /> : (
        <table>
          {data.data.map(txn => (
            <tr key={txn.id}>
              <td>{txn.category_icon} {txn.merchant_name}</td>
              <td><span className={`tag-${txn.category_name}`}>{txn.category_name}</span></td>
              <td>{new Date(txn.date).toLocaleDateString('id-ID')}</td>
              <td style={{ color: txn.type === 'expense' ? 'red' : 'green' }}>
                {txn.type === 'expense' ? '-' : '+'}Rp {txn.amount.toLocaleString('id-ID')}
              </td>
            </tr>
          ))}
        </table>
      )}

      {/* Pagination */}
      <div>
        <button
          disabled={!data.pagination.hasPrev}
          onClick={() => goToPage(params.page - 1)}
        >Prev</button>
        <span>Halaman {data.pagination.page} dari {data.pagination.totalPages}</span>
        <button
          disabled={!data.pagination.hasNext}
          onClick={() => goToPage(params.page + 1)}
        >Next</button>
      </div>
    </div>
  )
}
```

---

### Scan Struk (Upload + AI Processing)
```jsx
import { useScanReceipt, useConfirmScan } from '@/hooks/useApi'

function ScanPage() {
  const { upload, result, scanning, error, reset } = useScanReceipt()
  const { mutate: confirm, loading: confirming } = useConfirmScan()

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    await upload(file, (progress) => {
      console.log('Status:', progress.status) // 'processing' | 'completed'
    })
  }

  const handleConfirm = async () => {
    await confirm(result.id, {
      merchant_name: result.merchant_name,
      total_amount:  result.total_amount,
      category_id:   result.suggested_category_id,
      date:          result.scan_date,
    })
    reset()
    navigate('/history')
  }

  return (
    <div>
      <input type="file" accept="image/*,.pdf" onChange={handleFileChange} />

      {scanning && <p>⏳ AI sedang membaca struk...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {result && (
        <div>
          <h3>Hasil Scan</h3>
          <p>Merchant: {result.merchant_name}</p>
          <p>Total: Rp {result.total_amount?.toLocaleString('id-ID')}</p>
          <p>Kategori: {result.suggested_category_icon} {result.suggested_category_name}</p>
          <p>Confidence: {result.confidence_score}% ({result.confidence_level})</p>

          <button onClick={handleConfirm} disabled={confirming}>
            {confirming ? 'Menyimpan...' : 'Simpan Transaksi'}
          </button>
          <button onClick={reset}>Ulangi Scan</button>
        </div>
      )}
    </div>
  )
}
```

---

### Tambah Transaksi Manual
```jsx
import { useCreateTransaction, useCategories, useWallets } from '@/hooks/useApi'

function AddTransactionPage() {
  const { mutate: create, loading } = useCreateTransaction()
  const { data: categories }        = useCategories('expense')
  const { data: wallets }           = useWallets()

  const handleSubmit = async (formData) => {
    await create({
      type:          'expense',
      amount:        parseInt(formData.amount),
      merchant_name: formData.merchant,
      category_id:   formData.categoryId,
      wallet_id:     formData.walletId,
      date:          formData.date,
      notes:         formData.notes,
    })
    navigate('/history')
  }
}
```

---

### Analysis + AI Forecast
```jsx
import { useInsights } from '@/hooks/useApi'

function AnalysisPage() {
  const { data, loading } = useInsights()

  if (loading || !data) return <Spinner />

  const { cash_flow, spending_clusters, forecast, insights } = data

  return (
    <div>
      {/* Chart Cash Flow */}
      <BarChart data={cash_flow} xKey="label" bars={['income','expense']} />

      {/* Spending per Kategori AI */}
      {spending_clusters.map(c => (
        <div key={c.name}>
          {c.icon} {c.name}: Rp {c.total.toLocaleString('id-ID')} ({c.pct_of_total}%)
        </div>
      ))}

      {/* AI Forecast minggu depan */}
      {forecast.source === 'ai_model' ? (
        <div>
          <h3>Prediksi Minggu Depan</h3>
          {Object.entries(forecast.next_week).map(([cat, amount]) => (
            <p key={cat}>{cat}: Rp {amount?.toLocaleString('id-ID')}</p>
          ))}
          <strong>Total: Rp {forecast.total_predicted?.toLocaleString('id-ID')}</strong>
        </div>
      ) : (
        <p>AI Forecasting belum tersedia</p>
      )}

      {/* AI Insights */}
      {insights.map((insight, i) => (
        <div key={i} className={`alert-${insight.type}`}>
          <strong>{insight.title}</strong>
          <p>{insight.message}</p>
        </div>
      ))}
    </div>
  )
}
```

---

## Response Format Standar

Semua endpoint return format ini:

```json
{
  "success": true,
  "message": "Success",
  "data": { ... }
}
```

Error:
```json
{
  "success": false,
  "message": "Pesan error",
  "errors": [{ "field": "email", "message": "Invalid email" }]
}
```

Pagination (untuk GET /transactions):
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "total": 248,
    "page": 1,
    "limit": 10,
    "totalPages": 25,
    "hasNext": true,
    "hasPrev": false
  }
}
```

---

## Kategori (8 kategori model AI)

| Nama | Icon | Tipe |
|---|---|---|
| Beauty | 💄 | expense |
| F&B | 🍽️ | expense |
| Gas | ⛽ | expense |
| Groceries | 🛒 | expense |
| Health | 🏥 | expense |
| HouseHold | 🏠 | expense |
| Lifestyle | 👗 | expense |
| Listrik | ⚡ | expense |
| Income | 💰 | income |

---

## Semua Endpoint

| Endpoint | Method | Auth | Keterangan |
|---|---|---|---|
| /auth/register | POST | ❌ | Daftar |
| /auth/login | POST | ❌ | Login |
| /auth/refresh | POST | ❌ | Refresh token |
| /auth/logout | POST | ❌ | Logout |
| /auth/me | GET | ✅ | Profil user |
| /auth/me | PUT | ✅ | Update profil |
| /auth/me/password | PUT | ✅ | Ganti password |
| /auth/me/preferences | PUT | ✅ | Update preferensi |
| /transactions | GET | ✅ | List transaksi |
| /transactions | POST | ✅ | Tambah transaksi |
| /transactions/:id | GET | ✅ | Detail transaksi |
| /transactions/:id | PUT | ✅ | Update transaksi |
| /transactions/:id | DELETE | ✅ | Hapus transaksi |
| /transactions/summary | GET | ✅ | Ringkasan bulan ini |
| /transactions/cash-flow | GET | ✅ | Cash flow 6 bulan |
| /categories | GET | ✅ | List kategori |
| /categories/stats | GET | ✅ | Statistik kategori |
| /wallets | GET | ✅ | List wallet |
| /wallets/balance | GET | ✅ | Total saldo |
| /budgets | GET | ✅ | List budget |
| /budgets/summary | GET | ✅ | Ringkasan budget |
| /scans/upload | POST | ✅ | Upload struk |
| /scans/:id | GET | ✅ | Hasil scan (polling) |
| /scans/:id/confirm | POST | ✅ | Simpan ke transaksi |
| /analysis/dashboard | GET | ✅ | Data halaman Home |
| /analysis/insights | GET | ✅ | Data halaman Analysis |
| /analysis/forecast | GET | ✅ | Prediksi LSTM |
| /analysis/ai-health | GET | ✅ | Status FastAPI AI |

---

## Demo Account

```
Email    : alex.graham@spendly.io
Password : password123
```

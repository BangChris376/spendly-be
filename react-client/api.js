/**
 * api.js — Spendly API Client
 * Tim Fullstack: letakkan file ini di src/services/api.js
 *
 * Setup:
 * 1. npm install axios
 * 2. Buat file .env di root React project:
 *    VITE_API_URL=http://localhost:3000/api/v1
 * 3. Import fungsi yang dibutuhkan:
 *    import { login, getTransactions } from '@/services/api'
 */

import axios from 'axios';

// ─── Axios Instance ──────────────────────────────────────────────
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Token Management ────────────────────────────────────────────
const TOKEN_KEY   = 'spendly_token';
const REFRESH_KEY = 'spendly_refresh_token';

export const tokenStorage = {
  get:        ()      => localStorage.getItem(TOKEN_KEY),
  set:        (token) => localStorage.setItem(TOKEN_KEY, token),
  remove:     ()      => localStorage.removeItem(TOKEN_KEY),
  getRefresh: ()      => localStorage.getItem(REFRESH_KEY),
  setRefresh: (token) => localStorage.setItem(REFRESH_KEY, token),
  removeAll:  ()      => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

// ─── Request Interceptor: Inject Token ──────────────────────────
api.interceptors.request.use(
  (config) => {
    const token = tokenStorage.get();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response Interceptor: Auto Refresh Token ───────────────────
let isRefreshing  = false;
let failedQueue   = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) =>
    error ? prom.reject(error) : prom.resolve(token)
  );
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    // Token expired → coba refresh sekali
    if (error.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            original.headers.Authorization = `Bearer ${token}`;
            return api(original);
          })
          .catch((err) => Promise.reject(err));
      }

      original._retry = true;
      isRefreshing    = true;

      try {
        const refreshToken = tokenStorage.getRefresh();
        if (!refreshToken) throw new Error('No refresh token');

        const res = await axios.post(
          `${import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'}/auth/refresh`,
          { refresh_token: refreshToken }
        );

        const newToken = res.data.data.accessToken;
        tokenStorage.set(newToken);
        tokenStorage.setRefresh(res.data.data.refreshToken);
        api.defaults.headers.common.Authorization = `Bearer ${newToken}`;
        processQueue(null, newToken);

        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (refreshError) {
        processQueue(refreshError, null);
        tokenStorage.removeAll();
        // Redirect ke login
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// ─── Helper: Ekstrak data dari response ─────────────────────────
const getData = (res) => res.data.data;

// ════════════════════════════════════════════════════════════════
// 🔐 AUTH
// ════════════════════════════════════════════════════════════════

export const authAPI = {
  /**
   * Register akun baru
   * @param {{ email, password, first_name, last_name }} body
   */
  register: async (body) => {
    const res = await api.post('/auth/register', body);
    const { user, accessToken, refreshToken } = getData(res);
    tokenStorage.set(accessToken);
    tokenStorage.setRefresh(refreshToken);
    return user;
  },

  /**
   * Login
   * @param {{ email, password }} body
   */
  login: async (body) => {
    const res = await api.post('/auth/login', body);
    const { user, accessToken, refreshToken } = getData(res);
    tokenStorage.set(accessToken);
    tokenStorage.setRefresh(refreshToken);
    return user;
  },

  /** Logout — hapus token */
  logout: async () => {
    try {
      await api.post('/auth/logout', { refresh_token: tokenStorage.getRefresh() });
    } finally {
      tokenStorage.removeAll();
    }
  },

  /** Ambil profil user yang sedang login */
  getMe: () => api.get('/auth/me').then(getData),

  /**
   * Update profil
   * @param {{ first_name, last_name, monthly_limit }} body
   */
  updateProfile: (body) => api.put('/auth/me', body).then(getData),

  /**
   * Ganti password
   * @param {{ current_password, new_password }} body
   */
  updatePassword: (body) => api.put('/auth/me/password', body).then(getData),

  /**
   * Update preferensi notifikasi & tampilan
   * @param {{ push_notifications, email_summaries, security_alerts, spending_alerts, dark_mode, currency }} body
   */
  updatePreferences: (body) => api.put('/auth/me/preferences', body).then(getData),

  /** Cek apakah user sudah login */
  isLoggedIn: () => !!tokenStorage.get(),
};

// ════════════════════════════════════════════════════════════════
// 💸 TRANSACTIONS
// ════════════════════════════════════════════════════════════════

export const transactionAPI = {
  /**
   * Ambil daftar transaksi dengan filter
   * @param {Object} params
   * @param {number}  params.page        - Halaman (default 1)
   * @param {number}  params.limit       - Per halaman (default 10)
   * @param {string}  params.type        - 'income' | 'expense' | 'transfer'
   * @param {string}  params.category_id - UUID kategori
   * @param {string}  params.wallet_id   - UUID wallet
   * @param {string}  params.date_from   - Format: YYYY-MM-DD
   * @param {string}  params.date_to     - Format: YYYY-MM-DD
   * @param {number}  params.amount_min
   * @param {number}  params.amount_max
   * @param {string}  params.search      - Cari merchant/deskripsi
   * @param {string}  params.sort        - 'date' | 'amount' | 'created_at'
   * @param {string}  params.order       - 'ASC' | 'DESC'
   * @returns {{ data, pagination }}
   */
  getAll: (params = {}) =>
    api.get('/transactions', { params }).then((res) => res.data),

  /** Ambil detail satu transaksi */
  getById: (id) => api.get(`/transactions/${id}`).then(getData),

  /**
   * Buat transaksi baru
   * @param {{ type, amount, merchant_name, category_id, wallet_id, date, notes, description }} body
   */
  create: (body) => api.post('/transactions', body).then(getData),

  /**
   * Update transaksi
   * @param {string} id
   * @param {{ amount, category_id, merchant_name, notes, date }} body
   */
  update: (id, body) => api.put(`/transactions/${id}`, body).then(getData),

  /** Hapus transaksi */
  delete: (id) => api.delete(`/transactions/${id}`).then(getData),

  /**
   * Ringkasan income & expense bulan/tahun ini
   * @param {{ period, year, month }} params
   * @returns {{ summary: { income, expense, net_balance, transaction_count }, breakdown }}
   */
  getSummary: (params = {}) => api.get('/transactions/summary', { params }).then(getData),

  /**
   * Cash flow 6 bulan terakhir (untuk chart)
   * @returns Array of { month, income, expense }
   */
  getCashFlow: (months = 6) =>
    api.get('/transactions/cash-flow', { params: { months } }).then(getData),

  /**
   * Spending per hari dalam seminggu (untuk heatmap)
   * @returns Array of { dow, day_name, total }
   */
  getSpendingByDay: () => api.get('/transactions/spending-by-day').then(getData),
};

// ════════════════════════════════════════════════════════════════
// 📂 CATEGORIES
// ════════════════════════════════════════════════════════════════

export const categoryAPI = {
  /**
   * Ambil semua kategori
   * @param {'expense'|'income'|'both'} type - Filter tipe (opsional)
   *
   * Kategori sistem (8 kategori AI):
   * Beauty | F&B | Gas | Groceries | Health | HouseHold | Lifestyle | Listrik
   */
  getAll: (type) =>
    api.get('/categories', { params: type ? { type } : {} }).then(getData),

  /**
   * Statistik pengeluaran per kategori
   * @param {{ month, year }} params
   * @returns Array of { name, icon, color, total_amount, transaction_count, percentage }
   */
  getStats: (params = {}) => api.get('/categories/stats', { params }).then(getData),

  /** Detail satu kategori */
  getById: (id) => api.get(`/categories/${id}`).then(getData),

  /**
   * Buat kategori custom
   * @param {{ name, icon, color, type }} body
   */
  create: (body) => api.post('/categories', body).then(getData),

  /** Update kategori custom (kategori sistem tidak bisa diubah) */
  update: (id, body) => api.put(`/categories/${id}`, body).then(getData),

  /** Hapus kategori custom */
  delete: (id) => api.delete(`/categories/${id}`).then(getData),
};

// ════════════════════════════════════════════════════════════════
// 💳 WALLETS
// ════════════════════════════════════════════════════════════════

export const walletAPI = {
  /**
   * Ambil semua wallet beserta total income/expense
   * @returns Array of { id, name, type, balance, is_default, total_income, total_expense }
   */
  getAll: () => api.get('/wallets').then(getData),

  /**
   * Total saldo semua wallet
   * @returns { total_balance, wallet_count }
   */
  getTotalBalance: () => api.get('/wallets/balance').then(getData),

  /** Detail satu wallet */
  getById: (id) => api.get(`/wallets/${id}`).then(getData),

  /**
   * Tambah wallet
   * @param {{ name, type, account_number, bank_name, balance, color }} body
   * type: 'bank' | 'credit_card' | 'e_wallet' | 'cash'
   */
  create: (body) => api.post('/wallets', body).then(getData),

  /**
   * Update wallet
   * @param {string} id
   * @param {{ name, account_number, bank_name, color, is_default }} body
   */
  update: (id, body) => api.put(`/wallets/${id}`, body).then(getData),

  /** Hapus wallet (wallet default tidak bisa dihapus) */
  delete: (id) => api.delete(`/wallets/${id}`).then(getData),
};

// ════════════════════════════════════════════════════════════════
// 🎯 BUDGETS
// ════════════════════════════════════════════════════════════════

export const budgetAPI = {
  /**
   * Ambil semua budget dengan % penggunaan
   * @returns Array of { id, name, amount, spent, remaining, percentage_used, status }
   * status: 'healthy' | 'warning' | 'exceeded'
   */
  getAll: () => api.get('/budgets').then(getData),

  /**
   * Ringkasan semua budget
   * @returns { total_budgets, exceeded, warning, total_budget_amount, total_spent }
   */
  getSummary: () => api.get('/budgets/summary').then(getData),

  /** Detail satu budget */
  getById: (id) => api.get(`/budgets/${id}`).then(getData),

  /**
   * Buat budget
   * @param {{ name, category_id, amount, period, start_date, end_date }} body
   * period: 'weekly' | 'monthly' | 'yearly'
   */
  create: (body) => api.post('/budgets', body).then(getData),

  /**
   * Update budget
   * @param {string} id
   * @param {{ name, amount, period, start_date, end_date }} body
   */
  update: (id, body) => api.put(`/budgets/${id}`, body).then(getData),

  /** Hapus budget */
  delete: (id) => api.delete(`/budgets/${id}`).then(getData),
};

// ════════════════════════════════════════════════════════════════
// 🔍 SCAN RECEIPT (OCR + AI Classifier)
// ════════════════════════════════════════════════════════════════

export const scanAPI = {
  /**
   * Upload gambar struk → AI proses OCR + klasifikasi kategori
   * @param {File} file - File gambar (JPG/PNG/PDF, max 5MB)
   * @returns {{ scan_id, file_url, status: 'processing' }}
   *
   * Setelah upload, polling getScanResult() tiap 2 detik
   * sampai status = 'completed' atau 'failed'
   */
  upload: async (file) => {
    const formData = new FormData();
    formData.append('receipt', file);
    const res = await api.post('/scans/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return getData(res);
  },

  /**
   * Polling hasil scan (panggil tiap 2 detik setelah upload)
   * @param {string} scanId
   * @returns {{
   *   id, status,
   *   merchant_name, total_amount, scan_date,
   *   suggested_category_name, suggested_category_icon,
   *   confidence_score, confidence_level,
   *   raw_text
   * }}
   * status: 'processing' | 'completed' | 'failed'
   */
  getResult: (scanId) => api.get(`/scans/${scanId}`).then(getData),

  /**
   * Konfirmasi & simpan scan menjadi transaksi
   * User bisa override merchant_name, total_amount, category_id sebelum konfirmasi
   * @param {string} scanId
   * @param {{ merchant_name, total_amount, category_id, wallet_id, date, notes }} body
   */
  confirm: (scanId, body) => api.post(`/scans/${scanId}/confirm`, body).then(getData),

  /** Riwayat scan (20 terakhir) */
  getHistory: () => api.get('/scans').then(getData),

  /** Hapus scan */
  delete: (scanId) => api.delete(`/scans/${scanId}`).then(getData),

  /**
   * Helper: Upload + polling otomatis (all-in-one)
   * @param {File} file
   * @param {Function} onProgress - Callback saat status berubah
   * @returns {Promise<Object>} Hasil scan lengkap
   */
  uploadAndWait: async (file, onProgress) => {
    // 1. Upload
    const { scan_id } = await scanAPI.upload(file);
    onProgress?.({ status: 'processing', scan_id });

    // 2. Polling sampai selesai (max 30 detik)
    const MAX_POLLS = 15;
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const result = await scanAPI.getResult(scan_id);
      onProgress?.(result);

      if (result.status === 'completed') return result;
      if (result.status === 'failed') throw new Error('AI gagal memproses struk');
    }
    throw new Error('Timeout: struk terlalu lama diproses');
  },
};

// ════════════════════════════════════════════════════════════════
// 📊 ANALYSIS & AI INSIGHTS
// ════════════════════════════════════════════════════════════════

export const analysisAPI = {
  /**
   * Data lengkap untuk halaman Home / Dashboard
   * @returns {{
   *   balance: { total, income, expense, income_change_pct, expense_change_pct },
   *   recent_transactions: Transaction[],
   *   budgets: Budget[],
   *   wealth_growth: { month, net }[]
   * }}
   */
  getDashboard: () => api.get('/analysis/dashboard').then(getData),

  /**
   * Data lengkap untuk halaman Analysis
   * @returns {{
   *   cash_flow: { label, income, expense }[],
   *   heatmap: { dow, day_name, total }[],
   *   spending_clusters: { name, icon, total, pct_of_total }[],
   *   recurring_patterns: { merchant_name, occurrences, avg_amount }[],
   *   forecast: { next_week: {Beauty,F&B,...}, total_predicted, source },
   *   insights: { type, title, message, action }[]
   * }}
   */
  getInsights: () => api.get('/analysis/insights').then(getData),

  /**
   * Prediksi pengeluaran minggu depan (LSTM model tim AI)
   * @returns {{
   *   forecast: { Beauty, F&B, Gas, Groceries, Health, HouseHold, Lifestyle, Listrik },
   *   total_predicted: number,
   *   source: 'ai_model' | 'unavailable'
   * }}
   */
  getForecast: () => api.get('/analysis/forecast').then(getData),

  /**
   * Deteksi transaksi yang anomali (jauh di atas rata-rata)
   * @returns Array of { category, merchant_name, amount, deviation_pct }
   */
  getUnusualSpending: () => api.get('/analysis/unusual-spending').then(getData),

  /**
   * Cek status FastAPI tim AI
   * @returns {{ ai_service: { online, ... }, ai_url }}
   */
  getAIHealth: () => api.get('/analysis/ai-health').then(getData),
};

// ════════════════════════════════════════════════════════════════
// 🛠️ ERROR HELPER
// ════════════════════════════════════════════════════════════════

/**
 * Ekstrak pesan error dari response Axios
 * Gunakan di catch block:
 *   catch (err) { toast.error(getErrorMessage(err)) }
 */
export const getErrorMessage = (error) => {
  if (error.response?.data?.errors?.length) {
    return error.response.data.errors.map((e) => e.message).join(', ');
  }
  return error.response?.data?.message || error.message || 'Terjadi kesalahan';
};

// ─── Export default semua API ────────────────────────────────────
export default {
  auth:        authAPI,
  transaction: transactionAPI,
  category:    categoryAPI,
  wallet:      walletAPI,
  budget:      budgetAPI,
  scan:        scanAPI,
  analysis:    analysisAPI,
};

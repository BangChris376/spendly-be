/**
 * useApi.js — Custom React Hooks untuk Spendly API
 * Tim Fullstack: letakkan di src/hooks/useApi.js
 *
 * Semua hooks ini handle: loading, error, data state secara otomatis
 *
 * Contoh pemakaian:
 *   const { data, loading, error } = useDashboard()
 *   const { mutate: createTxn, loading } = useCreateTransaction()
 */

import { useState, useEffect, useCallback } from 'react';
import {
  authAPI, transactionAPI, categoryAPI,
  walletAPI, budgetAPI, scanAPI, analysisAPI,
  getErrorMessage,
} from './api';

// ─── Base Hook: fetch data otomatis ─────────────────────────────
const useFetch = (fetchFn, deps = [], options = {}) => {
  const { immediate = true, defaultData = null } = options;
  const [data,    setData]    = useState(defaultData);
  const [loading, setLoading] = useState(immediate);
  const [error,   setError]   = useState(null);

  const execute = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn(...args);
      setData(result);
      return result;
    } catch (err) {
      const msg = getErrorMessage(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (immediate) execute();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immediate]);

  return { data, loading, error, refetch: execute };
};

// ─── Base Hook: mutasi (POST/PUT/DELETE) ─────────────────────────
const useMutation = (mutateFn) => {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const mutate = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    try {
      const result = await mutateFn(...args);
      return result;
    } catch (err) {
      const msg = getErrorMessage(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [mutateFn]);

  return { mutate, loading, error };
};

// ════════════════════════════════════════════════════════════════
// 🔐 AUTH HOOKS
// ════════════════════════════════════════════════════════════════

/** Ambil profil user yang sedang login */
export const useMe = () =>
  useFetch(authAPI.getMe, [], { defaultData: null });

/** Login */
export const useLogin = () => useMutation(authAPI.login);

/** Register */
export const useRegister = () => useMutation(authAPI.register);

/** Logout */
export const useLogout = () => useMutation(authAPI.logout);

/** Update profil */
export const useUpdateProfile = () => useMutation(authAPI.updateProfile);

/** Ganti password */
export const useUpdatePassword = () => useMutation(authAPI.updatePassword);

/** Update preferensi */
export const useUpdatePreferences = () => useMutation(authAPI.updatePreferences);

// ════════════════════════════════════════════════════════════════
// 💸 TRANSACTION HOOKS
// ════════════════════════════════════════════════════════════════

/**
 * Ambil daftar transaksi
 * @param {Object} filters - { page, limit, type, category_id, date_from, date_to, search, ... }
 *
 * @example
 * const { data, loading } = useTransactions({ type: 'expense', limit: 10 })
 * data.data        // array transaksi
 * data.pagination  // { total, page, totalPages, hasNext }
 */
export const useTransactions = (filters = {}) => {
  const [params, setParams] = useState({ page: 1, limit: 10, ...filters });

  const { data, loading, error, refetch } = useFetch(
    () => transactionAPI.getAll(params),
    [JSON.stringify(params)],
    { defaultData: { data: [], pagination: {} } }
  );

  const updateFilters = useCallback((newFilters) => {
    setParams((prev) => ({ ...prev, ...newFilters, page: 1 }));
  }, []);

  const goToPage = useCallback((page) => {
    setParams((prev) => ({ ...prev, page }));
  }, []);

  return { data, loading, error, refetch, updateFilters, goToPage, params };
};

/** Ambil detail satu transaksi */
export const useTransaction = (id) =>
  useFetch(() => transactionAPI.getById(id), [id], { immediate: !!id });

/** Buat transaksi baru */
export const useCreateTransaction = () => useMutation(transactionAPI.create);

/** Update transaksi */
export const useUpdateTransaction = () =>
  useMutation((id, body) => transactionAPI.update(id, body));

/** Hapus transaksi */
export const useDeleteTransaction = () => useMutation(transactionAPI.delete);

/**
 * Ringkasan income & expense
 * @param {{ period, year, month }} params
 */
export const useTransactionSummary = (params = {}) =>
  useFetch(() => transactionAPI.getSummary(params), [JSON.stringify(params)]);

/** Cash flow 6 bulan (untuk chart di Analysis) */
export const useCashFlow = (months = 6) =>
  useFetch(() => transactionAPI.getCashFlow(months), [months]);

// ════════════════════════════════════════════════════════════════
// 📂 CATEGORY HOOKS
// ════════════════════════════════════════════════════════════════

/**
 * Ambil semua kategori
 * @param {'expense'|'income'|'both'} type
 *
 * Kategori sistem (8 kategori AI):
 * Beauty | F&B | Gas | Groceries | Health | HouseHold | Lifestyle | Listrik
 */
export const useCategories = (type) =>
  useFetch(() => categoryAPI.getAll(type), [type], { defaultData: [] });

/** Statistik per kategori */
export const useCategoryStats = (params = {}) =>
  useFetch(() => categoryAPI.getStats(params), [JSON.stringify(params)], { defaultData: [] });

/** Buat kategori custom */
export const useCreateCategory = () => useMutation(categoryAPI.create);

/** Update kategori custom */
export const useUpdateCategory = () =>
  useMutation((id, body) => categoryAPI.update(id, body));

/** Hapus kategori custom */
export const useDeleteCategory = () => useMutation(categoryAPI.delete);

// ════════════════════════════════════════════════════════════════
// 💳 WALLET HOOKS
// ════════════════════════════════════════════════════════════════

/** Ambil semua wallet + total balance */
export const useWallets = () =>
  useFetch(walletAPI.getAll, [], { defaultData: [] });

/** Total saldo */
export const useTotalBalance = () =>
  useFetch(walletAPI.getTotalBalance, [], { defaultData: { total_balance: 0 } });

/** Tambah wallet */
export const useCreateWallet = () => useMutation(walletAPI.create);

/** Update wallet */
export const useUpdateWallet = () =>
  useMutation((id, body) => walletAPI.update(id, body));

/** Hapus wallet */
export const useDeleteWallet = () => useMutation(walletAPI.delete);

// ════════════════════════════════════════════════════════════════
// 🎯 BUDGET HOOKS
// ════════════════════════════════════════════════════════════════

/**
 * Ambil semua budget dengan status & % pemakaian
 * status: 'healthy' | 'warning' | 'exceeded'
 */
export const useBudgets = () =>
  useFetch(budgetAPI.getAll, [], { defaultData: [] });

/** Ringkasan budget */
export const useBudgetSummary = () =>
  useFetch(budgetAPI.getSummary, [], { defaultData: {} });

/** Buat budget */
export const useCreateBudget = () => useMutation(budgetAPI.create);

/** Update budget */
export const useUpdateBudget = () =>
  useMutation((id, body) => budgetAPI.update(id, body));

/** Hapus budget */
export const useDeleteBudget = () => useMutation(budgetAPI.delete);

// ════════════════════════════════════════════════════════════════
// 🔍 SCAN RECEIPT HOOKS
// ════════════════════════════════════════════════════════════════

/**
 * Upload + polling otomatis hingga AI selesai
 *
 * @example
 * const { upload, result, scanning, error } = useScanReceipt()
 *
 * // Di handler:
 * await upload(file, (progress) => {
 *   console.log(progress.status) // 'processing' | 'completed' | 'failed'
 * })
 * console.log(result) // { merchant_name, total_amount, suggested_category_name, ... }
 */
export const useScanReceipt = () => {
  const [result,   setResult]   = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error,    setError]    = useState(null);

  const upload = useCallback(async (file, onProgress) => {
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const scanResult = await scanAPI.uploadAndWait(file, onProgress);
      setResult(scanResult);
      return scanResult;
    } catch (err) {
      const msg = getErrorMessage(err);
      setError(msg);
      throw err;
    } finally {
      setScanning(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { upload, result, scanning, error, reset };
};

/** Konfirmasi scan → simpan sebagai transaksi */
export const useConfirmScan = () =>
  useMutation((scanId, body) => scanAPI.confirm(scanId, body));

/** Riwayat scan */
export const useScanHistory = () =>
  useFetch(scanAPI.getHistory, [], { defaultData: [] });

// ════════════════════════════════════════════════════════════════
// 📊 ANALYSIS HOOKS
// ════════════════════════════════════════════════════════════════

/**
 * Data lengkap untuk halaman Home
 * @returns {{
 *   data: {
 *     balance: { total, income, expense, income_change_pct, expense_change_pct },
 *     recent_transactions,
 *     budgets,
 *     wealth_growth
 *   },
 *   loading, error, refetch
 * }}
 */
export const useDashboard = () =>
  useFetch(analysisAPI.getDashboard, [], { defaultData: null });

/**
 * Data lengkap untuk halaman Analysis
 * @returns {{
 *   data: {
 *     cash_flow, heatmap, spending_clusters,
 *     recurring_patterns, forecast, insights
 *   },
 *   loading, error, refetch
 * }}
 */
export const useInsights = () =>
  useFetch(analysisAPI.getInsights, [], { defaultData: null });

/**
 * Prediksi pengeluaran minggu depan (LSTM model AI)
 * @returns {{
 *   data: {
 *     forecast: { Beauty, F&B, Gas, Groceries, Health, HouseHold, Lifestyle, Listrik },
 *     total_predicted,
 *     source: 'ai_model' | 'unavailable'
 *   }
 * }}
 */
export const useForecast = () =>
  useFetch(analysisAPI.getForecast, [], { defaultData: null });

/** Transaksi anomali */
export const useUnusualSpending = () =>
  useFetch(analysisAPI.getUnusualSpending, [], { defaultData: [] });

/** Status FastAPI tim AI */
export const useAIHealth = () =>
  useFetch(analysisAPI.getAIHealth, [], { defaultData: null });

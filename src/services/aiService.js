/**
 * aiService.js
 * Jembatan antara Express backend dan FastAPI AI (port 8000)
 * Semua komunikasi ke tim AI dilakukan dari sini.
 */

const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const AI_BASE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
const AI_TIMEOUT = parseInt(process.env.AI_TIMEOUT_MS) || 30000;

// ── Helper: fetch dengan timeout ────────────────────────────────
const fetchWithTimeout = (url, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
};

// ── Helper: log error AI tanpa crash backend ─────────────────────
const logAIError = (service, err) => {
  console.error(`[AI Service - ${service}] ${err.message}`);
};

/**
 * OCR: Ekstrak teks dari gambar struk
 * Tim AI endpoint: POST /ocr
 * Input : file gambar (multipart/form-data)
 * Output: { text: string, confidence: float }
 */
const extractOCR = async (filePath) => {
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), {
      filename: path.basename(filePath),
      contentType: 'image/jpeg',
    });

    const res = await fetchWithTimeout(`${AI_BASE_URL}/ocr`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });

    if (!res.ok) {
      throw new Error(`OCR API responded ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return {
      success: true,
      text: data.text || '',
      confidence: data.confidence || 0,
    };
  } catch (err) {
    logAIError('OCR', err);
    return { success: false, text: '', confidence: 0, error: err.message };
  }
};

/**
 * Classifier: Klasifikasi kategori transaksi
 * Tim AI endpoint: POST /classify
 * Input : { text: string, image_path?: string }
 * Output: { category: string, confidence: float, probabilities: object }
 *
 * Kategori valid (sesuai model tim AI):
 * Beauty | F&B | Gas | Groceries | Health | HouseHold | Lifestyle | Listrik
 */
const classifyTransaction = async ({ text, imagePath }) => {
  try {
    const form = new FormData();
    form.append('text', text || '');

    if (imagePath && fs.existsSync(imagePath)) {
      form.append('file', fs.createReadStream(imagePath), {
        filename: path.basename(imagePath),
        contentType: 'image/jpeg',
      });
    }

    const res = await fetchWithTimeout(`${AI_BASE_URL}/classify`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Classify API responded ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return {
      success: true,
      category: data.category || null,         // e.g. "Groceries"
      confidence: data.confidence || 0,         // e.g. 0.95
      probabilities: data.probabilities || {},  // semua kategori + score
    };
  } catch (err) {
    logAIError('Classifier', err);
    return { success: false, category: null, confidence: 0, error: err.message };
  }
};

/**
 * OCR + Classify sekaligus (pipeline lengkap untuk scan struk)
 * Tim AI endpoint: POST /scan (jika ada endpoint gabungan)
 * Fallback: panggil /ocr lalu /classify secara berurutan
 *
 * Output gabungan:
 * {
 *   merchant_name, total_amount, date,
 *   category, confidence_score,
 *   raw_text
 * }
 */
const processReceipt = async (filePath) => {
  try {
    // Coba endpoint gabungan dulu
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), {
      filename: path.basename(filePath),
      contentType: 'image/jpeg',
    });

    const res = await fetchWithTimeout(`${AI_BASE_URL}/scan`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        success: true,
        merchant_name:    data.merchant_name    || null,
        total_amount:     data.total_amount     || null,
        scan_date:        data.date             || new Date().toISOString().split('T')[0],
        category:         data.category         || null,
        confidence_score: Math.round((data.confidence || 0) * 100),
        raw_text:         data.raw_text         || data.text || '',
        probabilities:    data.probabilities    || {},
      };
    }

    // Fallback: jalankan OCR → Classify terpisah
    console.log('[AI Service] /scan tidak tersedia, fallback ke /ocr + /classify');

    const ocrResult = await extractOCR(filePath);
    if (!ocrResult.success) throw new Error('OCR gagal: ' + ocrResult.error);

    const classResult = await classifyTransaction({
      text: ocrResult.text,
      imagePath: filePath,
    });

    return {
      success: true,
      merchant_name:    extractMerchantFromText(ocrResult.text),
      total_amount:     extractAmountFromText(ocrResult.text),
      scan_date:        new Date().toISOString().split('T')[0],
      category:         classResult.category,
      confidence_score: Math.round((classResult.confidence || 0) * 100),
      raw_text:         ocrResult.text,
      probabilities:    classResult.probabilities,
    };
  } catch (err) {
    logAIError('processReceipt', err);
    return { success: false, error: err.message };
  }
};

/**
 * Spending Forecast: Prediksi pengeluaran minggu depan
 * Tim AI endpoint: POST /forecast
 *
 * Input:
 * {
 *   history: [
 *     { week: 1, Beauty: 50000, F&B: 120000, Gas: 80000, ... },
 *     ...12 minggu terakhir
 *   ]
 * }
 *
 * Output:
 * {
 *   forecast: { Beauty: 55000, F&B: 130000, Gas: 75000, ... },
 *   total_predicted: number
 * }
 */
const predictSpending = async (weeklyHistory) => {
  try {
    const res = await fetchWithTimeout(`${AI_BASE_URL}/forecast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: weeklyHistory }),
    });

    if (!res.ok) {
      throw new Error(`Forecast API responded ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return {
      success: true,
      forecast: data.forecast || data.prediction || {},
      total_predicted: data.total_predicted || data.total || 0,
    };
  } catch (err) {
    logAIError('Forecaster', err);
    return { success: false, forecast: {}, total_predicted: 0, error: err.message };
  }
};

/**
 * Health check: Cek apakah FastAPI AI service aktif
 */
const checkAIHealth = async () => {
  try {
    const res = await fetchWithTimeout(`${AI_BASE_URL}/health`, { method: 'GET' });
    const data = await res.json();
    return { online: res.ok, ...data };
  } catch (err) {
    return { online: false, error: err.message };
  }
};

// ── Helpers: ekstrak dari raw OCR text ──────────────────────────
// (Digunakan hanya saat fallback, bukan primary logic)

const extractMerchantFromText = (text) => {
  if (!text) return null;
  const lines = text.split('\n').filter(l => l.trim().length > 2);
  return lines[0]?.trim().substring(0, 100) || null;
};

const extractAmountFromText = (text) => {
  if (!text) return null;
  // Cari pola "TOTAL", "JUMLAH", atau nominal terbesar
  const patterns = [
    /(?:total|jumlah|amount)[^\d]*(\d[\d.,]+)/i,
    /rp\.?\s*(\d[\d.,]+)/i,
    /(\d{4,})/g,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const raw = match[1].replace(/[.,]/g, '');
      const num = parseInt(raw);
      if (!isNaN(num) && num > 0) return num;
    }
  }
  return null;
};

module.exports = {
  extractOCR,
  classifyTransaction,
  processReceipt,
  predictSpending,
  checkAIHealth,
};

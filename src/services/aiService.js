// bridge to the fastapi ai service for ocr, classification and forecasting

const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const env = require('../config/env');

const fetchWithTimeout = (url, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.aiTimeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
};

const logError = (label, err) => console.error(`[ai:${label}] ${err.message}`);

const buildFileForm = (filePath) => {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: 'image/jpeg',
  });
  return form;
};

const extractMerchantFromText = (text) => {
  if (!text) return null;
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 2);
  return lines[0]?.substring(0, 100) || null;
};

const extractAmountFromText = (text) => {
  if (!text) return null;
  const patterns = [
    /(?:total|jumlah|amount)[^\d]*(\d[\d.,]+)/i,
    /rp\.?\s*(\d[\d.,]+)/i,
    /(\d{4,})/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1].replace(/[.,]/g, ''), 10);
      if (Number.isFinite(num) && num > 0) return num;
    }
  }
  return null;
};

const extractOCR = async (filePath) => {
  try {
    const form = buildFileForm(filePath);
    const res = await fetchWithTimeout(`${env.aiBaseUrl}/ocr`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });
    if (!res.ok) throw new Error(`ocr api ${res.status}`);
    const data = await res.json();
    return { success: true, text: data.text || '', confidence: data.confidence || 0 };
  } catch (err) {
    logError('ocr', err);
    return { success: false, text: '', confidence: 0, error: err.message };
  }
};

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

    const res = await fetchWithTimeout(`${env.aiBaseUrl}/classify`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });
    if (!res.ok) throw new Error(`classify api ${res.status}`);
    const data = await res.json();
    return {
      success: true,
      category: data.category || null,
      confidence: data.confidence || 0,
      probabilities: data.probabilities || {},
    };
  } catch (err) {
    logError('classify', err);
    return { success: false, category: null, confidence: 0, error: err.message };
  }
};

const processReceipt = async (filePath) => {
  try {
    const form = buildFileForm(filePath);
    const res = await fetchWithTimeout(`${env.aiBaseUrl}/scan`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        success: true,
        merchant_name: data.merchant_name || null,
        total_amount: data.total_amount || null,
        scan_date: data.date || new Date().toISOString().split('T')[0],
        category: data.category || null,
        confidence_score: Math.round((data.confidence || 0) * 100),
        raw_text: data.raw_text || data.text || '',
        probabilities: data.probabilities || {},
      };
    }

    // fallback: ocr then classify separately
    const ocr = await extractOCR(filePath);
    if (!ocr.success) throw new Error(`ocr failed: ${ocr.error}`);
    const cls = await classifyTransaction({ text: ocr.text, imagePath: filePath });

    return {
      success: true,
      merchant_name: extractMerchantFromText(ocr.text),
      total_amount: extractAmountFromText(ocr.text),
      scan_date: new Date().toISOString().split('T')[0],
      category: cls.category,
      confidence_score: Math.round((cls.confidence || 0) * 100),
      raw_text: ocr.text,
      probabilities: cls.probabilities,
    };
  } catch (err) {
    logError('processReceipt', err);
    return { success: false, error: err.message };
  }
};

// expects 12 weeks of per-category spending; returns next-week prediction
const predictSpending = async (weeklyHistory) => {
  try {
    const res = await fetchWithTimeout(`${env.aiBaseUrl}/forecast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: weeklyHistory }),
    });
    if (!res.ok) throw new Error(`forecast api ${res.status}`);
    const data = await res.json();
    return {
      success: true,
      forecast: data.forecast || data.prediction || {},
      total_predicted: data.total_predicted || data.total || 0,
    };
  } catch (err) {
    logError('forecast', err);
    return { success: false, forecast: {}, total_predicted: 0, error: err.message };
  }
};

const checkAIHealth = async () => {
  try {
    const res = await fetchWithTimeout(`${env.aiBaseUrl}/health`, { method: 'GET' });
    const data = await res.json();
    return { online: res.ok, ...data };
  } catch (err) {
    return { online: false, error: err.message };
  }
};

const getFinancialInsight = async (insightData) => {
  try {
    const res = await fetchWithTimeout(`${env.aiBaseUrl}/insight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(insightData),
    });
    if (!res.ok) throw new Error(`insight api ${res.status}`);
    const data = await res.json();
    return {
      success: true,
      insight: data.insight || data.message || data.text || null,
      insights: data.insights || [],
    };
  } catch (err) {
    logError('insight', err);
    return { success: false, insight: null, insights: [], error: err.message };
  }
};

module.exports = {
  extractOCR,
  classifyTransaction,
  processReceipt,
  predictSpending,
  checkAIHealth,
  getFinancialInsight,
};

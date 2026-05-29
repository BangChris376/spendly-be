const path = require('path');
const { query } = require('../config/database');
const { success } = require('../utils/response');
const aiService = require('../services/aiService');

/**
 * Mapping label kategori dari model AI → nama kategori di DB
 * Harus sinkron dengan SYSTEM_CATEGORIES di seed.js
 *
 * Model AI output: "Beauty" | "F&B" | "Gas" | "Groceries" |
 *                  "Health" | "HouseHold" | "Lifestyle" | "Listrik"
 */
const AI_CATEGORY_MAP = {
  'Beauty':    'Beauty',
  'F&B':       'F&B',
  'Gas':       'Gas',
  'Groceries': 'Groceries',
  'Health':    'Health',
  'HouseHold': 'HouseHold',
  'Lifestyle': 'Lifestyle',
  'Listrik':   'Listrik',
};

/**
 * Resolve category_id dari label AI ke UUID di DB
 */
const resolveCategoryId = async (userId, aiLabel) => {
  if (!aiLabel) return null;
  const dbName = AI_CATEGORY_MAP[aiLabel] || aiLabel;
  const result = await query(
    `SELECT id FROM categories
     WHERE (user_id = $1 OR is_system = true)
       AND LOWER(name) = LOWER($2)
     LIMIT 1`,
    [userId, dbName]
  );
  return result.rows[0]?.id || null;
};

/**
 * POST /api/v1/scans/upload
 * Upload gambar struk → kirim ke AI (OCR + Classifier) → simpan hasil
 */
const uploadReceipt = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'File struk wajib diupload' });
    }

    const fileUrl  = `/uploads/${req.file.filename}`;
    const filePath = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads', req.file.filename);

    // Simpan scan record dengan status "processing"
    const scanRes = await query(
      `INSERT INTO receipt_scans (user_id, file_url, file_name, status)
       VALUES ($1, $2, $3, 'processing') RETURNING *`,
      [req.user.id, fileUrl, req.file.originalname]
    );
    const scan = scanRes.rows[0];

    // Proses AI secara async (non-blocking response)
    setImmediate(async () => {
      try {
        // Kirim gambar ke FastAPI tim AI
        const aiResult = await aiService.processReceipt(filePath);

        if (!aiResult.success) {
          await query(
            `UPDATE receipt_scans SET status='failed' WHERE id=$1`,
            [scan.id]
          );
          console.error(`[Scan ${scan.id}] AI processing failed:`, aiResult.error);
          return;
        }

        // Resolve category ID dari label AI
        const suggestedCatId = await resolveCategoryId(req.user.id, aiResult.category);

        await query(
          `UPDATE receipt_scans
           SET status               = 'completed',
               merchant_name        = $1,
               total_amount         = $2,
               scan_date            = $3,
               confidence_score     = $4,
               raw_text             = $5,
               suggested_category_id = $6
           WHERE id = $7`,
          [
            aiResult.merchant_name,
            aiResult.total_amount,
            aiResult.scan_date,
            aiResult.confidence_score,
            aiResult.raw_text,
            suggestedCatId,
            scan.id,
          ]
        );

        console.log(`[Scan ${scan.id}] ✅ AI selesai — kategori: ${aiResult.category} (${aiResult.confidence_score}%)`);
      } catch (err) {
        await query(`UPDATE receipt_scans SET status='failed' WHERE id=$1`, [scan.id]);
        console.error(`[Scan ${scan.id}] Error AI:`, err.message);
      }
    });

    return res.status(202).json({
      success: true,
      message: 'Struk diupload, sedang diproses AI...',
      data: {
        scan_id:  scan.id,
        file_url: fileUrl,
        status:   'processing',
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/scans/:id
 * Polling hasil scan (frontend polling tiap 2 detik sampai status = completed/failed)
 */
const getScanResult = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT rs.*,
              c.name  AS suggested_category_name,
              c.icon  AS suggested_category_icon,
              c.color AS suggested_category_color
       FROM receipt_scans rs
       LEFT JOIN categories c ON c.id = rs.suggested_category_id
       WHERE rs.id = $1 AND rs.user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Scan tidak ditemukan' });
    }

    const scan = result.rows[0];

    // Tambahkan estimasi confidence level untuk UI
    const confidenceLevel =
      scan.confidence_score >= 90 ? 'high' :
      scan.confidence_score >= 70 ? 'medium' : 'low';

    return success(res, { ...scan, confidence_level: confidenceLevel });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/scans/:id/confirm
 * User konfirmasi hasil scan → simpan sebagai transaksi
 * (User bisa edit merchant_name, amount, category sebelum konfirmasi)
 */
const confirmScan = async (req, res, next) => {
  try {
    const { merchant_name, total_amount, category_id, wallet_id, date, notes } = req.body;

    const scanRes = await query(
      `SELECT * FROM receipt_scans
       WHERE id = $1 AND user_id = $2 AND status = 'completed'`,
      [req.params.id, req.user.id]
    );

    if (!scanRes.rows.length) {
      return res.status(400).json({
        success: false,
        message: 'Scan belum selesai atau tidak ditemukan',
      });
    }

    const scan = scanRes.rows[0];

    // Gunakan data dari user (override) atau fallback ke hasil AI
    const finalAmount   = parseFloat(total_amount) || parseFloat(scan.total_amount) || 0;
    const finalMerchant = merchant_name || scan.merchant_name || 'Unknown';
    const finalCatId    = category_id   || scan.suggested_category_id;
    const finalDate     = date          || scan.scan_date || new Date().toISOString().split('T')[0];

    if (finalAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Jumlah transaksi tidak valid' });
    }

    // Buat transaksi dari hasil scan
    const txnRes = await query(
      `INSERT INTO transactions
         (user_id, wallet_id, category_id, type, amount, merchant_name, notes, receipt_url, date)
       VALUES ($1,$2,$3,'expense',$4,$5,$6,$7,$8)
       RETURNING *`,
      [req.user.id, wallet_id || null, finalCatId, finalAmount, finalMerchant, notes || null, scan.file_url, finalDate]
    );

    // Hubungkan scan ke transaksi
    await query(
      `UPDATE receipt_scans SET transaction_id = $1 WHERE id = $2`,
      [txnRes.rows[0].id, scan.id]
    );

    // Update saldo wallet
    if (wallet_id) {
      await query(
        `UPDATE wallets SET balance = balance - $1 WHERE id = $2 AND user_id = $3`,
        [finalAmount, wallet_id, req.user.id]
      );
    }

    return success(res, txnRes.rows[0], 'Transaksi berhasil disimpan dari scan', 201);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/scans
 * Riwayat scan milik user
 */
const getScans = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT rs.*,
              c.name  AS suggested_category_name,
              c.icon  AS suggested_category_icon
       FROM receipt_scans rs
       LEFT JOIN categories c ON c.id = rs.suggested_category_id
       WHERE rs.user_id = $1
       ORDER BY rs.created_at DESC
       LIMIT 20`,
      [req.user.id]
    );
    return success(res, result.rows);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/scans/:id
 */
const deleteScan = async (req, res, next) => {
  try {
    const result = await query(
      `DELETE FROM receipt_scans WHERE id=$1 AND user_id=$2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Scan tidak ditemukan' });
    }
    return success(res, null, 'Scan dihapus');
  } catch (err) {
    next(err);
  }
};

module.exports = { uploadReceipt, getScanResult, confirmScan, getScans, deleteScan };

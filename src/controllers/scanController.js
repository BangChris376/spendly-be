const path = require('path');
const { query, getClient } = require('../config/database');
const { success, failure } = require('../utils/response');
const aiService = require('../services/aiService');
const env = require('../config/env');

// resolve a category uuid from the ai-returned label
const resolveCategoryId = async (userId, label) => {
  if (!label) return null;
  const result = await query(
    `SELECT id FROM categories
     WHERE (user_id = $1 OR is_system = true) AND LOWER(name) = LOWER($2)
     LIMIT 1`,
    [userId, label]
  );
  return result.rows[0]?.id || null;
};

const uploadReceipt = async (req, res, next) => {
  try {
    if (!req.file) return failure(res, 'Receipt file is required', 400);

    const fileUrl = `/uploads/${req.file.filename}`;
    const filePath = path.join(__dirname, '..', '..', env.uploadDir, req.file.filename);

    const scanRes = await query(
      `INSERT INTO receipt_scans (user_id, file_url, file_name, status)
       VALUES ($1, $2, $3, 'processing') RETURNING id`,
      [req.user.id, fileUrl, req.file.originalname]
    );
    const scanId = scanRes.rows[0].id;
    const userId = req.user.id;

    // run ai pipeline asynchronously so the upload returns immediately
    setImmediate(async () => {
      try {
        const result = await aiService.processReceipt(filePath);
        if (!result.success) {
          await query(`UPDATE receipt_scans SET status='failed' WHERE id=$1`, [scanId]);
          console.error(`[scan ${scanId}] ai failed:`, result.error);
          return;
        }

        const suggestedCatId = await resolveCategoryId(userId, result.category);
        await query(
          `UPDATE receipt_scans SET
             status                = 'completed',
             merchant_name         = $1,
             total_amount          = $2,
             scan_date             = $3,
             confidence_score      = $4,
             raw_text              = $5,
             suggested_category_id = $6
           WHERE id = $7`,
          [
            result.merchant_name,
            result.total_amount,
            result.scan_date,
            result.confidence_score,
            result.raw_text,
            suggestedCatId,
            scanId,
          ]
        );
        console.log(`[scan ${scanId}] completed: ${result.category} (${result.confidence_score}%)`);
      } catch (err) {
        await query(`UPDATE receipt_scans SET status='failed' WHERE id=$1`, [scanId]).catch(() => {});
        console.error(`[scan ${scanId}] pipeline error:`, err.message);
      }
    });

    return res.status(202).json({
      success: true,
      message: 'Receipt uploaded, AI processing started',
      data: { scan_id: scanId, file_url: fileUrl, status: 'processing' },
    });
  } catch (err) {
    return next(err);
  }
};

const confidenceLevel = (score) =>
  score >= 90 ? 'high' : score >= 70 ? 'medium' : 'low';

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
    if (!result.rows.length) return failure(res, 'Scan not found', 404);

    const scan = result.rows[0];
    return success(res, { ...scan, confidence_level: confidenceLevel(scan.confidence_score || 0) });
  } catch (err) {
    return next(err);
  }
};

const confirmScan = async (req, res, next) => {
  const client = await getClient();
  try {
    const { merchant_name, total_amount, category_id, wallet_id, date, notes } = req.body;

    const scanRes = await client.query(
      `SELECT * FROM receipt_scans
       WHERE id = $1 AND user_id = $2 AND status = 'completed'`,
      [req.params.id, req.user.id]
    );
    if (!scanRes.rows.length) return failure(res, 'Scan not found or not yet completed', 400);

    const scan = scanRes.rows[0];
    const finalAmount = parseFloat(total_amount) || parseFloat(scan.total_amount) || 0;
    const finalMerchant = merchant_name || scan.merchant_name || 'Unknown';
    const finalCatId = category_id || scan.suggested_category_id;
    const finalDate = date || scan.scan_date || new Date().toISOString().split('T')[0];

    if (finalAmount <= 0) return failure(res, 'Invalid transaction amount', 400);

    if (wallet_id) {
      const owns = await client.query(
        `SELECT 1 FROM wallets WHERE id = $1 AND user_id = $2`,
        [wallet_id, req.user.id]
      );
      if (!owns.rowCount) return failure(res, 'Wallet not found', 400);
    }

    await client.query('BEGIN');

    const txnRes = await client.query(
      `INSERT INTO transactions
         (user_id, wallet_id, category_id, type, amount, merchant_name, notes, receipt_url, date)
       VALUES ($1, $2, $3, 'expense', $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.id, wallet_id || null, finalCatId, finalAmount, finalMerchant, notes || null, scan.file_url, finalDate]
    );

    await client.query(
      `UPDATE receipt_scans SET transaction_id = $1 WHERE id = $2`,
      [txnRes.rows[0].id, scan.id]
    );

    if (wallet_id) {
      await client.query(
        `UPDATE wallets SET balance = balance - $1 WHERE id = $2`,
        [finalAmount, wallet_id]
      );
    }

    await client.query('COMMIT');
    return success(res, txnRes.rows[0], 'Transaction saved from scan', 201);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return next(err);
  } finally {
    client.release();
  }
};

const getScans = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT rs.*, c.name AS suggested_category_name, c.icon AS suggested_category_icon
       FROM receipt_scans rs
       LEFT JOIN categories c ON c.id = rs.suggested_category_id
       WHERE rs.user_id = $1
       ORDER BY rs.created_at DESC
       LIMIT 20`,
      [req.user.id]
    );
    return success(res, result.rows);
  } catch (err) {
    return next(err);
  }
};

const deleteScan = async (req, res, next) => {
  try {
    const result = await query(
      `DELETE FROM receipt_scans WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return failure(res, 'Scan not found', 404);
    return success(res, null, 'Scan deleted');
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  uploadReceipt,
  getScanResult,
  confirmScan,
  getScans,
  deleteScan,
};

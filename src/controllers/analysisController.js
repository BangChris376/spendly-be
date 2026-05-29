const { query } = require('../config/database');
const { success } = require('../utils/response');
const aiService = require('../services/aiService');

/**
 * 8 kategori yang dikenali model Forecaster tim AI
 * Urutan ini HARUS konsisten dengan format input LSTM model
 */
const AI_CATEGORIES = ['Beauty', 'F&B', 'Gas', 'Groceries', 'Health', 'HouseHold', 'Lifestyle', 'Listrik'];

/**
 * Ambil histori spending mingguan per kategori (12 minggu terakhir)
 * Format output sesuai input LSTM tim AI: 12 weeks × 8 categories
 */
const getWeeklyHistoryForAI = async (userId) => {
  const result = await query(
    `SELECT
       EXTRACT(WEEK FROM date)::int  AS week_num,
       EXTRACT(YEAR FROM date)::int  AS year_num,
       c.name                        AS category,
       SUM(t.amount)                 AS total
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = $1
       AND t.type = 'expense'
       AND c.name = ANY($2::text[])
       AND t.date >= NOW() - INTERVAL '12 weeks'
     GROUP BY week_num, year_num, c.name
     ORDER BY year_num ASC, week_num ASC`,
    [userId, AI_CATEGORIES]
  );

  // Susun ulang menjadi array 12 entri, tiap entri berisi spending per kategori
  const weekMap = {};
  for (const row of result.rows) {
    const key = `${row.year_num}-W${row.week_num}`;
    if (!weekMap[key]) weekMap[key] = { week: key };
    weekMap[key][row.category] = parseFloat(row.total);
  }

  // Pastikan semua kategori ada (default 0 jika tidak ada transaksi)
  const weeks = Object.values(weekMap).map(w => {
    const entry = { week: w.week };
    for (const cat of AI_CATEGORIES) {
      entry[cat] = w[cat] || 0;
    }
    return entry;
  });

  // Pad ke 12 minggu jika data kurang
  while (weeks.length < 12) {
    weeks.unshift({ week: `pad-${weeks.length}`, ...Object.fromEntries(AI_CATEGORIES.map(c => [c, 0])) });
  }

  return weeks.slice(-12); // Ambil 12 minggu terakhir
};

/**
 * GET /api/v1/analysis/dashboard
 * Overview lengkap untuk halaman Home
 */
const getDashboardOverview = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const m = now.getMonth() + 1;
    const y = now.getFullYear();

    // Ringkasan bulan ini
    const summaryRes = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS expense,
         COUNT(*)::int AS tx_count
       FROM transactions
       WHERE user_id=$1
         AND EXTRACT(MONTH FROM date)=$2
         AND EXTRACT(YEAR  FROM date)=$3`,
      [userId, m, y]
    );

    // Bulan sebelumnya (untuk % perubahan)
    const prevM = m === 1 ? 12 : m - 1;
    const prevY = m === 1 ? y - 1 : y;
    const prevRes = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE user_id=$1
         AND EXTRACT(MONTH FROM date)=$2
         AND EXTRACT(YEAR  FROM date)=$3`,
      [userId, prevM, prevY]
    );

    const cur  = summaryRes.rows[0];
    const prev = prevRes.rows[0];
    const pct  = (a, b) => b > 0 ? Math.round(((a - b) / b) * 100) : 0;

    // Total saldo wallet
    const walletRes = await query(
      `SELECT COALESCE(SUM(balance),0) AS total_balance FROM wallets WHERE user_id=$1`,
      [userId]
    );

    // 5 transaksi terbaru
    const recentRes = await query(
      `SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id=$1
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT 5`,
      [userId]
    );

    // Budget tracking
    const budgetRes = await query(
      `SELECT b.id, b.name, b.amount,
         COALESCE(SUM(t.amount), 0) AS spent,
         ROUND(COALESCE(SUM(t.amount),0) / NULLIF(b.amount,0) * 100, 0) AS percentage
       FROM budgets b
       LEFT JOIN transactions t
         ON t.category_id = b.category_id
        AND t.user_id     = b.user_id
        AND t.type        = 'expense'
        AND t.date        >= b.start_date
        AND (b.end_date IS NULL OR t.date <= b.end_date)
       WHERE b.user_id=$1
       GROUP BY b.id, b.name, b.amount
       ORDER BY percentage DESC
       LIMIT 5`,
      [userId]
    );

    // Wealth growth (7 bulan)
    const growthRes = await query(
      `SELECT
         TO_CHAR(date_trunc('month', date), 'Mon') AS month,
         date_trunc('month', date)                  AS period,
         SUM(CASE WHEN type='income' THEN amount ELSE -amount END) AS net
       FROM transactions
       WHERE user_id=$1 AND date >= NOW() - INTERVAL '7 months'
       GROUP BY date_trunc('month', date)
       ORDER BY period ASC`,
      [userId]
    );

    return success(res, {
      balance: {
        total:              walletRes.rows[0].total_balance,
        income:             cur.income,
        expense:            cur.expense,
        income_change_pct:  pct(cur.income, prev.income),
        expense_change_pct: pct(cur.expense, prev.expense),
        transaction_count:  cur.tx_count,
      },
      recent_transactions: recentRes.rows,
      budgets:             budgetRes.rows,
      wealth_growth:       growthRes.rows,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/analysis/insights
 * Cash flow + Spending Clusters + AI Insights dari FastAPI
 */
const getAnalysis = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // 1. Cash Flow 6 bulan (income vs expense)
    const cashFlow = await query(
      `SELECT
         TO_CHAR(date_trunc('month', date), 'Mon YYYY') AS label,
         date_trunc('month', date)                       AS period,
         COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END),0) AS income,
         COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense
       FROM transactions
       WHERE user_id=$1 AND date >= NOW() - INTERVAL '6 months'
       GROUP BY date_trunc('month', date)
       ORDER BY period ASC`,
      [userId]
    );

    // 2. Heatmap pengeluaran per hari (90 hari terakhir)
    const heatmap = await query(
      `SELECT
         EXTRACT(DOW FROM date)::int AS dow,
         TO_CHAR(date, 'Day')        AS day_name,
         COUNT(*)::int               AS tx_count,
         COALESCE(SUM(amount), 0)    AS total
       FROM transactions
       WHERE user_id=$1 AND type='expense' AND date >= NOW() - INTERVAL '90 days'
       GROUP BY EXTRACT(DOW FROM date)
       ORDER BY dow`,
      [userId]
    );

    // 3. Spending Clusters per kategori AI (30 hari terakhir)
    const clusters = await query(
      `SELECT
         c.name, c.icon, c.color,
         COUNT(t.id)::int            AS frequency,
         COALESCE(SUM(t.amount), 0)  AS total,
         ROUND(
           COALESCE(SUM(t.amount),0) /
           NULLIF((SELECT SUM(amount) FROM transactions
                   WHERE user_id=$1 AND type='expense'
                     AND date >= NOW() - INTERVAL '30 days'), 0) * 100, 1
         ) AS pct_of_total
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE t.user_id=$1
         AND t.type='expense'
         AND t.date >= NOW() - INTERVAL '30 days'
         AND c.name = ANY($2::text[])
       GROUP BY c.id, c.name, c.icon, c.color
       ORDER BY total DESC`,
      [userId, AI_CATEGORIES]
    );

    // 4. Recurring Patterns (merchant yang sering muncul)
    const recurring = await query(
      `SELECT
         merchant_name,
         COUNT(*)::int                    AS occurrences,
         ROUND(AVG(amount))::int          AS avg_amount,
         MAX(date)                        AS last_date
       FROM transactions
       WHERE user_id=$1 AND type='expense' AND date >= NOW() - INTERVAL '90 days'
         AND merchant_name IS NOT NULL
       GROUP BY merchant_name
       HAVING COUNT(*) >= 2
       ORDER BY occurrences DESC
       LIMIT 5`,
      [userId]
    );

    // 5. AI Forecasting dari FastAPI tim AI
    let forecast = null;
    let forecastError = null;
    try {
      const weeklyHistory = await getWeeklyHistoryForAI(userId);
      const forecastResult = await aiService.predictSpending(weeklyHistory);
      if (forecastResult.success) {
        forecast = {
          next_week:       forecastResult.forecast,
          total_predicted: forecastResult.total_predicted,
          source:          'ai_model', // bukan simulasi
        };
      } else {
        forecastError = forecastResult.error;
      }
    } catch (err) {
      forecastError = err.message;
      console.error('[Analysis] Forecast error:', err.message);
    }

    // 6. AI Insights (rule-based dari DB + akan digabung dengan output model)
    const insights = await generateInsights(userId);

    return success(res, {
      cash_flow:          cashFlow.rows,
      heatmap:            heatmap.rows,
      spending_clusters:  clusters.rows,
      recurring_patterns: recurring.rows,
      forecast: forecast || {
        next_week:       null,
        total_predicted: null,
        source:          'unavailable',
        error:           forecastError,
      },
      insights,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Rule-based insights dari data DB
 * Dapat digabungkan dengan output Gemini dari tim AI nantinya
 */
const generateInsights = async (userId) => {
  const insights = [];

  // Deteksi lonjakan pengeluaran per kategori
  const unusual = await query(
    `SELECT
       c.name,
       SUM(CASE WHEN t.date >= NOW() - INTERVAL '7 days'
                THEN t.amount ELSE 0 END) AS this_week,
       SUM(CASE WHEN t.date >= NOW() - INTERVAL '14 days'
                AND t.date  <  NOW() - INTERVAL '7 days'
                THEN t.amount ELSE 0 END) AS last_week
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     WHERE t.user_id=$1 AND t.type='expense' AND c.name = ANY($2::text[])
     GROUP BY c.id, c.name
     HAVING
       SUM(CASE WHEN t.date >= NOW() - INTERVAL '7 days' THEN t.amount ELSE 0 END) >
       SUM(CASE WHEN t.date >= NOW() - INTERVAL '14 days'
               AND t.date  <  NOW() - INTERVAL '7 days' THEN t.amount ELSE 0 END) * 1.3
       AND SUM(CASE WHEN t.date >= NOW() - INTERVAL '7 days' THEN t.amount ELSE 0 END) > 0
     LIMIT 3`,
    [userId, AI_CATEGORIES]
  );

  for (const row of unusual.rows) {
    const pct = row.last_week > 0
      ? Math.round(((row.this_week - row.last_week) / row.last_week) * 100)
      : 100;
    insights.push({
      type:    'warning',
      title:   'Unusual Spending Detected',
      message: `Pengeluaran ${row.name} naik ${pct}% dibanding minggu lalu.`,
      action:  'View Transactions',
      category: row.name,
    });
  }

  // Budget hampir habis
  const nearLimit = await query(
    `SELECT b.name, b.amount, COALESCE(SUM(t.amount),0) AS spent
     FROM budgets b
     LEFT JOIN transactions t
       ON t.category_id=b.category_id AND t.user_id=b.user_id
      AND t.type='expense' AND t.date >= b.start_date
     WHERE b.user_id=$1
     GROUP BY b.id, b.name, b.amount
     HAVING COALESCE(SUM(t.amount),0) / NULLIF(b.amount,0) >= 0.8`,
    [userId]
  );

  for (const row of nearLimit.rows) {
    const pct = Math.round((row.spent / row.amount) * 100);
    insights.push({
      type:    pct >= 100 ? 'danger' : 'info',
      title:   pct >= 100 ? 'Budget Terlampaui!' : 'Budget Hampir Habis',
      message: `"${row.name}" sudah terpakai ${pct}% dari limit.`,
      action:  'Adjust Budget',
    });
  }

  // Saran hemat default
  insights.push({
    type:    'tip',
    title:   'Smart Savings Tip',
    message: 'Coba tetapkan limit harian agar lebih mudah mengontrol pengeluaran mingguan.',
    action:  'Set Budget',
    source:  'system',
  });

  return insights;
};

/**
 * GET /api/v1/analysis/unusual-spending
 * Deteksi anomali belanja
 */
const getUnusualSpending = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         c.name AS category,
         t.merchant_name,
         t.amount,
         t.date,
         AVG(t2.amount) OVER (PARTITION BY t.category_id) AS avg_amount,
         ROUND(
           (t.amount - AVG(t2.amount) OVER (PARTITION BY t.category_id)) /
           NULLIF(AVG(t2.amount) OVER (PARTITION BY t.category_id),0) * 100, 1
         ) AS deviation_pct
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       JOIN transactions t2 ON t2.category_id=t.category_id AND t2.user_id=t.user_id
       WHERE t.user_id=$1 AND t.type='expense' AND t.date >= NOW() - INTERVAL '30 days'
         AND c.name = ANY($2::text[])
       GROUP BY t.id, c.name
       HAVING t.amount > AVG(t2.amount) * 1.5
       ORDER BY deviation_pct DESC
       LIMIT 5`,
      [req.user.id, AI_CATEGORIES]
    );
    return success(res, result.rows);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/analysis/forecast
 * Endpoint khusus untuk prediksi spending minggu depan via AI FastAPI
 */
const getForecast = async (req, res, next) => {
  try {
    const weeklyHistory = await getWeeklyHistoryForAI(req.user.id);
    const result = await aiService.predictSpending(weeklyHistory);

    if (!result.success) {
      return res.status(503).json({
        success: false,
        message: 'AI Forecasting service tidak tersedia saat ini',
        error: result.error,
      });
    }

    return success(res, {
      forecast:        result.forecast,
      total_predicted: result.total_predicted,
      categories:      AI_CATEGORIES,
      source:          'ai_model',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/analysis/ai-health
 * Cek status FastAPI tim AI
 */
const getAIHealth = async (req, res, next) => {
  try {
    const status = await aiService.checkAIHealth();
    return success(res, {
      ai_service: status,
      ai_url:     process.env.AI_SERVICE_URL || 'http://localhost:8000',
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDashboardOverview,
  getAnalysis,
  getUnusualSpending,
  getForecast,
  getAIHealth,
};

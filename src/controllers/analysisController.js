const { query } = require('../config/database');
const { success } = require('../utils/response');
const aiService = require('../services/aiService');
const env = require('../config/env');

// 8 categories the ai forecaster recognizes; order matches lstm input
const AI_CATEGORIES = ['Beauty', 'F&B', 'Gas', 'Groceries', 'Health', 'HouseHold', 'Lifestyle', 'Listrik'];

// build 12 weeks x 8 categories array for the forecast model
const getWeeklyHistoryForAI = async (userId) => {
  const result = await query(
    `SELECT
       EXTRACT(WEEK FROM date)::int AS week_num,
       EXTRACT(YEAR FROM date)::int AS year_num,
       c.name                       AS category,
       SUM(t.amount)                AS total
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

  // zero pad week number so string sort matches chronological order
  const weekKey = (year, week) => `${year}-W${String(week).padStart(2, '0')}`;

  const weekMap = {};
  for (const row of result.rows) {
    const key = weekKey(row.year_num, row.week_num);
    if (!weekMap[key]) weekMap[key] = { week: key };
    weekMap[key][row.category] = parseFloat(row.total);
  }

  const weeks = Object.keys(weekMap)
    .sort()
    .map((k) => {
      const entry = { week: k };
      for (const cat of AI_CATEGORIES) entry[cat] = weekMap[k][cat] || 0;
      return entry;
    });

  while (weeks.length < 12) {
    const filler = Object.fromEntries(AI_CATEGORIES.map((c) => [c, 0]));
    weeks.unshift({ week: `pad-${weeks.length}`, ...filler });
  }
  return weeks.slice(-12);
};

const pctChange = (current, previous) =>
  previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0;

// Internal Helper: Dashboard
const _fetchDashboard = async (userId, filterQuery) => {
  const now = new Date();
  const m = now.getMonth() + 1;
  const y = now.getFullYear();
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;

  const [summaryRes, prevRes, walletRes, recentRes, budgetRes, growthRes, categoryRes] = await Promise.all([
    query(
      `SELECT
         COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS expense,
         COUNT(*)::int AS tx_count
       FROM transactions
       WHERE user_id=$1 AND EXTRACT(MONTH FROM date)=$2 AND EXTRACT(YEAR FROM date)=$3`,
      [userId, m, y]
    ),
    query(
      `SELECT
         COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE user_id=$1 AND EXTRACT(MONTH FROM date)=$2 AND EXTRACT(YEAR FROM date)=$3`,
      [userId, prevM, prevY]
    ),
    query(`SELECT COALESCE(SUM(balance), 0) AS total_balance FROM wallets WHERE user_id=$1`, [userId]),
    query(
      `SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
              w.name AS wallet_name, w.type AS wallet_type
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN wallets w    ON w.id = t.wallet_id
       WHERE t.user_id = $1
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT 5`,
      [userId]
    ),
    query(
      `SELECT b.id, b.name, b.amount,
              COALESCE(SUM(t.amount), 0) AS spent,
              ROUND(COALESCE(SUM(t.amount), 0) / NULLIF(b.amount, 0) * 100, 0) AS percentage
       FROM budgets b
       LEFT JOIN transactions t
         ON t.category_id = b.category_id
        AND t.user_id     = b.user_id
        AND t.type        = 'expense'
        AND t.date        >= b.start_date
        AND (b.end_date IS NULL OR t.date <= b.end_date)
       WHERE b.user_id = $1
       GROUP BY b.id, b.name, b.amount
       ORDER BY percentage DESC
       LIMIT 5`,
      [userId]
    ),
    query(
      `SELECT
         TO_CHAR(date_trunc('month', date), 'Mon') AS month,
         date_trunc('month', date) AS period,
         SUM(CASE WHEN type='income' THEN amount ELSE -amount END) AS net
       FROM transactions
       WHERE user_id = $1 AND date >= NOW() - INTERVAL '7 months'
       GROUP BY date_trunc('month', date)
       ORDER BY period ASC`,
      [userId]
    ),
    query(
      `SELECT id, name, icon, color, type, is_system
       FROM categories
       WHERE user_id = $1 OR is_system = true
       ORDER BY is_system DESC, name ASC`,
      [userId]
    ),
  ]);

  const cur = summaryRes.rows[0];
  const prev = prevRes.rows[0];

  return {
    balance: {
      total: walletRes.rows[0].total_balance,
      income: cur.income,
      expense: cur.expense,
      income_change_pct: pctChange(cur.income, prev.income),
      expense_change_pct: pctChange(cur.expense, prev.expense),
      transaction_count: cur.tx_count,
    },
    recent_transactions: recentRes.rows,
    budgets: budgetRes.rows,
    wealth_growth: growthRes.rows,
    categories: categoryRes.rows,
  };
};

// rule-based insights derived from db; can be augmented with ai output later
const generateInsights = async (userId) => {
  const insights = [];

  const unusual = await query(
    `SELECT c.name,
            SUM(CASE WHEN t.date >= NOW() - INTERVAL '7 days' THEN t.amount ELSE 0 END) AS this_week,
            SUM(CASE WHEN t.date >= NOW() - INTERVAL '14 days'
                     AND t.date  <  NOW() - INTERVAL '7 days' THEN t.amount ELSE 0 END) AS last_week
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = $1 AND t.type = 'expense' AND c.name = ANY($2::text[])
      GROUP BY c.id, c.name
     HAVING SUM(CASE WHEN t.date >= NOW() - INTERVAL '7 days' THEN t.amount ELSE 0 END) >
            SUM(CASE WHEN t.date >= NOW() - INTERVAL '14 days'
                     AND t.date <  NOW() - INTERVAL '7 days' THEN t.amount ELSE 0 END) * 1.3
        AND SUM(CASE WHEN t.date >= NOW() - INTERVAL '7 days' THEN t.amount ELSE 0 END) > 0
      LIMIT 3`,
    [userId, AI_CATEGORIES]
  );

  for (const row of unusual.rows) {
    const pct = row.last_week > 0
      ? Math.round(((row.this_week - row.last_week) / row.last_week) * 100)
      : 100;
    insights.push({
      type: 'warning',
      title: 'Unusual Spending Detected',
      message: `Your ${row.name} spending is up ${pct}% from last week.`,
      action: 'View Transactions',
      category: row.name,
    });
  }

  const nearLimit = await query(
    `SELECT b.name, b.amount, COALESCE(SUM(t.amount), 0) AS spent
       FROM budgets b
       LEFT JOIN transactions t
         ON t.category_id = b.category_id AND t.user_id = b.user_id
        AND t.type = 'expense' AND t.date >= b.start_date
      WHERE b.user_id = $1
      GROUP BY b.id, b.name, b.amount
     HAVING COALESCE(SUM(t.amount), 0) / NULLIF(b.amount, 0) >= 0.8`,
    [userId]
  );

  for (const row of nearLimit.rows) {
    const pct = Math.round((row.spent / row.amount) * 100);
    insights.push({
      type: pct >= 100 ? 'danger' : 'info',
      title: pct >= 100 ? 'Budget Exceeded' : 'Budget Almost Reached',
      message: `"${row.name}" has used ${pct}% of its limit.`,
      action: 'Adjust Budget',
    });
  }

  insights.push({
    type: 'tip',
    title: 'Smart Savings Tip',
    message: 'Set a daily limit to keep weekly spending under control.',
    action: 'Set Budget',
    source: 'system',
  });

  return insights;
};

// Internal Helper: Forecast
const _fetchForecast = async (userId) => {
  let forecast = null;
  let forecastError = null;
  let weeklyHistory = [];
  try {
    weeklyHistory = await getWeeklyHistoryForAI(userId);
    const result = await aiService.predictSpending(weeklyHistory);
    if (result.success) {
      forecast = {
        next_week: result.forecast,
        total_predicted: result.total_predicted,
        categories: AI_CATEGORIES,
        source: 'ai_model',
      };
    } else {
      forecastError = result.error;
    }
  } catch (err) {
    forecastError = err.message;
    console.error('[analysis] forecast error:', err.message);
  }

  return { forecast, forecastError, weeklyHistory };
};

// Internal Helper: Insights Data
const _fetchAnalysis = async (userId, filterQuery, forecastData) => {
  const [cashFlow, heatmap, clusters, recurring] = await Promise.all([
    query(
      `SELECT
         TO_CHAR(date_trunc('month', date), 'Mon YYYY') AS label,
         date_trunc('month', date) AS period,
         COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE user_id = $1 AND date >= NOW() - INTERVAL '6 months'
       GROUP BY date_trunc('month', date)
       ORDER BY period ASC`,
      [userId]
    ),
    query(
      `SELECT EXTRACT(DOW FROM date)::int AS dow,
              TO_CHAR(date, 'Day') AS day_name,
              COUNT(*)::int AS tx_count,
              COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE user_id = $1 AND type = 'expense' AND date >= NOW() - INTERVAL '90 days'
       GROUP BY EXTRACT(DOW FROM date)
       ORDER BY dow`,
      [userId]
    ),
    query(
      `SELECT c.name, c.icon, c.color,
              COUNT(t.id)::int AS frequency,
              COALESCE(SUM(t.amount), 0) AS total,
              ROUND(
                COALESCE(SUM(t.amount), 0) /
                NULLIF((SELECT SUM(amount) FROM transactions
                        WHERE user_id = $1 AND type = 'expense'
                          AND date >= NOW() - INTERVAL '30 days'), 0) * 100, 1
              ) AS pct_of_total
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = $1
         AND t.type = 'expense'
         AND t.date >= NOW() - INTERVAL '30 days'
         AND c.name = ANY($2::text[])
       GROUP BY c.id, c.name, c.icon, c.color
       ORDER BY total DESC`,
      [userId, AI_CATEGORIES]
    ),
    query(
      `SELECT merchant_name,
              COUNT(*)::int AS occurrences,
              ROUND(AVG(amount))::int AS avg_amount,
              MAX(date) AS last_date
       FROM transactions
       WHERE user_id = $1 AND type = 'expense'
         AND date >= NOW() - INTERVAL '90 days'
         AND merchant_name IS NOT NULL
       GROUP BY merchant_name
       HAVING COUNT(*) >= 2
       ORDER BY occurrences DESC
       LIMIT 5`,
      [userId]
    ),
  ]);

  const insights = await generateInsights(userId);
  const { forecast, forecastError, weeklyHistory } = forecastData;

  // Fetch Gemini AI insight if forecast was successful
  if (forecast && !forecastError) {
    try {
      const insightRes = await aiService.getFinancialInsight({
        history: weeklyHistory,
        forecast: forecast.next_week,
        total_predicted: forecast.total_predicted,
      });

      if (insightRes.success) {
        if (insightRes.insight) {
          insights.unshift({
            type: 'info',
            title: 'Gemini AI Insight',
            message: insightRes.insight,
            source: 'gemini',
          });
        }
        if (insightRes.insights && insightRes.insights.length > 0) {
          insightRes.insights.forEach(item => insights.unshift({
            type: item.type || 'info',
            title: item.title || 'Gemini AI Insight',
            message: item.message || item,
            source: 'gemini',
          }));
        }
      }
    } catch (err) {
      console.error('[analysis] gemini insight error:', err.message);
    }
  }

  return {
    cash_flow: cashFlow.rows,
    heatmap: heatmap.rows,
    spending_clusters: clusters.rows,
    recurring_patterns: recurring.rows,
    insights,
  };
};

// Internal Helper: Unusual Spending
const _fetchUnusualSpending = async (userId, filterQuery) => {
  const result = await query(
    `WITH CategoryAverages AS (
       SELECT category_id, AVG(amount) AS avg_amount
       FROM transactions
       WHERE user_id = $1 AND type = 'expense'
       GROUP BY category_id
     )
     SELECT c.name AS category,
            t.merchant_name,
            t.amount,
            t.date,
            ca.avg_amount,
            ROUND(
              (t.amount - ca.avg_amount) / NULLIF(ca.avg_amount, 0) * 100, 1
            ) AS deviation_pct
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     JOIN CategoryAverages ca ON ca.category_id = t.category_id
     WHERE t.user_id = $1 AND t.type = 'expense'
       AND t.date >= NOW() - INTERVAL '30 days'
       AND c.name = ANY($2::text[])
       AND t.amount > ca.avg_amount * 1.5
     ORDER BY deviation_pct DESC
     LIMIT 5`,
    [userId, AI_CATEGORIES]
  );
  return result.rows;
};

// Main Exported Unified Controller
const getFullAnalysisSummary = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const filterQuery = req.query; // pass this down to helpers

    // To optimize, some helpers depend on others or can run entirely in parallel.
    // _fetchAnalysis depends on forecastData for Gemini insights.
    
    // We start all independent promises
    const pDashboard = _fetchDashboard(userId, filterQuery);
    const pUnusual = _fetchUnusualSpending(userId, filterQuery);
    const pForecast = _fetchForecast(userId, filterQuery);
    const pAiHealth = aiService.checkAIHealth();

    // Await forecast to pass into analysis for Gemini
    const forecastData = await pForecast;
    const pAnalysis = _fetchAnalysis(userId, filterQuery, forecastData);

    // Wait for all to complete
    const [dashboard, unusual_spending, ai_health, analysis] = await Promise.all([
      pDashboard,
      pUnusual,
      pAiHealth,
      pAnalysis
    ]);

    return success(res, {
      dashboard,
      insights: {
        cash_flow: analysis.cash_flow,
        heatmap: analysis.heatmap,
        spending_clusters: analysis.spending_clusters,
        recurring_patterns: analysis.recurring_patterns,
        insights_list: analysis.insights,
      },
      unusual_spending,
      forecast: forecastData.forecast || {
        next_week: null,
        total_predicted: null,
        categories: AI_CATEGORIES,
        source: 'unavailable',
        error: forecastData.forecastError,
      },
      ai_health: { ai_service: ai_health, ai_url: env.aiBaseUrl }
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  getFullAnalysisSummary,
};

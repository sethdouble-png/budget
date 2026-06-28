require('dotenv').config();
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const requiredEnv = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missingEnv = requiredEnv.filter(name => !process.env[name]);
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
let supabaseAdmin = null;

function initializeSupabase() {
  if (supabase) return;
  if (missingEnv.length > 0) {
    const message = `Missing required environment variables: ${missingEnv.join(', ')}`;
    console.error('[ERROR]', message);
    throw new Error(message);
  }

  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  if (serviceRoleKey) {
    supabaseAdmin = createClient(process.env.SUPABASE_URL, serviceRoleKey);
  }
}

function db() {
  initializeSupabase();
  return supabaseAdmin || supabase;
}

if (missingEnv.length > 0 && require.main === module) {
  process.exit(1);
}

async function getActiveGroupId(userId) {
  const { data, error } = await db()
    .from('settings')
    .select('value')
    .eq('user_id', userId)
    .eq('key', 'active_group_id')
    .maybeSingle();

  if (error) return null;
  if (data?.value) return data.value;

  const membership = await db()
    .from('group_memberships')
    .select('group_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  return membership?.group_id || null;
}

function addInterval(dateStr, frequency) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;

  switch (frequency) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
    default:
      return null;
  }

  return d.toISOString().slice(0, 10);
}

async function processDueRecurring(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: recurringEntries, error } = await db()
    .from('recurring_transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (error || !Array.isArray(recurringEntries)) return;
  const activeGroupId = await getActiveGroupId(userId);

  for (const entry of recurringEntries) {
    const startDate = entry.start_date;
    if (!startDate || startDate > today) continue;

    let nextRun = entry.last_run_date || entry.start_date;
    if (nextRun < entry.start_date) nextRun = entry.start_date;

    const created = [];
    while (nextRun && nextRun <= today) {
      const existing = await db()
        .from('transactions')
        .select('id')
        .eq('user_id', userId)
        .eq('date', nextRun)
        .eq('type', entry.type)
        .eq('category', entry.category)
        .eq('amount', entry.amount)
        .maybeSingle();

      if (!existing?.id) {
        created.push({
          user_id: userId,
          group_id: activeGroupId,
          date: nextRun,
          amount: entry.amount,
          type: entry.type,
          category: entry.category,
          note: entry.note || ''
        });
      }

      nextRun = addInterval(nextRun, entry.frequency);
    }

    if (created.length) {
      await db().from('transactions').insert(created);
      const lastRun = created[created.length - 1].date;
      await db()
        .from('recurring_transactions')
        .update({ last_run_date: lastRun })
        .eq('id', entry.id);
    }
  }
}

const isProduction = process.env.NODE_ENV === 'production';
const corsOptions = process.env.CORS_ORIGIN
  ? { origin: process.env.CORS_ORIGIN.split(',').map(o => o.trim()), credentials: true }
  : undefined;

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

app.use(helmet());
app.use(cors(corsOptions));
app.use(limiter);
app.use(bodyParser.json());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});
if (isProduction) {
  app.set('trust proxy', 1);
}
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to get user from auth header
async function getUserFromToken(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  req.user = data.user;
  next();
}

// ===== AUTH ENDPOINTS =====
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password
      });
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ user: data.user, session: null });
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ user: data.user, session: data.session });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ user: data.user, session: data.session });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true });
});

app.get('/api/auth/me', getUserFromToken, async (req, res) => {
  res.json({ user: req.user });
});

// ===== TRANSACTIONS ENDPOINTS =====
app.get('/api/transactions', getUserFromToken, async (req, res) => {
  const { startDate, endDate, category, type, search } = req.query;
  const activeGroupId = await getActiveGroupId(req.user.id);

  await processDueRecurring(req.user.id);

  let query = db()
    .from('transactions')
    .select('*')
    .order('date', { ascending: false });

  if (activeGroupId) {
    query = query.or(`user_id.eq.${req.user.id},group_id.eq.${activeGroupId}`);
  } else {
    query = query.eq('user_id', req.user.id);
  }

  if (startDate) query = query.gte('date', startDate);
  if (endDate) query = query.lte('date', endDate);
  if (category) query = query.eq('category', category);
  if (type) query = query.eq('type', type);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  const results = Array.isArray(data) ? data : [];

  if (search) {
    const lowerSearch = search.toLowerCase();
    return res.json(results.filter(t => 
      t.category.toLowerCase().includes(lowerSearch) ||
      t.note?.toLowerCase().includes(lowerSearch) ||
      t.amount.toString().includes(lowerSearch)
    ));
  }
  
  res.json(results);
});

app.post('/api/transactions', getUserFromToken, async (req, res) => {
  const { date, amount, type, category, note } = req.body;
  if (!date || amount == null || !type) {
    return res.status(400).json({ error: 'date, amount, and type are required' });
  }

  const activeGroupId = await getActiveGroupId(req.user.id);
  const { data, error } = await db()
    .from('transactions')
    .insert([{ date, amount, type, category, note, user_id: req.user.id, group_id: activeGroupId }])
    .select();
  
  if (error) return res.status(400).json({ error: error.message });
  if (!Array.isArray(data) || !data.length) return res.status(500).json({ error: 'Transaction insert failed' });
  res.json(data[0]);
});

app.put('/api/transactions/:id', getUserFromToken, async (req, res) => {
  const { id } = req.params;
  const { date, amount, type, category, note } = req.body;

  const { data, error } = await db()
    .from('transactions')
    .update({ date, amount, type, category, note })
    .eq('id', id)
    .eq('user_id', req.user.id)
    .select();
  
  if (error) return res.status(400).json({ error: error.message });
  if (!Array.isArray(data) || !data.length) return res.status(404).json({ error: 'Transaction not found' });
  res.json(data[0]);
});

app.delete('/api/transactions/:id', getUserFromToken, async (req, res) => {
  const { id } = req.params;

  const { data, error } = await db()
    .from('transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', req.user.id)
    .select();
  
  if (error) return res.status(400).json({ error: error.message });
  if (!Array.isArray(data) || !data.length) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ success: true });
});

// ===== SUMMARY ENDPOINT =====
app.get('/api/summary', getUserFromToken, async (req, res) => {
  try {
    const activeGroupId = await getActiveGroupId(req.user.id);
    let txQuery = db().from('transactions').select('*');

    if (activeGroupId) {
      txQuery = txQuery.or(`user_id.eq.${req.user.id},group_id.eq.${activeGroupId}`);
    } else {
      txQuery = txQuery.eq('user_id', req.user.id);
    }

    const { data: transactions, error: transactionsError } = await txQuery;
    if (transactionsError) return res.status(400).json({ error: transactionsError.message });
    const safeTransactions = Array.isArray(transactions) ? transactions : [];

    const { data: settingsData, error: settingsError } = await db()
      .from('settings')
      .select('*')
      .eq('user_id', req.user.id);

    if (settingsError) return res.status(400).json({ error: settingsError.message });
    const safeSettings = Array.isArray(settingsData) ? settingsData : [];

    const income = safeTransactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    
    const expense = safeTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    const savings = income - expense;
    const settingsMap = {};
    safeSettings.forEach(s => settingsMap[s.key] = s.value);

    res.json({
      income,
      expense,
      savings,
      monthly_budget: settingsMap.monthly_budget ? Number(settingsMap.monthly_budget) : 0,
      currency: settingsMap.currency || 'USD'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== SETTINGS ENDPOINTS =====
app.post('/api/budget', getUserFromToken, async (req, res) => {
  const { monthly_budget } = req.body;
  if (monthly_budget == null) return res.status(400).json({ error: 'monthly_budget required' });
  // Atomic upsert to avoid duplicate-key races
  const { data, error } = await db()
    .from('settings')
    .upsert(
      [{ user_id: req.user.id, key: 'monthly_budget', value: String(monthly_budget) }],
      { onConflict: 'user_id,key' }
    )
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ monthly_budget: Number(monthly_budget) });
});

app.post('/api/currency', getUserFromToken, async (req, res) => {
  const { currency } = req.body;
  if (!currency) return res.status(400).json({ error: 'currency required' });
  // Atomic upsert to set or replace currency setting
  const { data, error } = await db()
    .from('settings')
    .upsert(
      [{ user_id: req.user.id, key: 'currency', value: currency }],
      { onConflict: 'user_id,key' }
    )
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ currency });
});

app.post('/api/import/transactions', getUserFromToken, async (req, res) => {
  const records = req.body.records;
  if (!Array.isArray(records) || !records.length) {
    return res.status(400).json({ error: 'records are required' });
  }

  const activeGroupId = await getActiveGroupId(req.user.id);
  const inserts = records.map(record => ({
    user_id: req.user.id,
    group_id: activeGroupId,
    date: record.date,
    amount: Number(record.amount),
    type: record.type,
    category: record.category,
    note: record.note || ''
  })).filter(row => row.date && !Number.isNaN(row.amount) && ['income','expense'].includes(row.type) && row.category);

  if (!inserts.length) {
    return res.status(400).json({ error: 'No valid records to import' });
  }

  const { data, error } = await db()
    .from('transactions')
    .insert(inserts)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ imported: Array.isArray(data) ? data.length : 0 });
});

app.post('/api/group/create', getUserFromToken, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Group name is required' });

  const code = `G-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const { data: group, error: groupError } = await db()
    .from('groups')
    .insert([{ name, code }])
    .select()
    .single();

  if (groupError) return res.status(400).json({ error: groupError.message });

  const { error: membershipError } = await db()
    .from('group_memberships')
    .insert([{ user_id: req.user.id, group_id: group.id }]);

  if (membershipError) return res.status(400).json({ error: membershipError.message });

  await db()
    .from('settings')
    .upsert([{ user_id: req.user.id, key: 'active_group_id', value: group.id }], { onConflict: 'user_id,key' });

  res.json({ group });
});

app.post('/api/group/join', getUserFromToken, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Group invite code is required' });

  const { data: group, error: groupError } = await db()
    .from('groups')
    .select('*')
    .eq('code', code)
    .maybeSingle();

  if (groupError || !group) return res.status(400).json({ error: 'Group not found' });

  const { error: membershipError } = await db()
    .from('group_memberships')
    .upsert([{ user_id: req.user.id, group_id: group.id }], { onConflict: 'user_id,group_id' });

  if (membershipError) return res.status(400).json({ error: membershipError.message });

  await db()
    .from('settings')
    .upsert([{ user_id: req.user.id, key: 'active_group_id', value: group.id }], { onConflict: 'user_id,key' });

  res.json({ group });
});

app.get('/api/group', getUserFromToken, async (req, res) => {
  const activeGroupId = await getActiveGroupId(req.user.id);
  if (!activeGroupId) return res.json({ group: null, members: [] });

  const { data: group, error: groupError } = await db()
    .from('groups')
    .select('*')
    .eq('id', activeGroupId)
    .maybeSingle();

  if (groupError || !group) return res.status(400).json({ error: 'Group not found' });

  const { data: members, error: membersError } = await db()
    .from('group_memberships')
    .select('user_id')
    .eq('group_id', activeGroupId);

  if (membersError) return res.status(400).json({ error: membersError.message });

  res.json({ group, members: Array.isArray(members) ? members.map(m => m.user_id) : [] });
});

app.get('/api/rates', async (req, res) => {
  try {
    const response = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=USD,AED,UGX');
    if (!response.ok) {
      return res.status(502).json({ error: 'Unable to fetch exchange rates' });
    }
    const data = await response.json();
    res.json({ rates: data.rates || {} });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== ANALYTICS ENDPOINTS =====
app.get('/api/analytics/categories', getUserFromToken, async (req, res) => {
  const { startDate, endDate } = req.query;
  const activeGroupId = await getActiveGroupId(req.user.id);

  let query = db()
    .from('transactions')
    .select('*')
    .eq('type', 'expense');

  if (activeGroupId) {
    query = query.or(`user_id.eq.${req.user.id},group_id.eq.${activeGroupId}`);
  } else {
    query = query.eq('user_id', req.user.id);
  }

  if (startDate) query = query.gte('date', startDate);
  if (endDate) query = query.lte('date', endDate);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });

  const categories = {};
  data.forEach(t => {
    categories[t.category] = (categories[t.category] || 0) + t.amount;
  });

  const result = Object.entries(categories).map(([category, total]) => ({
    category,
    total,
    percentage: ((total / Object.values(categories).reduce((a, b) => a + b, 1)) * 100).toFixed(2)
  }));

  res.json(result);
});

app.get('/api/analytics/monthly', getUserFromToken, async (req, res) => {
  const activeGroupId = await getActiveGroupId(req.user.id);
  let query = db().from('transactions').select('*');

  if (activeGroupId) {
    query = query.or(`user_id.eq.${req.user.id},group_id.eq.${activeGroupId}`);
  } else {
    query = query.eq('user_id', req.user.id);
  }

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });

  const monthly = {};
  data.forEach(t => {
    const month = t.date.substring(0, 7);
    if (!monthly[month]) monthly[month] = { income: 0, expense: 0, savings: 0 };
    if (t.type === 'income') monthly[month].income += t.amount;
    else monthly[month].expense += t.amount;
    monthly[month].savings = monthly[month].income - monthly[month].expense;
  });

  const result = Object.entries(monthly)
    .sort()
    .map(([month, data]) => ({ month, ...data }));

  res.json(result);
});

// ===== RECURRING TRANSACTIONS ENDPOINTS =====
app.get('/api/recurring', getUserFromToken, async (req, res) => {
  const { data, error } = await db()
    .from('recurring_transactions')
    .select('*')
    .eq('user_id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json(Array.isArray(data) ? data : []);
});

app.post('/api/recurring', getUserFromToken, async (req, res) => {
  const { amount, type, category, note, frequency, start_date, end_date } = req.body;
  
  const { data, error } = await db()
    .from('recurring_transactions')
    .insert([{
      user_id: req.user.id,
      amount,
      type,
      category,
      note,
      frequency,
      start_date,
      end_date,
      is_active: true
    }])
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data[0]);
});

app.put('/api/recurring/:id', getUserFromToken, async (req, res) => {
  const { id } = req.params;
  const { amount, type, category, note, frequency, start_date, end_date, is_active } = req.body;

  const { data, error } = await db()
    .from('recurring_transactions')
    .update({ amount, type, category, note, frequency, start_date, end_date, is_active })
    .eq('id', id)
    .eq('user_id', req.user.id)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  if (!data.length) return res.status(404).json({ error: 'Recurring transaction not found' });
  res.json(data[0]);
});

app.delete('/api/recurring/:id', getUserFromToken, async (req, res) => {
  const { id } = req.params;

  const { data, error } = await db()
    .from('recurring_transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// ===== EXPORT ENDPOINTS =====
function convertToCSV(rows, headers) {
  if (!rows || rows.length === 0) return headers.join(',') + '\n';
  const csv = [headers.join(',')];
  rows.forEach(row => {
    const values = headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return '';
      return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
    });
    csv.push(values.join(','));
  });
  return csv.join('\n');
}

app.get('/api/export/transactions', getUserFromToken, async (req, res) => {
  const { data, error } = await db()
    .from('transactions')
    .select('*')
    .eq('user_id', req.user.id)
    .order('date', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  const headers = ['Date', 'Amount', 'Type', 'Category', 'Note'];
  const csvData = convertToCSV(data, ['date', 'amount', 'type', 'category', 'note']);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
  res.send(csvData);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Seth and Paula finances server listening on http://localhost:${PORT}`);
  });
}

module.exports = app;

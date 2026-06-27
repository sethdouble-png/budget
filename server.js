const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'finance.db');
const db = new sqlite3.Database(DB_PATH);

function initDb() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      amount REAL,
      type TEXT,
      category TEXT,
      note TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
  });
}

initDb();

app.get('/api/transactions', (req, res) => {
  db.all('SELECT * FROM transactions ORDER BY date DESC, id DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/transactions', (req, res) => {
  const { date, amount, type, category, note } = req.body;
  if (!date || !amount || !type) return res.status(400).json({ error: 'date, amount and type are required' });
  const stmt = db.prepare('INSERT INTO transactions (date, amount, type, category, note) VALUES (?, ?, ?, ?, ?)');
  stmt.run(date, amount, type, category || '', note || '', function(err) {
    if (err) return res.status(500).json({ error: err.message });
    db.get('SELECT * FROM transactions WHERE id = ?', [this.lastID], (err2, row) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json(row);
    });
  });
});

app.get('/api/summary', (req, res) => {
  db.serialize(() => {
    db.get("SELECT IFNULL(SUM(amount),0) AS income FROM transactions WHERE type='income'", (err1, incomeRow) => {
      if (err1) return res.status(500).json({ error: err1.message });
      db.get("SELECT IFNULL(SUM(amount),0) AS expense FROM transactions WHERE type='expense'", (err2, expenseRow) => {
        if (err2) return res.status(500).json({ error: err2.message });
        db.all("SELECT key, value FROM settings WHERE key IN ('monthly_budget', 'currency')", (err3, settingsRows) => {
          if (err3) return res.status(500).json({ error: err3.message });
          const income = incomeRow ? incomeRow.income : 0;
          const expense = expenseRow ? expenseRow.expense : 0;
          const savings = income - expense;
          const settings = settingsRows || [];
          const monthly_budget = (settings.find(s => s.key === 'monthly_budget')?.value) ? Number(settings.find(s => s.key === 'monthly_budget').value) : 0;
          const currency = settings.find(s => s.key === 'currency')?.value || 'USD';
          res.json({ income, expense, savings, monthly_budget, currency });
        });
      });
    });
  });
});

app.post('/api/budget', (req, res) => {
  const { monthly_budget } = req.body;
  if (monthly_budget == null) return res.status(400).json({ error: 'monthly_budget required' });
  const val = String(monthly_budget);
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  stmt.run('monthly_budget', val, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ monthly_budget: Number(val) });
  });
});

app.post('/api/currency', (req, res) => {
  const { currency } = req.body;
  if (!currency) return res.status(400).json({ error: 'currency required' });
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  stmt.run('currency', currency, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ currency });
  });
});

// Export endpoints
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

app.get('/api/export/transactions', (req, res) => {
  db.all('SELECT * FROM transactions ORDER BY date DESC, id DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const headers = ['Date', 'Amount', 'Type', 'Category', 'Note'];
    const csvData = convertToCSV(rows, ['date', 'amount', 'type', 'category', 'note']);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.send(csvData);
  });
});

app.get('/api/export/income', (req, res) => {
  db.all("SELECT * FROM transactions WHERE type='income' ORDER BY date DESC, id DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const headers = ['Date', 'Amount', 'Category', 'Note'];
    const csvData = convertToCSV(rows, ['date', 'amount', 'category', 'note']);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="income.csv"');
    res.send(csvData);
  });
});

app.get('/api/export/expenses', (req, res) => {
  db.all("SELECT * FROM transactions WHERE type='expense' ORDER BY date DESC, id DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const headers = ['Date', 'Amount', 'Category', 'Note'];
    const csvData = convertToCSV(rows, ['date', 'amount', 'category', 'note']);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="expenses.csv"');
    res.send(csvData);
  });
});

app.get('/api/export/summary', (req, res) => {
  db.serialize(() => {
    db.get("SELECT IFNULL(SUM(amount),0) AS income FROM transactions WHERE type='income'", (err1, incomeRow) => {
      if (err1) return res.status(500).json({ error: err1.message });
      db.get("SELECT IFNULL(SUM(amount),0) AS expense FROM transactions WHERE type='expense'", (err2, expenseRow) => {
        if (err2) return res.status(500).json({ error: err2.message });
        db.get("SELECT value FROM settings WHERE key='monthly_budget'", (err3, budgetRow) => {
          if (err3) return res.status(500).json({ error: err3.message });
          const income = incomeRow ? incomeRow.income : 0;
          const expense = expenseRow ? expenseRow.expense : 0;
          const savings = income - expense;
          const monthly_budget = budgetRow ? Number(budgetRow.value) : 0;
          
          const summaryData = [
            ['Category', 'Amount'],
            ['Income', income.toFixed(2)],
            ['Expenses', expense.toFixed(2)],
            ['Savings', savings.toFixed(2)],
            ['Monthly Budget', monthly_budget.toFixed(2)]
          ].map(row => row.join(',')).join('\n');
          
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', 'attachment; filename="summary.csv"');
          res.send(summaryData);
        });
      });
    });
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Seth and Paula finances server listening on http://localhost:${PORT}`);
});

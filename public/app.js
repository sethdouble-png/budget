async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function downloadCSV(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

const currencySymbols = {
  'USD': '$',
  'AED': 'د.إ',
  'UGX': 'USh'
};

let currentCurrency = 'USD';

function getCurrencySymbol(currency) {
  return currencySymbols[currency] || '$';
}

async function refreshSummary() {
  try {
    const s = await fetchJSON('/api/summary');
    currentCurrency = s.currency || 'USD';
    const symbol = getCurrencySymbol(currentCurrency);
    document.getElementById('income').textContent = 'Income: ' + symbol + s.income.toFixed(2);
    document.getElementById('expense').textContent = 'Expense: ' + symbol + s.expense.toFixed(2);
    document.getElementById('savings').textContent = 'Savings: ' + symbol + s.savings.toFixed(2);
    document.getElementById('budgetInput').value = s.monthly_budget || '';
    document.getElementById('currencySymbol').textContent = symbol;
    document.getElementById('currencySelect').value = currentCurrency;
  } catch (e) {
    console.error(e);
  }
}

async function refreshTransactions() {
  try {
    const tx = await fetchJSON('/api/transactions');
    const tbody = document.querySelector('#txTable tbody');
    tbody.innerHTML = '';
    const symbol = getCurrencySymbol(currentCurrency);
    tx.forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${t.date}</td><td>${symbol}${t.amount.toFixed(2)}</td><td>${t.type}</td><td>${t.category}</td><td>${t.note}</td>`;
      tbody.appendChild(tr);
    });
  } catch (e) { console.error(e); }
}

document.getElementById('txForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const date = document.getElementById('date').value;
  const amount = parseFloat(document.getElementById('amount').value);
  const type = document.getElementById('type').value;
  const category = document.getElementById('category').value;
  const note = document.getElementById('note').value;
  try {
    await fetchJSON('/api/transactions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({date, amount, type, category, note}) });
    document.getElementById('txForm').reset();
    await refreshTransactions();
    await refreshSummary();
  } catch (e) { alert('Error adding transaction'); console.error(e); }
});

document.getElementById('saveBudget').addEventListener('click', async () => {
  const val = parseFloat(document.getElementById('budgetInput').value || 0);
  try {
    await fetchJSON('/api/budget', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ monthly_budget: val }) });
    await refreshSummary();
  } catch (e) { alert('Error saving budget'); console.error(e); }
});

document.getElementById('currencySelect').addEventListener('change', async (ev) => {
  const newCurrency = ev.target.value;
  try {
    await fetchJSON('/api/currency', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ currency: newCurrency }) });
    await refreshSummary();
    await refreshTransactions();
  } catch (e) { alert('Error changing currency'); console.error(e); }
});

// Export buttons
document.getElementById('exportAll').addEventListener('click', () => {
  downloadCSV('/api/export/transactions', 'transactions.csv');
});

document.getElementById('exportIncome').addEventListener('click', () => {
  downloadCSV('/api/export/income', 'income.csv');
});

document.getElementById('exportExpenses').addEventListener('click', () => {
  downloadCSV('/api/export/expenses', 'expenses.csv');
});

document.getElementById('exportSummary').addEventListener('click', () => {
  downloadCSV('/api/export/summary', 'summary.csv');
});

async function init() {
  await refreshSummary();
  await refreshTransactions();
}

init();

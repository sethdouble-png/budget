async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function refreshSummary() {
  try {
    const s = await fetchJSON('/api/summary');
    document.getElementById('income').textContent = 'Income: $' + s.income.toFixed(2);
    document.getElementById('expense').textContent = 'Expense: $' + s.expense.toFixed(2);
    document.getElementById('savings').textContent = 'Savings: $' + s.savings.toFixed(2);
    document.getElementById('budgetInput').value = s.monthly_budget || '';
  } catch (e) {
    console.error(e);
  }
}

async function refreshTransactions() {
  try {
    const tx = await fetchJSON('/api/transactions');
    const tbody = document.querySelector('#txTable tbody');
    tbody.innerHTML = '';
    tx.forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${t.date}</td><td>${t.amount.toFixed(2)}</td><td>${t.type}</td><td>${t.category}</td><td>${t.note}</td>`;
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

async function init() {
  await refreshSummary();
  await refreshTransactions();
}

init();

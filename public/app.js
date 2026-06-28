// Global state
let authToken = localStorage.getItem('authToken');
let currentUser = null;
let currentCurrency = localStorage.getItem('displayCurrency') || 'USD';
let currentSummary = { income: 0, expense: 0, savings: 0, monthly_budget: 0 };
let currentCategories = [];
let currentMonthly = [];
let currentRecurring = [];
let allTransactions = [];
let filteredTransactions = [];

const API_BASE = '/api';

const currencySymbols = {
  'USD': '$',
  'AED': 'AED',
  'UGX': 'USh'
};

const financeAdvice = [
  {
    title: 'Save before you spend',
    text: 'Automate savings first, then plan spending from what remains. This creates a simple, stable financial cushion.'
  },
  {
    title: 'Build multiple income streams',
    text: 'Relying on one source of income is risky. Side income, investments, and freelance work help you stay resilient.'
  },
  {
    title: 'Invest in time, not timing',
    text: 'Focus on long-term compound growth rather than trying to pick the perfect entry point in markets.'
  },
  {
    title: 'Track your cash flow',
    text: 'Know exactly where money enters and leaves your accounts. Clarity makes it easier to cut waste and increase savings.'
  },
  {
    title: 'Make your money work harder',
    text: 'Convert excess cash into assets like stocks, property, or skills that increase earning power.'
  },
  {
    title: 'Protect your downside',
    text: 'Emergencies happen. Keep reserves and insurance in place so one setback does not derail your progress.'
  },
  {
    title: 'Learn continuously',
    text: 'The best financial advantage is knowledge. Read, study successful founders, and apply lessons quickly.'
  },
  {
    title: 'Keep spending intentional',
    text: 'Every expense should serve a purpose. Avoid impulse purchases and align spending with your goals.'
  }
];

const financePrinciples = [
  'Spend less than you earn and invest the surplus into assets.',
  'Diversify income streams so you are not dependent on one source.',
  'Use debt strategically: good debt for growth, avoid high-cost consumer debt.',
  'Build a financial cushion before taking bigger risks.',
  'Invest consistently and let compounding work over time.',
  'Develop valuable skills that increase your earning power.',
  'Measure progress regularly and adjust quickly when needed.',
  'Create systems that scale in business and personal finance.',
  'Keep a long-term vision while optimizing daily habits.',
  'Learn from mentors, books, and proven entrepreneurs.'
];

const DEFAULT_BASE_CURRENCY = 'USD';
let exchangeRates = {
  USD: 1,
  AED: 3.67,
  UGX: 3740
};

async function loadExchangeRates() {
  try {
    const res = await fetch(`${API_BASE}/rates`);
    if (!res.ok) throw new Error('Failed to load exchange rates');
    const data = await res.json();
    if (data && data.rates) {
      exchangeRates = {
        USD: Number(data.rates.USD) || 1,
        AED: Number(data.rates.AED) || exchangeRates.AED,
        UGX: Number(data.rates.UGX) || exchangeRates.UGX
      };
    }
  } catch (err) {
    console.warn('Unable to load live exchange rates, using fallback rates', err);
  }
}

function getRate(currency) {
  return exchangeRates[currency] || 1;
}

function convertAmount(amount, fromCurrency = DEFAULT_BASE_CURRENCY, toCurrency = currentCurrency) {
  const fromRate = getRate(fromCurrency);
  const toRate = getRate(toCurrency);
  return Number(amount || 0) * (toRate / fromRate);
}

function formatMoney(amount, fromCurrency = DEFAULT_BASE_CURRENCY) {
  const symbol = currencySymbols[currentCurrency] || '';
  return `${symbol}${convertAmount(amount, fromCurrency).toFixed(2)}`;
}

function createActionButton(text, className, handler) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `action-btn ${className}`;
  btn.textContent = text;
  btn.addEventListener('click', handler);
  return btn;
}

async function fetchJSON(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    data = null;
  }

  if (!res.ok) {
    throw new Error(data?.error || data?.message || text || res.statusText);
  }

  return data;
}

// ===== INITIALIZATION =====
async function init() {
  if (authToken) {
    try {
      await checkAuth();
      showAppPages();
      await loadExchangeRates();
      await loadSummary();
      await refreshTransactions();
      setupEventListeners();
    } catch (e) {
      logout();
    }
  } else {
    showAuthPages();
    setupAuthListeners();
  }
}

async function checkAuth() {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  if (!res.ok) throw new Error('Not authenticated');
  const result = await res.json();
  currentUser = result.user;
}

function showAuthPages() {
  document.getElementById('authPages').style.display = 'block';
  document.getElementById('appContainer').style.display = 'none';
}

function showAppPages() {
  document.getElementById('authPages').style.display = 'none';
  document.getElementById('appContainer').style.display = 'block';
  document.getElementById('userEmail').textContent = currentUser?.email || '';
  document.getElementById('currencySelect').value = currentCurrency;
  loadGroup();
  initializeAdviceSection();
}

// ===== AUTH LISTENERS =====
function setupAuthListeners() {
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('signupForm').addEventListener('submit', handleSignup);
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const result = await res.json();

    if (!res.ok) {
      document.getElementById('loginError').textContent = result.error || 'Login failed';
      return;
    }

    authToken = result.session.access_token;
    localStorage.setItem('authToken', authToken);
    currentUser = result.user;

    showAppPages();
    await loadSummary();
    await refreshTransactions();
    setupEventListeners();
  } catch (e) {
    document.getElementById('loginError').textContent = e.message;
  }
}

function initializeAdviceSection() {
  const adviceCards = document.getElementById('adviceCards');
  const principlesList = document.getElementById('principlesList');

  if (!adviceCards || !principlesList) return;

  adviceCards.innerHTML = '';
  const cardClasses = ['accent-blue', 'accent-green', 'accent-indigo'];

  financeAdvice.forEach((advice, index) => {
    const card = document.createElement('article');
    card.className = `advice-card ${cardClasses[index % cardClasses.length]}`;
    card.innerHTML = `
      <h3>${advice.title}</h3>
      <p>${advice.text}</p>
    `;
    adviceCards.appendChild(card);
  });

  principlesList.innerHTML = '';
  financePrinciples.forEach(principle => {
    const li = document.createElement('li');
    li.textContent = principle;
    principlesList.appendChild(li);
  });
}

async function handleSignup(e) {
  e.preventDefault();
  const email = document.getElementById('signupEmail').value;
  const password = document.getElementById('signupPassword').value;
  const confirm = document.getElementById('signupConfirm').value;

  if (password !== confirm) {
    document.getElementById('signupError').textContent = 'Passwords do not match';
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const result = await res.json();

    if (!res.ok) {
      document.getElementById('signupError').textContent = result.error || 'Signup failed';
      return;
    }

    if (result.session && result.session.access_token) {
      authToken = result.session.access_token;
      localStorage.setItem('authToken', authToken);
      currentUser = result.user;
      showAppPages();
      await loadSummary();
      await refreshTransactions();
      setupEventListeners();
      return;
    }

    // If no session returned, perform sign-in immediately after signup
    const loginRes = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const loginResult = await loginRes.json();

    if (!loginRes.ok) {
      document.getElementById('signupError').textContent = loginResult.error || 'Signup completed, please login';
      return;
    }

    authToken = loginResult.session.access_token;
    localStorage.setItem('authToken', authToken);
    currentUser = loginResult.user;
    showAppPages();
    await loadSummary();
    await refreshTransactions();
    setupEventListeners();
  } catch (e) {
    document.getElementById('signupError').textContent = e.message;
  }
}

function switchToSignup() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('signupPage').style.display = 'block';
  document.getElementById('loginError').textContent = '';
  document.getElementById('signupError').textContent = '';
}

function switchToLogin() {
  document.getElementById('loginPage').style.display = 'block';
  document.getElementById('signupPage').style.display = 'none';
  document.getElementById('loginError').textContent = '';
  document.getElementById('signupError').textContent = '';
}

function logout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('authToken');
  location.reload();
}

// ===== TAB MANAGEMENT =====
function showTab(event, tabName) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  
  document.getElementById(tabName).classList.add('active');
  event?.currentTarget?.classList.add('active');
  
  if (tabName === 'analytics') loadAnalytics();
  else if (tabName === 'recurring') loadRecurring();
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
  document.getElementById('txForm').addEventListener('submit', handleAddTransaction);
  document.getElementById('editForm').addEventListener('submit', handleEditTransaction);
  document.getElementById('recurringForm').addEventListener('submit', handleAddRecurring);
  document.getElementById('currencySelect').addEventListener('change', handleCurrencyChange);
  
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('date').value = today;
  document.getElementById('editDate').value = today;
  document.getElementById('recurStartDate').value = today;
}

// ===== TRANSACTION FUNCTIONS =====
async function handleAddTransaction(e) {
  e.preventDefault();
  const date = document.getElementById('date').value;
  const amount = parseFloat(document.getElementById('amount').value);
  const type = document.getElementById('type').value;
  const category = document.getElementById('category').value;
  const note = document.getElementById('note').value;
  
  try {
    const baseAmount = convertAmount(amount, currentCurrency, DEFAULT_BASE_CURRENCY);
    const res = await fetch(`${API_BASE}/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ date, amount: baseAmount, type, category, note })
    });
    
    if (!res.ok) throw new Error(await res.text());
    
    document.getElementById('txForm').reset();
    document.getElementById('date').value = new Date().toISOString().split('T')[0];
    await refreshTransactions();
    await loadSummary();
  } catch (e) {
    alert('Error adding transaction: ' + e.message);
  }
}

async function refreshTransactions() {
  try {
    const data = await fetchJSON(`${API_BASE}/transactions`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    allTransactions = Array.isArray(data) ? data : [];
    filteredTransactions = allTransactions;
    displayTransactions(filteredTransactions);
  } catch (e) {
    console.error('refreshTransactions failed', e);
    allTransactions = [];
    filteredTransactions = [];
    displayTransactions([]);
  }
}

function displayTransactions(txs) {
  const tbody = document.querySelector('#txTable tbody');
  tbody.innerHTML = '';
  const safeTxs = Array.isArray(txs) ? txs : [];
  
  safeTxs.forEach(t => {
    const displayAmount = formatMoney(t.amount);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t.date}</td>
      <td>${displayAmount}</td>
      <td>${t.type}</td>
      <td>${t.category}</td>
      <td>${t.note || '-'}</td>
      <td></td>
    `;

    const actionCell = tr.querySelector('td:last-child');
    actionCell.appendChild(createActionButton('Edit', 'edit-btn', () => openEditModal(
      t.id,
      t.date,
      convertAmount(t.amount),
      t.type,
      t.category,
      t.note || ''
    )));
    actionCell.appendChild(createActionButton('Delete', 'delete-btn', () => deleteTransaction(t.id)));
    tbody.appendChild(tr);
  });
}

async function loadGroup() {
  try {
    const data = await fetchJSON(`${API_BASE}/group`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    const statusEl = document.getElementById('groupStatus');
    const listEl = document.getElementById('groupList');
    listEl.innerHTML = '';

    if (!data.group) {
      statusEl.textContent = 'Not currently in a shared group.';
      return;
    }

    statusEl.textContent = `In group: ${data.group.name} (${data.group.code})`;
    if (Array.isArray(data.members) && data.members.length) {
      const membersText = data.members.map(m => m).join(', ');
      listEl.textContent = `Members: ${membersText}`;
    }
  } catch (e) {
    console.warn('Could not load group data', e);
  }
}

async function createGroup() {
  const name = document.getElementById('groupName').value.trim();
  if (!name) return alert('Group name is required.');

  try {
    const res = await fetch(`${API_BASE}/group/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ name })
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to create group');
    document.getElementById('groupName').value = '';
    await loadGroup();
    await refreshTransactions();
  } catch (e) {
    alert('Error creating group: ' + e.message);
  }
}

async function joinGroup() {
  const code = document.getElementById('groupCode').value.trim();
  if (!code) return alert('Group invite code is required.');

  try {
    const res = await fetch(`${API_BASE}/group/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ code })
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to join group');
    document.getElementById('groupCode').value = '';
    await loadGroup();
    await refreshTransactions();
  } catch (e) {
    alert('Error joining group: ' + e.message);
  }
}

function parseCSV(contents) {
  const lines = contents.trim().split(/\r?\n/);
  const headers = lines.shift().split(',').map(h => h.trim().toLowerCase());
  return lines.map(line => {
    const values = line.split(',').map(v => v.trim());
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] || '';
    });
    return record;
  });
}

async function importTransactions() {
  const fileInput = document.getElementById('importFile');
  if (!fileInput.files.length) return alert('Please choose a CSV file to import.');

  const file = fileInput.files[0];
  const reader = new FileReader();
  reader.onload = async (event) => {
    const contents = event.target.result;
    const records = parseCSV(contents);

    try {
      const res = await fetch(`${API_BASE}/import/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ records })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Import failed');
      alert(`Imported ${result.imported} transactions successfully.`);
      fileInput.value = '';
      await refreshTransactions();
      await loadSummary();
    } catch (e) {
      alert('Error importing CSV: ' + e.message);
    }
  };
  reader.readAsText(file);
}

function openEditModal(id, date, amount, type, category, note) {
  document.getElementById('editId').value = id;
  document.getElementById('editDate').value = date;
  document.getElementById('editAmount').value = amount;
  document.getElementById('editType').value = type;
  document.getElementById('editCategory').value = category;
  document.getElementById('editNote').value = note;
  document.getElementById('editModal').style.display = 'block';
}

function closeEditModal() {
  document.getElementById('editModal').style.display = 'none';
}

async function handleEditTransaction(e) {
  e.preventDefault();
  const id = document.getElementById('editId').value;
  const date = document.getElementById('editDate').value;
  const amount = parseFloat(document.getElementById('editAmount').value);
  const type = document.getElementById('editType').value;
  const category = document.getElementById('editCategory').value;
  const note = document.getElementById('editNote').value;
  
  try {
    const baseAmount = convertAmount(amount, currentCurrency, DEFAULT_BASE_CURRENCY);
    const res = await fetch(`${API_BASE}/transactions/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ date, amount: baseAmount, type, category, note })
    });
    
    if (!res.ok) throw new Error(await res.text());
    
    closeEditModal();
    await refreshTransactions();
    await loadSummary();
  } catch (e) {
    alert('Error updating transaction: ' + e.message);
  }
}

async function deleteTransaction(id) {
  if (!confirm('Are you sure?')) return;
  
  try {
    const res = await fetch(`${API_BASE}/transactions/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    if (!res.ok) throw new Error(await res.text());
    await refreshTransactions();
    await loadSummary();
  } catch (e) {
    alert('Error deleting transaction: ' + e.message);
  }
}

// ===== FILTER FUNCTIONS =====
async function applyFilters() {
  const search = document.getElementById('searchTx').value;
  const startDate = document.getElementById('filterStartDate').value;
  const endDate = document.getElementById('filterEndDate').value;
  const type = document.getElementById('filterType').value;
  
  try {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (type) params.append('type', type);
    
    const res = await fetch(`${API_BASE}/transactions?${params}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    filteredTransactions = await res.json();
    displayTransactions(filteredTransactions);
  } catch (e) {
    alert('Error filtering: ' + e.message);
  }
}

function clearFilters() {
  document.getElementById('searchTx').value = '';
  document.getElementById('filterStartDate').value = '';
  document.getElementById('filterEndDate').value = '';
  document.getElementById('filterType').value = '';
  displayTransactions(allTransactions);
}

async function exportTransactions() {
  window.location.href = `${API_BASE}/export/transactions`;
}

// ===== SUMMARY & BUDGET =====
async function loadSummary() {
  try {
    const data = await fetchJSON(`${API_BASE}/summary`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    // Respect user's local display preference; only use server currency if user hasn't selected one
    if (!localStorage.getItem('displayCurrency')) {
      currentCurrency = data?.currency || 'USD';
      document.getElementById('currencySelect').value = currentCurrency;
    }

    currentSummary = {
      income: Number(data?.income || 0),
      expense: Number(data?.expense || 0),
      savings: Number(data?.savings || 0),
      monthly_budget: Number(data?.monthly_budget || 0)
    };
    document.getElementById('budgetInput').value = currentSummary.monthly_budget || '';

    updateCurrencyDisplay();
    updateSummaryDisplay();
    updateBudgetVisualization(currentSummary.expense, currentSummary.monthly_budget);
  } catch (e) {
    console.error(e);
    alert('Unable to load summary: ' + e.message);
  }
}

function updateCurrencyDisplay() {
  const symbol = currencySymbols[currentCurrency];
  document.getElementById('budgetCurrency').textContent = symbol;
  displayTransactions(filteredTransactions);
  updateSummaryDisplay();
  displayCategories(currentCategories);
  displayMonthly(currentMonthly);
  displayRecurring(currentRecurring);
}

function updateSummaryDisplay() {
  document.getElementById('income').textContent = `Income: ${formatMoney(currentSummary.income)}`;
  document.getElementById('expense').textContent = `Expense: ${formatMoney(currentSummary.expense)}`;
  document.getElementById('savings').textContent = `Savings: ${formatMoney(currentSummary.savings)}`;
  document.getElementById('budgetInput').value = convertAmount(currentSummary.monthly_budget).toFixed(2);
  updateBudgetVisualization(currentSummary.expense, currentSummary.monthly_budget);
}

function updateBudgetVisualization(spent, budget) {
  document.getElementById('budgetSpent').textContent = formatMoney(spent);
  document.getElementById('budgetTotal').textContent = formatMoney(budget);
  
  if (budget > 0) {
    const percent = (spent / budget) * 100;
    document.getElementById('budgetFill').style.width = Math.min(percent, 100) + '%';
    document.getElementById('budgetPercent').textContent = percent.toFixed(0) + '%';
    updateBudgetAlert(spent, budget, percent);
  } else {
    updateBudgetAlert(spent, budget, 0);
  }
}

function updateBudgetAlert(spent, budget, percent) {
  const alertEl = document.getElementById('budgetAlert');
  if (!alertEl) return;

  if (!budget || budget <= 0) {
    alertEl.textContent = 'Set a monthly budget to track progress and alerts.';
    alertEl.className = 'budget-alert safe';
    return;
  }

  if (percent >= 100) {
    alertEl.textContent = 'You have reached or exceeded your budget! Review your spending.';
    alertEl.className = 'budget-alert danger';
  } else if (percent >= 80) {
    alertEl.textContent = 'You are nearing your budget limit. Keep an eye on spending.';
    alertEl.className = 'budget-alert warning';
  } else {
    alertEl.textContent = 'Good job — spending is within your budget.';
    alertEl.className = 'budget-alert safe';
  }
}

async function saveBudget() {
  const val = parseFloat(document.getElementById('budgetInput').value || 0);
  try {
    const baseValue = convertAmount(val, currentCurrency, DEFAULT_BASE_CURRENCY);
    const res = await fetch(`${API_BASE}/budget`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ monthly_budget: baseValue })
    });
    
    if (!res.ok) throw new Error(await res.text());
    await loadSummary();
  } catch (e) {
    alert('Error saving budget: ' + e.message);
  }
}

async function handleCurrencyChange(e) {
  const currency = e.target.value;
  try {
    currentCurrency = currency;
    localStorage.setItem('displayCurrency', currency);
    await loadExchangeRates();
    updateCurrencyDisplay();

    // Still attempt to persist user preference server-side, but don't reload summary/transactions
    fetch(`${API_BASE}/currency`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ currency })
    }).catch(err => console.warn('Could not persist currency to server:', err));
  } catch (e) {
    alert('Error changing currency: ' + e.message);
  }
}

// ===== ANALYTICS =====
async function loadAnalytics() {
  try {
    const startDate = document.getElementById('analyticsStartDate').value;
    const endDate = document.getElementById('analyticsEndDate').value;
    
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    
    const catRes = await fetch(`${API_BASE}/analytics/categories?${params}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const categories = await catRes.json();
    displayCategories(categories);
    
    const monthRes = await fetch(`${API_BASE}/analytics/monthly`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const monthly = await monthRes.json();
    displayMonthly(monthly);
  } catch (e) {
    alert('Error loading analytics: ' + e.message);
  }
}

function displayCategories(categories) {
  currentCategories = Array.isArray(categories) ? categories : [];
  const tbody = document.querySelector('#categoriesTable tbody');
  tbody.innerHTML = '';
  
  currentCategories.forEach(cat => {
    const total = Number(cat.total || 0);
    const convertedTotal = convertAmount(total);
    const percentage = Number(cat.percentage || 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${cat.category}</td>
      <td>${formatMoney(total)}</td>
      <td>${percentage}%</td>
      <td><div class="bar" style="width:${percentage}%"></div></td>
    `;
    tbody.appendChild(tr);
  });
}

function displayMonthly(monthly) {
  currentMonthly = Array.isArray(monthly) ? monthly : [];
  const tbody = document.querySelector('#monthlyTable tbody');
  tbody.innerHTML = '';
  
  currentMonthly.forEach(m => {
    const income = Number(m.income || 0);
    const expense = Number(m.expense || 0);
    const savings = Number(m.savings || 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m.month}</td>
      <td>${formatMoney(income)}</td>
      <td>${formatMoney(expense)}</td>
      <td>${formatMoney(savings)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ===== RECURRING TRANSACTIONS =====
async function handleAddRecurring(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('recurAmount').value);
  const type = document.getElementById('recurType').value;
  const category = document.getElementById('recurCategory').value;
  const note = document.getElementById('recurNote').value;
  const frequency = document.getElementById('recurFrequency').value;
  const start_date = document.getElementById('recurStartDate').value;
  const end_date = document.getElementById('recurEndDate').value;
  
  try {
    const baseAmount = convertAmount(amount, currentCurrency, DEFAULT_BASE_CURRENCY);
    const res = await fetch(`${API_BASE}/recurring`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ amount: baseAmount, type, category, note, frequency, start_date, end_date })
    });
    
    if (!res.ok) throw new Error(await res.text());
    document.getElementById('recurringForm').reset();
    await loadRecurring();
  } catch (e) {
    alert('Error adding recurring: ' + e.message);
  }
}

async function loadRecurring() {
  try {
    const res = await fetch(`${API_BASE}/recurring`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const recurring = await res.json();
    displayRecurring(Array.isArray(recurring) ? recurring : []);
  } catch (e) {
    console.error(e);
    displayRecurring([]);
  }
}

function displayRecurring(recurring) {
  currentRecurring = Array.isArray(recurring) ? recurring : [];
  const tbody = document.querySelector('#recurringTable tbody');
  tbody.innerHTML = '';
  const safeRecurring = currentRecurring;
  
  safeRecurring.forEach(r => {
    const amount = Number(r.amount || 0);
    const displayAmount = formatMoney(amount);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${displayAmount}</td>
      <td>${r.type}</td>
      <td>${r.category}</td>
      <td>${r.frequency}</td>
      <td>${r.start_date}</td>
      <td>${r.is_active ? 'Active' : 'Inactive'}</td>
      <td></td>
    `;

    const actionCell = tr.querySelector('td:last-child');
    actionCell.appendChild(createActionButton(r.is_active ? 'Pause' : 'Resume', '', () => toggleRecurring(r.id, !r.is_active)));
    actionCell.appendChild(createActionButton('Delete', 'delete-btn', () => deleteRecurring(r.id)));
    tbody.appendChild(tr);
  });
}

async function toggleRecurring(id, isActive) {
  try {
    const res = await fetch(`${API_BASE}/recurring/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ is_active: isActive })
    });
    
    if (!res.ok) throw new Error(await res.text());
    await loadRecurring();
  } catch (e) {
    alert('Error updating recurring: ' + e.message);
  }
}

async function deleteRecurring(id) {
  if (!confirm('Are you sure?')) return;
  
  try {
    const res = await fetch(`${API_BASE}/recurring/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    if (!res.ok) throw new Error(await res.text());
    await loadRecurring();
  } catch (e) {
    alert('Error deleting recurring: ' + e.message);
  }
}

init();

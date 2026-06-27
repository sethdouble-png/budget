# Seth and Paula Finances

Simple single-user finances tracker.

Prerequisites: Node.js (14+)

Install and run:

```bash
cd seth-and-paula-finances
npm install
npm start
```

Open http://localhost:3000

API endpoints:
- `GET /api/transactions` - list transactions
- `POST /api/transactions` - add transaction {date,amount,type,category,note}
- `GET /api/summary` - {income,expense,savings,monthly_budget}
- `POST /api/budget` - {monthly_budget}


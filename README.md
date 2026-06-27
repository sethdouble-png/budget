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

Development setup
1. copy `.env.example` to `.env`
2. set your Supabase values
3. run `npm install`
4. run `npm start`

Production setup
1. copy `.env.example` to `.env`
2. set `NODE_ENV=production`
3. run `npm install`
4. run `npm run start:prod`

Environment variables
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CORS_ORIGIN` (optional, comma-separated allowed origins)
- `NODE_ENV=production` for production deployments

Helpful scripts
- `npm run check` - syntax check `server.js`

API endpoints:
- `GET /api/transactions` - list transactions
- `POST /api/transactions` - add transaction {date,amount,type,category,note}
- `GET /api/summary` - {income,expense,savings,monthly_budget}
- `POST /api/budget` - {monthly_budget}


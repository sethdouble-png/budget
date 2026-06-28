-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Transactions table
CREATE TABLE transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  category TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Shared groups
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE group_memberships (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, group_id)
);

-- Settings table (for budget, currency per user)
CREATE TABLE settings (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, key)
);

-- Recurring transactions table
CREATE TABLE recurring_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  category TEXT NOT NULL,
  note TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  last_run_date TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Users can only see their own data
CREATE POLICY "Users can view own transactions" 
  ON transactions FOR SELECT 
  USING (
    auth.uid() = user_id OR
    (group_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM group_memberships gm
      WHERE gm.group_id = group_id
        AND gm.user_id = auth.uid()
    ))
  );

CREATE POLICY "Users can insert own transactions" 
  ON transactions FOR INSERT 
  WITH CHECK (
    auth.uid() = user_id OR
    (group_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM group_memberships gm
      WHERE gm.group_id = group_id
        AND gm.user_id = auth.uid()
    ))
  );

CREATE POLICY "Users can update own transactions" 
  ON transactions FOR UPDATE 
  USING (
    auth.uid() = user_id OR
    (group_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM group_memberships gm
      WHERE gm.group_id = group_id
        AND gm.user_id = auth.uid()
    ))
  );

CREATE POLICY "Users can delete own transactions" 
  ON transactions FOR DELETE 
  USING (
    auth.uid() = user_id OR
    (group_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM group_memberships gm
      WHERE gm.group_id = group_id
        AND gm.user_id = auth.uid()
    ))
  );

CREATE POLICY "Users can view own settings" 
  ON settings FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings" 
  ON settings FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings" 
  ON settings FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own recurring" 
  ON recurring_transactions FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own recurring" 
  ON recurring_transactions FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own recurring" 
  ON recurring_transactions FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own recurring" 
  ON recurring_transactions FOR DELETE 
  USING (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_group_id ON transactions(group_id);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_settings_user_id ON settings(user_id);
CREATE INDEX idx_recurring_user_id ON recurring_transactions(user_id);
CREATE INDEX idx_group_memberships_user_id ON group_memberships(user_id);
CREATE INDEX idx_group_memberships_group_id ON group_memberships(group_id);

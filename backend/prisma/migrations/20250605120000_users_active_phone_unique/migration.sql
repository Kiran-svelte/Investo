-- One active staff mobile number per platform; inactive/deleted rows may reuse the same phone.
CREATE UNIQUE INDEX IF NOT EXISTS users_active_phone_unique
  ON users (phone)
  WHERE status = 'active' AND phone IS NOT NULL;

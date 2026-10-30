BEGIN;
ALTER TABLE subscriptions
  ADD COLUMN trial_days integer NOT NULL DEFAULT 0 CHECK (trial_days >= 0);
COMMIT;

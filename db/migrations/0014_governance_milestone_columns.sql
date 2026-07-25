-- Governance Milestone State Columns
-- Adds missing columns required by the Governance Presentation Generator

ALTER TABLE public.governance_milestone_state
  ADD COLUMN IF NOT EXISTS ppp_date varchar(20),
  ADD COLUMN IF NOT EXISTS comp_date varchar(20),
  ADD COLUMN IF NOT EXISTS custom_pct integer,
  ADD COLUMN IF NOT EXISTS ready_status varchar(20),
  ADD COLUMN IF NOT EXISTS remarks text;

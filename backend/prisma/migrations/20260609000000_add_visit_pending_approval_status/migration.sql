-- VisitStatus.pending_approval: buyer WhatsApp requests awaiting agent approval.
ALTER TYPE "VisitStatus" ADD VALUE IF NOT EXISTS 'pending_approval';

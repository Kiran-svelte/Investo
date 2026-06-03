import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getPropertyImportKnowledgeGate } from '../../services/propertyImport';
import { setPropertyKnowledgeGateCache } from '../../utils/propertyKnowledgeGateCache';

/**
 * Non-blocking reminder when an import still needs AI knowledge Q&A.
 * Does not prevent navigation (unlike a hard redirect guard).
 */
export default function KnowledgeGateBanner() {
  const { user } = useAuth();
  const [gate, setGate] = useState<{
    blocked: boolean;
    draftId: string | null;
    reason: string | null;
    gapCount: number;
  } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const run = async () => {
      if (user?.role !== 'company_admin') {
        setGate(null);
        return;
      }

      const companyId = typeof user.company_id === 'string' ? user.company_id : '';
      try {
        const status = await getPropertyImportKnowledgeGate();
        setGate({
          blocked: status.blocked,
          draftId: status.draftId,
          reason: status.reason,
          gapCount: status.gapCount,
        });
        if (companyId) {
          setPropertyKnowledgeGateCache(companyId, status.blocked);
        }
      } catch {
        setGate(null);
      }
    };

    if (user) {
      void run();
    }
  }, [user, user?.company_id]);

  if (!gate?.blocked || dismissed) {
    return null;
  }

  const importHref = gate.draftId
    ? `/properties/import/${gate.draftId}`
    : '/properties/import';

  return (
    <div className="border-b border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
      <div className="mx-auto flex max-w-6xl items-start justify-between gap-3">
        <p className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            {gate.reason || `Finish AI knowledge for this property (${gate.gapCount} questions left).`}
            {' '}
            <Link to={importHref} className="font-semibold underline hover:text-violet-700">
              Continue setup
            </Link>
          </span>
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded p-1 hover:bg-violet-100"
          aria-label="Dismiss reminder"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

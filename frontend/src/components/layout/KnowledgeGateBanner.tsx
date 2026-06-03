import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { dashboardPath } from '../../config/navigation.config';
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
    ? dashboardPath(`/properties/import/${gate.draftId}`)
    : dashboardPath('/properties/import');

  return (
    <div className="border-b border-brand-200 bg-brand-50 px-4 py-2.5 text-sm text-brand-900">
      <div className="mx-auto flex max-w-[1400px] items-start justify-between gap-3 px-4 md:px-8">
        <p className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-600" />
          <span>
            {gate.reason || `Finish AI knowledge for this property (${gate.gapCount} questions left).`}
            {' '}
            <Link to={importHref} className="font-semibold text-brand-800 underline hover:text-brand-900">
              Continue setup
            </Link>
          </span>
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-lg p-1 hover:bg-brand-100"
          aria-label="Dismiss reminder"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

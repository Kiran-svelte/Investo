import { useEffect, useMemo, useState } from 'react';
import { MessageCircleQuestion, ChevronRight, ChevronLeft, Sparkles, X } from 'lucide-react';
import {
  applyMarketingAnswer,
  CUSTOM_OPTION,
  type MarketingKnowledgeQuestion,
} from './propertyImportKnowledgeQuestions';
import type { PropertyImportFormValues } from './propertyImport.utils';

interface PropertyImportKnowledgeWizardProps {
  open?: boolean;
  inline?: boolean;
  questions: MarketingKnowledgeQuestion[];
  formValues: PropertyImportFormValues;
  draftData: Record<string, unknown> | null | undefined;
  onClose?: () => void;
  onComplete: (next: { formValues: PropertyImportFormValues; draftData: Record<string, unknown> }) => void;
  onStepAnswer?: (next: { formValues: PropertyImportFormValues; draftData: Record<string, unknown> }) => void;
}

export default function PropertyImportKnowledgeWizard({
  open = true,
  inline = false,
  questions,
  formValues,
  draftData,
  onClose,
  onComplete,
  onStepAnswer,
}: PropertyImportKnowledgeWizardProps) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState('');
  const [custom, setCustom] = useState('');
  const [workingForm, setWorkingForm] = useState(formValues);
  const [workingDraft, setWorkingDraft] = useState<Record<string, unknown>>(
    draftData && typeof draftData === 'object' ? { ...draftData } : {},
  );

  useEffect(() => {
    setWorkingForm(formValues);
    setWorkingDraft(draftData && typeof draftData === 'object' ? { ...draftData } : {});
    setStep(0);
    setSelected('');
    setCustom('');
  }, [questions.length, formValues.property_type]);

  const queue = useMemo(() => questions, [questions]);
  const current = queue[step];

  if ((!inline && !open) || queue.length === 0 || !current) {
    return null;
  }

  const canContinue =
    selected === 'Nothing else'
    || (selected && (selected !== CUSTOM_OPTION || custom.trim().length > 0));

  const handleNext = () => {
    if (!canContinue) {
      return;
    }

    const applied = applyMarketingAnswer(workingForm, workingDraft, current, selected, custom);
    setWorkingForm(applied.formValues);
    setWorkingDraft(applied.draftData);
    onStepAnswer?.(applied);

    if (step >= queue.length - 1) {
      onComplete(applied);
      setStep(0);
      setSelected('');
      setCustom('');
      return;
    }

    setStep(step + 1);
    setSelected('');
    setCustom('');
  };

  const body = (
    <>
      <div className={inline ? 'px-0 py-0' : 'px-5 py-5'}>
        {!inline && (
          <p className="flex items-start gap-2 text-base font-medium text-slate-900">
            <MessageCircleQuestion className="mt-0.5 h-5 w-5 flex-shrink-0 text-violet-600" />
            {current.prompt}
          </p>
        )}
        {inline && (
          <p className="text-lg font-semibold text-slate-900">{current.prompt}</p>
        )}
        <p className={`text-sm text-slate-600 ${inline ? 'mt-2' : 'mt-2'}`}>{current.helpText}</p>
        {inline && (
          <p className="mt-2 text-xs font-medium text-violet-700">
            Question {step + 1} of {queue.length}
          </p>
        )}

        <div className="mt-4 space-y-2">
          {current.options.map((option) => (
            <label
              key={option}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors ${
                selected === option
                  ? 'border-violet-400 bg-violet-50 text-violet-900'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name={`wizard-${current.id}`}
                checked={selected === option}
                onChange={() => setSelected(option)}
                className="h-4 w-4 text-violet-600"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>

        {selected === CUSTOM_OPTION && (
          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={current.customPlaceholder || 'Type your answer'}
            className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
          />
        )}
      </div>

      <div
        className={`flex items-center justify-between ${
          inline ? 'mt-6' : 'border-t border-slate-100 px-5 py-4'
        }`}
      >
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep(Math.max(0, step - 1))}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <button
          type="button"
          disabled={!canContinue}
          onClick={handleNext}
          className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {step >= queue.length - 1 ? 'Done' : 'Next'}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </>
  );

  if (inline) {
    return (
      <div className="rounded-2xl border border-violet-100 bg-violet-50/40 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-violet-900">
          <Sparkles className="h-4 w-4" />
          AI knowledge Q&amp;A
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-violet-100 p-2 text-violet-700">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">AI project knowledge</h3>
              <p className="text-sm text-slate-600">
                Question {step + 1} of {queue.length} — only gaps after brochure scan.
              </p>
            </div>
          </div>
          {onClose && (
            <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100" aria-label="Close">
              <X className="h-5 w-5 text-slate-500" />
            </button>
          )}
        </div>
        {body}
      </div>
    </div>
  );
}

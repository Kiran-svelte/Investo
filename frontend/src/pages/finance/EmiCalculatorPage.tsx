import React, { useMemo, useState } from 'react';
import api from '../../services/api';
import { Calculator, Copy, Download, Loader2, RotateCcw } from 'lucide-react';

type EmiResult = {
  principal: number;
  down_payment: number;
  loan_amount: number;
  interest_rate: number;
  tenure_months: number;
  monthly_emi: number;
  total_interest: number;
  total_payment: number;
};

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);

const EmiCalculatorPage: React.FC = () => {
  const [principal, setPrincipal] = useState('5000000');
  const [downPayment, setDownPayment] = useState('1000000');
  const [interestRate, setInterestRate] = useState('8.5');
  const [tenureMonths, setTenureMonths] = useState('240');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<EmiResult | null>(null);
  const [copied, setCopied] = useState(false);

  const summary = useMemo(() => {
    if (!result) {
      return '';
    }

    return [
      `Principal: ${formatCurrency(result.principal)}`,
      `Down payment: ${formatCurrency(result.down_payment)}`,
      `Loan amount: ${formatCurrency(result.loan_amount)}`,
      `Interest rate: ${result.interest_rate}%`,
      `Tenure: ${result.tenure_months} months`,
      `Monthly EMI: ${formatCurrency(result.monthly_emi)}`,
      `Total interest: ${formatCurrency(result.total_interest)}`,
      `Total payment: ${formatCurrency(result.total_payment)}`,
    ].join('\n');
  }, [result]);

  const handleCalculate = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await api.post('/calculate-emi', {
        principal: Number(principal),
        down_payment: Number(downPayment || 0),
        interest_rate: Number(interestRate),
        tenure_months: Number(tenureMonths),
      });

      setResult(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to calculate EMI');
    } finally {
      setLoading(false);
    }
  };

  const copySummary = async () => {
    if (!summary) {
      return;
    }

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard unavailable');
      }

      await navigator.clipboard.writeText(summary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Copy is unavailable in this browser context');
    }
  };

  const downloadSummary = () => {
    if (!summary) {
      return;
    }

    try {
      if (typeof URL.createObjectURL !== 'function') {
        throw new Error('Download is unavailable in this browser context');
      }

      const blob = new Blob([summary], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'emi-summary.txt';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Download is unavailable in this browser context');
    }
  };

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-50 via-white to-emerald-50/60 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 text-white shadow-2xl">
          <div className="grid gap-6 p-6 md:grid-cols-[1.15fr_0.85fr] md:p-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">
                <Calculator className="h-3.5 w-3.5" />
                EMI Calculator
              </div>
              <div className="space-y-3">
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Model affordability before the call.</h1>
                <p className="max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                  Calculate monthly EMI, total interest, and total payment from a property price. The output is ready to share with a buyer or copy into a follow-up message.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ['Estimate', 'Monthly EMI in seconds'],
                  ['Share', 'Copy or download the summary'],
                  ['Compare', 'Test multiple down payments'],
                ].map(([title, description]) => (
                  <div key={title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm font-semibold text-white">{title}</p>
                    <p className="mt-1 text-sm text-slate-300">{description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <div className="grid gap-3 text-sm text-slate-200 sm:grid-cols-2">
                <label className="space-y-1 sm:col-span-2">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Property price</span>
                  <input
                    value={principal}
                    onChange={(event) => setPrincipal(event.target.value)}
                    type="number"
                    min="0"
                    step="1000"
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none ring-0 placeholder:text-slate-500 focus:border-emerald-400"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Down payment</span>
                  <input
                    value={downPayment}
                    onChange={(event) => setDownPayment(event.target.value)}
                    type="number"
                    min="0"
                    step="1000"
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-emerald-400"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Interest rate %</span>
                  <input
                    value={interestRate}
                    onChange={(event) => setInterestRate(event.target.value)}
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-emerald-400"
                  />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Tenure in months</span>
                  <input
                    value={tenureMonths}
                    onChange={(event) => setTenureMonths(event.target.value)}
                    type="number"
                    min="1"
                    step="1"
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-emerald-400"
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  onClick={handleCalculate}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
                  Calculate
                </button>
                <button
                  onClick={() => {
                    setPrincipal('');
                    setDownPayment('');
                    setInterestRate('');
                    setTenureMonths('');
                    setResult(null);
                    setError('');
                  }}
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </button>
              </div>

              {error && (
                <p className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>

        {result && (
          <div className="grid gap-4 lg:grid-cols-[1fr_0.95fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Results</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {[
                  ['Monthly EMI', formatCurrency(result.monthly_emi)],
                  ['Loan amount', formatCurrency(result.loan_amount)],
                  ['Total interest', formatCurrency(result.total_interest)],
                  ['Total payment', formatCurrency(result.total_payment)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-900 p-6 text-white shadow-sm">
              <h2 className="text-lg font-semibold">Shareable summary</h2>
              <pre className="mt-4 whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-200">
                {summary}
              </pre>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  onClick={copySummary}
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-100"
                >
                  <Copy className="h-4 w-4" />
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={downloadSummary}
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
                >
                  <Download className="h-4 w-4" />
                  Download text
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmiCalculatorPage;
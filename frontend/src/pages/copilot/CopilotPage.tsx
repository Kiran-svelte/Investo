import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Send, Loader2 } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  replyKind?: string;
}

const CopilotPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const isViewer = user?.role === 'viewer';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);
    setError('');

    try {
      const res = await api.post('/copilot/chat', { message: text });
      const reply = res.data?.data?.reply ?? 'No reply received.';
      const replyKind = res.data?.data?.replyKind;
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: 'assistant', text: reply, replyKind },
      ]);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Could not reach copilot. Try again.';
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="border-b border-surface-border bg-surface px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-ink-primary">
              {t('copilot.title', { defaultValue: 'Investo Copilot' })}
            </h1>
            <p className="text-sm text-ink-secondary">
              {isViewer
                ? t('copilot.viewer_hint', {
                    defaultValue: 'Read-only mode — queries and reports only.',
                  })
                : t('copilot.hint', {
                    defaultValue: 'Same AI as WhatsApp copilot — visits, leads, properties.',
                  })}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-2xl rounded-2xl border border-dashed border-surface-border bg-surface-subtle p-8 text-center">
            <Bot className="mx-auto mb-3 h-8 w-8 text-brand-600" />
            <p className="text-sm text-ink-secondary">
              {t('copilot.empty', {
                defaultValue: 'Try "visits today", "new leads today", or "get lead Rahul".',
              })}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-brand-600 text-white'
                      : 'border border-surface-border bg-surface text-ink-primary'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <form
        onSubmit={sendMessage}
        className="border-t border-surface-border bg-surface px-4 py-4 sm:px-6"
      >
        <div className="mx-auto flex max-w-2xl gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={1200}
            placeholder={t('copilot.placeholder', { defaultValue: 'Ask copilot…' })}
            className="flex-1 rounded-xl border border-surface-border bg-surface px-4 py-3 text-sm outline-none focus:border-brand-500"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t('copilot.send', { defaultValue: 'Send' })}
          </button>
        </div>
        {error ? <p className="mx-auto mt-2 max-w-2xl text-sm text-red-600">{error}</p> : null}
      </form>
    </div>
  );
};

export default CopilotPage;

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { getRoleCapabilities } from '../../config/navigation.config';
import { SOCKET_EVENTS, useSocketEvent } from '../../context/SocketContext';
import api from '../../services/api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import Pagination from '../../components/common/Pagination';
import useConfirmDialog from '../../hooks/useConfirmDialog';
import {
  Search, MessageSquare, User, Bot, UserCheck,
  ArrowRight, Trash2, Loader2,
} from 'lucide-react';
import { deleteConversation } from '../../services/resourceDelete';

interface Conversation {
  id: string;
  lead_id: string;
  customer_name: string | null;
  customer_phone: string;
  status: string;
  language: string;
  ai_enabled: boolean;
  updated_at: string;
  last_message?: {
    content: string;
    sender_type: string;
    created_at: string;
  };
}

interface Message {
  id: string;
  sender_type: 'customer' | 'ai' | 'agent';
  content: string;
  language: string;
  created_at: string;
}

type ComposerMode = 'text' | 'document' | 'quick_reply';

const ConversationsPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const capabilities = getRoleCapabilities(user?.role);
  const { confirm, Dialog } = useConfirmDialog();
  const [searchParams] = useSearchParams();
  const openConversationId = searchParams.get('id');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [composerMode, setComposerMode] = useState<ComposerMode>('text');
  const [textMessage, setTextMessage] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');
  const [documentFilename, setDocumentFilename] = useState('');
  const [documentCaption, setDocumentCaption] = useState('');
  const [quickReplyBody, setQuickReplyBody] = useState('');
  const [quickReplyHeader, setQuickReplyHeader] = useState('');
  const [quickReplyFooter, setQuickReplyFooter] = useState('');
  const [quickReplyButtons, setQuickReplyButtons] = useState<Array<{ id: string; title: string }>>([
    { id: '', title: '' },
  ]);
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [convPage, setConvPage] = useState(1);
  const [convTotalPages, setConvTotalPages] = useState(1);
  const [convTotal, setConvTotal] = useState(0);
  const [msgPage, setMsgPage] = useState(1);
  const [msgTotalPages, setMsgTotalPages] = useState(1);

  useEffect(() => {
    loadConversations();
  }, [search, convPage, openConversationId]);

  useEffect(() => {
    if (!openConversationId || selectedConv?.id === openConversationId) return;
    const match = conversations.find((c) => c.id === openConversationId);
    if (match) setSelectedConv(match);
  }, [openConversationId, conversations, selectedConv?.id]);

  useEffect(() => {
    setConvPage(1);
  }, [search]);

  useEffect(() => {
    if (selectedConv) {
      setMsgPage(1);
    }
  }, [selectedConv?.id]);

  useEffect(() => {
    if (selectedConv) {
      loadMessages(selectedConv.id, msgPage);
      setSendError(null);
    }
  }, [selectedConv, msgPage]);

  useSocketEvent(
    SOCKET_EVENTS.CONVERSATION_UPDATED,
    (event: { conversationId?: string }) => {
      loadConversations();
      if (event?.conversationId && event.conversationId === selectedConv?.id) {
        loadMessages(event.conversationId);
      }
    }
  );

  const normalizeMessage = (raw: any): Message => ({
    id: raw.id,
    sender_type: (raw.sender_type || raw.senderType) as Message['sender_type'],
    content: raw.content,
    language: raw.language || 'en',
    created_at: raw.created_at || raw.createdAt || new Date().toISOString(),
  });

  const loadConversations = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      params.append('page', String(convPage));
      params.append('limit', '25');
      const res = await api.get(`/conversations?${params.toString()}`);
      const list = res.data.data || [];
      setConversations(list);
      setConvTotalPages(res.data.pagination?.pages || 1);
      setConvTotal(res.data.pagination?.total || 0);
      if (openConversationId) {
        const match = list.find((c: Conversation) => c.id === openConversationId);
        if (match) {
          setSelectedConv(match);
        } else {
          try {
            const detail = await api.get(`/conversations/${openConversationId}`);
            const conv = detail.data.data as Conversation;
            if (conv?.id) setSelectedConv(conv);
          } catch {
            // Deep link invalid or no access — list still shown
          }
        }
      }
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 423) {
        const payload = err.response.data as { message?: string; error?: string };
        setLoadError(payload.message || payload.error || 'Complete your property catalog before viewing conversations.');
      } else {
        setLoadError('Failed to load conversations. Try refreshing the page.');
      }
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (convId: string, page = 1) => {
    try {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', '50');
      params.append('sort', 'desc');
      const res = await api.get(`/conversations/${convId}?${params.toString()}`);
      const convDetail = res.data.data as Conversation & { messages?: unknown[] };
      const apiMessages = (convDetail.messages || []).map((msg: any) => normalizeMessage(msg));
      setMessages(apiMessages);
      setMsgTotalPages(res.data.pagination?.pages || 1);
      if (convDetail?.id) {
        setSelectedConv((prev) =>
          prev?.id === convDetail.id
            ? {
                ...prev,
                status: convDetail.status ?? prev.status,
                ai_enabled: convDetail.ai_enabled ?? prev.ai_enabled,
              }
            : prev,
        );
      }
    } catch {
      // Message load failure is non-fatal — conversation view stays open
    }
  };

  const applyConversationControlState = (
    convId: string,
    patch: Pick<Conversation, 'status' | 'ai_enabled'>,
  ) => {
    setSelectedConv((prev) => (prev?.id === convId ? { ...prev, ...patch } : prev));
    setConversations((prev) =>
      prev.map((conv) => (conv.id === convId ? { ...conv, ...patch } : conv)),
    );
  };

  const takeOver = async (convId: string) => {
    try {
      await api.patch(`/conversations/${convId}/takeover`);
      applyConversationControlState(convId, { status: 'agent_active', ai_enabled: false });
      loadConversations();
    } catch (err: any) {
      setLoadError(getApiErrorMessage(err, 'Failed to take over conversation.'));
    }
  };

  const removeConversation = async (convId: string) => {
    const confirmed = await confirm(
      'Delete conversation?',
      'This conversation and all of its messages will be permanently removed from the database.',
      { confirmLabel: 'Delete' },
    );
    if (!confirmed) return;
    setDeleteLoading(true);
    try {
      await deleteConversation(convId);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (selectedConv?.id === convId) {
        setSelectedConv(null);
        setMessages([]);
      }
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string } } };
      setLoadError(getApiErrorMessage(ax, 'Failed to delete conversation'));
    } finally {
      setDeleteLoading(false);
    }
  };

  const release = async (convId: string) => {
    try {
      await api.patch(`/conversations/${convId}/release`);
      applyConversationControlState(convId, { status: 'ai_active', ai_enabled: true });
      loadConversations();
    } catch (err: any) {
      setLoadError(getApiErrorMessage(err, 'Failed to release conversation.'));
    }
  };

  const updateQuickReplyButton = (index: number, key: 'id' | 'title', value: string) => {
    setQuickReplyButtons((prev) => prev.map((button, idx) => {
      if (idx !== index) return button;
      return { ...button, [key]: value };
    }));
  };

  const addQuickReplyButton = () => {
    setQuickReplyButtons((prev) => {
      if (prev.length >= 3) return prev;
      return [...prev, { id: '', title: '' }];
    });
  };

  const removeQuickReplyButton = (index: number) => {
    setQuickReplyButtons((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, idx) => idx !== index);
    });
  };

  const sendMessage = async () => {
    if (!selectedConv || sendLoading) {
      return;
    }

    setSendError(null);

    let payload: any;

    if (composerMode === 'text') {
      const text = textMessage.trim();
      if (!text) {
        setSendError('Text message is required');
        return;
      }
      payload = { mode: 'text', text };
    } else if (composerMode === 'document') {
      const url = documentUrl.trim();
      if (!url) {
        setSendError('Document URL is required');
        return;
      }
      payload = {
        mode: 'document',
        document_url: url,
        filename: documentFilename.trim() || undefined,
        caption: documentCaption.trim() || undefined,
      };
    } else {
      const bodyText = quickReplyBody.trim();
      if (!bodyText) {
        setSendError('Quick-reply body text is required');
        return;
      }

      const buttons = quickReplyButtons
        .map((button) => ({ id: button.id.trim(), title: button.title.trim() }))
        .filter((button) => button.id && button.title);

      if (buttons.length === 0) {
        setSendError('At least one quick-reply button is required');
        return;
      }

      payload = {
        mode: 'quick_reply',
        body_text: bodyText,
        header_text: quickReplyHeader.trim() || undefined,
        footer_text: quickReplyFooter.trim() || undefined,
        buttons,
      };
    }

    try {
      setSendLoading(true);
      const res = await api.post(`/conversations/${selectedConv.id}/messages`, payload);
      const sentMessage = normalizeMessage(res.data.data);

      setMessages((prev) => [...prev, sentMessage]);
      setConversations((prev) => prev.map((conv) => {
        if (conv.id !== selectedConv.id) {
          return conv;
        }
        return {
          ...conv,
          status: res.data.conversation_status || conv.status,
          updated_at: sentMessage.created_at,
          last_message: {
            content: sentMessage.content,
            sender_type: sentMessage.sender_type,
            created_at: sentMessage.created_at,
          },
        };
      }));
      setSelectedConv((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: res.data.conversation_status || prev.status,
          updated_at: sentMessage.created_at,
          last_message: {
            content: sentMessage.content,
            sender_type: sentMessage.sender_type,
            created_at: sentMessage.created_at,
          },
        };
      });

      if (composerMode === 'text') {
        setTextMessage('');
      } else if (composerMode === 'document') {
        setDocumentUrl('');
        setDocumentFilename('');
        setDocumentCaption('');
      } else {
        setQuickReplyBody('');
        setQuickReplyHeader('');
        setQuickReplyFooter('');
        setQuickReplyButtons([{ id: '', title: '' }]);
      }
    } catch (err: any) {
      setSendError(getApiErrorMessage(err, 'Failed to send message'));
    } finally {
      setSendLoading(false);
    }
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const isHumanTakeover = Boolean(
    selectedConv && (selectedConv.status === 'agent_active' || !selectedConv.ai_enabled),
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] max-w-[100vw] overflow-hidden">
      {/* Conversation List */}
      <div
        className={`w-full md:w-80 lg:w-96 border-r border-surface-border flex flex-col bg-surface-elevated ${
          selectedConv ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="p-4 border-b border-surface-border">
          <h1 className="text-xl font-bold text-ink-primary mb-3">
            {t('conversations.title')}
          </h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
            <input
              type="text"
              placeholder={t('common.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
            />
          </div>
        </div>

        {loadError && (
          <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {loadError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-ink-muted">{t('common.loading')}</div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-ink-muted">{t('common.no_data')}</div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => setSelectedConv(conv)}
                className={`p-4 border-b border-surface-border cursor-pointer hover:bg-surface-muted transition-colors ${
                  selectedConv?.id === conv.id ? 'bg-brand-50' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-surface-subtle flex items-center justify-center flex-shrink-0">
                    <User className="h-5 w-5 text-ink-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-ink-primary truncate">
                        {conv.customer_name || conv.customer_phone}
                      </p>
                      <span className="text-xs text-ink-muted">
                        {formatTime(conv.updated_at)}
                      </span>
                    </div>
                    {conv.last_message && (
                      <p className="text-sm text-ink-muted truncate mt-0.5">
                        {conv.last_message.sender_type === 'ai' && '🤖 '}
                        {conv.last_message.content}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          conv.status === 'ai_active'
                            ? 'bg-green-100 text-green-700'
                            : conv.status === 'agent_active'
                            ? 'bg-brand-100 text-brand-800'
                            : 'bg-surface-subtle text-ink-secondary'
                        }`}
                      >
                        {conv.status === 'ai_active'
                          ? 'AI'
                          : conv.status === 'agent_active'
                          ? 'Agent'
                          : 'Closed'}
                      </span>
                      <span className="text-xs text-ink-faint">{conv.language.toUpperCase()}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-surface-border p-2">
          <Pagination
            page={convPage}
            totalPages={convTotalPages}
            total={convTotal}
            onPageChange={setConvPage}
            label="conversations"
          />
        </div>
      </div>

      {/* Chat View */}
      <div
        className={`flex-1 flex flex-col bg-surface-muted ${
          selectedConv ? 'flex' : 'hidden md:flex'
        }`}
      >
        {selectedConv ? (
          <>
            {/* Chat Header */}
            <div className="bg-surface-elevated border-b border-surface-border p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedConv(null)}
                  aria-label="Back to conversation list"
                  className="md:hidden p-1 hover:bg-surface-subtle rounded"
                >
                  <ArrowRight className="h-5 w-5 text-ink-secondary rotate-180" />
                </button>
                <div className="w-10 h-10 rounded-full bg-surface-subtle flex items-center justify-center">
                  <User className="h-5 w-5 text-ink-muted" />
                </div>
                <div>
                  <p className="font-medium text-ink-primary">
                    {selectedConv.customer_name || selectedConv.customer_phone}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {selectedConv.customer_phone} • {selectedConv.language.toUpperCase()}
                  </p>
                  <span
                    className={`inline-flex mt-1 text-xs px-2 py-0.5 rounded-full ${
                      selectedConv.status === 'ai_active' && selectedConv.ai_enabled
                        ? 'bg-green-100 text-green-700'
                        : isHumanTakeover
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-surface-subtle text-ink-secondary'
                    }`}
                  >
                    {selectedConv.status === 'ai_active' && selectedConv.ai_enabled
                      ? 'AI active'
                      : isHumanTakeover
                      ? 'Human takeover'
                      : selectedConv.status === 'closed'
                      ? 'Closed'
                      : selectedConv.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {capabilities.canTakeoverConversation && selectedConv.status === 'ai_active' ? (
                  <button
                    onClick={() => takeOver(selectedConv.id)}
                    className="px-3 py-1.5 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 flex items-center gap-1"
                  >
                    <UserCheck className="h-4 w-4" />
                    {t('conversations.takeover')}
                  </button>
                ) : capabilities.canTakeoverConversation && selectedConv.status === 'agent_active' ? (
                  <button
                    onClick={() => release(selectedConv.id)}
                    className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 flex items-center gap-1"
                  >
                    <Bot className="h-4 w-4" />
                    {t('conversations.release')}
                  </button>
                ) : null}
                {capabilities.canTakeoverConversation && (
                  <button
                    type="button"
                    onClick={() => removeConversation(selectedConv.id)}
                    disabled={deleteLoading}
                    className="px-3 py-1.5 border border-red-200 text-red-700 text-sm rounded-lg hover:bg-red-50 flex items-center gap-1 disabled:opacity-50"
                  >
                    {deleteLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Delete
                  </button>
                )}
              </div>
            </div>

            {isHumanTakeover && (
              <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start sm:items-center gap-2 text-sm text-amber-900">
                  <UserCheck className="h-4 w-4 flex-shrink-0 mt-0.5 sm:mt-0" />
                  <span>
                    Human takeover active — AI replies are paused until you release this conversation.
                  </span>
                </div>
                {capabilities.canTakeoverConversation && (
                  <button
                    onClick={() => release(selectedConv.id)}
                    className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 flex items-center justify-center gap-1 self-start sm:self-auto"
                  >
                    <Bot className="h-4 w-4" />
                    {t('conversations.release')}
                  </button>
                )}
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg) => {
                const isCustomer = msg.sender_type === 'customer';
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-[min(85%,20rem)] rounded-2xl px-3 py-2 text-sm sm:px-4 sm:text-base ${
                        isCustomer
                          ? 'bg-surface-elevated border border-surface-border'
                          : msg.sender_type === 'ai'
                          ? 'bg-green-100 text-green-900'
                          : 'bg-brand-600 text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {msg.sender_type === 'ai' && <Bot className="h-3 w-3" />}
                        {msg.sender_type === 'agent' && <UserCheck className="h-3 w-3" />}
                        <span className="text-xs opacity-75">
                          {msg.sender_type === 'customer'
                            ? 'Customer'
                            : msg.sender_type === 'ai'
                            ? 'AI'
                            : 'Agent'}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      <p
                        className={`text-xs mt-1 ${
                          isCustomer ? 'text-ink-faint' : 'opacity-75'
                        }`}
                      >
                        {new Date(msg.created_at).toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            {msgTotalPages > 1 && (
              <div className="border-t border-surface-border bg-surface-elevated px-4 py-2">
                <Pagination
                  page={msgPage}
                  totalPages={msgTotalPages}
                  total={0}
                  onPageChange={setMsgPage}
                  label="messages"
                />
              </div>
            )}

            {/* Composer */}
            {capabilities.canTakeoverConversation ? (
            <div className="bg-surface-elevated border-t border-surface-border p-4">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setComposerMode('text')}
                    className={`px-3 py-1.5 rounded-lg text-sm border ${
                      composerMode === 'text'
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-surface-elevated text-ink-secondary border-surface-border-strong'
                    }`}
                  >
                    Text
                  </button>
                  <button
                    onClick={() => setComposerMode('document')}
                    className={`px-3 py-1.5 rounded-lg text-sm border ${
                      composerMode === 'document'
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-surface-elevated text-ink-secondary border-surface-border-strong'
                    }`}
                  >
                    Document
                  </button>
                  <button
                    onClick={() => setComposerMode('quick_reply')}
                    className={`px-3 py-1.5 rounded-lg text-sm border ${
                      composerMode === 'quick_reply'
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-surface-elevated text-ink-secondary border-surface-border-strong'
                    }`}
                  >
                    Quick Reply
                  </button>
                </div>

                {composerMode === 'text' && (
                  <textarea
                    value={textMessage}
                    onChange={(e) => setTextMessage(e.target.value)}
                    placeholder="Type a message"
                    rows={3}
                    className="w-full px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
                  />
                )}

                {composerMode === 'document' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      type="url"
                      value={documentUrl}
                      onChange={(e) => setDocumentUrl(e.target.value)}
                      placeholder="Document URL (https://...)"
                      className="md:col-span-2 px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
                    />
                    <input
                      type="text"
                      value={documentFilename}
                      onChange={(e) => setDocumentFilename(e.target.value)}
                      placeholder="Filename (optional)"
                      className="px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
                    />
                    <input
                      type="text"
                      value={documentCaption}
                      onChange={(e) => setDocumentCaption(e.target.value)}
                      placeholder="Caption (optional)"
                      className="px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
                    />
                  </div>
                )}

                {composerMode === 'quick_reply' && (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={quickReplyBody}
                      onChange={(e) => setQuickReplyBody(e.target.value)}
                      placeholder="Quick-reply message body"
                      className="w-full px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={quickReplyHeader}
                        onChange={(e) => setQuickReplyHeader(e.target.value)}
                        placeholder="Header (optional)"
                        className="px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
                      />
                      <input
                        type="text"
                        value={quickReplyFooter}
                        onChange={(e) => setQuickReplyFooter(e.target.value)}
                        placeholder="Footer (optional)"
                        className="px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
                      />
                    </div>

                    {quickReplyButtons.map((button, index) => (
                      <div key={`button-${index}`} className="grid grid-cols-12 gap-2 items-center">
                        <input
                          type="text"
                          value={button.id}
                          onChange={(e) => updateQuickReplyButton(index, 'id', e.target.value)}
                          placeholder={`Button ${index + 1} ID`}
                          className="col-span-5 px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
                        />
                        <input
                          type="text"
                          value={button.title}
                          onChange={(e) => updateQuickReplyButton(index, 'title', e.target.value)}
                          placeholder={`Button ${index + 1} Title`}
                          className="col-span-5 px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
                        />
                        <button
                          onClick={() => removeQuickReplyButton(index)}
                          disabled={quickReplyButtons.length <= 1}
                          className="col-span-2 px-2 py-2 border border-surface-border-strong text-ink-secondary rounded-lg text-sm disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    ))}

                    <button
                      onClick={addQuickReplyButton}
                      disabled={quickReplyButtons.length >= 3}
                      className="px-3 py-1.5 border border-surface-border-strong rounded-lg text-sm text-ink-secondary disabled:opacity-50"
                    >
                      Add Button
                    </button>
                  </div>
                )}

                {sendError && (
                  <p className="text-sm text-red-600">{sendError}</p>
                )}

                <div className="flex items-center justify-between">
                  <p className="text-xs text-ink-muted">
                    Sending as {user?.name || 'Agent'}
                  </p>
                  <button
                    onClick={sendMessage}
                    disabled={sendLoading}
                    className="px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 disabled:opacity-60"
                  >
                    {sendLoading ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </div>
            </div>
            ) : (
              <div className="border-t border-surface-border bg-surface-elevated p-4 text-sm text-ink-muted">
                You can read this conversation, but your role cannot send messages or change takeover state.
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-ink-muted">
            <div className="text-center">
              <MessageSquare className="h-12 w-12 mx-auto text-ink-faint mb-3" />
              <p>Select a conversation to view</p>
            </div>
          </div>
        )}
      </div>
      {Dialog}
    </div>
  );
};

export default ConversationsPage;

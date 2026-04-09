import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { SOCKET_EVENTS, useSocketEvent } from '../../context/SocketContext';
import api from '../../services/api';
import {
  Search, MessageSquare, User, Bot, UserCheck,
  ArrowRight
} from 'lucide-react';

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
  const [conversations, setConversations] = useState<Conversation[]>([]);
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

  useEffect(() => {
    loadConversations();
  }, [search]);

  useEffect(() => {
    if (selectedConv) {
      loadMessages(selectedConv.id);
      setSendError(null);
    }
  }, [selectedConv]);

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
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      const res = await api.get(`/conversations?${params.toString()}`);
      setConversations(res.data.data);
    } catch (err) {
      console.error('Failed to load conversations', err);
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (convId: string) => {
    try {
      const res = await api.get(`/conversations/${convId}`);
      const apiMessages = (res.data.data.messages || []).map((msg: any) => normalizeMessage(msg));
      setMessages(apiMessages);
    } catch (err) {
      console.error('Failed to load messages', err);
    }
  };

  const takeOver = async (convId: string) => {
    try {
      await api.patch(`/conversations/${convId}/takeover`);
      loadConversations();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to take over');
    }
  };

  const release = async (convId: string) => {
    try {
      await api.patch(`/conversations/${convId}/release`);
      loadConversations();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to release');
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
      setSendError(err.response?.data?.error || 'Failed to send message');
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

  return (
    <div className="h-[calc(100vh-64px)] flex">
      {/* Conversation List */}
      <div
        className={`w-full md:w-80 lg:w-96 border-r border-gray-200 flex flex-col bg-white ${
          selectedConv ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-900 mb-3">
            {t('conversations.title')}
          </h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder={t('common.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-gray-500">{t('common.loading')}</div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-gray-500">{t('common.no_data')}</div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => setSelectedConv(conv)}
                className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                  selectedConv?.id === conv.id ? 'bg-blue-50' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <User className="h-5 w-5 text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-gray-900 truncate">
                        {conv.customer_name || conv.customer_phone}
                      </p>
                      <span className="text-xs text-gray-500">
                        {formatTime(conv.updated_at)}
                      </span>
                    </div>
                    {conv.last_message && (
                      <p className="text-sm text-gray-500 truncate mt-0.5">
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
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {conv.status === 'ai_active'
                          ? 'AI'
                          : conv.status === 'agent_active'
                          ? 'Agent'
                          : 'Closed'}
                      </span>
                      <span className="text-xs text-gray-400">{conv.language.toUpperCase()}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chat View */}
      <div
        className={`flex-1 flex flex-col bg-gray-50 ${
          selectedConv ? 'flex' : 'hidden md:flex'
        }`}
      >
        {selectedConv ? (
          <>
            {/* Chat Header */}
            <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedConv(null)}
                  aria-label="Back to conversation list"
                  className="md:hidden p-1 hover:bg-gray-100 rounded"
                >
                  <ArrowRight className="h-5 w-5 text-gray-600 rotate-180" />
                </button>
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                  <User className="h-5 w-5 text-gray-500" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">
                    {selectedConv.customer_name || selectedConv.customer_phone}
                  </p>
                  <p className="text-xs text-gray-500">
                    {selectedConv.customer_phone} • {selectedConv.language.toUpperCase()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selectedConv.status === 'ai_active' ? (
                  <button
                    onClick={() => takeOver(selectedConv.id)}
                    className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 flex items-center gap-1"
                  >
                    <UserCheck className="h-4 w-4" />
                    {t('conversations.takeover')}
                  </button>
                ) : selectedConv.status === 'agent_active' ? (
                  <button
                    onClick={() => release(selectedConv.id)}
                    className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 flex items-center gap-1"
                  >
                    <Bot className="h-4 w-4" />
                    {t('conversations.release')}
                  </button>
                ) : null}
              </div>
            </div>

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
                      className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                        isCustomer
                          ? 'bg-white border border-gray-200'
                          : msg.sender_type === 'ai'
                          ? 'bg-green-100 text-green-900'
                          : 'bg-blue-600 text-white'
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
                          isCustomer ? 'text-gray-400' : 'opacity-75'
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

            {/* Composer */}
            <div className="bg-white border-t border-gray-200 p-4">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setComposerMode('text')}
                    className={`px-3 py-1.5 rounded-lg text-sm border ${
                      composerMode === 'text'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300'
                    }`}
                  >
                    Text
                  </button>
                  <button
                    onClick={() => setComposerMode('document')}
                    className={`px-3 py-1.5 rounded-lg text-sm border ${
                      composerMode === 'document'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300'
                    }`}
                  >
                    Document
                  </button>
                  <button
                    onClick={() => setComposerMode('quick_reply')}
                    className={`px-3 py-1.5 rounded-lg text-sm border ${
                      composerMode === 'quick_reply'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300'
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                )}

                {composerMode === 'document' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      type="url"
                      value={documentUrl}
                      onChange={(e) => setDocumentUrl(e.target.value)}
                      placeholder="Document URL (https://...)"
                      className="md:col-span-2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    />
                    <input
                      type="text"
                      value={documentFilename}
                      onChange={(e) => setDocumentFilename(e.target.value)}
                      placeholder="Filename (optional)"
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    />
                    <input
                      type="text"
                      value={documentCaption}
                      onChange={(e) => setDocumentCaption(e.target.value)}
                      placeholder="Caption (optional)"
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={quickReplyHeader}
                        onChange={(e) => setQuickReplyHeader(e.target.value)}
                        placeholder="Header (optional)"
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                      <input
                        type="text"
                        value={quickReplyFooter}
                        onChange={(e) => setQuickReplyFooter(e.target.value)}
                        placeholder="Footer (optional)"
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>

                    {quickReplyButtons.map((button, index) => (
                      <div key={`button-${index}`} className="grid grid-cols-12 gap-2 items-center">
                        <input
                          type="text"
                          value={button.id}
                          onChange={(e) => updateQuickReplyButton(index, 'id', e.target.value)}
                          placeholder={`Button ${index + 1} ID`}
                          className="col-span-5 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        />
                        <input
                          type="text"
                          value={button.title}
                          onChange={(e) => updateQuickReplyButton(index, 'title', e.target.value)}
                          placeholder={`Button ${index + 1} Title`}
                          className="col-span-5 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        />
                        <button
                          onClick={() => removeQuickReplyButton(index)}
                          disabled={quickReplyButtons.length <= 1}
                          className="col-span-2 px-2 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    ))}

                    <button
                      onClick={addQuickReplyButton}
                      disabled={quickReplyButtons.length >= 3}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 disabled:opacity-50"
                    >
                      Add Button
                    </button>
                  </div>
                )}

                {sendError && (
                  <p className="text-sm text-red-600">{sendError}</p>
                )}

                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    Sending as {user?.name || 'Agent'}
                  </p>
                  <button
                    onClick={sendMessage}
                    disabled={sendLoading}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60"
                  >
                    {sendLoading ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <MessageSquare className="h-12 w-12 mx-auto text-gray-300 mb-3" />
              <p>Select a conversation to view</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConversationsPage;

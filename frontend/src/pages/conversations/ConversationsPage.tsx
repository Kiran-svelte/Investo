import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
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

const ConversationsPage: React.FC = () => {
  const { t } = useTranslation();
  const { user: _user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadConversations();
  }, [search]);

  useEffect(() => {
    if (selectedConv) {
      loadMessages(selectedConv.id);
    }
  }, [selectedConv]);

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
      setMessages(res.data.data.messages || []);
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

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
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

            {/* Input - Disabled for now (agent actions via WhatsApp) */}
            <div className="bg-white border-t border-gray-200 p-4">
              <div className="flex items-center gap-3 text-gray-500 text-sm">
                <MessageSquare className="h-5 w-5" />
                <span>Agent replies are sent via WhatsApp Business app</span>
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

import { useCallback, useEffect, useState } from 'react';
import {
  Activity, Copy, Inbox, LoaderCircle, Mail, Plus, RefreshCw,
  ShieldCheck, Trash2, X
} from 'lucide-react';
import './mailtm-dashboard.css';

const API = 'https://api.mail.tm';

type Domain = {
  id: string;
  domain: string;
  isActive: boolean;
  isPrivate: boolean;
};

type MailAddress = {
  address: string;
  name?: string;
};

type Message = {
  id: string;
  from: MailAddress;
  subject: string;
  intro: string;
  createdAt: string;
  seen: boolean;
};

type Mailbox = {
  id: string;
  address: string;
  password: string;
  token: string;
  expiresAt: number;
};

async function api<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.['hydra:description'] ||
      body?.message ||
      `Mail provider returned HTTP ${response.status}`
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function randomName() {
  return `inbox${Math.random().toString(36).slice(2, 9)}`;
}

function App() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domain, setDomain] = useState('');
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<Message | null>(null);
  const [messageBody, setMessageBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expiresIn, setExpiresIn] = useState('60');
  const [addressName, setAddressName] = useState(randomName());

  useEffect(() => {
    let active = true;

    api<{ 'hydra:member'?: Domain[] }>('/domains')
      .then(result => {
        if (!active) return;
        const available = (result['hydra:member'] || [])
          .filter(item => item.isActive && !item.isPrivate);

        setDomains(available);
        setDomain(available[0]?.domain || '');
      })
      .catch(e => {
        if (active) setError(e instanceof Error ? e.message : 'Unable to load provider domains.');
      });

    return () => { active = false; };
  }, []);

  const refreshInbox = useCallback(async (quiet = false) => {
    if (!mailbox) return;
    if (!quiet) setLoadingInbox(true);

    try {
      const result = await api<{ 'hydra:member'?: Message[] }>(
        '/messages?page=1',
        mailbox.token
      );
      setMessages(result['hydra:member'] || []);
      if (!quiet) setNotice('Inbox refreshed.');
      setError('');
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : 'Unable to refresh inbox.');
    } finally {
      if (!quiet) setLoadingInbox(false);
    }
  }, [mailbox]);

  useEffect(() => {
    if (!mailbox) return;
    void refreshInbox(true);
    const timer = window.setInterval(() => void refreshInbox(true), 10000);
    return () => window.clearInterval(timer);
  }, [mailbox, refreshInbox]);

  async function createInbox() {
    if (!domain) {
      setError('No provider domain is currently available.');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    setSelected(null);
    setMessageBody('');

    const password = `${crypto.randomUUID()}Aa9!`;

    try {
      const account = await api<{ id: string; address: string }>('/accounts', undefined, {
        method: 'POST',
        body: JSON.stringify({
          address: `${addressName.trim().toLowerCase() || randomName()}@${domain}`,
          password,
        }),
      });

      const auth = await api<{ token: string }>('/token', undefined, {
        method: 'POST',
        body: JSON.stringify({ address: account.address, password }),
      });

      setMailbox({
        id: account.id,
        address: account.address,
        password,
        token: auth.token,
        expiresAt: Date.now() + Number(expiresIn) * 60 * 1000,
      });
      setMessages([]);
      setNotice('Your temporary inbox is ready.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to create an inbox.');
    } finally {
      setBusy(false);
    }
  }

  async function openMessage(message: Message) {
    if (!mailbox) return;
    setSelected(message);
    setMessageBody('Loading message…');

    try {
      const result = await api<{
        text?: string;
        intro?: string;
        html?: string | string[];
      }>(`/messages/${message.id}`, mailbox.token);

      // Render untrusted message content as text; never inject provider HTML.
      const body = result.text || result.intro || message.intro || '';
      setMessageBody(body);
    } catch (e) {
      setMessageBody(e instanceof Error ? e.message : 'Unable to load this message.');
    }
  }

  async function deleteInbox() {
    if (!mailbox || !window.confirm('Delete this temporary inbox?')) return;

    setBusy(true);
    try {
      await api<void>(`/accounts/${mailbox.id}`, mailbox.token, {
        method: 'DELETE',
      });
      setMailbox(null);
      setMessages([]);
      setSelected(null);
      setMessageBody('');
      setNotice('Inbox deleted.');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to delete the inbox.');
    } finally {
      setBusy(false);
    }
  }

  async function copyAddress() {
    if (!mailbox) return;
    try {
      await navigator.clipboard.writeText(mailbox.address);
      setNotice('Email address copied.');
    } catch {
      setError('Copy was blocked. Select and copy the address manually.');
    }
  }

  const remaining = mailbox
    ? Math.max(0, Math.ceil((mailbox.expiresAt - Date.now()) / 1000))
    : 0;

  return (
    <div className="mtm-shell">
      <header className="mtm-header">
        <a className="mtm-brand" href="/">
          <span className="mtm-logo"><Mail size={23} /></span>
          <span>Facetime<span>Mail</span></span>
        </a>
        <span className="mtm-secure"><ShieldCheck size={16} /> Temporary inbox</span>
      </header>

      <main className="mtm-main">
        <section className="mtm-hero">
          <div className="mtm-eyebrow"><Activity size={15} /> SIMPLE. PRIVATE. TEMPORARY.</div>
          <h1>Your temporary inbox.</h1>
          <p>Create an email address, receive messages, and keep your personal inbox separate.</p>
        </section>

        {error && (
          <div className="mtm-alert mtm-error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="Dismiss error"><X size={17} /></button>
          </div>
        )}
        {notice && (
          <div className="mtm-alert mtm-notice">
            <span>{notice}</span>
            <button onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={17} /></button>
          </div>
        )}

        <section className="mtm-card">
          <div className="mtm-card-heading">
            <div className="mtm-icon"><Plus size={20} /></div>
            <div>
              <h2>{mailbox ? 'Your email address' : 'Create an inbox'}</h2>
              <p>{mailbox ? 'Use this address to receive messages.' : 'No personal email address required.'}</p>
            </div>
          </div>

          {!mailbox ? (
            <form onSubmit={event => { event.preventDefault(); void createInbox(); }}>
              <label htmlFor="mtm-name">Address name</label>
              <div className="mtm-address-input">
                <input
                  id="mtm-name"
                  value={addressName}
                  onChange={event => setAddressName(event.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))}
                  maxLength={32}
                  placeholder="Choose an address name"
                />
                <span>@</span>
                <select aria-label="Email domain" value={domain} onChange={event => setDomain(event.target.value)}>
                  {domains.map(item => (
                    <option key={item.id} value={item.domain}>{item.domain}</option>
                  ))}
                </select>
              </div>

              <label htmlFor="mtm-expiry">Session timer</label>
              <select id="mtm-expiry" value={expiresIn} onChange={event => setExpiresIn(event.target.value)}>
                <option value="10">10 minutes</option>
                <option value="60">1 hour</option>
                <option value="1440">24 hours</option>
                <option value="10080">7 days</option>
              </select>

              <button className="mtm-primary" type="submit" disabled={busy || !domain}>
                {busy ? <><LoaderCircle className="mtm-spin" size={18} /> Creating inbox…</> : <><Plus size={18} /> Generate email address</>}
              </button>
              {!domains.length && <p className="mtm-hint">Loading available domains or waiting for the provider.</p>}
            </form>
          ) : (
            <>
              <div className="mtm-created-address">
                <span>{mailbox.address}</span>
                <button onClick={() => void copyAddress()} aria-label="Copy address"><Copy size={17} /></button>
              </div>
              <div className="mtm-session-meta">
                <span>Session timer</span>
                <strong>{remaining ? `${Math.floor(remaining / 60)}m ${remaining % 60}s remaining` : 'Timer expired'}</strong>
              </div>
              <div className="mtm-actions">
                <button className="mtm-primary" onClick={() => void refreshInbox()} disabled={loadingInbox}>
                  {loadingInbox ? <LoaderCircle className="mtm-spin" size={17} /> : <RefreshCw size={17} />}
                  Refresh inbox
                </button>
                <button className="mtm-secondary" onClick={() => void deleteInbox()} disabled={busy}>
                  <Trash2 size={17} /> Delete inbox
                </button>
              </div>
              <p className="mtm-hint">
                The timer controls this page's session only. Provider account expiration and message retention
                are governed by Mail.tm.
              </p>
            </>
          )}
        </section>

        <section className="mtm-card mtm-inbox-card">
          <div className="mtm-card-heading">
            <div className="mtm-icon"><Inbox size={20} /></div>
            <div>
              <h2>Inbox</h2>
              <p>{mailbox ? `${messages.length} message(s) received` : 'Your received messages will appear here.'}</p>
            </div>
          </div>

          {!mailbox ? (
            <div className="mtm-empty"><Mail size={28} /><p>Create an address to start receiving email.</p></div>
          ) : messages.length === 0 ? (
            <div className="mtm-empty"><Inbox size={28} /><p>No messages yet. This inbox checks for new messages every 10 seconds.</p></div>
          ) : (
            <div className="mtm-message-list">
              {messages.map(message => (
                <button
                  className={`mtm-message ${selected?.id === message.id ? 'mtm-message-active' : ''}`}
                  key={message.id}
                  onClick={() => void openMessage(message)}
                >
                  <span className="mtm-message-icon"><Mail size={18} /></span>
                  <span className="mtm-message-copy">
                    <strong>{message.subject || '(No subject)'}</strong>
                    <small>{message.from?.address || 'Unknown sender'}</small>
                    <span>{message.intro || 'Open to read message'}</span>
                  </span>
                  <time>{message.createdAt ? new Date(message.createdAt).toLocaleString() : ''}</time>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div className="mtm-message-detail">
              <div className="mtm-detail-heading">
                <h3>{selected.subject || '(No subject)'}</h3>
                <button onClick={() => { setSelected(null); setMessageBody(''); }} aria-label="Close message"><X size={18} /></button>
              </div>
              <p>From: {selected.from?.address || 'Unknown sender'}</p>
              <pre>{messageBody}</pre>
            </div>
          )}
        </section>

        <footer className="mtm-provider-note">
          <ShieldCheck size={17} />
          <p>
            Email service provided by <a href="https://mail.tm/" target="_blank" rel="noreferrer">Mail.tm</a>.
            This interface uses the official Mail.tm API. Provider availability, delivery, retention and terms apply.
          </p>
        </footer>
      </main>
    </div>
  );
}

export default App;

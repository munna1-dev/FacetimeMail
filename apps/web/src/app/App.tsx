import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowDown, Check, CheckCheck, ChevronRight, Clock3,
  Copy, Inbox, LoaderCircle, Mail, Menu, Plus, RefreshCw,
  ShieldCheck, Trash2, X, Zap
} from 'lucide-react';

type Message = {
  id: string;
  from: string;
  subject: string;
  text: string;
  receivedAt: string;
};

type Mailbox = {
  id: string;
  address: string;
  expiresAt: string;
  messages: Message[];
};

type DomainOption = {
  domain: string;
  enabled: boolean;
  status: 'enabled' | 'pending';
};

const API = (import.meta.env.VITE_API_URL || '')
  .replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(typeof sessionStorage !== 'undefined' && sessionStorage.getItem('factormail.mailboxToken')
        ? { 'X-Mailbox-Token': sessionStorage.getItem('factormail.mailboxToken')! }
        : {}),
      ...init?.headers
    }
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function timeLeft(value: string, now: number) {
  const difference = new Date(value).getTime() - now;
  if (!Number.isFinite(difference) || difference <= 0) return 'Expired';
  const minutes = Math.floor(difference / 60_000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours > 0
    ? `${hours}h ${remainingMinutes}m remaining`
    : `${minutes}m remaining`;
}

function Dashboard() {
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [selectedDomain, setSelectedDomain] = useState('');
  const [username, setUsername] = useState('');
  const [domainsLoading, setDomainsLoading] = useState(true);
  const [selected, setSelected] = useState<Message | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const [mobileMenu, setMobileMenu] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [activePage, setActivePage] = useState<'home' | 'inbox' | 'how' | 'privacy'>('home');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;

    request<{ domains: DomainOption[] }>('/api/domains')
      .then(result => {
        if (!active) return;

        const available = result.domains;
        setDomains(available);

        const firstEnabled = available.find(item => item.enabled);
        setSelectedDomain(current =>
          current && available.some(item => item.domain === current && item.enabled)
            ? current
            : firstEnabled?.domain ?? ''
        );
      })
      .catch(e => {
        if (active) {
          setError(e instanceof Error ? e.message : 'Unable to load email domains.');
        }
      })
      .finally(() => {
        if (active) setDomainsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function randomizeUsername() {
    const randomPart = Math.random().toString(36).slice(2, 10);
    setUsername(`user${randomPart}`);
  }

  const createMailbox = useCallback(async () => {
    if (!selectedDomain) {
      setError('No enabled email domain is available yet.');
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');
    setSelected(null);

    try {
      const payload: { domain: string; username?: string } = {
        domain: selectedDomain
      };

      if (username.trim()) payload.username = username.trim();

      const result = await request<Mailbox & { accessToken: string }>('/api/mailboxes', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      sessionStorage.setItem('factormail.mailboxToken', result.accessToken);
      sessionStorage.setItem('factormail.mailboxId', result.id);
      setMailbox(result);
      setLastUpdated(new Date());
      setNotice('Your new inbox is ready.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to create an inbox.');
    } finally {
      setLoading(false);
    }
  }, [selectedDomain, username]);

  const refreshMailbox = useCallback(async (quiet = false) => {
    if (!mailbox) return;

    if (!quiet) setRefreshing(true);
    if (!quiet) setError('');

    try {
      const result = await request<Mailbox>(`/api/mailboxes/${mailbox.id}`);
      setMailbox(result);
      setSelected(current =>
        current ? result.messages.find(message => message.id === current.id) ?? null : null
      );
      setLastUpdated(new Date());
      if (!quiet) setNotice('Inbox refreshed.');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to refresh inbox.';
      if (message.includes('(401)') || message.includes('(404)') ||
          message.includes('Mailbox not found or expired')) {
        setMailbox(null);
        setSelected(null);
        sessionStorage.removeItem('factormail.mailboxToken');
        sessionStorage.removeItem('factormail.mailboxId');
        setError('This inbox has expired or is no longer accessible. Generate a new address to continue.');
      } else if (!quiet) {
        setError(message);
      }
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, [mailbox]);

  useEffect(() => {
    let active = true;
    const mailboxId = sessionStorage.getItem('factormail.mailboxId');
    const accessToken = sessionStorage.getItem('factormail.mailboxToken');

    if (!mailboxId || !accessToken) return;

    request<Mailbox>(`/api/mailboxes/${mailboxId}`)
      .then(result => {
        if (!active) return;
        setMailbox(result);
        setLastUpdated(new Date());
        setNotice('Your previous inbox has been restored.');
      })
      .catch(e => {
        if (!active) return;
        const message = e instanceof Error ? e.message : 'Unable to restore inbox.';
        if (message.includes('(401)') || message.includes('(404)') ||
            message.includes('Mailbox not found or expired')) {
          sessionStorage.removeItem('factormail.mailboxToken');
          sessionStorage.removeItem('factormail.mailboxId');
          setError('Your previous inbox has expired or is no longer accessible. Generate a new address.');
        } else {
          setError(`Could not restore your inbox: ${message}`);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const refreshMailboxRef = useRef(refreshMailbox);
  refreshMailboxRef.current = refreshMailbox;

  useEffect(() => {
    if (!mailbox?.id) return;
    const timer = setInterval(() => {
      void refreshMailboxRef.current(true);
    }, 10_000);
    return () => clearInterval(timer);
  }, [mailbox?.id]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  async function copyAddress() {
    if (!mailbox) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(mailbox.address);
      } else {
        const input = document.createElement('textarea');
        input.value = mailbox.address;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        const success = document.execCommand('copy');
        input.remove();
        if (!success) throw new Error('Copy was blocked by the browser.');
      }

      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Unable to copy automatically. Select and copy the address instead.');
    }
  }

  function handleCreateStep() {
    setActivePage('inbox');
    if (!mailbox && !loading) void createMailbox();
  }

  function handleUseStep() {
    setActivePage('inbox');
    if (mailbox) {
      void copyAddress();
    } else if (!loading) {
      void createMailbox();
    }
  }

  function handleCheckStep() {
    setActivePage('inbox');
    if (mailbox) {
      void refreshMailbox();
    } else if (!loading) {
      void createMailbox();
    }
  }

  async function deleteMailbox() {
    if (!mailbox) return;
    if (!window.confirm('Delete this temporary inbox? This cannot be undone.')) return;

    setLoading(true);
    setError('');

    try {
      await request<{ success: boolean }>(`/api/mailboxes/${mailbox.id}`, {
        method: 'DELETE'
      });
      setMailbox(null);
      setSelected(null);
      sessionStorage.removeItem('factormail.mailboxToken');
      sessionStorage.removeItem('factormail.mailboxId');
      setNotice('Inbox deleted. Create another whenever you need one.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to delete inbox.');
    } finally {
      setLoading(false);
    }
  }

  const messages = mailbox?.messages ?? [];

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand brand-svg" href="#home" aria-label="FactorMailService home" onClick={(event) => { event.preventDefault(); setActivePage('home'); setMobileMenu(false); }}>
          <img
            className="brand-logo-image"
            src="/factormail-logo.svg"
            alt="FactorMailService"
            width="210"
            height="50"
          />
        </a>

        <button
          className="mobile-menu-button"
          aria-label="Toggle navigation"
          onClick={() => setMobileMenu(!mobileMenu)}
        >
          {mobileMenu ? <X size={21} /> : <Menu size={21} />}
        </button>

        <nav className={`topnav ${mobileMenu ? 'topnav-open' : ''}`}>
          <a
            className={`nav-link ${activePage === 'home' ? 'nav-active' : ''}`}
            href="#home"
            onClick={(event) => { event.preventDefault(); setActivePage('home'); setMobileMenu(false); }}
          >
            <Mail size={16} /> Home
          </a>
          <a
            className={`nav-link ${activePage === 'inbox' ? 'nav-active' : ''}`}
            href="#inbox"
            onClick={(event) => { event.preventDefault(); setActivePage('inbox'); setMobileMenu(false); }}
          >
            <Inbox size={16} /> My inbox
          </a>
          <a
            className={`nav-link ${activePage === 'how' ? 'nav-active' : ''}`}
            href="#how-it-works"
            onClick={(event) => { event.preventDefault(); setActivePage('how'); setMobileMenu(false); }}
          >
            How it works
          </a>
          <a
            className={`nav-link ${activePage === 'privacy' ? 'nav-active' : ''}`}
            href="#privacy"
            onClick={(event) => { event.preventDefault(); setActivePage('privacy'); setMobileMenu(false); }}
          >
            Privacy
          </a>
        </nav>

        <div className="topbar-status">
          <span className="status-dot" /> Service preview
        </div>
      </header>

      <main>
        {activePage === 'home' && (
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><Zap size={14} /> SIMPLE. FAST. TEMPORARY.</div>
            <h1>Your inbox.<br /><span>On your terms.</span></h1>
            <p>
              Get a temporary email address in seconds. Keep your personal
              inbox private and reduce unwanted mail.
            </p>
            <div className="hero-points">
              <span><CheckCircleIcon /> No signup required</span>
              <span><CheckCircleIcon /> Quick setup</span>
              <span><CheckCircleIcon /> Mobile friendly</span>
            </div>
            <button type="button" className="button button-primary" onClick={() => setActivePage('inbox')}>
              <Inbox size={18} /> Open My Inbox
            </button>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="visual-glow" />
            <div className="visual-card">
              <div className="visual-card-top">
                <span className="visual-icon"><Mail size={22} /></span>
                <span className="visual-tag">TEMPORARY INBOX</span>
              </div>
              <div className="visual-line visual-line-long" />
              <div className="visual-line visual-line-short" />
              <div className="visual-message">
                <span className="visual-avatar">F</span>
                <span className="visual-message-lines">
                  <span className="visual-line visual-line-medium" />
                  <span className="visual-line visual-line-small" />
                </span>
                <span className="visual-unread" />
              </div>
              <div className="visual-message">
                <span className="visual-avatar avatar-purple">M</span>
                <span className="visual-message-lines">
                  <span className="visual-line visual-line-medium" />
                  <span className="visual-line visual-line-small" />
                </span>
              </div>
            </div>
            <div className="floating-badge"><ShieldCheck size={19} /><span><b>Privacy first</b><small>Your personal email stays yours</small></span></div>
          </div>
        </section>
        )}

        {activePage === 'inbox' && (
        <section className="workspace" id="inbox">
          <div className="workspace-heading">
            <div>
              <div className="section-kicker">YOUR WORKSPACE</div>
              <h2>Temporary inbox</h2>
              <p>One place for the messages you need right now.</p>
            </div>
            <button className="button button-primary create-button" onClick={createMailbox} disabled={loading}>
              {loading ? <LoaderCircle className="spin" size={18} /> : <Plus size={19} />}
              {mailbox ? 'Create new address' : 'Generate an address'}
            </button>
          </div>

          {error && (
            <div className="alert alert-error" role="alert">
              <span>{error}</span>
              <button onClick={() => setError('')} aria-label="Dismiss error"><X size={17} /></button>
            </div>
          )}
          {notice && (
            <div className="alert alert-success" role="status">
              <Check size={17} /><span>{notice}</span>
              <button onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={17} /></button>
            </div>
          )}

          <div className="mailbox-card">
            <div className="mailbox-card-heading">
              <div className="mailbox-title">
                <span className="mailbox-icon"><Mail size={20} /></span>
                <div>
                  <h3>Your email address</h3>
                  <p>Use this address wherever you need a temporary inbox.</p>
                </div>
              </div>
              {mailbox && <span className="live-pill"><span className="status-dot" /> ACTIVE</span>}
            </div>

            <div className="mailbox-options">
              <div className="mailbox-option">
                <label htmlFor="mailbox-username">Customize username</label>
                <div className="username-control">
                  <input
                    id="mailbox-username"
                    type="text"
                    value={username}
                    onChange={event => setUsername(event.target.value)}
                    placeholder="e.g. alex2026"
                    maxLength={64}
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby="username-help"
                  />
                  <button
                    type="button"
                    className="button button-secondary randomize-button"
                    onClick={randomizeUsername}
                  >
                    Randomize
                  </button>
                </div>
                <small id="username-help">
                  Letters, numbers, dots, underscores, plus signs and hyphens.
                  Leave blank to generate a random username.
                </small>
              </div>

              <div className="mailbox-option">
                <label htmlFor="mailbox-domain">Choose email domain</label>
                <select
                  id="mailbox-domain"
                  value={selectedDomain}
                  onChange={event => setSelectedDomain(event.target.value)}
                  disabled={domainsLoading || !domains.some(item => item.enabled)}
                >
                  {domains.length === 0 && (
                    <option value="">
                      {domainsLoading ? 'Loading domains...' : 'No domains available'}
                    </option>
                  )}
                  {domains.map(item => (
                    <option
                      key={item.domain}
                      value={item.domain}
                      disabled={!item.enabled}
                    >
                      {item.domain}{item.enabled ? ' — Available' : ' — Pending setup'}
                    </option>
                  ))}
                </select>
                <small>
                  {domainsLoading
                    ? 'Checking domain availability...'
                    : domains.some(item => item.enabled)
                      ? 'Pending domains cannot be selected until configured.'
                      : 'No domain is enabled. Configure a receiving domain on the server.'}
                </small>
              </div>
            </div>

            <div className={`address-box ${!mailbox ? 'address-empty' : ''}`}>
              <span className="address-text">
                {mailbox?.address ?? 'Your new email address will appear here'}
              </span>
              {mailbox && (
                <button className="button button-copy" onClick={copyAddress}>
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                  {copied ? 'Copied!' : 'Copy address'}
                </button>
              )}
            </div>

            <div className="mailbox-meta">
              <div className="meta-item">
                <Clock3 size={17} />
                <span>
                  <small>Mailbox expiry</small>
                  <b>{mailbox ? timeLeft(mailbox.expiresAt, now) : 'Not started'}</b>
                </span>
              </div>
              <div className="meta-item">
                <Activity size={17} />
                <span>
                  <small>Inbox status</small>
                  <b>{mailbox ? 'Ready for messages' : 'No active mailbox'}</b>
                </span>
              </div>
              <div className="meta-item">
                <Inbox size={17} />
                <span>
                  <small>Total messages</small>
                  <b>{messages.length} {messages.length === 1 ? 'message' : 'messages'}</b>
                </span>
              </div>
            </div>
          </div>

          <div className="inbox-panel">
            <div className="inbox-header">
              <div className="inbox-heading">
                <div className="inbox-heading-icon"><Inbox size={19} /></div>
                <div>
                  <h3>Received messages</h3>
                  <p>
                    {lastUpdated
                      ? `Last checked ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                      : 'Messages will appear here'}
                  </p>
                </div>
              </div>
              <div className="inbox-actions">
                <button
                  className="button button-secondary icon-button"
                  onClick={() => void refreshMailbox()}
                  disabled={!mailbox || refreshing}
                  aria-label="Refresh inbox"
                  title="Refresh inbox"
                >
                  <RefreshCw size={17} className={refreshing ? 'spin' : ''} />
                  <span>Refresh</span>
                </button>
                {mailbox && (
                  <button className="button button-danger icon-button" onClick={deleteMailbox} disabled={loading} aria-label="Delete mailbox">
                    <Trash2 size={17} /><span>Delete</span>
                  </button>
                )}
              </div>
            </div>

            {!mailbox ? (
              <div className="empty-state">
                <div className="empty-icon"><Mail size={27} /></div>
                <h4>Your inbox is waiting</h4>
                <p>Generate a temporary address to get started. Your messages will appear here when the email service receives them.</p>
                <button className="button button-primary" onClick={createMailbox} disabled={loading}>
                  {loading ? <LoaderCircle className="spin" size={17} /> : <Plus size={18} />}
                  Generate email address
                </button>
              </div>
            ) : messages.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"><Inbox size={27} /></div>
                <h4>Nothing in your inbox yet</h4>
                <p>Your inbox is ready. When the connected email service delivers a message, it will show up here.</p>
                <div className="waiting-indicator"><span className="status-dot" /> Checking automatically every 10 seconds</div>
              </div>
            ) : (
              <div className="message-list">
                {messages.map(message => (
                  <button
                    className={`message-row ${selected?.id === message.id ? 'message-row-selected' : ''}`}
                    key={message.id}
                    onClick={() => setSelected(message)}
                  >
                    <span className="message-avatar">{(message.from[0] || '?').toUpperCase()}</span>
                    <span className="message-summary">
                      <b>{message.from}</b>
                      <strong>{message.subject || '(No subject)'}</strong>
                      <span>{message.text.slice(0, 100)}</span>
                    </span>
                    <span className="message-date">{formatDate(message.receivedAt)}</span>
                    <ChevronRight className="message-chevron" size={17} />
                  </button>
                ))}
              </div>
            )}

            {selected && (
              <div className="message-detail">
                <div className="detail-top">
                  <div>
                    <div className="section-kicker">MESSAGE DETAILS</div>
                    <h3>{selected.subject || '(No subject)'}</h3>
                    <p>From: {selected.from}</p>
                    <p>Received: {formatDate(selected.receivedAt)}</p>
                  </div>
                  <button className="button button-secondary detail-close" onClick={() => setSelected(null)}>
                    <X size={17} /> Close
                  </button>
                </div>
                <div className="message-body">{selected.text}</div>
              </div>
            )}
          </div>

          <div className="notice-strip">
            <ShieldCheck size={19} />
            <p><b>A note about this preview:</b> This project currently creates local test inboxes only. Real incoming email requires a configured domain and inbound email provider. Do not use preview inboxes for sensitive information.</p>
          </div>
        </section>
        )}

        {activePage === 'how' && (
        <section className="how-section" id="how-it-works">
          <div className="section-kicker">GET STARTED IN SECONDS</div>
          <h2>Simple by design.</h2>
          <p className="how-subtitle">A straightforward way to keep temporary messages separate from your personal inbox.</p>
          <div className="steps-grid">
            <article
              className="step-card step-card-action"
              role="button"
              tabIndex={0}
              onClick={handleCreateStep}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleCreateStep();
                }
              }}
            >
              <span className="step-number">01</span>
              <div className="step-icon"><Plus size={22} /></div>
              <h3>Create an address</h3>
              <p>Generate a new temporary address without creating an account.</p>
            </article>
            <article
              className="step-card step-card-action"
              role="button"
              tabIndex={0}
              onClick={handleUseStep}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleUseStep();
                }
              }}
            >
              <span className="step-number">02</span>
              <div className="step-icon"><Copy size={22} /></div>
              <h3>Use it anywhere</h3>
              <p>Copy the address and use it when a temporary email is appropriate.</p>
            </article>
            <article
              className="step-card step-card-action"
              role="button"
              tabIndex={0}
              onClick={handleCheckStep}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleCheckStep();
                }
              }}
            >
              <span className="step-number">03</span>
              <div className="step-icon"><CheckCheck size={22} /></div>
              <h3>Check your inbox</h3>
              <p>Refresh or wait for automatic updates as incoming messages become available.</p>
            </article>
          </div>
        </section>
        )}

        {activePage === 'privacy' && (
        <section className="privacy-banner" id="privacy">
          <div className="privacy-icon"><ShieldCheck size={25} /></div>
          <div>
            <h3>Built with privacy in mind</h3>
            <p>Temporary email helps separate your everyday inbox from one-time signups. This preview is not yet a production email receiver or a guarantee of anonymity.</p>
          </div>
        </section>
        )}
      </main>

      <footer className="footer">
        <a className="brand footer-brand" href="#">
          <span className="brand-mark"><Mail size={20} /></span>
          <span className="brand-name">Factor<span>Mail</span></span>
        </a>
        <p>Temporary email, made simple.</p>
        <span className="footer-copy">© {new Date().getFullYear()} FactorMailService</span>
      </footer>
    </div>
  );
}

function CheckCircleIcon() {
  return <span className="check-circle"><Check size={11} /></span>;
}

import { useEffect as useAuthEffect, useState as useAuthState } from 'react';
import type { Session } from '@supabase/supabase-js';
import AuthScreen from './AuthScreen';
import AdminPortal from './AdminPortal';
import { supabase } from '../lib/supabase';

export default function App() {
  const [session, setSession] = useAuthState<Session | null>(null);
  const [authReady, setAuthReady] = useAuthState(false);
  const [guestMode, setGuestMode] = useAuthState(false);
  const [signingOut, setSigningOut] = useAuthState(false);
  const [authError, setAuthError] = useAuthState('');

  useAuthEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setAuthError(error.message);
      setSession(data.session);
      setAuthReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setAuthReady(true);
      if (nextSession) {
        setGuestMode(false);
        setAuthError('');
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    setAuthError('');
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setSession(null);
      setGuestMode(false);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Unable to sign out.');
    } finally {
      setSigningOut(false);
    }
  }

  if (
    window.location.pathname === '/admin' ||
    window.location.pathname.startsWith('/admin/')
  ) {
    return <AdminPortal />;
  }

  if (!authReady) {
    return (
      <div className="auth-loading">
        <img src="/factormail-logo.svg" alt="FactorMailService" />
        <span>Checking your session…</span>
      </div>
    );
  }

  if (!session && !guestMode) {
    return <AuthScreen onContinueAsGuest={() => setGuestMode(true)} />;
  }

  return (
    <>
      {session && (
        <div className="auth-session-bar">
          <span>Signed in as <strong>{session.user.email}</strong></span>
          <button type="button" onClick={signOut} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
      {authError && (
        <div className="auth-session-error" role="alert">{authError}</div>
      )}
      <Dashboard />
    </>
  );
}

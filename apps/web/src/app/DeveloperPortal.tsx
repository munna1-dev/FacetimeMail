import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Activity, AlertCircle, ArrowUpRight, CheckCircle2, Clock3,
  Code2, Database, Globe, LayoutDashboard, LockKeyhole, LogOut,
  Mail, RefreshCw, Server, Settings2, ShieldCheck, ShieldAlert,
  TerminalSquare, Wifi, XCircle
} from 'lucide-react';

const TOKEN_KEY = 'factormail.developer.token';

type Status = {
  api: string;
  storage: string;
  domain: string;
  mailboxTtlMinutes: number;
  databaseConfigured: boolean;
  inboundConfigured: boolean;
  developerSessionExpiresAt: string;
  timestamp: string;
};

type Overview = {
  api: string;
  storage: string;
  mailboxCount: number;
  messageCount: number;
  enabledDomains: string[];
  databaseConfigured: boolean;
  inboundConfigured: boolean;
  timestamp: string;
};

async function request<T>(
  route: string,
  token = '',
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(route, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : `Request failed (${response.status}).`
    );
  }
  return data as T;
}

function readableDate(value?: string) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not available'
    : date.toLocaleString();
}

function HealthBadge({ healthy, children }: {
  healthy: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`dev-health ${healthy ? 'is-healthy' : 'is-warning'}`}>
      <span className="dev-health-dot" />
      {children}
    </span>
  );
}

function ConfigRow({ label, detail, configured }: {
  label: string;
  detail: string;
  configured: boolean;
}) {
  return (
    <div className="dev-config-row">
      <span className={`dev-config-icon ${configured ? 'good' : 'warn'}`}>
        {configured ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
      </span>
      <span className="dev-config-copy">
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <span className={`dev-config-state ${configured ? 'good' : 'warn'}`}>
        {configured ? 'Configured' : 'Needs attention'}
      </span>
    </div>
  );
}

export default function DeveloperPortal() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem(TOKEN_KEY) || ''
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeSection, setActiveSection] = useState('overview');

  const logout = useCallback(async () => {
    const current = token;
    sessionStorage.removeItem(TOKEN_KEY);
    setToken('');
    setStatus(null);
    setOverview(null);
    setPassword('');

    if (current) {
      try {
        await request('/api/developer/logout', current, { method: 'POST' });
      } catch {
        // Local sign-out still takes effect if the server cannot be reached.
      }
    }
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token) return;

    setBusy(true);
    setError('');
    try {
      const [nextStatus, nextOverview] = await Promise.all([
        request<Status>('/api/developer/status', token),
        request<Overview>('/api/developer/overview', token)
      ]);

      setStatus(nextStatus);
      setOverview(nextOverview);
      setNotice(`Diagnostics refreshed at ${readableDate(nextStatus.timestamp)}.`);
    } catch (e) {
      const message = e instanceof Error
        ? e.message
        : 'Unable to load developer diagnostics.';

      if (message.toLowerCase().includes('developer sign-in required')) {
        await logout();
        setError('Your developer session expired. Please sign in again.');
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }, [token, logout]);

  useEffect(() => {
    if (token) void refresh();
  }, [token, refresh]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const result = await request<{ token: string }>(
        '/api/developer/login',
        '',
        {
          method: 'POST',
          body: JSON.stringify({
            username: username.trim(),
            password
          })
        }
      );

      sessionStorage.setItem(TOKEN_KEY, result.token);
      setToken(result.token);
      setPassword('');
      setNotice('Developer session established.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Developer sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <main className="dev-login-page">
        <section className="dev-login-card">
          <a className="dev-brand" href="/" aria-label="FacetimeMail home">
            <span className="dev-brand-mark"><Mail size={23} /></span>
            <span className="dev-brand-copy">
              <strong>FacetimeMail</strong>
              <small>DEVELOPER PLATFORM</small>
            </span>
          </a>

          <div className="dev-login-icon"><LockKeyhole size={25} /></div>
          <div className="dev-eyebrow">RESTRICTED ACCESS</div>
          <h1>Developer console</h1>
          <p className="dev-login-description">
            Sign in with your dedicated developer credentials to inspect
            platform health and integration readiness.
          </p>

          {error && (
            <div className="dev-alert dev-alert-error" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
            </div>
          )}

          <form className="dev-login-form" onSubmit={login}>
            <label htmlFor="developer-username">Developer username</label>
            <input
              id="developer-username"
              autoComplete="username"
              value={username}
              onChange={event => setUsername(event.target.value)}
              required
              autoFocus
            />

            <label htmlFor="developer-password">Password</label>
            <input
              id="developer-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
            />

            <button className="dev-primary-button" type="submit" disabled={busy}>
              <ShieldCheck size={17} />
              {busy ? 'Verifying credentials…' : 'Sign in securely'}
            </button>
          </form>

          <div className="dev-login-foot">
            <ShieldCheck size={15} />
            <span>Credentials are verified by the server. This portal uses a separate developer session.</span>
          </div>
          <div className="dev-login-copyright">
            FacetimeMail Developer Platform
          </div>
        </section>
      </main>
    );
  }

  const apiHealthy = status?.api?.toLowerCase() === 'healthy';
  const databaseReady = Boolean(status?.databaseConfigured);
  const inboundReady = Boolean(status?.inboundConfigured);
  const enabledDomains = overview?.enabledDomains || [];

  const navigation = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'runtime', label: 'Runtime health', icon: Activity },
    { id: 'domains', label: 'Mail domains', icon: Globe },
    { id: 'security', label: 'Security & integrations', icon: ShieldCheck }
  ];

  function goToSection(id: string) {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  return (
    <div className="dev-console">
      <aside className="dev-sidebar">
        <a className="dev-brand dev-sidebar-brand" href="/" aria-label="FacetimeMail">
          <span className="dev-brand-mark"><Mail size={22} /></span>
          <span className="dev-brand-copy">
            <strong>FacetimeMail</strong>
            <small>DEVELOPER PLATFORM</small>
          </span>
        </a>

        <div className="dev-sidebar-label">WORKSPACE</div>
        <nav className="dev-nav" aria-label="Developer console navigation">
          {navigation.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`dev-nav-item ${activeSection === item.id ? 'active' : ''}`}
                onClick={() => goToSection(item.id)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                {item.id === 'overview' && <span className="dev-nav-arrow">›</span>}
              </button>
            );
          })}
        </nav>

        <div className="dev-sidebar-bottom">
          <div className="dev-sidebar-status">
            <span className={`dev-status-light ${apiHealthy ? 'online' : ''}`} />
            <span>
              <strong>{apiHealthy ? 'API operational' : 'API status pending'}</strong>
              <small>Live server response</small>
            </span>
          </div>
          <button className="dev-sidebar-logout" onClick={() => void logout()}>
            <LogOut size={16} /> Sign out
          </button>
          <div className="dev-sidebar-version">FACETIMEMAIL · ENGINEERING</div>
        </div>
      </aside>

      <main className="dev-content">
        <header className="dev-topbar">
          <div className="dev-breadcrumb">
            <Code2 size={16} />
            <span>Developer workspace</span>
            <span className="dev-breadcrumb-separator">/</span>
            <strong>Console</strong>
          </div>
          <div className="dev-top-actions">
            <HealthBadge healthy={apiHealthy}>
              {apiHealthy ? 'Systems responsive' : 'Checking systems'}
            </HealthBadge>
            <button
              className="dev-refresh-button"
              onClick={() => void refresh()}
              disabled={busy}
            >
              <RefreshCw size={15} className={busy ? 'dev-spinning' : ''} />
              Refresh
            </button>
          </div>
        </header>

        <div className="dev-page-inner">
          <section className="dev-page-heading" id="overview">
            <div>
              <div className="dev-eyebrow">PLATFORM OPERATIONS</div>
              <h1>Developer console</h1>
              <p>Monitor FacetimeMail service health, mail infrastructure, and configuration readiness.</p>
            </div>
            <div className="dev-readonly-tag">
              <ShieldCheck size={15} /> Authenticated session
            </div>
          </section>

          {error && (
            <div className="dev-alert dev-alert-error" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button onClick={() => setError('')} aria-label="Dismiss error">×</button>
            </div>
          )}
          {notice && (
            <div className="dev-alert dev-alert-info" role="status">
              <CheckCircle2 size={17} />
              <span>{notice}</span>
              <button onClick={() => setNotice('')} aria-label="Dismiss notice">×</button>
            </div>
          )}

          <section className="dev-metrics" aria-label="Platform metrics">
            <article className="dev-metric-card">
              <div className="dev-metric-top">
                <span>API service</span>
                <span className="dev-metric-icon blue"><Activity size={18} /></span>
              </div>
              <div className="dev-metric-value dev-metric-text">
                {status?.api || 'Loading'}
              </div>
              <div className="dev-metric-caption">
                <span className={`dev-mini-dot ${apiHealthy ? 'good' : 'pending'}`} />
                Current server health
              </div>
            </article>

            <article className="dev-metric-card">
              <div className="dev-metric-top">
                <span>Storage backend</span>
                <span className="dev-metric-icon violet"><Database size={18} /></span>
              </div>
              <div className="dev-metric-value dev-metric-text">
                {overview?.storage || status?.storage || 'Loading'}
              </div>
              <div className="dev-metric-caption">Persistence adapter</div>
            </article>

            <article className="dev-metric-card">
              <div className="dev-metric-top">
                <span>Mailboxes</span>
                <span className="dev-metric-icon cyan"><Mail size={18} /></span>
              </div>
              <div className="dev-metric-value">
                {overview ? overview.mailboxCount.toLocaleString() : '—'}
              </div>
              <div className="dev-metric-caption">Count reported by the API</div>
            </article>

            <article className="dev-metric-card">
              <div className="dev-metric-top">
                <span>Messages</span>
                <span className="dev-metric-icon amber"><TerminalSquare size={18} /></span>
              </div>
              <div className="dev-metric-value">
                {overview ? overview.messageCount.toLocaleString() : '—'}
              </div>
              <div className="dev-metric-caption">Count reported by the API</div>
            </article>
          </section>

          <section className="dev-section" id="runtime">
            <div className="dev-section-heading">
              <div>
                <div className="dev-section-kicker">SERVICE MONITORING</div>
                <h2>Runtime health</h2>
                <p>Live configuration and runtime information returned by the API.</p>
              </div>
              <span className="dev-section-icon"><Server size={19} /></span>
            </div>

            <div className="dev-runtime-grid">
              <div className="dev-panel dev-runtime-panel">
                <div className="dev-panel-heading">
                  <span className="dev-panel-icon"><Wifi size={17} /></span>
                  <div><h3>Service details</h3><p>Runtime information</p></div>
                </div>
                <div className="dev-detail-list">
                  <div><span>API status</span><strong>{status?.api || '—'}</strong></div>
                  <div><span>Storage backend</span><strong>{status?.storage || '—'}</strong></div>
                  <div><span>Primary mail domain</span><strong className="dev-break-word">{status?.domain || '—'}</strong></div>
                  <div><span>Mailbox lifetime</span><strong>{status ? `${status.mailboxTtlMinutes} minutes` : '—'}</strong></div>
                  <div><span>Last health check</span><strong>{readableDate(status?.timestamp)}</strong></div>
                </div>
              </div>

              <div className="dev-panel dev-runtime-panel">
                <div className="dev-panel-heading">
                  <span className="dev-panel-icon"><ShieldCheck size={17} /></span>
                  <div><h3>Integration readiness</h3><p>Configuration presence checks</p></div>
                </div>
                <div className="dev-config-list">
                  <ConfigRow
                    label="Database connection"
                    detail="Database pool initialized by the API"
                    configured={databaseReady}
                  />
                  <ConfigRow
                    label="Inbound email"
                    detail="Email API key and webhook secret are present"
                    configured={inboundReady}
                  />
                  <ConfigRow
                    label="Developer session"
                    detail={`Expires ${readableDate(status?.developerSessionExpiresAt)}`}
                    configured={Boolean(status?.developerSessionExpiresAt)}
                  />
                </div>
                <p className="dev-panel-note">
                  These indicators report configuration presence, not a full end-to-end delivery test.
                </p>
              </div>
            </div>
          </section>

          <section className="dev-section" id="domains">
            <div className="dev-section-heading">
              <div>
                <div className="dev-section-kicker">MAIL INFRASTRUCTURE</div>
                <h2>Enabled mail domains</h2>
                <p>Domains currently returned by the server configuration.</p>
              </div>
              <span className="dev-domain-count">{enabledDomains.length} enabled</span>
            </div>

            <div className="dev-panel dev-domain-panel">
              {enabledDomains.length > 0 ? (
                <div className="dev-domain-table-wrap">
                  <table className="dev-domain-table">
                    <thead>
                      <tr><th>DOMAIN</th><th>CONFIGURATION</th><th>STATUS</th></tr>
                    </thead>
                    <tbody>
                      {enabledDomains.map(domain => (
                        <tr key={domain}>
                          <td>
                            <span className="dev-domain-name">
                              <Globe size={16} /> {domain}
                            </span>
                          </td>
                          <td>Enabled by server configuration</td>
                          <td><span className="dev-domain-enabled"><CheckCircle2 size={13} /> Enabled</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="dev-empty-state">
                  <Globe size={25} />
                  <strong>No enabled domains returned</strong>
                  <p>The API did not return a configured mail domain list.</p>
                </div>
              )}
              <div className="dev-panel-footer">
                <ShieldAlert size={15} />
                <span>This is a read-only view. Domain changes belong in the authorized administration workflow.</span>
              </div>
            </div>
          </section>

          <section className="dev-section" id="security">
            <div className="dev-section-heading">
              <div>
                <div className="dev-section-kicker">ACCESS & INTEGRATIONS</div>
                <h2>Security overview</h2>
                <p>Session state and available integration checks.</p>
              </div>
              <span className="dev-section-icon"><LockKeyhole size={19} /></span>
            </div>

            <div className="dev-security-grid">
              <article className="dev-panel dev-security-card">
                <span className="dev-security-icon"><LockKeyhole size={20} /></span>
                <h3>Developer access</h3>
                <p>Developer credentials are checked by the server. API requests in this session use a bearer token.</p>
                <div className="dev-security-foot">
                  <CheckCircle2 size={15} /> Authenticated
                </div>
              </article>
              <article className="dev-panel dev-security-card">
                <span className="dev-security-icon"><Database size={20} /></span>
                <h3>Persistent storage</h3>
                <p>{databaseReady
                  ? 'The API reports that its database connection is configured.'
                  : 'The API reports that its database connection is not configured.'}</p>
                <div className={`dev-security-foot ${databaseReady ? '' : 'warning'}`}>
                  {databaseReady ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                  {databaseReady ? 'Configured' : 'Needs attention'}
                </div>
              </article>
              <article className="dev-panel dev-security-card">
                <span className="dev-security-icon"><Mail size={20} /></span>
                <h3>Inbound email</h3>
                <p>{inboundReady
                  ? 'The API reports the required inbound-email credentials are present.'
                  : 'One or more inbound-email configuration values are missing.'}</p>
                <div className={`dev-security-foot ${inboundReady ? '' : 'warning'}`}>
                  {inboundReady ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                  {inboundReady ? 'Configured' : 'Needs attention'}
                </div>
              </article>
            </div>
          </section>

          <footer className="dev-footer">
            <div className="dev-footer-brand">
              <span className="dev-footer-mark"><Mail size={15} /></span>
              <strong>FacetimeMail</strong>
              <span>Developer Console</span>
            </div>
            <div className="dev-footer-meta">
              <span><Clock3 size={13} /> Session expiry: {readableDate(status?.developerSessionExpiresAt)}</span>
              <span>Read-only diagnostics</span>
            </div>
            <button className="dev-footer-link" onClick={() => void refresh()}>
              <RefreshCw size={13} /> Recheck status <ArrowUpRight size={13} />
            </button>
          </footer>
        </div>
      </main>
    </div>
  );
}

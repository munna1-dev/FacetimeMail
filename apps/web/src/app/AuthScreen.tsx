import { useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';

type AuthScreenProps = {
  onContinueAsGuest: () => void;
};

type Mode = 'signin' | 'signup' | 'reset';

export default function AuthScreen({ onContinueAsGuest }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function changeMode(next: Mode) {
    setMode(next);
    setError('');
    setNotice('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);

    try {
      if (mode === 'signin') {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });
        if (authError) throw authError;
      } else if (mode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin
          }
        });
        if (authError) throw authError;

        if (!data.session) {
          setNotice('Account created. Check your email for a verification link before signing in.');
        }
      } else {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: window.location.origin }
        );
        if (authError) throw authError;
        setNotice('If an account exists for this email, a password reset link will be sent.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'signin'
    ? 'Welcome back'
    : mode === 'signup'
      ? 'Create your account'
      : 'Reset your password';

  const subtitle = mode === 'signin'
    ? 'Sign in to continue to FacetimeMail.'
    : mode === 'signup'
      ? 'Create an account to get started.'
      : 'Enter your email and we will send reset instructions if an account exists.';

  return (
    <main className="auth-page">
      <section className="auth-showcase">
        <a className="auth-logo" href="/" aria-label="FacetimeMail home">
          <img src="/factormail-logo.svg" alt="FacetimeMail" />
        </a>

        <div className="auth-showcase-content">
          <span className="auth-eyebrow">YOUR EMAIL. YOUR CONTROL.</span>
          <h1>A cleaner way to manage temporary email.</h1>
          <p>Keep one-time messages separate from your personal inbox with a simple, focused workspace.</p>

          <div className="auth-benefits">
            <div><CheckCircle2 size={19} /><span>Simple inbox management</span></div>
            <div><CheckCircle2 size={19} /><span>Account access across sessions</span></div>
            <div><CheckCircle2 size={19} /><span>Privacy-conscious design</span></div>
          </div>
        </div>

        <p className="auth-showcase-foot">FacetimeMail · Temporary email, made simple.</p>
      </section>

      <section className="auth-form-side">
        <div className="auth-card">
          <div className="auth-card-icon"><LockKeyhole size={23} /></div>
          <div className="auth-kicker">SECURE ACCOUNT ACCESS</div>
          <h2>{title}</h2>
          <p className="auth-subtitle">{subtitle}</p>

          <form onSubmit={submit}>
            <label className="auth-label" htmlFor="auth-email">Email address</label>
            <div className="auth-input-wrap">
              <Mail size={18} aria-hidden="true" />
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={event => setEmail(event.target.value)}
                required
              />
            </div>

            {mode !== 'reset' && (
              <>
                <label className="auth-label" htmlFor="auth-password">Password</label>
                <div className="auth-input-wrap">
                  <LockKeyhole size={18} aria-hidden="true" />
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    placeholder={mode === 'signup' ? 'At least 8 characters' : 'Enter your password'}
                    minLength={8}
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    required
                  />
                  <button
                    className="auth-show-password"
                    type="button"
                    onClick={() => setShowPassword(value => !value)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </>
            )}

            {error && <div className="auth-message auth-error" role="alert">{error}</div>}
            {notice && <div className="auth-message auth-success" role="status">{notice}</div>}

            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
              {!busy && <ArrowRight size={18} />}
            </button>
          </form>

          {mode === 'signin' && (
            <button className="auth-text-button auth-forgot" type="button" onClick={() => changeMode('reset')}>
              Forgot your password?
            </button>
          )}

          <div className="auth-divider"><span>OR</span></div>

          {mode === 'signin' ? (
            <p className="auth-switch">
              New to FacetimeMail?{' '}
              <button type="button" className="auth-text-button" onClick={() => changeMode('signup')}>
                Create an account
              </button>
            </p>
          ) : (
            <p className="auth-switch">
              Already have an account?{' '}
              <button type="button" className="auth-text-button" onClick={() => changeMode('signin')}>
                Sign in
              </button>
            </p>
          )}

          <button type="button" className="auth-guest" onClick={onContinueAsGuest}>
            Continue to temporary inbox without an account
          </button>

          <p className="auth-legal">
            By continuing, you agree to use the service responsibly. Never use temporary email for sensitive information.
          </p>
        </div>
      </section>
    </main>
  );
}

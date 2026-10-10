import { useEffect, useMemo, useState } from 'react'
import { AsYouType, isValidPhoneNumber, parsePhoneNumber } from 'libphonenumber-js'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Image as ImageIcon,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MessageCircle,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { countries, type Country } from '../data/countries'
import { supabase } from './supabase'

type AuthMethod = 'email' | 'phone'
type AuthMode = 'sign-in' | 'sign-up'
type AuthFields = {
  email: string
  password: string
  phone: string
  otp: string
}

const authFieldsSchema = z.object({
  email: z.string(),
  password: z.string(),
  phone: z.string(),
  otp: z.string(),
})
const emailSchema = z.string().trim().email('Enter a valid email address.')
const signupPasswordSchema = z.string().min(8, 'Use at least 8 characters for your password.')
const resetPasswordSchema = z.string().min(8, 'Use at least 8 characters for your new password.')

function providerErrorMessage(message: string) {
  if (/rate|too many|limit/i.test(message)) return 'Too many attempts. Please wait before trying again.'
  if (/expired|invalid.*(otp|token|code)|token.*invalid/i.test(message)) return 'That code is invalid or expired. Request a new code and try again.'
  return message
}

export function AuthPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [method, setMethod] = useState<AuthMethod>('email')
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [showPassword, setShowPassword] = useState(false)
  const [forgotPassword, setForgotPassword] = useState(false)
  const [selectedCountry, setSelectedCountry] = useState<Country>(countries[0])
  const [countrySearch, setCountrySearch] = useState('')
  const [countryMenuOpen, setCountryMenuOpen] = useState(false)
  const [pendingPhone, setPendingPhone] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(0)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<AuthFields>({
    resolver: zodResolver(authFieldsSchema),
    defaultValues: { email: '', password: '', phone: '', otp: '' },
  })

  const filteredCountries = useMemo(() => {
    const query = countrySearch.trim().toLowerCase()
    return query
      ? countries.filter((country) =>
          `${country.name} ${country.iso} ${country.callingCode}`.toLowerCase().includes(query),
        )
      : countries
  }, [countrySearch])

  useEffect(() => {
    if (resendSeconds <= 0) return
    const timer = window.setTimeout(() => setResendSeconds((current) => Math.max(0, current - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendSeconds])

  useEffect(() => {
    if (searchParams.get('verified') === 'true') {
      setNotice({ kind: 'success', text: 'Your email is verified. You can now sign in.' })
    }
  }, [searchParams])

  const selectMethod = (nextMethod: AuthMethod) => {
    setMethod(nextMethod)
    setNotice(null)
    clearErrors()
  }

  const onSubmit = handleSubmit(async (values) => {
    setNotice(null)
    if (!supabase) {
      setNotice({
        kind: 'error',
        text: 'Authentication is not connected. Configure the Supabase URL and anon key to enable sign-in; you can still explore in guest demo mode.',
      })
      return
    }

    if (method === 'email') {
      const emailResult = emailSchema.safeParse(values.email)
      if (!emailResult.success) {
        setError('email', { message: emailResult.error.issues[0]?.message })
        return
      }

      if (forgotPassword) {
        try {
          const { error } = await supabase.auth.resetPasswordForEmail(emailResult.data, {
            redirectTo: `${window.location.origin}/reset-password`,
          })
          if (error) throw error
          setNotice({ kind: 'success', text: 'If an account exists for this email, a password-reset link has been sent.' })
        } catch (error) {
          setNotice({ kind: 'error', text: providerErrorMessage(error instanceof Error ? error.message : 'Could not request a password reset.') })
        }
        return
      }

      if (!values.password) {
        setError('password', { message: 'Enter your password.' })
        return
      }
      if (mode === 'sign-up') {
        const passwordResult = signupPasswordSchema.safeParse(values.password)
        if (!passwordResult.success) {
          setError('password', { message: passwordResult.error.issues[0]?.message })
          return
        }
      }

      try {
        if (mode === 'sign-up') {
          const { data, error } = await supabase.auth.signUp({
            email: emailResult.data,
            password: values.password,
            options: { emailRedirectTo: `${window.location.origin}/?verified=true` },
          })
          if (error) throw error
          setNotice(data.session
            ? { kind: 'success', text: 'Your account is ready.' }
            : { kind: 'success', text: 'Check your inbox for an email verification link before signing in.' })
        } else {
          const { error } = await supabase.auth.signInWithPassword({ email: emailResult.data, password: values.password })
          if (error) throw error
          navigate('/')
        }
      } catch (error) {
        setNotice({ kind: 'error', text: providerErrorMessage(error instanceof Error ? error.message : 'Unable to complete email authentication.') })
      }
      return
    }

    if (!otpSent) {
      if (!isValidPhoneNumber(values.phone, selectedCountry.iso)) {
        setError('phone', { message: `Enter a valid ${selectedCountry.name} phone number.` })
        return
      }

      try {
        const phone = parsePhoneNumber(values.phone, selectedCountry.iso).number
        const { error } = await supabase.auth.signInWithOtp({
          phone,
          options: { shouldCreateUser: mode === 'sign-up' },
        })
        if (error) throw error
        setPendingPhone(phone)
        setOtpSent(true)
        setResendSeconds(60)
        setNotice({ kind: 'success', text: `A verification code was requested for ${phone}. Delivery depends on your configured SMS provider.` })
      } catch (error) {
        setNotice({ kind: 'error', text: providerErrorMessage(error instanceof Error ? error.message : 'Unable to request a verification code.') })
      }
      return
    }

    if (!/^\d{6,8}$/.test(values.otp)) {
      setError('otp', { message: 'Enter the 6–8 digit code from your message.' })
      return
    }
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: pendingPhone,
        token: values.otp,
        type: 'sms',
      })
      if (error) throw error
      navigate('/')
    } catch (error) {
      setNotice({ kind: 'error', text: providerErrorMessage(error instanceof Error ? error.message : 'Unable to verify that code.') })
    }
  })

  const requestAnotherOtp = async () => {
    if (!supabase || resendSeconds > 0 || !pendingPhone) return
    setNotice(null)
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: pendingPhone,
        options: { shouldCreateUser: mode === 'sign-up' },
      })
      if (error) throw error
      setResendSeconds(60)
      setNotice({ kind: 'success', text: 'A new code was requested. Any earlier code may no longer work.' })
    } catch (error) {
      setNotice({ kind: 'error', text: providerErrorMessage(error instanceof Error ? error.message : 'Unable to resend the verification code.') })
    }
  }

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setNotice(null)
    setForgotPassword(false)
    setOtpSent(false)
    setValue('otp', '')
    clearErrors()
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link className="auth-brand" to="/">
          <span className="brand-mark"><ImageIcon size={18} /></span>
          <span>EduGen Smart</span>
        </Link>
        <div className="auth-story-content">
          <p className="eyebrow">Purpose-first education visuals</p>
          <h1>Better learning images.<br />Less wasted compute.</h1>
          <p>Give teachers a thoughtful way to find, reuse, or right-size educational illustrations for their classroom.</p>
          <div className="auth-story-points">
            <span><ShieldCheck size={17} /> Institution-aware workflows</span>
            <span><Sparkles size={17} /> Resource-conscious recommendations</span>
          </div>
        </div>
        <p className="auth-story-caption">A transparent frontend demo — real authentication activates only after provider setup.</p>
      </section>

      <section className="auth-side">
        <div className="auth-card">
          <Link className="auth-back-link" to="/"><ArrowLeft size={15} /> Back to demo</Link>
          <div className="auth-heading">
            <span className="auth-icon"><LockKeyhole size={18} /></span>
            <p className="eyebrow">{forgotPassword ? 'Account recovery' : 'Welcome to EduGen Smart'}</p>
            <h2>{forgotPassword ? 'Reset your password' : mode === 'sign-up' ? 'Create your account' : 'Sign in to continue'}</h2>
            <p>{forgotPassword ? 'We’ll send a secure reset link if an account matches.' : 'Choose how you would like to access your workspace.'}</p>
          </div>

          {!forgotPassword && (
            <div className="auth-mode-switch" role="group" aria-label="Sign-in method">
              <button type="button" className={method === 'email' ? 'active' : ''} onClick={() => selectMethod('email')}>
                <Mail size={15} /> Email
              </button>
              <button type="button" className={method === 'phone' ? 'active' : ''} onClick={() => selectMethod('phone')}>
                <MessageCircle size={15} /> Phone
              </button>
            </div>
          )}

          <div className="auth-tabs" role="group" aria-label="Account action">
            {!forgotPassword && (
              <>
                <button type="button" className={mode === 'sign-in' ? 'active' : ''} onClick={() => changeMode('sign-in')}>Sign in</button>
                <button type="button" className={mode === 'sign-up' ? 'active' : ''} onClick={() => changeMode('sign-up')}>Create account</button>
              </>
            )}
          </div>

          <form className="auth-form" onSubmit={onSubmit} noValidate>
            {(method === 'email' || forgotPassword) ? (
              <>
                <label htmlFor="auth-email">Email address</label>
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@school.org"
                  aria-invalid={Boolean(errors.email)}
                  {...register('email')}
                />
                {errors.email?.message && <span className="field-error">{errors.email.message}</span>}

                {!forgotPassword && (
                  <>
                    <label htmlFor="auth-password">Password</label>
                    <div className="password-input-wrap">
                      <input
                        id="auth-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                        placeholder={mode === 'sign-up' ? 'At least 8 characters' : 'Your password'}
                        aria-invalid={Boolean(errors.password)}
                        {...register('password')}
                      />
                      <button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {errors.password?.message && <span className="field-error">{errors.password.message}</span>}
                    {mode === 'sign-in' && (
                      <button className="forgot-link" type="button" onClick={() => { setForgotPassword(true); setNotice(null) }}>
                        Forgot password?
                      </button>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                {!otpSent ? (
                  <>
                    <label htmlFor="country-search">Country or region</label>
                    <div className="country-picker">
                      <button type="button" className="country-picker-button" aria-expanded={countryMenuOpen} aria-controls="country-options" onClick={() => setCountryMenuOpen((open) => !open)}>
                        <span>{selectedCountry.flag} {selectedCountry.name}</span>
                        <strong>{selectedCountry.callingCode}</strong>
                      </button>
                      {countryMenuOpen && (
                        <div className="country-menu" id="country-options">
                          <div className="country-search">
                            <Search size={15} />
                            <input id="country-search" autoFocus value={countrySearch} onChange={(event) => setCountrySearch(event.target.value)} placeholder="Search countries" aria-label="Search countries" />
                          </div>
                          <div className="country-options" role="listbox" aria-label="Countries">
                            {filteredCountries.map((country) => (
                              <button
                                type="button"
                                role="option"
                                aria-selected={country.iso === selectedCountry.iso}
                                key={country.iso}
                                onClick={() => {
                                  setSelectedCountry(country)
                                  setCountryMenuOpen(false)
                                  setCountrySearch('')
                                  setValue('phone', '')
                                  clearErrors('phone')
                                }}
                              >
                                <span>{country.flag} {country.name}</span><strong>{country.callingCode}</strong>
                              </button>
                            ))}
                            {filteredCountries.length === 0 && <p className="country-empty">No countries match that search.</p>}
                          </div>
                        </div>
                      )}
                    </div>
                    <label htmlFor="auth-phone">Phone number</label>
                    <div className="phone-input-wrap">
                      <span aria-hidden="true">{selectedCountry.callingCode}</span>
                      <input
                        id="auth-phone"
                        type="tel"
                        autoComplete="tel-national"
                        inputMode="tel"
                        placeholder={selectedCountry.iso === 'IN' ? '98765 43210' : 'Enter your phone number'}
                        aria-invalid={Boolean(errors.phone)}
                        {...register('phone', {
                          onChange: (event) => {
                            const formatted = new AsYouType(selectedCountry.iso).input(event.target.value.replace(/[^\d+]/g, ''))
                            setValue('phone', formatted, { shouldDirty: true, shouldValidate: false })
                          },
                        })}
                      />
                    </div>
                    {errors.phone?.message && <span className="field-error">{errors.phone.message}</span>}
                  </>
                ) : (
                  <>
                    <div className="otp-destination">
                      <span className="auth-icon"><MessageCircle size={17} /></span>
                      <div><strong>Enter your verification code</strong><span>Sent to {pendingPhone}</span></div>
                    </div>
                    <label htmlFor="auth-otp">One-time code</label>
                    <input
                      id="auth-otp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={8}
                      placeholder="6–8 digit code"
                      aria-invalid={Boolean(errors.otp)}
                      {...register('otp')}
                    />
                    {errors.otp?.message && <span className="field-error">{errors.otp.message}</span>}
                    <div className="resend-row">
                      <span>Code expiry follows your auth provider’s OTP settings.</span>
                      <button type="button" disabled={resendSeconds > 0 || isSubmitting} onClick={() => void requestAnotherOtp()}>
                        {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : 'Resend code'}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {notice && <div className={`auth-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
            <button className="primary-button auth-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? <LoaderCircle size={16} className="spin-icon" /> : method === 'phone' ? <MessageCircle size={16} /> : <Mail size={16} />}
              {isSubmitting
                ? 'Please wait…'
                : forgotPassword
                  ? 'Send reset link'
                  : method === 'phone'
                    ? otpSent ? 'Verify code' : 'Send OTP'
                    : mode === 'sign-up' ? 'Create account' : 'Sign in'}
            </button>
            {forgotPassword && <button className="forgot-link back-to-signin" type="button" onClick={() => { setForgotPassword(false); setNotice(null) }}>Back to sign in</button>}
          </form>

          {!supabase && (
            <div className="auth-demo-note">
              <span className="demo-banner-dot" />
              <p><strong>Development demo mode.</strong> Authentication is not configured. Provider actions will not pretend to succeed.</p>
            </div>
          )}
          <div className="auth-divider"><span>or</span></div>
          <Link className="ghost-button auth-guest" to="/">
            <Sparkles size={16} /> Continue in guest demo mode
          </Link>
          <p className="auth-legal">By continuing, you agree to our <a href="#terms">Terms</a> and <a href="#privacy">Privacy notice</a>.</p>
          <div className="auth-legal-details">
            <p id="terms"><strong>Terms:</strong> This demonstration provides estimates and sample resources only; production use requires institution review.</p>
            <p id="privacy"><strong>Privacy:</strong> Credentials are sent directly to the configured Supabase Auth project and are not stored by this frontend.</p>
          </div>
        </div>
      </section>
    </main>
  )
}

export function PasswordResetPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setNotice(null)
    const validation = resetPasswordSchema.safeParse(password)
    if (!validation.success) {
      setNotice({ kind: 'error', text: validation.error.issues[0]?.message ?? 'Choose a valid password.' })
      return
    }
    if (password !== confirmPassword) {
      setNotice({ kind: 'error', text: 'The passwords do not match.' })
      return
    }
    if (!supabase) {
      setNotice({ kind: 'error', text: 'Password reset is unavailable until Supabase is configured.' })
      return
    }
    setSubmitting(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setNotice({ kind: 'success', text: 'Password updated. You can now sign in with your new password.' })
      window.setTimeout(() => navigate('/login'), 1200)
    } catch (error) {
      setNotice({ kind: 'error', text: providerErrorMessage(error instanceof Error ? error.message : 'Unable to update your password.') })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page reset-page">
      <section className="auth-side">
        <div className="auth-card">
          <Link className="auth-back-link" to="/login"><ArrowLeft size={15} /> Back to sign in</Link>
          <div className="auth-heading">
            <span className="auth-icon"><LockKeyhole size={18} /></span>
            <p className="eyebrow">Account recovery</p>
            <h2>Choose a new password</h2>
            <p>Use at least 8 characters for your account password.</p>
          </div>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <label htmlFor="new-password">New password</label>
            <div className="password-input-wrap">
              <input id="new-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
              <button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
            <label htmlFor="confirm-password">Confirm password</label>
            <input id="confirm-password" type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
            {notice && <div className={`auth-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
            <button className="primary-button auth-submit" type="submit" disabled={submitting}>{submitting ? <LoaderCircle size={16} className="spin-icon" /> : <LockKeyhole size={16} />} Update password</button>
          </form>
          {!supabase && <p className="auth-demo-note">Development demo mode — password reset is not connected.</p>}
        </div>
      </section>
    </main>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../auth/supabase'

type UncertainRequest = {
  id: string
  user_id: string
  school_id: string | null
  prompt: string
  state: 'uncertain'
  provider_error_code: string | null
  provider_started_at: string | null
  created_at: string
}

type OperationsResponse = {
  requests?: UncertainRequest[]
  message?: string
  image_url?: string | null
  error?: { message?: string } | string
}

export function ImageOperationsPage() {
  const [requests, setRequests] = useState<UncertainRequest[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [recoveredImageUrl, setRecoveredImageUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadRequests = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured.')
      setLoading(false)
      return
    }
    setError('')
    const { data, error: invokeError } = await supabase.functions.invoke<OperationsResponse>('resolve-image-request', {
      body: { action: 'list_uncertain' },
    })
    if (invokeError) {
      setError(invokeError.message || 'Could not load uncertain requests. Confirm that you are an authorized operator.')
    } else {
      setRequests(data?.requests ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadRequests()
  }, [loadRequests])

  const resolve = async (requestId: string, action: 'confirm_no_image' | 'recover_stored_image') => {
    const note = notes[requestId]?.trim()
    if (!note) {
      setError('Enter an audit note before resolving an uncertain request.')
      return
    }
    if (!supabase) {
      setError('Supabase is not configured.')
      return
    }
    setBusyId(requestId)
    setError('')
    setMessage('')
    setRecoveredImageUrl(null)
    const { data, error: invokeError } = await supabase.functions.invoke<OperationsResponse>('resolve-image-request', {
      body: { action, request_id: requestId, note },
    })
    setBusyId(null)
    if (invokeError) {
      setError(invokeError.message || 'The request could not be resolved. Verify its persisted state before retrying.')
      return
    }
    setMessage(data?.message ?? 'The request was resolved.')
    setRequests((current) => current.filter((item) => item.id !== requestId))
    setNotes((current) => {
      const next = { ...current }
      delete next[requestId]
      return next
    })
    if (data?.image_url) setRecoveredImageUrl(data.image_url)
  }

  return (
    <main className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Trusted operations</p>
          <h2>Uncertain image requests</h2>
          <p className="page-intro">Only explicitly authorized image-generation operators can view or resolve this queue.</p>
        </div>
        <Link className="ghost-button" to="/generate">Image planner</Link>
      </header>
      <section className="panel workspace-panel">
        <p className="field-hint">
          A timeout does not prove that the provider failed. Verify provider and private Storage evidence before resolving.
          “Confirm no image” releases a reserved school estimate. “Recover stored PNG” validates the request’s expected
          private object, then finalizes it without another provider call. Recovered content still requires human review.
        </p>
        {error && <p className="workspace-alert" role="alert">{error}</p>}
        {message && <p className="workspace-notice" role="status">{message}</p>}
        {recoveredImageUrl && <p><a href={recoveredImageUrl} target="_blank" rel="noreferrer">Open recovered image</a></p>}
        {loading ? <p role="status">Loading uncertain requests…</p>
          : requests.length === 0 ? <p>No uncertain requests need resolution.</p>
            : <div className="asset-grid">{requests.map((request) => (
              <article className="asset-card" key={request.id}>
                <span className="asset-kind">Uncertain · do not resubmit</span>
                <h3>{request.id}</h3>
                <p>{request.prompt}</p>
                <dl>
                  <div><dt>Provider diagnostic</dt><dd>{request.provider_error_code ?? 'Not recorded'}</dd></div>
                  <div><dt>Provider attempt</dt><dd>{request.provider_started_at ? new Date(request.provider_started_at).toLocaleString() : 'Not recorded'}</dd></div>
                  <div><dt>Created</dt><dd>{new Date(request.created_at).toLocaleString()}</dd></div>
                  <div><dt>School</dt><dd>{request.school_id ?? 'Personal request'}</dd></div>
                </dl>
                <label htmlFor={`operator-note-${request.id}`}>Audited resolution note
                  <textarea
                    id={`operator-note-${request.id}`}
                    maxLength={1000}
                    value={notes[request.id] ?? ''}
                    onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                    placeholder="Record what provider/storage evidence was checked"
                  />
                </label>
                <button
                  className="primary-button"
                  type="button"
                  disabled={busyId !== null || !(notes[request.id] ?? '').trim()}
                  onClick={() => void resolve(request.id, 'recover_stored_image')}
                >{busyId === request.id ? 'Resolving…' : 'Recover known stored PNG'}</button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={busyId !== null || !(notes[request.id] ?? '').trim()}
                  onClick={() => void resolve(request.id, 'confirm_no_image')}
                >Confirm no image exists</button>
              </article>
            ))}</div>}
      </section>
    </main>
  )
}

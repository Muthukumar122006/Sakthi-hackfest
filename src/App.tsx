import { useEffect, useState } from 'react'
import {
  ArrowDownRight,
  Check,
  Clock3,
  Cpu,
  Image as ImageIcon,
  Leaf,
  LoaderCircle,
  Plus,
  Sparkles,
  Zap,
} from 'lucide-react'

type Purpose = 'Kids Colouring Sheet' | 'Educational Flashcard' | 'Professional Poster'
type TierId = 'studio-pro' | 'precision-lite' | 'draft-rapid'
type PreviewStatus = 'ready' | 'generating' | 'success'

type Tier = {
  id: TierId
  name: string
  quality: string
  time: string
  intensity: 'Low' | 'Medium' | 'High'
  cost: number
  description: string
}

const purposes: Purpose[] = [
  'Kids Colouring Sheet',
  'Educational Flashcard',
  'Professional Poster',
]

const tiers: Tier[] = [
  {
    id: 'studio-pro',
    name: 'Studio Pro',
    quality: 'High fidelity',
    time: '1m 15s',
    intensity: 'High',
    cost: 4.8,
    description: 'More detail and polish for presentation-ready work.',
  },
  {
    id: 'precision-lite',
    name: 'Precision Lite',
    quality: 'Balanced',
    time: '42s',
    intensity: 'Medium',
    cost: 2.4,
    description: 'A clear, balanced option for focused learning visuals.',
  },
  {
    id: 'draft-rapid',
    name: 'Draft Rapid',
    quality: 'Draft',
    time: '22s',
    intensity: 'Low',
    cost: 1.2,
    description: 'A lighter option for simple concepts and clean outlines.',
  },
]

const purposeRecommendations: Record<Purpose, { tier: TierId; explanation: string }> = {
  'Kids Colouring Sheet': {
    tier: 'draft-rapid',
    explanation: 'Simple line art does not need maximum fidelity. Draft Rapid is the lighter fit for a colouring sheet.',
  },
  'Educational Flashcard': {
    tier: 'precision-lite',
    explanation: 'Flashcards benefit from clear, balanced detail without the extra effort of maximum quality.',
  },
  'Professional Poster': {
    tier: 'studio-pro',
    explanation: 'A polished poster can benefit from the extra detail and fidelity offered by Studio Pro.',
  },
}

function App() {
  const [purpose, setPurpose] = useState<Purpose>('Educational Flashcard')
  const [prompt, setPrompt] = useState('')
  const [selectedTierId, setSelectedTierId] = useState<TierId>('precision-lite')
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('ready')

  const recommendation = purposeRecommendations[purpose]
  const selectedTier = tiers.find((tier) => tier.id === selectedTierId) ?? tiers[1]
  const studioPro = tiers[0]
  const savings = Math.max(0, studioPro.cost - selectedTier.cost)
  const savingsPercentage = Math.round((savings / studioPro.cost) * 100)
  const intensityDifference = studioPro.intensity === selectedTier.intensity
    ? 'Same relative intensity'
    : `${intensityRank(studioPro.intensity) - intensityRank(selectedTier.intensity)} level${intensityRank(studioPro.intensity) - intensityRank(selectedTier.intensity) === 1 ? '' : 's'} lower`

  useEffect(() => {
    if (previewStatus !== 'generating') return

    const timer = window.setTimeout(() => setPreviewStatus('success'), 1100)
    return () => window.clearTimeout(timer)
  }, [previewStatus])

  const handlePurposeChange = (nextPurpose: Purpose) => {
    setPurpose(nextPurpose)
    setSelectedTierId(purposeRecommendations[nextPurpose].tier)
    setPreviewStatus('ready')
  }

  const handleNewProject = () => {
    setPrompt('')
    setPurpose('Educational Flashcard')
    setSelectedTierId('precision-lite')
    setPreviewStatus('ready')
  }

  const handleGeneratePreview = () => {
    if (previewStatus === 'generating') return
    setPreviewStatus('generating')
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <ImageIcon size={18} />
          </div>
          <div>
            <p className="eyebrow">Purpose-first creation</p>
            <h1>SmartSketch AI</h1>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#create">
            <span className="nav-dot" />
            Create image
          </a>
          <a className="nav-item" href="#tiers">
            <span className="nav-dot" />
            Compare tiers
          </a>
          <a className="nav-item" href="#estimates">
            <span className="nav-dot" />
            Resource estimate
          </a>
        </nav>

        <div className="sidebar-panel">
          <div className="panel-header">
            <p className="eyebrow">The idea</p>
            <div className="badge badge-soft">Demo</div>
          </div>
          <h3>Match effort to purpose</h3>
          <p className="muted">Choose only the compute intensity your image needs. All prices and comparisons here are illustrative demo estimates.</p>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Smart image planning</p>
            <h2>Create with intention</h2>
            <p className="page-intro">Pick a purpose and see how a right-sized quality tier could avoid unnecessary high-compute generation.</p>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" type="button" onClick={handleNewProject}>
              <Plus size={16} />
              New project
            </button>
          </div>
        </header>

        <div className="demo-banner" role="note">
          <span className="demo-banner-dot" />
          <strong>FRONTEND-ONLY DEMO</strong>
          <span>Illustrative prices and relative resource intensity — no real image generation or provider pricing is connected.</span>
        </div>

        <section className="workspace-grid" id="create">
          <div className="workflow-column">
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Step 1</p>
                  <h3>Describe your image</h3>
                </div>
                <span className="status-pill">Prompt</span>
              </div>
              <label className="visually-hidden" htmlFor="image-prompt">Image description</label>
              <textarea
                id="image-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe the image you have in mind..."
                rows={4}
              />
              <p className="field-hint">Your prompt stays in this browser demo and is not sent to an AI service.</p>
            </section>

            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Step 2</p>
                  <h3>What is it for?</h3>
                </div>
              </div>
              <div className="chip-grid purpose-grid" role="group" aria-label="Image purpose">
                {purposes.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={['chip', option === purpose ? 'selected' : ''].join(' ')}
                    aria-pressed={option === purpose}
                    onClick={() => handlePurposeChange(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </section>

            <section className="panel" id="tiers">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Step 3</p>
                  <h3>Choose a quality tier</h3>
                </div>
                <span className="status-pill">DEMO ESTIMATES</span>
              </div>
              <div className="recommendation-note">
                <Sparkles size={16} />
                <p><strong>Smart pick: {tiers.find((tier) => tier.id === recommendation.tier)?.name}</strong> — {recommendation.explanation}</p>
              </div>
              <div className="model-list">
                {tiers.map((tier) => {
                  const isSelected = tier.id === selectedTierId
                  const isRecommended = tier.id === recommendation.tier
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      className={['model-card', isSelected ? 'selected' : ''].join(' ')}
                      aria-pressed={isSelected}
                      onClick={() => {
                        setSelectedTierId(tier.id)
                        setPreviewStatus('ready')
                      }}
                    >
                      <span className="model-card-select" aria-hidden="true">
                        {isSelected ? <Check size={14} /> : null}
                      </span>
                      <div className="model-card-content">
                        <div className="model-topline">
                          <div>
                            <strong>{tier.name}</strong>
                            <span>{tier.quality}</span>
                          </div>
                          {isRecommended && <span className="badge badge-primary">Recommended</span>}
                        </div>
                        <p className="tier-description">{tier.description}</p>
                        <div className="tier-meta">
                          <span><Clock3 size={14} /> {tier.time}</span>
                          <span><Cpu size={14} /> {tier.intensity} relative intensity</span>
                          <span className="tier-cost">${tier.cost.toFixed(2)} demo</span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          </div>

          <aside className="preview-column">
            <section className="panel estimate-panel" id="estimates" aria-live="polite">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Resource estimate</p>
                  <h3>Your right-sized run</h3>
                </div>
                <span className="estimate-stamp">DEMO ESTIMATES</span>
              </div>
              <div className="estimate-selected">
                <span className="estimate-icon"><Zap size={17} /></span>
                <div>
                  <span className="mini-label">Selected tier</span>
                  <strong>{selectedTier.name}</strong>
                </div>
              </div>
              <div className="estimate-metrics">
                <div className="estimate-metric">
                  <span className="mini-label">Estimated cost</span>
                  <strong>${selectedTier.cost.toFixed(2)}</strong>
                </div>
                <div className="estimate-metric">
                  <span className="mini-label">Relative intensity</span>
                  <strong>{selectedTier.intensity}</strong>
                </div>
                <div className="estimate-metric">
                  <span className="mini-label">Estimated time</span>
                  <strong>{selectedTier.time}</strong>
                </div>
                <div className="estimate-metric baseline-metric">
                  <span className="mini-label">Maximum-quality baseline (Studio Pro)</span>
                  <strong>${studioPro.cost.toFixed(2)}</strong>
                </div>
              </div>
              <div className="savings-box">
                <div className="savings-icon"><Leaf size={18} /></div>
                <div>
                  <span className="mini-label">Potential cost savings vs. Studio Pro</span>
                  <strong>${savings.toFixed(2)} <span>({savingsPercentage}%)</span></strong>
                </div>
                <ArrowDownRight size={18} className="savings-arrow" />
              </div>
              <div className="energy-disclaimer">
                <span className="energy-indicator" />
                <p><strong>Energy usage unavailable in frontend demo.</strong> Relative intensity is a qualitative illustration, not a measured energy value.</p>
              </div>
            </section>

            <section className="panel preview-panel">
              <div className="preview-topline">
                <div>
                  <p className="eyebrow">Step 4</p>
                  <h3>Generation preview</h3>
                </div>
                <span className={['status-pill', previewStatus === 'success' ? 'success' : ''].join(' ')}>
                  {previewStatus === 'generating' ? 'Loading demo' : previewStatus === 'success' ? 'Demo complete' : 'Ready'}
                </span>
              </div>
              <div className={['preview-stage', previewStatus === 'generating' ? 'is-generating' : ''].join(' ')}>
                <div className="preview-illustration" aria-hidden="true">
                  <div className="illustration-sun" />
                  <div className="illustration-cloud" />
                  <div className="illustration-water" />
                  <div className="illustration-land" />
                  <div className="illustration-label" />
                  <div className="illustration-arrow" />
                </div>
                {previewStatus === 'generating' && (
                  <div className="preview-loading">
                    <LoaderCircle size={22} className="spin-icon" />
                    <strong>Preparing demo preview…</strong>
                  </div>
                )}
              </div>
              <div className="preview-disclosure">
                <span className="preview-demo-label">DEMO PREVIEW</span>
                <span>Not an AI-generated image</span>
              </div>
              {previewStatus === 'success' && (
                <p className="preview-success" role="status"><Check size={15} /> Demo interaction complete. No image was generated or sent to a provider.</p>
              )}
              <button
                className="primary-button preview-button"
                type="button"
                onClick={handleGeneratePreview}
                disabled={previewStatus === 'generating'}
              >
                {previewStatus === 'generating' ? <LoaderCircle size={16} className="spin-icon" /> : <Sparkles size={16} />}
                {previewStatus === 'generating' ? 'Preparing preview…' : previewStatus === 'success' ? 'Run preview again' : 'Generate Preview'}
              </button>
            </section>
          </aside>
        </section>

        <section className="panel comparison-panel" id="comparison">
          <div className="section-heading">
            <div>
              <p className="eyebrow">The trade-off</p>
              <h3>{selectedTier.name} compared with Studio Pro</h3>
            </div>
            <span className="status-pill">Illustrative comparison</span>
          </div>
          <div className="comparison-grid">
            <div className="comparison-tier current-tier">
              <span className="mini-label">Selected tier</span>
              <strong>{selectedTier.name}</strong>
              <span>${selectedTier.cost.toFixed(2)} estimated cost · {selectedTier.intensity} relative intensity</span>
            </div>
            <div className="comparison-difference">
              <span className="mini-label">Potential difference</span>
              <strong>${savings.toFixed(2)} less</strong>
              <span>{intensityDifference} in illustrative resource intensity</span>
            </div>
            <div className="comparison-tier">
              <span className="mini-label">Maximum-quality baseline</span>
              <strong>Studio Pro</strong>
              <span>${studioPro.cost.toFixed(2)} estimated cost · High relative intensity</span>
            </div>
          </div>
          <p className="comparison-footnote">The goal is to avoid unnecessary high-compute generation while still meeting the quality required for your image. Prices and intensity levels are illustrative demo estimates, not actual provider measurements.</p>
        </section>

        <footer className="app-footer">SmartSketch AI · Frontend-only demonstration · Energy usage unavailable in frontend demo</footer>
      </main>
    </div>
  )
}

function intensityRank(intensity: Tier['intensity']) {
  return intensity === 'Low' ? 1 : intensity === 'Medium' ? 2 : 3
}

export default App

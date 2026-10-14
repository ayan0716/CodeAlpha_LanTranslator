import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API = import.meta.env.VITE_API_URL || '/api'

function readDetail(data) {
  if (!data || !data.detail) return ''
  if (typeof data.detail === 'string') return data.detail
  return 'The request was not valid. Please check your input.'
}

export default function App() {
  const [languages, setLanguages] = useState([])
  const [maxChars, setMaxChars] = useState(5000)

  const [text, setText] = useState('')
  const [source, setSource] = useState('auto')
  const [target, setTarget] = useState('es')

  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeaking] = useState(false)

  const abortRef = useRef(null)
  const speakAbortRef = useRef(null)
  const audioRef = useRef(null)
  const audioUrlRef = useRef(null)

  const byCode = useMemo(
    () => Object.fromEntries(languages.map((l) => [l.code, l])),
    [languages],
  )

  // Load the language list from the backend.
  useEffect(() => {
    fetch(`${API}/languages`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((data) => {
        setLanguages(data.languages)
        if (data.maxChars) setMaxChars(data.maxChars)
      })
      .catch(() =>
        setError('Cannot reach the translation server. Make sure the backend is running on port 8000.'),
      )
  }, [])

  // Free the audio file and stop any speech.
  const releaseAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current.pause()
      audioRef.current = null
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
  }, [])

  const stopSpeaking = useCallback(() => {
    speakAbortRef.current?.abort()
    speakAbortRef.current = null
    releaseAudio()
    window.speechSynthesis?.cancel()
    setSpeaking(false)
  }, [releaseAudio])

  // Stop speech if the page is closed.
  useEffect(() => stopSpeaking, [stopSpeaking])

  const translate = useCallback(async () => {
    setError('')
    setNotice('')
    const trimmed = text.trim()
    if (!trimmed) {
      setError('Please enter some text to translate.')
      return
    }
    if (source !== 'auto' && source === target) {
      setError('Source and target languages are the same.')
      return
    }

    stopSpeaking()
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)

    try {
      const res = await fetch(`${API}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, source, target }),
        signal: controller.signal,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(readDetail(data) || `Request failed (${res.status}).`)
      setResult(data)
    } catch (e) {
      if (e.name === 'AbortError') return
      setResult(null)
      setError(
        e instanceof TypeError
          ? 'Cannot reach the translation server. Make sure the backend is running.'
          : e.message,
      )
    } finally {
      if (abortRef.current === controller) setLoading(false)
    }
  }, [text, source, target, stopSpeaking])

  const canSwap = source !== 'auto' || Boolean(result?.detectedSource)

  function swapLanguages() {
    const newTarget = source === 'auto' ? result?.detectedSource : source
    if (!newTarget) return
    setSource(target)
    setTarget(newTarget)
    if (result) setText(result.translatedText)
    setResult(null)
    setError('')
    setNotice('')
    stopSpeaking()
  }

  function clearAll() {
    abortRef.current?.abort()
    setLoading(false)
    setText('')
    setResult(null)
    setError('')
    setNotice('')
    stopSpeaking()
  }

  async function copyResult() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.translatedText)
    } catch {
      // Fallback for browsers/contexts without the async clipboard API.
      const area = document.createElement('textarea')
      area.value = result.translatedText
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  // Text-to-speech, option 1: audio made by the backend (works for any language).
  async function speakWithServer(textToSpeak, langCode) {
    const controller = new AbortController()
    speakAbortRef.current = controller

    const res = await fetch(`${API}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textToSpeak, lang: langCode }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(readDetail(data) || `Speech request failed (${res.status}).`)
    }
    const blob = await res.blob()
    if (controller.signal.aborted) return

    releaseAudio()
    const url = URL.createObjectURL(blob)
    audioUrlRef.current = url
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onended = () => {
      releaseAudio()
      setSpeaking(false)
    }
    audio.onerror = () => {
      releaseAudio()
      setSpeaking(false)
      setNotice('The audio could not be played. Check your volume and sound output.')
    }
    await audio.play()
  }

  // Text-to-speech, option 2 (fallback): the voices installed in the browser.
  function speakWithBrowser(textToSpeak, langCode) {
    const synth = window.speechSynthesis
    if (!synth) {
      setSpeaking(false)
      setNotice('Text-to-speech is not available in this browser.')
      return
    }

    const lang = byCode[langCode]?.speech || langCode
    const utterance = new SpeechSynthesisUtterance(textToSpeak)
    utterance.lang = lang

    const voices = synth.getVoices()
    const wanted = lang.toLowerCase()
    const base = wanted.split('-')[0]
    const voice =
      voices.find((v) => v.lang.replace('_', '-').toLowerCase() === wanted) ||
      voices.find((v) => v.lang.toLowerCase().startsWith(base))
    if (voice) {
      utterance.voice = voice
    } else if (voices.length > 0) {
      setNotice(
        `No ${byCode[langCode]?.name || 'matching'} voice is installed on this device, so speech may not work.`,
      )
    }

    let started = false
    utterance.onstart = () => {
      started = true
    }
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = (event) => {
      setSpeaking(false)
      // 'canceled' / 'interrupted' just mean we stopped it ourselves.
      if (event.error && !['canceled', 'interrupted'].includes(event.error)) {
        setNotice(`Speech failed (${event.error}). Check your volume, or try Microsoft Edge.`)
      }
    }

    // Some Chrome versions stay silent if speak() follows cancel() immediately,
    // or if the queue was left paused. Clear it, resume, then speak after a short delay.
    if (synth.speaking || synth.pending) synth.cancel()
    synth.resume()
    setTimeout(() => {
      synth.speak(utterance)
      setTimeout(() => {
        if (!started && !synth.speaking) {
          setSpeaking(false)
          setNotice(
            'The browser did not start speaking. Check your volume and sound output, or try Microsoft Edge.',
          )
        }
      }, 3000)
    }, 80)
  }

  async function toggleSpeech() {
    if (speaking) {
      stopSpeaking()
      return
    }
    if (!result) return

    setNotice('')
    setSpeaking(true)
    try {
      await speakWithServer(result.translatedText, result.target)
    } catch (e) {
      if (e.name === 'AbortError') return
      // The server could not make the audio, so use the browser's own voice instead.
      const reason = e instanceof TypeError ? 'Cannot reach the speech server.' : e.message
      setNotice(`${reason} Trying your browser's voice instead.`)
      speakWithBrowser(result.translatedText, result.target)
    }
  }

  function onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      translate()
    }
  }

  const detectedName = result?.detectedSource ? byCode[result.detectedSource]?.name : ''

  return (
    <main className="app">
      <header className="header">
        <h1>AI Translator</h1>
        <p>Translate text between {languages.length || 24} languages.</p>
      </header>

      <section className="lang-bar">
        <label className="field">
          <span>From</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="auto">Detect language</option>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="icon-btn swap"
          onClick={swapLanguages}
          disabled={!canSwap}
          aria-label="Swap languages"
          title={canSwap ? 'Swap languages' : 'Translate once with auto-detect to enable swapping'}
        >
          ⇄
        </button>

        <label className="field">
          <span>To</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="panels">
        <div className="panel">
          <div className="panel-head">
            <h2>Original</h2>
            <button type="button" className="link-btn" onClick={clearAll} disabled={!text && !result}>
              Clear
            </button>
          </div>
          <textarea
            dir="auto"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={maxChars}
            placeholder="Type or paste text here…"
            aria-label="Text to translate"
          />
          <div className="panel-foot">
            <span className="counter">
              {text.length} / {maxChars}
            </span>
            <button type="button" className="primary" onClick={translate} disabled={loading || !text.trim()}>
              {loading ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Translating…
                </>
              ) : (
                'Translate'
              )}
            </button>
          </div>
          <p className="hint">Tip: press Ctrl/⌘ + Enter to translate.</p>
        </div>

        <div className="panel result-panel">
          <div className="panel-head">
            <h2>Translation</h2>
            {detectedName && <span className="badge">Detected: {detectedName}</span>}
          </div>
          <div className="output" dir="auto" aria-live="polite">
            {loading ? (
              <span className="placeholder">Translating…</span>
            ) : result ? (
              result.translatedText
            ) : (
              <span className="placeholder">The translation will appear here.</span>
            )}
          </div>
          <div className="panel-foot">
            <span className="counter" />
            <div className="actions">
              <button type="button" className="secondary" onClick={toggleSpeech} disabled={!result || loading}>
                {speaking ? '⏹ Stop' : '🔊 Listen'}
              </button>
              <button type="button" className="secondary" onClick={copyResult} disabled={!result || loading}>
                {copied ? '✓ Copied' : '📋 Copy'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="banner notice" role="status">
          {notice}
        </div>
      )}

      <footer className="footer">React + FastAPI · MyMemory Translation API · gTTS speech</footer>
    </main>
  )
}
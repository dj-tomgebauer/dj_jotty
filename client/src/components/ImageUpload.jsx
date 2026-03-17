import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import SnapCard from './SnapCard'

export default function ImageUpload() {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [creatorName, setCreatorName] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceNotes, setSourceNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [snaps, setSnaps] = useState([])
  const fileInputRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    fetch('/api/snaps').then(r => r.json()).then(setSnaps).catch(() => {})
  }, [])

  const handleFile = useCallback((f) => {
    if (!f) return
    const allowed = ['image/png', 'image/jpeg', 'image/webp']
    if (!allowed.includes(f.type)) {
      alert('Please upload a PNG, JPG, or WEBP image.')
      return
    }
    setFile(f)
    const reader = new FileReader()
    reader.onload = (e) => setPreview(e.target.result)
    reader.readAsDataURL(f)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    handleFile(f)
  }, [handleFile])

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        handleFile(item.getAsFile())
        break
      }
    }
  }, [handleFile])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!file || !creatorName.trim()) return

    setUploading(true)
    const formData = new FormData()
    formData.append('image', file)
    formData.append('creator_name', creatorName.trim())
    if (sourceUrl.trim()) formData.append('source_url', sourceUrl.trim())
    if (sourceNotes.trim()) formData.append('source_notes', sourceNotes.trim())

    try {
      const res = await fetch('/api/snaps', { method: 'POST', body: formData })
      if (!res.ok) throw new Error('Upload failed')
      const snap = await res.json()
      navigate(`/snap/${snap.id}/edit`)
    } catch (err) {
      alert('Failed to upload: ' + err.message)
      setUploading(false)
    }
  }

  return (
    <div className="upload-page" onPaste={handlePaste}>
      <h2>New Screenshot</h2>

      {!preview ? (
        <div
          className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <p>Drop a screenshot here, paste from clipboard, or click to upload</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => handleFile(e.target.files[0])}
          />
        </div>
      ) : (
        <div>
          <img src={preview} alt="Preview" className="preview-image" style={{ display: 'block', marginBottom: 12 }} />
          <button className="btn btn-secondary" onClick={() => { setFile(null); setPreview(null) }}>
            Remove
          </button>
        </div>
      )}

      <form className="upload-form" onSubmit={handleSubmit}>
        <label>
          Your Name *
          <input
            type="text"
            value={creatorName}
            onChange={(e) => setCreatorName(e.target.value)}
            placeholder="e.g. Jane Smith"
            required
          />
        </label>
        <label>
          Source URL
          <input
            type="text"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="Where was this screenshot taken?"
          />
        </label>
        <label>
          Notes
          <textarea
            value={sourceNotes}
            onChange={(e) => setSourceNotes(e.target.value)}
            placeholder="Optional context (e.g. Staging, Mobile view)"
          />
        </label>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!file || !creatorName.trim() || uploading}
        >
          {uploading ? 'Uploading...' : 'Upload & Annotate'}
        </button>
      </form>

      {snaps.length > 0 && (
        <div className="snap-gallery">
          <h3>Recent Snaps</h3>
          <div className="library-grid">
            {snaps.slice(0, 8).map(s => <SnapCard key={s.id} snap={s} />)}
          </div>
        </div>
      )}
    </div>
  )
}

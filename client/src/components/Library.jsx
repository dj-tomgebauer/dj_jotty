import { useState, useEffect } from 'react'
import SnapCard from './SnapCard'

export default function Library() {
  const [snaps, setSnaps] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/snaps')
      .then(r => r.json())
      .then(data => { setSnaps(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const filtered = snaps.filter(s => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      s.creator_name?.toLowerCase().includes(q) ||
      s.source_url?.toLowerCase().includes(q)
    )
  })

  if (loading) return <div className="loading">Loading...</div>

  return (
    <div className="library-page">
      <div className="library-header">
        <h2>Library</h2>
        <span className="library-count">{snaps.length} {snaps.length === 1 ? 'snap' : 'snaps'}</span>
      </div>

      {snaps.length > 0 && (
        <input
          type="text"
          className="library-search"
          placeholder="Filter by name or URL..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {filtered.length > 0 ? (
        <div className="library-grid">
          {filtered.map(s => <SnapCard key={s.id} snap={s} />)}
        </div>
      ) : (
        <div className="library-empty">
          {search ? 'No snaps match your filter.' : 'No snaps yet. Upload your first screenshot!'}
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as fabric from 'fabric'

const CANVAS_PADDING = 200
const isMobile = () => window.innerWidth <= 768

const createArrowLine = (coords, options, arrowStyle = 'end') => {
  const line = new fabric.Line(coords, options)
  line._isArrow = true
  line._arrowStyle = arrowStyle
  const origRender = line._render.bind(line)
  line._render = function(ctx) {
    origRender(ctx)
    const p = this.calcLinePoints()
    const angle = Math.atan2(p.y2 - p.y1, p.x2 - p.x1)
    const headLen = 12
    const style = this._arrowStyle || 'end'

    const drawFilled = (px, py, a) => {
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(a)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(-headLen, headLen / 3)
      ctx.lineTo(-headLen, -headLen / 3)
      ctx.closePath()
      ctx.fillStyle = this.stroke
      ctx.fill()
      ctx.restore()
    }

    const drawOpen = (px, py, a) => {
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(a)
      ctx.beginPath()
      ctx.moveTo(-headLen, headLen / 3)
      ctx.lineTo(0, 0)
      ctx.lineTo(-headLen, -headLen / 3)
      ctx.strokeStyle = this.stroke
      ctx.lineWidth = this.strokeWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
      ctx.restore()
    }

    if (style === 'open') {
      drawOpen(p.x2, p.y2, angle)
    } else {
      drawFilled(p.x2, p.y2, angle)
      if (style === 'both') {
        drawFilled(p.x1, p.y1, angle + Math.PI)
      }
    }
  }
  return line
}

export default function Viewer() {
  const { id } = useParams()
  const navigate = useNavigate()
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const fabricRef = useRef(null)
  const [snap, setSnap] = useState(null)
  const [showForkDialog, setShowForkDialog] = useState(false)
  const [forkName, setForkName] = useState('')
  const [includeAnnotations, setIncludeAnnotations] = useState(false)
  const [screenSize, setScreenSize] = useState(() => {
    const stored = localStorage.getItem('jotty-screen-size')
    if (stored) return stored === '1x'
    return true // default, will be overridden by HiDPI detection on image load
  })
  const [naturalW, setNaturalW] = useState(null)
  const screenSizeInitRef = useRef(false)

  useEffect(() => {
    fetch(`/api/snaps/${id}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(setSnap)
      .catch(() => navigate('/'))
  }, [id, navigate])

  const initCanvas = (annotations, storedCanvasWidth) => {
    const imgEl = imgRef.current
    if (!imgEl) return

    const imgW = imgEl.clientWidth
    const imgH = imgEl.clientHeight

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: imgW + CANVAS_PADDING * 2,
      height: imgH + CANVAS_PADDING * 2,
      enableRetinaScaling: false,
      selection: false,
    })
    fabricRef.current = canvas

    const fabricWrapper = canvas.wrapperEl || canvasRef.current.parentElement
    if (fabricWrapper) {
      fabricWrapper.style.position = 'absolute'
      fabricWrapper.style.left = `${-CANVAS_PADDING}px`
      fabricWrapper.style.top = `${-CANVAS_PADDING}px`
    }

    // Recalculate canvas position after repositioning the wrapper
    canvas.calcOffset()

    if (annotations && annotations.length > 0) {
      const P = CANVAS_PADDING
      const origin = { originX: 'left', originY: 'top' }
      // Scale from stored coordinate space to current display size
      const refW = storedCanvasWidth || imgEl.naturalWidth || imgW
      const s = imgW / refW
      annotations.forEach(ann => {
        let obj = null
        if (ann.type === 'text') {
          obj = new fabric.IText(ann.text || '', {
            ...origin,
            left: ann.left * s + P, top: ann.top * s + P,
            fontSize: (ann.fontSize || 16) * s, fill: ann.fill || '#FF0000',
            fontFamily: ann.fontFamily || 'Inter, system-ui, sans-serif',
            editable: false,
          })
        } else if (ann.type === 'rectangle') {
          obj = new fabric.Rect({
            ...origin,
            left: ann.left * s + P, top: ann.top * s + P,
            width: ann.width * s, height: ann.height * s,
            stroke: ann.stroke, strokeWidth: ann.strokeWidth, fill: ann.fill || 'transparent',
            strokeUniform: true,
          })
        } else if (ann.type === 'circle') {
          obj = new fabric.Ellipse({
            ...origin,
            left: ann.left * s + P, top: ann.top * s + P,
            rx: (ann.rx || ann.radius) * s, ry: (ann.ry || ann.radius) * s,
            stroke: ann.stroke, strokeWidth: ann.strokeWidth, fill: ann.fill || 'transparent',
            strokeUniform: true,
          })
        } else if (ann.type === 'line') {
          obj = new fabric.Line([ann.x1 * s + P, ann.y1 * s + P, ann.x2 * s + P, ann.y2 * s + P], {
            ...origin,
            stroke: ann.stroke, strokeWidth: ann.strokeWidth,
            strokeUniform: true,
          })
        } else if (ann.type === 'arrow') {
          obj = createArrowLine([ann.x1 * s + P, ann.y1 * s + P, ann.x2 * s + P, ann.y2 * s + P], {
            ...origin,
            stroke: ann.stroke, strokeWidth: ann.strokeWidth,
            strokeUniform: true,
          }, ann.arrowStyle)
        } else if (ann.type === 'draw') {
          obj = new fabric.Path(ann.path, {
            ...origin,
            left: ann.left * s + P, top: ann.top * s + P,
            scaleX: s, scaleY: s,
            stroke: ann.stroke, strokeWidth: ann.strokeWidth,
            fill: ann.fill || '',
            strokeLineCap: 'round', strokeLineJoin: 'round',
          })
        } else if (ann.type === 'highlight') {
          obj = new fabric.Rect({
            ...origin,
            left: ann.left * s + P, top: ann.top * s + P,
            width: ann.width * s, height: ann.height * s,
            fill: ann.fill || 'rgba(255, 255, 0, 0.3)', stroke: '', strokeWidth: 0,
          })
        }
        if (obj) {
          obj.selectable = false
          obj.evented = false
          canvas.add(obj)
        }
      })
    }

    canvas.renderAll()
  }

  const handleImageLoad = () => {
    if (fabricRef.current) return
    const imgEl = imgRef.current
    if (!imgEl) return

    const nw = imgEl.naturalWidth

    // Auto-detect HiDPI: if no user preference and image is wide, default to 1x (half size)
    if (!screenSizeInitRef.current && !localStorage.getItem('jotty-screen-size')) {
      screenSizeInitRef.current = true
      const isHiDPI = nw > 2000
      setScreenSize(isHiDPI)
    }

    setNaturalW(nw)
  }

  // Initialize canvas after image dimensions are known and React has rendered at correct size
  useEffect(() => {
    if (!naturalW || fabricRef.current || !snap) return
    const imgEl = imgRef.current
    if (!imgEl) return

    const frame = requestAnimationFrame(() => {
      initCanvas(snap.annotations, snap.canvas_width)
    })
    return () => cancelAnimationFrame(frame)
  }, [naturalW, snap, screenSize])

  const handleToggleSize = () => {
    if (fabricRef.current) {
      fabricRef.current.dispose()
      fabricRef.current = null
    }

    setScreenSize(prev => {
      const next = !prev
      localStorage.setItem('jotty-screen-size', next ? '1x' : '2x')
      return next
    })
  }

  useEffect(() => {
    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose()
        fabricRef.current = null
      }
    }
  }, [])

  const handleFork = async () => {
    if (!forkName.trim()) return
    try {
      const res = await fetch(`/api/snaps/${id}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_name: forkName.trim(),
          include_annotations: includeAnnotations,
        }),
      })
      if (!res.ok) throw new Error()
      const newSnap = await res.json()
      navigate(`/snap/${newSnap.id}/edit`)
    } catch {
      alert('Failed to fork')
    }
  }

  if (!snap) return <div className="loading">Loading...</div>

  const mobile = isMobile()

  const imgStyle = {
    display: 'block',
    maxWidth: '100%',
    height: 'auto',
  }
  if (mobile) {
    imgStyle.width = '100%'
  } else if (screenSize && naturalW) {
    imgStyle.width = `${Math.round(naturalW / 2)}px`
  }

  return (
    <div className="viewer-page">
      <div className="viewer-meta">
        <div className="meta-info">
          <span className="creator">{snap.creator_name}</span>
          <span className="timestamp">{new Date(snap.created_at).toLocaleString()}</span>
          {snap.source_url && (
            <a href={snap.source_url} target="_blank" rel="noopener noreferrer">
              {snap.source_url}
            </a>
          )}
          {snap.source_notes && <span className="source-notes">{snap.source_notes}</span>}
          {snap.forked_from && (
            <span className="source-notes">
              Forked from <a href={`/snap/${snap.forked_from}`}>{snap.forked_from.slice(0, 8)}...</a>
            </span>
          )}
        </div>
        <div className="viewer-actions">
          {!mobile && (
            <>
              <button className={`btn ${screenSize ? 'active' : ''}`} onClick={() => !screenSize && handleToggleSize()}>
                1x
              </button>
              <button className={`btn ${!screenSize ? 'active' : ''}`} onClick={() => screenSize && handleToggleSize()}>
                2x
              </button>
            </>
          )}
          <button className="btn btn-primary" onClick={() => setShowForkDialog(true)}>Fork</button>
          <button className="btn btn-secondary" onClick={() => navigate(`/snap/${id}/edit`)}>Edit</button>
        </div>
      </div>

      <div className="viewer-canvas-wrapper">
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <img
            ref={imgRef}
            src={snap.image_path}
            onLoad={handleImageLoad}
            style={imgStyle}
            alt="Screenshot"
          />
          <canvas
            ref={canvasRef}
            style={{ position: 'absolute', left: 0, top: 0 }}
          />
        </div>
      </div>

      {showForkDialog && (
        <div className="dialog-overlay" onClick={() => setShowForkDialog(false)}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <h3>Fork this Snap</h3>
            <div className="form-group">
              <label>Your Name</label>
              <input
                type="text"
                value={forkName}
                onChange={e => setForkName(e.target.value)}
                placeholder="e.g. Jane Smith"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="checkbox-group">
                <input
                  type="checkbox"
                  checked={includeAnnotations}
                  onChange={e => setIncludeAnnotations(e.target.checked)}
                />
                Include existing annotations
              </label>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setShowForkDialog(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleFork} disabled={!forkName.trim()}>Fork</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

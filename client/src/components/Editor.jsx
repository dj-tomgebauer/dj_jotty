import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as fabric from 'fabric'
import {
  CursorIcon,
  RectangleIcon,
  CircleIcon,
  LineSegmentIcon,
  ArrowUpRightIcon,
  HighlighterIcon,
  TextTIcon,
  LinkIcon,
  EyeIcon,
  CopySimpleIcon,
} from '@phosphor-icons/react'

const CANVAS_PADDING = 200
const COLORS = ['#FF0000', '#0066FF', '#00CC44', '#FF9900', '#9933FF', '#000000']
const STROKE_WIDTHS = [1, 2, 4]
const STROKE_TOOLS = new Set(['rectangle', 'circle', 'line', 'arrow'])

const TOOLS = {
  select:    { label: 'Select',  icon: CursorIcon },
  rectangle: { label: 'Rect',    icon: RectangleIcon },
  circle:    { label: 'Circle',  icon: CircleIcon },
  line:      { label: 'Line',    icon: LineSegmentIcon },
  arrow:     { label: 'Arrow',   icon: ArrowUpRightIcon },
  highlight: { label: 'Hilite',  icon: HighlighterIcon },
  text:      { label: 'Text',    icon: TextTIcon },
}

const TOOL_SHORTCUTS = {
  s: 'select',
  r: 'rectangle',
  c: 'circle',
  l: 'line',
  a: 'arrow',
  h: 'highlight',
  t: 'text',
}

const ARROW_STYLES = ['end', 'open', 'both']

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

export default function Editor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const canvasRef = useRef(null)
  const wrapperRef = useRef(null)
  const imgRef = useRef(null)
  const fabricRef = useRef(null)
  const [snap, setSnap] = useState(null)
  const [activeTool, setActiveTool] = useState('select')
  const [activeColor, setActiveColor] = useState('#FF0000')
  const [activeStrokeWidth, setActiveStrokeWidth] = useState(2)
  const [activeArrowStyle, setActiveArrowStyle] = useState('end')
  const [strokeMenuFor, setStrokeMenuFor] = useState(null)
  const strokeMenuRef = useRef(null)
  const [saveStatus, setSaveStatus] = useState(null)
  const [copied, setCopied] = useState(false)
  const [copiedImage, setCopiedImage] = useState(false)
  const saveTimerRef = useRef(null)
  const [screenSize, setScreenSize] = useState(true)
  const [naturalW, setNaturalW] = useState(null)
  const isDrawingRef = useRef(false)
  const startPointRef = useRef(null)
  const activeShapeRef = useRef(null)
  const canvasPadRef = useRef({ x: CANVAS_PADDING, y: CANVAS_PADDING })
  const undoStackRef = useRef([])
  const pendingToggleRef = useRef(null)

  // Apply property changes to selected canvas objects
  const applyToSelection = ({ color, strokeWidth, arrowStyle }) => {
    const canvas = fabricRef.current
    if (!canvas) return
    const selected = canvas.getActiveObjects()
    if (selected.length === 0) return
    selected.forEach(obj => {
      if (color !== undefined) {
        if (obj instanceof fabric.IText) obj.set('fill', color)
        else if (obj.stroke) obj.set('stroke', color)
      }
      if (strokeWidth !== undefined && obj.stroke) {
        obj.set('strokeWidth', strokeWidth)
      }
      if (arrowStyle !== undefined && obj._isArrow) {
        obj._arrowStyle = arrowStyle
      }
    })
    canvas.renderAll()
    triggerAutosave()
  }

  // Close stroke menu on outside click
  useEffect(() => {
    if (!strokeMenuFor) return
    const onClick = (e) => {
      if (strokeMenuRef.current && !strokeMenuRef.current.contains(e.target)) {
        setStrokeMenuFor(null)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [strokeMenuFor])

  // Load snap data
  useEffect(() => {
    fetch(`/api/snaps/${id}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(setSnap)
      .catch(() => navigate('/'))
  }, [id, navigate])

  const initCanvas = (annotations, explicitW, explicitH) => {
    const imgEl = imgRef.current
    const wrapper = wrapperRef.current
    if (!imgEl || !wrapper) return

    const imgW = explicitW || imgEl.clientWidth
    const imgH = explicitH || imgEl.clientHeight
    if (!imgW || !imgH) return

    // Compute padding so canvas fills at least the full visible wrapper area
    const wW = wrapper.clientWidth
    const wH = wrapper.clientHeight
    const padX = Math.max(CANVAS_PADDING, Math.ceil((wW - imgW) / 2) + 50)
    const padY = Math.max(CANVAS_PADDING, Math.ceil((wH - imgH) / 2) + 50)
    canvasPadRef.current = { x: padX, y: padY }

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: imgW + padX * 2,
      height: imgH + padY * 2,
      enableRetinaScaling: false,
      selection: true,
    })
    fabricRef.current = canvas

    const fabricWrapper = canvas.wrapperEl || canvasRef.current.parentElement
    if (fabricWrapper) {
      fabricWrapper.style.position = 'absolute'
      fabricWrapper.style.left = `${-padX}px`
      fabricWrapper.style.top = `${-padY}px`
    }

    canvas.calcOffset()

    canvas.on('object:modified', () => triggerAutosave())
    canvas.on('text:editing:exited', () => {
      if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') {
        document.activeElement.blur()
      }
    })

    if (annotations && annotations.length > 0) {
      loadAnnotations(canvas, annotations)
    }

    canvas.renderAll()
  }

  const handleImageLoad = () => {
    if (fabricRef.current) return
    const imgEl = imgRef.current
    if (imgEl) setNaturalW(imgEl.naturalWidth)
  }

  // Initialize canvas AFTER React has rendered the image at its correct size.
  // handleImageLoad sets naturalW → React re-renders with imgStyle.width →
  // this effect fires → rAF ensures browser has laid out → read actual dimensions.
  useEffect(() => {
    if (!naturalW || fabricRef.current || !snap) return
    const imgEl = imgRef.current
    if (!imgEl) return

    const frame = requestAnimationFrame(() => {
      // Check for pending toggle (annotation scaling)
      if (pendingToggleRef.current) {
        const { annotations, oldW } = pendingToggleRef.current
        pendingToggleRef.current = null
        const newW = imgEl.clientWidth
        const newH = imgEl.clientHeight
        if (!newW || !newH) return
        const ratio = newW / oldW
        const scaledAnnotations = annotations.map(ann => {
          const scaled = { ...ann }
          if (ann.type === 'text') {
            scaled.left = ann.left * ratio
            scaled.top = ann.top * ratio
            scaled.fontSize = (ann.fontSize || 16) * ratio
          } else if (ann.type === 'line' || ann.type === 'arrow') {
            scaled.x1 = ann.x1 * ratio
            scaled.y1 = ann.y1 * ratio
            scaled.x2 = ann.x2 * ratio
            scaled.y2 = ann.y2 * ratio
          } else if (ann.type === 'circle') {
            scaled.left = ann.left * ratio
            scaled.top = ann.top * ratio
            scaled.rx = ann.rx * ratio
            scaled.ry = ann.ry * ratio
          } else {
            scaled.left = ann.left * ratio
            scaled.top = ann.top * ratio
            scaled.width = ann.width * ratio
            scaled.height = ann.height * ratio
          }
          return scaled
        })
        initCanvas(scaledAnnotations, newW, newH)
      } else {
        // Initial load
        const w = imgEl.clientWidth
        const h = imgEl.clientHeight
        if (w && h) initCanvas(snap.annotations, w, h)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [naturalW, snap, screenSize])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(saveTimerRef.current)
      if (fabricRef.current) {
        fabricRef.current.dispose()
        fabricRef.current = null
      }
    }
  }, [])

  const handleToggleSize = () => {
    const imgEl = imgRef.current
    if (!imgEl) return

    // Save state before disposing
    pendingToggleRef.current = {
      annotations: serializeAnnotations(),
      oldW: imgEl.clientWidth || 1,
    }

    if (fabricRef.current) {
      fabricRef.current.dispose()
      fabricRef.current = null
    }

    // Toggle — React will re-render with new imgStyle, then useEffect inits canvas
    setScreenSize(prev => !prev)
  }

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e) => {
      // Don't trigger shortcuts when typing in inputs
      if (e.target.tagName === 'INPUT') return
      // Don't trigger shortcuts when actively editing text on canvas
      const editingText = fabricRef.current?.getActiveObject()?.isEditing
      if (editingText) return
      // Block other textareas (but not Fabric's hidden textarea when not editing)
      if (e.target.tagName === 'TEXTAREA' && !e.target.closest('.canvas-container')) return

      const canvas = fabricRef.current
      const isMeta = e.metaKey || e.ctrlKey

      // Cmd/Ctrl+Z — Undo
      if (isMeta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
        return
      }

      // Cmd/Ctrl+Shift+Z — Redo
      if (isMeta && e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        handleRedo()
        return
      }

      // Cmd/Ctrl+S — prevent browser save dialog (autosave handles it)
      if (isMeta && e.key === 's') {
        e.preventDefault()
        return
      }

      // Delete / Backspace — delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (canvas && canvas.getActiveObjects().length > 0) {
          e.preventDefault()
          handleDelete()
          return
        }
      }

      // Cmd/Ctrl+C — copy selected objects
      if (isMeta && e.key === 'c') {
        if (canvas && canvas.getActiveObjects().length > 0) {
          canvas.getActiveObject().clone().then(cloned => {
            clipboardRef.current = cloned
          })
        }
        return
      }

      // Cmd/Ctrl+V — paste
      if (isMeta && e.key === 'v') {
        if (canvas && clipboardRef.current) {
          e.preventDefault()
          clipboardRef.current.clone().then(cloned => {
            canvas.discardActiveObject()
            cloned.set({
              left: (cloned.left || 0) + 10,
              top: (cloned.top || 0) + 10,
              evented: true,
            })
            if (cloned.type === 'activeselection') {
              cloned.canvas = canvas
              cloned.forEachObject(obj => canvas.add(obj))
              cloned.setCoords()
            } else {
              canvas.add(cloned)
            }
            clipboardRef.current.set({
              left: (clipboardRef.current.left || 0) + 10,
              top: (clipboardRef.current.top || 0) + 10,
            })
            canvas.setActiveObject(cloned)
            canvas.requestRenderAll()
            triggerAutosave()
          })
        }
        return
      }

      // Tool shortcuts (only when no modifier keys)
      if (!isMeta && !e.altKey) {
        const tool = TOOL_SHORTCUTS[e.key.toLowerCase()]
        if (tool) {
          e.preventDefault()
          setActiveTool(tool)
        }
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  })

  const clipboardRef = useRef(null)

  // Update drawing mode when tool changes
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    canvas.isDrawingMode = false
    canvas.selection = activeTool === 'select'
    canvas.forEachObject(obj => {
      obj.selectable = activeTool === 'select'
      obj.evented = activeTool === 'select'
    })
    canvas.defaultCursor = (activeTool === 'select' || activeTool === 'text') ? 'default' : 'crosshair'
    if (activeTool === 'text') {
      canvas.defaultCursor = 'text'
    }
    canvas.renderAll()
  }, [activeTool])

  // Mouse event handlers for shape drawing
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    const el = canvas.upperCanvasEl
    if (!el) return

    const getPointer = (e) => {
      const rect = el.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const onMouseDown = (e) => {
      if (activeTool === 'select') return

      // Text tool: place IText on click
      if (activeTool === 'text') {
        const pointer = getPointer(e)
        const textObj = new fabric.IText('Type here', {
          originX: 'left', originY: 'top',
          left: pointer.x, top: pointer.y,
          fontSize: 20,
          fill: activeColor,
          fontFamily: 'Inter, system-ui, sans-serif',
          editable: true,
        })
        canvas.add(textObj)
        canvas.setActiveObject(textObj)
        textObj.enterEditing()
        textObj.selectAll()
        undoStackRef.current = []
        textObj.on('editing:exited', () => {
          if (!textObj.text || !textObj.text.trim()) {
            canvas.remove(textObj)
          }
          // Return focus to the canvas so keyboard shortcuts work again
          if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') {
            document.activeElement.blur()
          }
          triggerAutosave()
        })
        return
      }

      const pointer = getPointer(e)
      isDrawingRef.current = true
      startPointRef.current = pointer

      let shape = null
      const origin = { originX: 'left', originY: 'top' }

      if (activeTool === 'rectangle') {
        shape = new fabric.Rect({
          ...origin,
          left: pointer.x, top: pointer.y, width: 0, height: 0,
          stroke: activeColor, strokeWidth: activeStrokeWidth, fill: 'transparent',
          strokeUniform: true,
        })
      } else if (activeTool === 'circle') {
        shape = new fabric.Ellipse({
          ...origin,
          left: pointer.x, top: pointer.y, rx: 0, ry: 0,
          stroke: activeColor, strokeWidth: activeStrokeWidth, fill: 'transparent',
          strokeUniform: true,
        })
      } else if (activeTool === 'line') {
        shape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
          ...origin,
          stroke: activeColor, strokeWidth: activeStrokeWidth,
          strokeUniform: true,
        })
      } else if (activeTool === 'arrow') {
        shape = createArrowLine([pointer.x, pointer.y, pointer.x, pointer.y], {
          ...origin,
          stroke: activeColor, strokeWidth: activeStrokeWidth,
          strokeUniform: true,
        }, activeArrowStyle)
      } else if (activeTool === 'highlight') {
        shape = new fabric.Rect({
          ...origin,
          left: pointer.x, top: pointer.y, width: 0, height: 0,
          fill: 'rgba(255, 255, 0, 0.3)', stroke: '', strokeWidth: 0,
        })
      }

      if (shape) {
        shape.selectable = false
        shape.evented = false
        canvas.add(shape)
        activeShapeRef.current = shape
      }
    }

    const onMouseMove = (e) => {
      if (!isDrawingRef.current || !activeShapeRef.current) return
      const pointer = getPointer(e)
      const start = startPointRef.current
      const shape = activeShapeRef.current

      if (activeTool === 'rectangle' || activeTool === 'highlight') {
        shape.set({
          left: Math.min(start.x, pointer.x),
          top: Math.min(start.y, pointer.y),
          width: Math.abs(pointer.x - start.x),
          height: Math.abs(pointer.y - start.y),
        })
      } else if (activeTool === 'circle') {
        shape.set({
          left: Math.min(start.x, pointer.x),
          top: Math.min(start.y, pointer.y),
          rx: Math.abs(pointer.x - start.x) / 2,
          ry: Math.abs(pointer.y - start.y) / 2,
        })
      } else if (activeTool === 'line' || activeTool === 'arrow') {
        shape.set({ x2: pointer.x, y2: pointer.y })
      }

      canvas.renderAll()
    }

    const onMouseUp = () => {
      if (!isDrawingRef.current) return
      isDrawingRef.current = false
      const shape = activeShapeRef.current
      if (shape) {
        shape.selectable = activeTool === 'select'
        shape.evented = activeTool === 'select'
        shape.setCoords()
        // Clear redo stack when a new action is performed
        undoStackRef.current = []
      }
      activeShapeRef.current = null
      triggerAutosave()
    }

    el.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)

    return () => {
      el.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [activeTool, activeColor, activeStrokeWidth, activeArrowStyle])

  const loadAnnotations = (canvas, annotations) => {
    const { x: PX, y: PY } = canvasPadRef.current
    const origin = { originX: 'left', originY: 'top' }
    annotations.forEach(ann => {
      let obj = null
      if (ann.type === 'text') {
        obj = new fabric.IText(ann.text || '', {
          ...origin,
          left: ann.left + PX, top: ann.top + PY,
          fontSize: ann.fontSize || 16, fill: ann.fill || '#FF0000',
          fontFamily: ann.fontFamily || 'Inter, system-ui, sans-serif',
          editable: true,
        })
      } else if (ann.type === 'rectangle') {
        obj = new fabric.Rect({
          ...origin,
          left: ann.left + PX, top: ann.top + PY, width: ann.width, height: ann.height,
          stroke: ann.stroke, strokeWidth: ann.strokeWidth, fill: ann.fill || 'transparent',
          strokeUniform: true,
        })
      } else if (ann.type === 'circle') {
        obj = new fabric.Ellipse({
          ...origin,
          left: ann.left + PX, top: ann.top + PY, rx: ann.rx || ann.radius, ry: ann.ry || ann.radius,
          stroke: ann.stroke, strokeWidth: ann.strokeWidth, fill: ann.fill || 'transparent',
          strokeUniform: true,
        })
      } else if (ann.type === 'line') {
        obj = new fabric.Line([ann.x1 + PX, ann.y1 + PY, ann.x2 + PX, ann.y2 + PY], {
          ...origin,
          stroke: ann.stroke, strokeWidth: ann.strokeWidth,
          strokeUniform: true,
        })
      } else if (ann.type === 'arrow') {
        obj = createArrowLine([ann.x1 + PX, ann.y1 + PY, ann.x2 + PX, ann.y2 + PY], {
          ...origin,
          stroke: ann.stroke, strokeWidth: ann.strokeWidth,
          strokeUniform: true,
        }, ann.arrowStyle)
      } else if (ann.type === 'highlight') {
        obj = new fabric.Rect({
          ...origin,
          left: ann.left + PX, top: ann.top + PY, width: ann.width, height: ann.height,
          fill: ann.fill || 'rgba(255, 255, 0, 0.3)', stroke: '', strokeWidth: 0,
        })
      }
      if (obj) canvas.add(obj)
    })
    canvas.renderAll()
  }

  const serializeAnnotations = () => {
    const canvas = fabricRef.current
    if (!canvas) return []
    const { x: PX, y: PY } = canvasPadRef.current
    return canvas.getObjects().map(obj => {
      if (obj instanceof fabric.IText) {
        return {
          type: 'text',
          left: obj.left - PX, top: obj.top - PY,
          text: obj.text, fontSize: obj.fontSize, fill: obj.fill,
          fontFamily: obj.fontFamily,
        }
      }
      if (obj instanceof fabric.Line) {
        const data = {
          type: obj._isArrow ? 'arrow' : 'line',
          x1: obj.x1 - PX, y1: obj.y1 - PY, x2: obj.x2 - PX, y2: obj.y2 - PY,
          stroke: obj.stroke, strokeWidth: obj.strokeWidth,
        }
        if (obj._isArrow && obj._arrowStyle && obj._arrowStyle !== 'end') {
          data.arrowStyle = obj._arrowStyle
        }
        return data
      }
      const isHighlight = !obj.stroke && obj.fill && obj.fill.includes('rgba')
      if (obj instanceof fabric.Ellipse) {
        return {
          type: 'circle',
          left: obj.left - PX, top: obj.top - PY, rx: obj.rx, ry: obj.ry,
          stroke: obj.stroke, strokeWidth: obj.strokeWidth,
          fill: obj.fill || 'transparent',
        }
      }
      return {
        type: isHighlight ? 'highlight' : 'rectangle',
        left: obj.left - PX, top: obj.top - PY, width: obj.width, height: obj.height,
        stroke: obj.stroke || '', strokeWidth: obj.strokeWidth || 0,
        fill: obj.fill || 'transparent',
      }
    })
  }

  const triggerAutosave = () => {
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        const annotations = serializeAnnotations()
        const canvas = fabricRef.current
        const res = await fetch(`/api/snaps/${id}/annotations`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            annotations,
            canvas_width: imgRef.current?.clientWidth || canvas?.width,
            canvas_height: imgRef.current?.clientHeight || canvas?.height,
          }),
        })
        if (!res.ok) throw new Error()
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus(null), 2000)
      } catch {
        setSaveStatus('error')
      }
    }, 800)
  }

  const handleCopyLink = () => {
    const url = `${window.location.origin}/snap/${id}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCopyImage = async () => {
    const imgEl = imgRef.current
    const canvas = fabricRef.current
    if (!imgEl || !canvas) return

    const imgW = imgEl.clientWidth
    const imgH = imgEl.clientHeight
    const { x: PX, y: PY } = canvasPadRef.current

    const offscreen = document.createElement('canvas')
    offscreen.width = imgW
    offscreen.height = imgH
    const ctx = offscreen.getContext('2d')

    // Draw background image at current display size
    ctx.drawImage(imgEl, 0, 0, imgW, imgH)

    // Draw Fabric annotations on top, cropped to the image region
    const fabricCanvas = canvas.lowerCanvasEl
    ctx.drawImage(fabricCanvas, PX, PY, imgW, imgH, 0, 0, imgW, imgH)

    try {
      const blob = await new Promise(resolve => offscreen.toBlob(resolve, 'image/png'))
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setCopiedImage(true)
      setTimeout(() => setCopiedImage(false), 2000)
    } catch (err) {
      console.error('Failed to copy image:', err)
    }
  }

  const handleDelete = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    const active = canvas.getActiveObjects()
    active.forEach(obj => {
      undoStackRef.current.push(obj)
      canvas.remove(obj)
    })
    canvas.discardActiveObject()
    canvas.renderAll()
    triggerAutosave()
  }

  const handleUndo = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    const objects = canvas.getObjects()
    if (objects.length > 0) {
      const removed = objects[objects.length - 1]
      undoStackRef.current.push(removed)
      canvas.remove(removed)
      canvas.renderAll()
      triggerAutosave()
    }
  }

  const handleRedo = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    if (undoStackRef.current.length > 0) {
      const obj = undoStackRef.current.pop()
      canvas.add(obj)
      canvas.renderAll()
      triggerAutosave()
    }
  }

  if (!snap) return <div className="loading">Loading...</div>

  const imgStyle = {
    display: 'block',
    maxWidth: '100%',
    height: 'auto',
  }
  if (screenSize && naturalW) {
    imgStyle.width = `${Math.round(naturalW / 2)}px`
  }

  return (
    <div className="editor-page">
      <div className="toolbar">
        <div className="toolbar-left">
          <div className="tool-group">
            {['select', 'rectangle', 'circle', 'line', 'arrow', 'highlight', 'text'].map(tool => {
              const { label, icon: Icon } = TOOLS[tool]
              const hasStroke = STROKE_TOOLS.has(tool)
              const isActive = activeTool === tool
              return (
                <div key={tool} className="tool-btn-wrap" ref={hasStroke && strokeMenuFor === tool ? strokeMenuRef : undefined}>
                  <button
                    className={isActive ? 'active' : ''}
                    onClick={() => { setActiveTool(tool); setStrokeMenuFor(null) }}
                    title={`${label} (${Object.entries(TOOL_SHORTCUTS).find(([, v]) => v === tool)?.[0].toUpperCase()})`}
                  >
                    <Icon size={16} weight="bold" /> {label}
                  </button>
                  {hasStroke && (
                    <button
                      className={`stroke-chevron${isActive ? ' active' : ''}`}
                      onClick={() => setStrokeMenuFor(v => v === tool ? null : tool)}
                      title="Stroke width"
                    >
                      <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 3l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                  )}
                  {hasStroke && strokeMenuFor === tool && (
                    <div className="stroke-menu">
                      <span className="stroke-menu-label">Weight</span>
                      <div className="stroke-menu-row">
                        {STROKE_WIDTHS.map(w => (
                          <button
                            key={w}
                            className={activeStrokeWidth === w ? 'active' : ''}
                            onClick={() => { setActiveStrokeWidth(w); applyToSelection({ strokeWidth: w }) }}
                          >
                            <svg width="20" height="12" viewBox="0 0 20 12">
                              <line x1="2" y1="6" x2="18" y2="6" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
                            </svg>
                          </button>
                        ))}
                      </div>
                      {tool === 'arrow' && (
                        <>
                          <span className="stroke-menu-label">Style</span>
                          <div className="stroke-menu-row">
                            {ARROW_STYLES.map(s => (
                              <button
                                key={s}
                                className={activeArrowStyle === s ? 'active' : ''}
                                onClick={() => { setActiveArrowStyle(s); applyToSelection({ arrowStyle: s }) }}
                              >
                                <svg width="20" height="12" viewBox="0 0 20 12">
                                  {s === 'end' && (
                                    <>
                                      <line x1="1" y1="6" x2="13" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                      <polygon points="18,6 12,3 12,9" fill="currentColor" />
                                    </>
                                  )}
                                  {s === 'both' && (
                                    <>
                                      <line x1="6" y1="6" x2="14" y2="6" stroke="currentColor" strokeWidth="1.5" />
                                      <polygon points="18,6 12,3 12,9" fill="currentColor" />
                                      <polygon points="2,6 8,3 8,9" fill="currentColor" />
                                    </>
                                  )}
                                  {s === 'open' && (
                                    <>
                                      <line x1="1" y1="6" x2="13" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                      <polyline points="12,3 18,6 12,9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </>
                                  )}
                                </svg>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="separator" />

          <div className="tool-group">
            {COLORS.map(color => (
              <button
                key={color}
                className={`color-btn ${activeColor === color ? 'active' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => { setActiveColor(color); applyToSelection({ color }) }}
              />
            ))}
          </div>

        </div>

        <div className="toolbar-right">
          <div className="tool-group">
            <button className="btn btn-secondary" onClick={handleCopyImage}>
              <CopySimpleIcon size={16} weight="bold" /> {copiedImage ? 'Copied!' : 'Copy'}
            </button>
            <button className="btn btn-secondary" onClick={handleCopyLink}>
              <LinkIcon size={16} weight="bold" /> {copied ? 'Copied!' : 'Copy Link'}
            </button>
            <button className="btn btn-secondary" onClick={() => navigate(`/snap/${id}`)}>
              <EyeIcon size={16} weight="bold" /> View
            </button>
            <button className={screenSize ? 'active' : ''} onClick={() => !screenSize && handleToggleSize()}>
              1x
            </button>
            <button className={!screenSize ? 'active' : ''} onClick={() => screenSize && handleToggleSize()}>
              2x
            </button>
          </div>
        </div>
      </div>

      <div className="canvas-container-wrapper" ref={wrapperRef}>
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

      {saveStatus && (
        <div className={`save-toast ${saveStatus}`}>
          {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Save failed'}
        </div>
      )}
    </div>
  )
}

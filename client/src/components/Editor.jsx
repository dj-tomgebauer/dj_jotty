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
  PencilSimpleIcon,
  TextTIcon,
  LinkIcon,
  EyeIcon,
  CopySimpleIcon,
} from '@phosphor-icons/react'

const CANVAS_PADDING = 200
const isMobile = () => window.innerWidth <= 768
const COLORS = ['#FF0000', '#0066FF', '#00CC44', '#FF9900', '#9933FF', '#000000']
const STROKE_WIDTHS = [1, 2, 4]
const STROKE_TOOLS = new Set(['rectangle', 'circle', 'line', 'arrow', 'draw'])

const TOOLS = {
  select:    { label: 'Select',  icon: CursorIcon },
  rectangle: { label: 'Rect',    icon: RectangleIcon },
  circle:    { label: 'Circle',  icon: CircleIcon },
  line:      { label: 'Line',    icon: LineSegmentIcon },
  arrow:     { label: 'Arrow',   icon: ArrowUpRightIcon },
  draw:      { label: 'Draw',    icon: PencilSimpleIcon },
  highlight: { label: 'Hilite',  icon: HighlighterIcon },
  text:      { label: 'Text',    icon: TextTIcon },
}

const TOOL_SHORTCUTS = {
  v: 'select',
  s: 'rectangle',
  r: 'rectangle',
  c: 'circle',
  l: 'line',
  a: 'arrow',
  d: 'draw',
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
  const [screenSize, setScreenSize] = useState(() => {
    const stored = localStorage.getItem('jotty-screen-size')
    if (stored) return stored === '1x'
    return true // default, will be overridden by HiDPI detection on image load
  })
  const [naturalW, setNaturalW] = useState(null)
  const screenSizeInitRef = useRef(false)
  const isDrawingRef = useRef(false)
  const startPointRef = useRef(null)
  const activeShapeRef = useRef(null)
  const canvasPadRef = useRef({ x: CANVAS_PADDING, y: CANVAS_PADDING })
  const undoStackRef = useRef([])
  const pendingToggleRef = useRef(null)
  const cmdHeldRef = useRef(false)

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

  const initCanvas = (annotations, explicitW, explicitH, storedCanvasWidth) => {
    const imgEl = imgRef.current
    const wrapper = wrapperRef.current
    if (!imgEl || !wrapper) return

    const imgW = explicitW || imgEl.clientWidth
    const imgH = explicitH || imgEl.clientHeight
    if (!imgW || !imgH) return

    // Compute padding so canvas fills at least the full visible wrapper area
    // On mobile, use minimal padding since image fills the screen
    const mobile = isMobile()
    const wW = wrapper.clientWidth
    const wH = wrapper.clientHeight
    const basePad = mobile ? 20 : CANVAS_PADDING
    const padX = Math.max(basePad, Math.ceil((wW - imgW) / 2) + (mobile ? 10 : 50))
    const padY = Math.max(basePad, Math.ceil((wH - imgH) / 2) + (mobile ? 10 : 50))
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

    // Prevent touch scrolling on canvas elements (needed for mobile drawing)
    if (canvas.upperCanvasEl) canvas.upperCanvasEl.style.touchAction = 'none'
    if (canvas.lowerCanvasEl) canvas.lowerCanvasEl.style.touchAction = 'none'

    canvas.on('object:modified', () => triggerAutosave())
    canvas.on('path:created', () => { undoStackRef.current = []; triggerAutosave() })
    canvas.on('text:editing:exited', () => {
      if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') {
        document.activeElement.blur()
      }
    })

    if (annotations && annotations.length > 0) {
      loadAnnotations(canvas, annotations, storedCanvasWidth)
    }

    canvas.renderAll()
  }

  const handleImageLoad = () => {
    if (fabricRef.current) return
    const imgEl = imgRef.current
    if (!imgEl) return

    const nw = imgEl.naturalWidth
    // Auto-detect HiDPI: if no user preference and image is wide, default to 1x (half size)
    // If image is narrow (likely 1x capture), default to 2x (full size)
    if (!screenSizeInitRef.current && !localStorage.getItem('jotty-screen-size')) {
      screenSizeInitRef.current = true
      const isHiDPI = nw > 2000
      setScreenSize(isHiDPI) // true = 1x (half), false = 2x (full)
    }
    setNaturalW(nw)
  }

  // Initialize canvas AFTER React has rendered the image at its correct size.
  // handleImageLoad sets naturalW → React re-renders with imgStyle.width →
  // this effect fires → rAF ensures browser has laid out → read actual dimensions.
  useEffect(() => {
    if (!naturalW || fabricRef.current || !snap) return
    const imgEl = imgRef.current
    if (!imgEl) return

    const frame = requestAnimationFrame(() => {
      const w = imgEl.clientWidth
      const h = imgEl.clientHeight
      if (!w || !h) return

      if (pendingToggleRef.current) {
        // Toggle: annotations already in natural space from serializeAnnotations()
        const { annotations } = pendingToggleRef.current
        pendingToggleRef.current = null
        initCanvas(annotations, w, h, naturalW)
      } else {
        // Initial load: use stored canvas_width for correct scaling
        initCanvas(snap.annotations, w, h, snap.canvas_width)
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
    // Serialize to natural space before disposing
    pendingToggleRef.current = {
      annotations: serializeAnnotations(),
    }

    if (fabricRef.current) {
      fabricRef.current.dispose()
      fabricRef.current = null
    }

    // Toggle — React will re-render with new imgStyle, then useEffect inits canvas
    setScreenSize(prev => {
      const next = !prev
      localStorage.setItem('jotty-screen-size', next ? '1x' : '2x')
      return next
    })
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

  // Hold Cmd/Ctrl to temporarily switch to select mode while drawing
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    const enableSelect = () => {
      canvas.isDrawingMode = false
      canvas.selection = true
      canvas.forEachObject(obj => { obj.selectable = true; obj.evented = true })
      canvas.defaultCursor = 'default'
    }

    const restoreTool = () => {
      canvas.isDrawingMode = activeTool === 'draw'
      canvas.selection = activeTool === 'select'
      const sel = activeTool === 'select'
      canvas.forEachObject(obj => { obj.selectable = sel; obj.evented = sel })
      canvas.defaultCursor = activeTool === 'select' ? 'default' : activeTool === 'text' ? 'text' : 'crosshair'
    }

    const onKeyDown = (e) => {
      if (e.key === 'Meta' || e.key === 'Control') {
        if (activeTool !== 'select' && !cmdHeldRef.current) {
          cmdHeldRef.current = true
          enableSelect()
        }
      }
    }

    const onKeyUp = (e) => {
      if (e.key === 'Meta' || e.key === 'Control') {
        if (cmdHeldRef.current) {
          cmdHeldRef.current = false
          restoreTool()
        }
      }
    }

    // Also clear on blur (in case key release happens while window unfocused)
    const onBlur = () => {
      if (cmdHeldRef.current) {
        cmdHeldRef.current = false
        restoreTool()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [activeTool])

  // Update drawing mode when tool changes
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    canvas.isDrawingMode = activeTool === 'draw'
    if (activeTool === 'draw') {
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas)
      canvas.freeDrawingBrush.color = activeColor
      canvas.freeDrawingBrush.width = activeStrokeWidth
    }
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
  }, [activeTool, activeColor, activeStrokeWidth])

  // Mouse event handlers for shape drawing
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    const el = canvas.upperCanvasEl
    if (!el) return

    const getPointer = (e) => {
      const rect = el.getBoundingClientRect()
      const touch = e.touches?.[0] || e.changedTouches?.[0]
      const clientX = touch ? touch.clientX : e.clientX
      const clientY = touch ? touch.clientY : e.clientY
      return { x: clientX - rect.left, y: clientY - rect.top }
    }

    const onTouchStart = (e) => {
      if (activeTool === 'select' || activeTool === 'draw') return
      // Prevent scroll while drawing
      e.preventDefault()
      onMouseDown(e)
    }

    const onTouchMove = (e) => {
      if (!isDrawingRef.current) return
      e.preventDefault()
      onMouseMove(e)
    }

    const onTouchEnd = (e) => {
      onMouseUp(e)
    }

    const onMouseDown = (e) => {
      if (activeTool === 'select' || activeTool === 'draw') return
      if (cmdHeldRef.current) return

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
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd)

    return () => {
      el.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      el.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [activeTool, activeColor, activeStrokeWidth, activeArrowStyle])

  const loadAnnotations = (canvas, annotations, storedCanvasWidth) => {
    const { x: PX, y: PY } = canvasPadRef.current
    const origin = { originX: 'left', originY: 'top' }
    const imgEl = imgRef.current
    const displayW = imgEl?.clientWidth || 1
    // Scale from stored coordinate space to current display size
    // storedCanvasWidth is naturalWidth for new saves, or old display width for legacy
    const refW = storedCanvasWidth || imgEl?.naturalWidth || displayW
    const s = displayW / refW
    annotations.forEach(ann => {
      let obj = null
      if (ann.type === 'text') {
        obj = new fabric.IText(ann.text || '', {
          ...origin,
          left: ann.left * s + PX, top: ann.top * s + PY,
          fontSize: (ann.fontSize || 16) * s, fill: ann.fill || '#FF0000',
          fontFamily: ann.fontFamily || 'Inter, system-ui, sans-serif',
          editable: true,
        })
      } else if (ann.type === 'rectangle') {
        obj = new fabric.Rect({
          ...origin,
          left: ann.left * s + PX, top: ann.top * s + PY,
          width: ann.width * s, height: ann.height * s,
          stroke: ann.stroke, strokeWidth: ann.strokeWidth, fill: ann.fill || 'transparent',
          strokeUniform: true,
        })
      } else if (ann.type === 'circle') {
        obj = new fabric.Ellipse({
          ...origin,
          left: ann.left * s + PX, top: ann.top * s + PY,
          rx: (ann.rx || ann.radius) * s, ry: (ann.ry || ann.radius) * s,
          stroke: ann.stroke, strokeWidth: ann.strokeWidth, fill: ann.fill || 'transparent',
          strokeUniform: true,
        })
      } else if (ann.type === 'line') {
        obj = new fabric.Line([ann.x1 * s + PX, ann.y1 * s + PY, ann.x2 * s + PX, ann.y2 * s + PY], {
          ...origin,
          stroke: ann.stroke, strokeWidth: ann.strokeWidth,
          strokeUniform: true,
        })
      } else if (ann.type === 'arrow') {
        obj = createArrowLine([ann.x1 * s + PX, ann.y1 * s + PY, ann.x2 * s + PX, ann.y2 * s + PY], {
          ...origin,
          stroke: ann.stroke, strokeWidth: ann.strokeWidth,
          strokeUniform: true,
        }, ann.arrowStyle)
      } else if (ann.type === 'draw') {
        obj = new fabric.Path(ann.path, {
          ...origin,
          left: ann.left * s + PX, top: ann.top * s + PY,
          scaleX: s, scaleY: s,
          stroke: ann.stroke, strokeWidth: ann.strokeWidth,
          fill: ann.fill || '',
          strokeLineCap: 'round', strokeLineJoin: 'round',
        })
      } else if (ann.type === 'highlight') {
        obj = new fabric.Rect({
          ...origin,
          left: ann.left * s + PX, top: ann.top * s + PY,
          width: ann.width * s, height: ann.height * s,
          fill: ann.fill || 'rgba(255, 255, 0, 0.3)', stroke: '', strokeWidth: 0,
        })
      }
      if (obj) canvas.add(obj)
    })
    canvas.renderAll()
  }

  const serializeAnnotations = (forToggle = false) => {
    const canvas = fabricRef.current
    if (!canvas) return []
    const { x: PX, y: PY } = canvasPadRef.current
    const imgEl = imgRef.current
    // Normalize to natural image dimensions for storage
    // For toggle (transient), skip normalization — we'll re-normalize on load
    const displayW = imgEl?.clientWidth || 1
    const natW = imgEl?.naturalWidth || displayW
    const s = forToggle ? 1 : natW / displayW
    return canvas.getObjects().map(obj => {
      if (obj instanceof fabric.Path) {
        return {
          type: 'draw',
          path: obj.path,
          left: (obj.left - PX) * s, top: (obj.top - PY) * s,
          width: obj.width * s, height: obj.height * s,
          stroke: obj.stroke, strokeWidth: obj.strokeWidth,
          fill: obj.fill,
        }
      }
      if (obj instanceof fabric.IText) {
        return {
          type: 'text',
          left: (obj.left - PX) * s, top: (obj.top - PY) * s,
          text: obj.text, fontSize: obj.fontSize * s, fill: obj.fill,
          fontFamily: obj.fontFamily,
        }
      }
      if (obj instanceof fabric.Line) {
        const data = {
          type: obj._isArrow ? 'arrow' : 'line',
          x1: (obj.x1 - PX) * s, y1: (obj.y1 - PY) * s,
          x2: (obj.x2 - PX) * s, y2: (obj.y2 - PY) * s,
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
          left: (obj.left - PX) * s, top: (obj.top - PY) * s,
          rx: obj.rx * s, ry: obj.ry * s,
          stroke: obj.stroke, strokeWidth: obj.strokeWidth,
          fill: obj.fill || 'transparent',
        }
      }
      return {
        type: isHighlight ? 'highlight' : 'rectangle',
        left: (obj.left - PX) * s, top: (obj.top - PY) * s,
        width: obj.width * s, height: obj.height * s,
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
        const imgEl = imgRef.current
        const res = await fetch(`/api/snaps/${id}/annotations`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            annotations,
            canvas_width: imgEl?.naturalWidth || null,
            canvas_height: imgEl?.naturalHeight || null,
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

  const mobile = isMobile()

  const imgStyle = {
    display: 'block',
    maxWidth: '100%',
    height: 'auto',
  }
  if (mobile) {
    // On mobile, always fit to viewport width
    imgStyle.width = '100%'
  } else if (screenSize && naturalW) {
    imgStyle.width = `${Math.round(naturalW / 2)}px`
  }

  return (
    <div className="editor-page">
      <div className="toolbar">
        <div className="toolbar-left">
          <div className="tool-group">
            {['select', 'rectangle', 'circle', 'line', 'arrow', 'draw', 'highlight', 'text'].map(tool => {
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
            {!mobile && (
              <>
                <button className={screenSize ? 'active' : ''} onClick={() => !screenSize && handleToggleSize()}>
                  1x
                </button>
                <button className={!screenSize ? 'active' : ''} onClick={() => screenSize && handleToggleSize()}>
                  2x
                </button>
              </>
            )}
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

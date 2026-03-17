import { Link } from 'react-router-dom'

function AnnotationOverlay({ annotations, canvasWidth, canvasHeight }) {
  if (!annotations || annotations.length === 0 || !canvasWidth || !canvasHeight) return null

  return (
    <svg
      className="snap-card-annotations"
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      preserveAspectRatio="xMidYMid slice"
    >
      {annotations.map((ann, i) => {
        if (ann.type === 'rectangle') {
          return (
            <rect key={i} x={ann.left} y={ann.top} width={ann.width} height={ann.height}
              stroke={ann.stroke} strokeWidth={ann.strokeWidth} fill={ann.fill || 'transparent'} />
          )
        }
        if (ann.type === 'circle') {
          return (
            <ellipse key={i}
              cx={ann.left + (ann.rx || 0)} cy={ann.top + (ann.ry || 0)}
              rx={ann.rx} ry={ann.ry}
              stroke={ann.stroke} strokeWidth={ann.strokeWidth} fill={ann.fill || 'transparent'} />
          )
        }
        if (ann.type === 'line') {
          return (
            <line key={i} x1={ann.x1} y1={ann.y1} x2={ann.x2} y2={ann.y2}
              stroke={ann.stroke} strokeWidth={ann.strokeWidth} />
          )
        }
        if (ann.type === 'highlight') {
          return (
            <rect key={i} x={ann.left} y={ann.top} width={ann.width} height={ann.height}
              fill={ann.fill || 'rgba(255, 255, 0, 0.3)'} stroke="none" />
          )
        }
        if (ann.type === 'text') {
          return (
            <text key={i} x={ann.left} y={ann.top} fill={ann.fill || '#FF0000'}
              fontSize={ann.fontSize || 16} fontFamily={ann.fontFamily || 'Inter, system-ui, sans-serif'}
              dominantBaseline="hanging">{ann.text}</text>
          )
        }
        return null
      })}
    </svg>
  )
}

export default function SnapCard({ snap }) {
  return (
    <Link to={`/snap/${snap.id}/edit`} className="snap-card">
      <div className="snap-card-thumb">
        <img src={snap.image_path} alt="Snap" />
        <AnnotationOverlay
          annotations={snap.annotations}
          canvasWidth={snap.canvas_width}
          canvasHeight={snap.canvas_height}
        />
      </div>
      <div className="snap-card-info">
        <span className="snap-card-creator">{snap.creator_name}</span>
        <span className="snap-card-date">{new Date(snap.created_at).toLocaleDateString()}</span>
        {snap.source_url && (() => {
          try { return <span className="snap-card-url">{new URL(snap.source_url).hostname}</span> }
          catch { return null }
        })()}
        {snap.source_notes && <span className="snap-card-notes">{snap.source_notes}</span>}
      </div>
    </Link>
  )
}

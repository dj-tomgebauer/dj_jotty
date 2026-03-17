import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import ImageUpload from './components/ImageUpload'
import Library from './components/Library'
import Editor from './components/Editor'
import Viewer from './components/Viewer'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <div className="app-header">
        <Link to="/" className="app-header-title"><h1>Jotty</h1></Link>
        <nav className="app-nav">
          <Link to="/" className="app-nav-link">Upload</Link>
          <Link to="/library" className="app-nav-link">Library</Link>
        </nav>
      </div>
      <Routes>
        <Route path="/" element={<ImageUpload />} />
        <Route path="/library" element={<Library />} />
        <Route path="/snap/:id/edit" element={<Editor />} />
        <Route path="/snap/:id" element={<Viewer />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App

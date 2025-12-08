import React from 'react'
import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import BetaAnalysis from './pages/BetaAnalysis'
import ClimbingDaily from './pages/ClimbingDaily'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/beta-analysis" element={<BetaAnalysis />} />
        <Route path="/climbing-daily" element={<ClimbingDaily />} />
      </Routes>
    </Router>
  )
}

export default App


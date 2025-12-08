import React from 'react'
import { NavBar } from 'antd-mobile'
import { useNavigate } from 'react-router-dom'

const BetaAnalysis: React.FC = () => {
  const navigate = useNavigate()

  const onBack = () => {
    navigate(-1)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#ffffff' }}>
      <NavBar onBack={onBack}>Beta 分析</NavBar>
      <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        <h2>Beta 分析功能开发中...</h2>
        <p>这里将提供攀岩动作的详细分析工具。</p>
      </div>
    </div>
  )
}

export default BetaAnalysis


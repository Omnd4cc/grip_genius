import React from 'react'
import { NavBar } from 'antd-mobile'
import { useNavigate } from 'react-router-dom'

const ClimbingDaily: React.FC = () => {
  const navigate = useNavigate()

  const onBack = () => {
    navigate(-1)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#ffffff' }}>
      <NavBar onBack={onBack}>攀岩日结</NavBar>
      <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        <h2>攀岩日结功能开发中...</h2>
        <p>这里将用于记录和回顾每日的攀岩训练。</p>
      </div>
    </div>
  )
}

export default ClimbingDaily


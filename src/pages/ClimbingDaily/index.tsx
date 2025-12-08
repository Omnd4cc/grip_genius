import React from 'react'
import { NavBar } from 'antd-mobile'
import { useNavigate } from 'react-router-dom'
import { CalendarOutline } from 'antd-mobile-icons'

const ClimbingDaily: React.FC = () => {
  const navigate = useNavigate()

  const onBack = () => {
    navigate(-1)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      <NavBar onBack={onBack} style={{ background: '#fff', borderBottom: '1px solid #f0f0f0' }}>攀岩日结</NavBar>
      <div style={{ padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ 
          width: '80px', 
          height: '80px', 
          background: '#e6f7ff', 
          borderRadius: '50%', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          color: '#00b4d8',
          marginBottom: '20px'
        }}>
          <CalendarOutline fontSize={40} />
        </div>
        <h2 style={{ color: '#2c3e50', marginBottom: '8px' }}>功能开发中</h2>
        <p style={{ color: '#6b7280', textAlign: 'center', maxWidth: '80%' }}>
          很快您就可以在这里记录每一次的攀爬成就了。
        </p>
      </div>
    </div>
  )
}

export default ClimbingDaily

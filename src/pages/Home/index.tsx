import React from 'react'
import { Card, Space, Button, NavBar, Toast } from 'antd-mobile'
import { useNavigate } from 'react-router-dom'
import { HistogramOutline, CalendarOutline, RightOutline } from 'antd-mobile-icons'

const Home: React.FC = () => {
  const navigate = useNavigate()

  return (
    <div style={{ padding: '24px 20px', minHeight: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* 背景装饰岩点 */}
      <div className="rock-hold rock-hold-1" />
      <div className="rock-hold rock-hold-2" />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <header style={{ marginBottom: '32px', marginTop: '12px' }}>
          <h1 style={{ 
            fontSize: '32px', 
            fontWeight: 800, 
            margin: '0 0 8px 0', 
            color: 'var(--climb-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            Grip Genius <span style={{ fontSize: '28px' }}>🧗</span>
          </h1>
          <p style={{ color: '#6b7280', margin: 0, fontSize: '16px' }}>
            你的智能攀岩进阶助手
          </p>
        </header>
        
        <Space direction='vertical' block style={{ '--gap': '24px' }}>
          <Card 
            style={{ 
              borderRadius: '24px', 
              boxShadow: '0 10px 30px -10px rgba(0,0,0,0.08)',
              border: '1px solid rgba(0,0,0,0.02)',
              overflow: 'hidden'
            }}
            onClick={() => navigate('/beta-analysis')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ 
                  width: '48px', 
                  height: '48px', 
                  background: '#fff0e6', 
                  borderRadius: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '16px',
                  color: '#ff7f50'
                }}>
                  <HistogramOutline fontSize={28} />
                </div>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '20px', color: '#1f2937' }}>Beta 分析</h3>
                <p style={{ margin: '0 0 16px 0', color: '#6b7280', fontSize: '14px', lineHeight: '1.5' }}>
                  记录线路难点，拆解动作细节，<br/>找到属于你的最优解。
                </p>
              </div>
              <RightOutline color='#d1d5db' fontSize={24} />
            </div>
            <Button 
              block 
              style={{ 
                borderRadius: '12px', 
                backgroundColor: '#2c3e50', 
                color: 'white',
                border: 'none',
                fontWeight: 600
              }}
              onClick={(e) => {
                e.stopPropagation()
                navigate('/beta-analysis')
              }}
            >
              开始分析
            </Button>
          </Card>

          <Card 
            style={{ 
              borderRadius: '24px', 
              boxShadow: '0 10px 30px -10px rgba(0,0,0,0.08)',
              border: '1px solid rgba(0,0,0,0.02)',
              overflow: 'hidden'
            }}
            onClick={() => navigate('/climbing-daily')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ 
                  width: '48px', 
                  height: '48px', 
                  background: '#e6f7ff', 
                  borderRadius: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '16px',
                  color: '#00b4d8'
                }}>
                  <CalendarOutline fontSize={28} />
                </div>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '20px', color: '#1f2937' }}>攀岩日结</h3>
                <p style={{ margin: '0 0 16px 0', color: '#6b7280', fontSize: '14px', lineHeight: '1.5' }}>
                  追踪训练进度，记录完攀线路，<br/>见证每一次进步。
                </p>
              </div>
              <RightOutline color='#d1d5db' fontSize={24} />
            </div>
            <Button 
              block 
              style={{ 
                borderRadius: '12px', 
                backgroundColor: '#ffffff', 
                color: '#2c3e50',
                border: '1px solid #e5e7eb',
                fontWeight: 600
              }}
              onClick={(e) => {
                e.stopPropagation()
                navigate('/climbing-daily')
              }}
            >
              写日结
            </Button>
          </Card>
        </Space>

        <footer style={{ 
          marginTop: '40px', 
          textAlign: 'center', 
          color: '#9ca3af', 
          fontSize: '12px',
          fontWeight: 500
        }}>
          KEEP CLIMBING
        </footer>
      </div>
    </div>
  )
}

export default Home

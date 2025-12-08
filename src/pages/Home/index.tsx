import React from 'react'
import { Card, Space, Button, NavBar } from 'antd-mobile'
import { useNavigate } from 'react-router-dom'
import { HistogramOutline, CalendarOutline } from 'antd-mobile-icons'

const Home: React.FC = () => {
  const navigate = useNavigate()

  return (
    <div style={{ padding: '20px', minHeight: '100vh', background: '#f5f5f5' }}>
      <NavBar back={null}>Grip Genius</NavBar>
      
      <Space direction='vertical' block style={{ marginTop: '20px', '--gap': '20px' }}>
        <Card 
          title="Beta 分析" 
          extra={<HistogramOutline fontSize={24} />}
          onClick={() => navigate('/beta-analysis')}
          style={{ borderRadius: '16px' }}
        >
          <div style={{ color: '#666', marginBottom: '12px' }}>
            记录并分析你的攀岩 Beta，优化动作细节。
          </div>
          <Button block color='primary' size='small' onClick={() => navigate('/beta-analysis')}>
            进入分析
          </Button>
        </Card>

        <Card 
          title="攀岩日结" 
          extra={<CalendarOutline fontSize={24} />}
          onClick={() => navigate('/climbing-daily')}
          style={{ borderRadius: '16px' }}
        >
          <div style={{ color: '#666', marginBottom: '12px' }}>
            记录每日攀岩训练内容，生成日结报告。
          </div>
          <Button block color='primary' size='small' onClick={() => navigate('/climbing-daily')}>
            开始记录
          </Button>
        </Card>
      </Space>
    </div>
  )
}

export default Home


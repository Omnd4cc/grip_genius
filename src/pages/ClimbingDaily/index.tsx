import React, { useRef, useState, useEffect } from 'react';
import { 
  NavBar, Button, Toast, Card, ProgressBar, Tag, Grid, 
  List, Empty, SpinLoading, Result 
} from 'antd-mobile';
import { useNavigate } from 'react-router-dom';
import { 
  generateDailyReport, 
  DailyReport, 
  ClimbAttempt,
  formatDuration,
  formatTotalTime 
} from '../../logic/climb_report';
import { PoseDetector } from '../../logic/pose_detector';
import './index.css';

// 颜色映射
const COLOR_HEX: Record<string, string> = {
  black: '#1a1a1a', blue: '#3b82f6', brown: '#a16207',
  cyan: '#06b6d4', gray: '#6b7280', green: '#22c55e',
  orange: '#f97316', pink: '#ec4899', purple: '#a855f7',
  red: '#ef4444', white: '#e5e5e5', yellow: '#eab308',
};

const COLOR_NAMES: Record<string, string> = {
  black: '黑色', blue: '蓝色', brown: '棕色', cyan: '青色',
  gray: '灰色', green: '绿色', orange: '橙色', pink: '粉色',
  purple: '紫色', red: '红色', white: '白色', yellow: '黄色',
};

const ClimbingDaily: React.FC = () => {
  const navigate = useNavigate();
  
  // State
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, videoName: '', step: '' });
  const [report, setReport] = useState<DailyReport | null>(null);
  
  // Refs
  const poseDetector = useRef(new PoseDetector());
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    poseDetector.current.initialize().then(() => {
      console.log('[ClimbingDaily] PoseDetector 初始化完成');
    });
  }, []);
  
  const onBack = () => navigate(-1);
  
  // 选择视频文件
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    // 过滤视频文件
    const videos = files.filter(f => f.type.startsWith('video/'));
    
    if (videos.length === 0) {
      Toast.show('请选择视频文件');
      return;
    }
    
    setVideoFiles(prev => [...prev, ...videos]);
    setReport(null);
    
    Toast.show(`已添加 ${videos.length} 个视频`);
  };
  
  // 移除视频
  const removeVideo = (index: number) => {
    setVideoFiles(prev => prev.filter((_, i) => i !== index));
  };
  
  // 清空所有
  const clearAll = () => {
    setVideoFiles([]);
    setReport(null);
  };
  
  // 开始分析
  const startAnalysis = async () => {
    if (videoFiles.length === 0) {
      Toast.show('请先添加视频');
      return;
    }
    
    if (!poseDetector.current.detector) {
      Toast.show('模型加载中，请稍候...');
      return;
    }
    
    setIsAnalyzing(true);
    setProgress({ current: 0, total: videoFiles.length, videoName: '', step: '准备中...' });
    
    try {
      // 创建视频元素
      const videos: Array<{ video: HTMLVideoElement; name: string }> = [];
      
      for (const file of videoFiles) {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.muted = true;
        video.playsInline = true;
        
        // 等待视频加载
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error(`无法加载视频: ${file.name}`));
        });
        
        videos.push({ video, name: file.name });
      }
      
      // 生成日报
      const dailyReport = await generateDailyReport(
        videos,
        poseDetector.current,
        (current, total, videoName, step) => {
          setProgress({ current, total, videoName, step });
        }
      );
      
      setReport(dailyReport);
      Toast.show({ content: '分析完成!', icon: 'success' });
      
      // 清理视频 URL
      videos.forEach(v => URL.revokeObjectURL(v.video.src));
      
    } catch (e) {
      console.error('分析失败:', e);
      Toast.show({ content: '分析失败', icon: 'fail' });
    } finally {
      setIsAnalyzing(false);
    }
  };
  
  return (
    <div className="climbing-daily-page">
      <NavBar onBack={onBack} style={{ background: '#fff' }}>
        攀岩日报
      </NavBar>
      
      <div className="content">
        {/* 上传区域 */}
        <Card className="upload-card">
          <div className="upload-header">
            <span className="title">📹 上传今日视频</span>
            {videoFiles.length > 0 && (
              <Button size="mini" onClick={clearAll}>清空</Button>
            )}
          </div>
          
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          
          <div 
            className="upload-zone"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="upload-icon">📁</div>
            <div className="upload-text">点击选择视频文件</div>
            <div className="upload-hint">支持多选，可上传今日所有攀爬视频</div>
          </div>
          
          {/* 已选视频列表 */}
          {videoFiles.length > 0 && (
            <div className="video-list">
              {videoFiles.map((file, idx) => (
                <div key={idx} className="video-item">
                  <span className="video-name">{file.name}</span>
                  <span className="video-size">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                  <Button 
                    size="mini" 
                    color="danger"
                    onClick={() => removeVideo(idx)}
                  >
                    删除
                  </Button>
                </div>
              ))}
            </div>
          )}
          
          <Button
            block
            color="primary"
            size="large"
            onClick={startAnalysis}
            loading={isAnalyzing}
            disabled={videoFiles.length === 0}
            style={{ marginTop: 16 }}
          >
            {isAnalyzing ? '分析中...' : `开始分析 (${videoFiles.length} 个视频)`}
          </Button>
        </Card>
        
        {/* 分析进度 */}
        {isAnalyzing && (
          <Card className="progress-card">
            <div className="progress-info">
              <SpinLoading style={{ '--size': '24px' }} />
              <div className="progress-text">
                <div>正在分析: {progress.videoName}</div>
                <div className="progress-step">{progress.step}</div>
              </div>
            </div>
            <ProgressBar 
              percent={Math.round((progress.current / Math.max(progress.total, 1)) * 100)} 
              style={{ marginTop: 12 }}
            />
            <div className="progress-count">
              {progress.current} / {progress.total}
            </div>
          </Card>
        )}
        
        {/* 日报结果 */}
        {report && (
          <div className="report-section">
            {/* 总览卡片 */}
            <Card className="summary-card">
              <div className="report-date">📅 {report.date}</div>
              
              <Grid columns={2} gap={16} className="stats-grid">
                <Grid.Item>
                  <div className="stat-box success">
                    <div className="stat-value">{report.successCount}</div>
                    <div className="stat-label">✓ 完成</div>
                  </div>
                </Grid.Item>
                <Grid.Item>
                  <div className="stat-box fail">
                    <div className="stat-value">{report.failCount}</div>
                    <div className="stat-label">✗ 未完成</div>
                  </div>
                </Grid.Item>
              </Grid>
              
              <div className="rate-bar">
                <div className="rate-label">成功率</div>
                <ProgressBar 
                  percent={report.successRate}
                  style={{ 
                    '--fill-color': report.successRate >= 50 ? '#22c55e' : '#ef4444',
                    '--track-width': '12px'
                  }}
                />
                <div className="rate-value">{report.successRate}%</div>
              </div>
              
              <div className="summary-row">
                <span>🧗 不同线路</span>
                <span className="value">{report.uniqueRoutes} 条</span>
              </div>
              <div className="summary-row">
                <span>⏱️ 总攀爬时长</span>
                <span className="value">{formatTotalTime(report.totalClimbTime)}</span>
              </div>
            </Card>
            
            {/* 线路统计 */}
            <Card title="📊 线路统计" className="route-card">
              {report.routeBreakdown.length > 0 ? (
                <List>
                  {report.routeBreakdown.map((route, idx) => (
                    <List.Item
                      key={idx}
                      prefix={
                        <div 
                          className="color-dot"
                          style={{ background: COLOR_HEX[route.color] || '#888' }}
                        />
                      }
                      extra={
                        <Tag color={route.successRate >= 50 ? 'success' : 'warning'}>
                          {route.successRate}%
                        </Tag>
                      }
                    >
                      <div className="route-info">
                        <span className="route-name">{route.colorName}线</span>
                        <span className="route-stats">
                          {route.successes}/{route.attempts} 次
                        </span>
                      </div>
                    </List.Item>
                  ))}
                </List>
              ) : (
                <Empty description="未识别到线路" />
              )}
            </Card>
            
            {/* 详细记录 */}
            <Card title="📝 攀爬记录" className="attempts-card">
              <List>
                {report.attempts.map((attempt, idx) => (
                  <AttemptItem key={idx} attempt={attempt} />
                ))}
              </List>
            </Card>
          </div>
        )}
        
        {/* 空状态 */}
        {!isAnalyzing && !report && videoFiles.length === 0 && (
          <Result
            icon={<span style={{ fontSize: 60 }}>🧗</span>}
            status="info"
            title="开始记录你的攀岩日"
            description={
              <div style={{ textAlign: 'left', fontSize: 13, color: '#666', marginTop: 12 }}>
                <p>📹 上传今天的攀爬视频</p>
                <p>🎯 自动识别线路颜色</p>
                <p>✓ 判定完成/未完成 (双手触顶=完成)</p>
                <p>📊 生成统计日报</p>
              </div>
            }
          />
        )}
      </div>
    </div>
  );
};

// 单条攀爬记录组件
const AttemptItem: React.FC<{ attempt: ClimbAttempt }> = ({ attempt }) => {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="attempt-item-wrapper">
      <List.Item
        onClick={() => setExpanded(!expanded)}
        arrow={expanded ? 'up' : 'down'}
        prefix={
          attempt.thumbnail ? (
            <img 
              src={attempt.thumbnail} 
              className="attempt-thumb"
              alt="缩略图"
            />
          ) : (
            <div className="attempt-thumb placeholder">🎬</div>
          )
        }
        extra={
          <Tag color={attempt.isSuccess ? 'success' : 'danger'}>
            {attempt.isSuccess ? '✓ 完成' : '✗ 未完成'}
          </Tag>
        }
        description={
          <div className="attempt-details">
            {attempt.routeColor !== 'unknown' && (
              <span 
                className="color-badge"
                style={{ background: COLOR_HEX[attempt.routeColor] || '#888' }}
              >
                {attempt.routeColorName || attempt.routeColor}
              </span>
            )}
            <span>时长: {formatDuration(attempt.duration)}</span>
            {attempt.isSuccess && attempt.topReachedTime && (
              <span>到顶: {formatDuration(attempt.topReachedTime)}</span>
            )}
          </div>
        }
      >
        {attempt.videoName}
      </List.Item>
      
      {/* 展开显示截图 */}
      {expanded && (
        <div className="attempt-images">
          {/* 攀爬中间图 */}
          {attempt.climbingImage && (
            <div className="image-card">
              <div className="image-label">🧗 攀爬中</div>
              <img 
                src={attempt.climbingImage} 
                alt="攀爬中"
                className="climbing-image"
              />
            </div>
          )}
          
          {/* TOP 图 (成功才有) */}
          {attempt.topImage && (
            <div className="image-card success">
              <div className="image-label">🎉 TOP!</div>
              <img 
                src={attempt.topImage} 
                alt="到顶"
                className="top-image"
              />
            </div>
          )}
          
          {/* 没有图片的提示 */}
          {!attempt.climbingImage && !attempt.topImage && (
            <div className="no-images">
              暂无截图
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ClimbingDaily;

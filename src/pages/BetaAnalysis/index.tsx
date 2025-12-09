import React, { useRef, useState, useEffect } from 'react'
import { NavBar, Button, Toast, Grid, Card, List, Tag, ProgressBar } from 'antd-mobile'
import { useNavigate } from 'react-router-dom'
import { PoseDetector } from '../../logic/pose_detector'
import { detectHolds, HoldDetectionResult, toHoldArray } from '../../logic/hold_detector'
import { ActionRecognizer } from '../../logic/action_recognizer'
import { BetaGenerator } from '../../logic/beta_generator'
import { DiffAnalyzer } from '../../logic/diff_analyzer'
import { drawKeypoints, drawSkeleton, drawHolds } from '../../utils/drawing'
import { BetaSequence, DiffResult } from '../../types'

const BetaAnalysis: React.FC = () => {
  const navigate = useNavigate()
  
  // -- State --
  const [videoSrcA, setVideoSrcA] = useState<string>('')
  const [videoSrcB, setVideoSrcB] = useState<string>('')
  
  const [betaA, setBetaA] = useState<string[]>([])
  const [betaB, setBetaB] = useState<string[]>([])
  const [sequenceA, setSequenceA] = useState<BetaSequence | null>(null)
  const [sequenceB, setSequenceB] = useState<BetaSequence | null>(null)
  
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisStep, setAnalysisStep] = useState('')
  const [progress, setProgress] = useState(0)

  // -- Refs --
  const poseDetector = useRef(new PoseDetector())
  const generator = useRef(new BetaGenerator())

  const videoARef = useRef<HTMLVideoElement>(null)
  const canvasARef = useRef<HTMLCanvasElement>(null)
  const videoBRef = useRef<HTMLVideoElement>(null)
  const canvasBRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    poseDetector.current.initialize().then(() => {
      console.log('MoveNet 初始化完成')
    })
  }, [])

  const onBack = () => navigate(-1)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setSrc: (s: string) => void) => {
    const file = e.target.files?.[0]
    if (file) {
      setSrc(URL.createObjectURL(file))
      setDiffResult(null)
    }
  }

  // 分析单个视频
  const analyzeVideo = async (
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    setBetaLines: (l: string[]) => void,
    setSequence: (s: BetaSequence) => void
  ) => {
    if (!poseDetector.current.detector) {
      Toast.show('模型加载中，请稍候...')
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    // Phase 1: 岩点检测 (只做一次)
    setAnalysisStep('检测岩点...')
    const holdData = await detectHolds(video)
    const holds = toHoldArray(holdData)
    console.log(`检测到 ${holds.length} 个岩点, ${holdData.routes.length} 条线路`)

    // Phase 2: 姿态分析
    setAnalysisStep('分析动作...')
    const recognizer = new ActionRecognizer()
    recognizer.setHoldData(holdData)

    video.currentTime = 0
    await video.play()

    return new Promise<void>((resolve) => {
      const processFrame = async () => {
        if (video.paused || video.ended) {
          // 完成
          const state = recognizer.getState()
          const seq = { actions: state.betaSequence, totalTime: video.currentTime }
          setSequence(seq)
          setBetaLines(generator.current.generateText(seq))
          setProgress(100)
          resolve()
          return
        }

        // 更新进度
        setProgress(Math.round((video.currentTime / video.duration) * 100))

        // 姿态检测
        const poses = await poseDetector.current.estimatePoses(video)

        // 更新动作识别
        if (poses.length > 0) {
          recognizer.update(poses, video.currentTime * 1000)
        }

        // 绘制
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        drawHolds(ctx, holds)
        drawKeypoints(ctx, poses)
        drawSkeleton(ctx, poses)

        // 显示当前线路和进度
        const state = recognizer.getState()
        if (state.activeRoute) {
          ctx.fillStyle = 'rgba(0,0,0,0.7)'
          ctx.fillRect(10, 10, 150, 30)
          ctx.fillStyle = '#fff'
          ctx.font = '14px Arial'
          ctx.fillText(recognizer.getHint(), 15, 30)
        }

        requestAnimationFrame(processFrame)
      }

      processFrame()
    })
  }

  const startAnalysis = async () => {
    setIsAnalyzing(true)
    setProgress(0)

    try {
      if (videoSrcA && videoARef.current && canvasARef.current) {
        setAnalysisStep('分析视频 A...')
        await analyzeVideo(videoARef.current, canvasARef.current, setBetaA, setSequenceA)
      }

      if (videoSrcB && videoBRef.current && canvasBRef.current) {
        setAnalysisStep('分析视频 B...')
        setProgress(0)
        await analyzeVideo(videoBRef.current, canvasBRef.current, setBetaB, setSequenceB)
      }

      setAnalysisStep('分析完成!')
      Toast.show({ content: '分析完成!', icon: 'success' })
    } catch (e) {
      console.error(e)
      Toast.show({ content: '分析出错', icon: 'fail' })
    } finally {
      setIsAnalyzing(false)
    }
  }

  const startDiff = () => {
    if (!sequenceA || !sequenceB) {
      Toast.show('请先完成两个视频的分析')
      return
    }
    const analyzer = new DiffAnalyzer()
    const res = analyzer.compare(sequenceA.actions, sequenceB.actions)
    setDiffResult(res)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', paddingBottom: 50 }}>
      <NavBar onBack={onBack} style={{ background: '#fff' }}>Beta 智能分析</NavBar>

      <div style={{ padding: 12 }}>
        {/* 进度条 */}
        {isAnalyzing && (
          <Card style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>{analysisStep}</div>
            <ProgressBar percent={progress} />
          </Card>
        )}

        <Grid columns={2} gap={8}>
          {/* Video A */}
          <Grid.Item>
            <Card title="演示视频 (A)">
              <div style={{ position: 'relative', minHeight: 180, background: '#000' }}>
                {videoSrcA ? (
                  <>
                    <video ref={videoARef} src={videoSrcA} style={{ display: 'none' }} playsInline muted />
                    <canvas ref={canvasARef} style={{ width: '100%' }} />
                  </>
                ) : (
                  <div style={{ padding: 20, textAlign: 'center', color: '#fff' }}>
                    <input type="file" accept="video/*" onChange={(e) => handleFileChange(e, setVideoSrcA)} />
                  </div>
                )}
              </div>
              <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: 8, fontSize: 12, color: '#666' }}>
                {betaA.length > 0 ? betaA.map((line, i) => <div key={i}>{line}</div>) : '等待分析...'}
              </div>
            </Card>
          </Grid.Item>

          {/* Video B */}
          <Grid.Item>
            <Card title="尝试视频 (B)">
              <div style={{ position: 'relative', minHeight: 180, background: '#000' }}>
                {videoSrcB ? (
                  <>
                    <video ref={videoBRef} src={videoSrcB} style={{ display: 'none' }} playsInline muted />
                    <canvas ref={canvasBRef} style={{ width: '100%' }} />
                  </>
                ) : (
                  <div style={{ padding: 20, textAlign: 'center', color: '#fff' }}>
                    <input type="file" accept="video/*" onChange={(e) => handleFileChange(e, setVideoSrcB)} />
                  </div>
                )}
              </div>
              <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: 8, fontSize: 12, color: '#666' }}>
                {betaB.length > 0 ? betaB.map((line, i) => <div key={i}>{line}</div>) : '等待分析...'}
              </div>
            </Card>
          </Grid.Item>
        </Grid>

        {/* 操作按钮 */}
        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          <Button
            block
            color="primary"
            onClick={startAnalysis}
            loading={isAnalyzing}
            disabled={!videoSrcA && !videoSrcB}
          >
            开始分析
          </Button>
          <Button
            block
            color="success"
            onClick={startDiff}
            disabled={!sequenceA || !sequenceB}
          >
            生成对比
          </Button>
        </div>

        {/* 对比结果 */}
        {diffResult && (
          <Card title="动作差异报告" style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 10, fontSize: 14 }}>
              差异评分: <strong>{diffResult.cost.toFixed(1)}</strong>
            </div>
            <List header="详细对比">
              {diffResult.operations.map((op, idx) => (
                <List.Item
                  key={idx}
                  prefix={
                    op.type === 'match' ? <Tag color="success">一致</Tag> :
                    op.type === 'substitute' ? <Tag color="warning">差异</Tag> :
                    op.type === 'delete' ? <Tag color="danger">冗余</Tag> :
                    <Tag color="primary">缺失</Tag>
                  }
                >
                  <div>{op.description}</div>
                  <div style={{ fontSize: 12, color: '#888' }}>
                    {op.itemA && `A: [${op.itemA.timestamp.toFixed(1)}s] ${op.itemA.description}`}
                    {op.itemA && op.itemB && ' vs '}
                    {op.itemB && `B: [${op.itemB.timestamp.toFixed(1)}s] ${op.itemB.description}`}
                  </div>
                </List.Item>
              ))}
            </List>
          </Card>
        )}
      </div>
    </div>
  )
}

export default BetaAnalysis

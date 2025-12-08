import React, { useRef, useState, useEffect } from 'react'
import { NavBar, Button, Toast, Grid, Card, List, Tag } from 'antd-mobile'
import { useNavigate } from 'react-router-dom'
import { PoseDetector } from '../../logic/pose_detector'
import { HoldManager } from '../../logic/hold_manager'
import { ActionRecognizer } from '../../logic/recognizer'
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

  // -- Refs for Logic --
  // We need independent instances for A and B
  const logicA = useRef({
    detector: new PoseDetector(),
    holdManager: new HoldManager(),
    recognizer: new ActionRecognizer(),
    generator: new BetaGenerator()
  })
  
  const logicB = useRef({
    detector: new PoseDetector(), // Sharing detector might be possible but safer to separate or init once
    holdManager: new HoldManager(),
    recognizer: new ActionRecognizer(),
    generator: new BetaGenerator()
  })
  
  // NOTE: PoseDetector loads a heavy model. We should ideally share the static model instance 
  // but the wrapper I wrote manages its own. For now, let's just init one shared detector if possible 
  // or just use one detector instance for both if we process sequentially.
  // Actually, let's use a single detector instance to save memory.
  const sharedDetector = useRef(new PoseDetector())

  const videoARef = useRef<HTMLVideoElement>(null)
  const canvasARef = useRef<HTMLCanvasElement>(null)
  
  const videoBRef = useRef<HTMLVideoElement>(null)
  const canvasBRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    sharedDetector.current.initialize().then(() => {
        console.log("Shared MoveNet Initialized");
    });
  }, [])

  const onBack = () => navigate(-1)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setSrc: (s: string) => void) => {
    const file = e.target.files?.[0]
    if (file) {
      const url = URL.createObjectURL(file)
      setSrc(url)
      // Reset results
      setDiffResult(null)
    }
  }

  // Generic Analysis Loop
  const analyzeVideo = async (
    video: HTMLVideoElement, 
    canvas: HTMLCanvasElement, 
    logic: typeof logicA.current,
    setBetaLines: (l: string[]) => void,
    setSequence: (s: BetaSequence) => void
  ) => {
    if (!sharedDetector.current.detector) {
        Toast.show('模型加载中，请稍候...')
        return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    video.currentTime = 0
    await video.play()
    
    // Set canvas dims
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    logic.recognizer.reset()
    let holdScanDone = false

    const processFrame = async () => {
        if (video.paused || video.ended) {
            // Finish
            const seq = { actions: logic.recognizer.getBetaSequence(), totalTime: video.currentTime }
            setSequence(seq)
            setBetaLines(logic.generator.generateText(seq))
            return
        }

        // 1. Detect Pose
        const poses = await sharedDetector.current.estimatePoses(video)
        
        // 2. Image Processing (Holds) - Once at start
        if (!holdScanDone && poses.length > 0) {
            // Sample color from wrist? or just auto scan entire image?
            // Logic said sample from wrist first.
            const color = logic.holdManager.sampleHoldColor(ctx, poses)
            if (color) {
                logic.holdManager.scanForHolds(ctx, canvas.width, canvas.height)
                holdScanDone = true
            } else {
                 // Retry next frame until found or timeout?
                 // For now, if failed, we might miss holds. 
                 // Let's allow manual hold scan trigger or just retry for first few frames.
                 if (video.currentTime > 2) holdScanDone = true; // Give up after 2s
            }
        }

        // 3. Update State Machine
        const holds = logic.holdManager.getHolds()
        if (poses.length > 0) {
            logic.recognizer.update(poses, holds, video.currentTime * 1000)
        }

        // 4. Draw
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        drawHolds(ctx, holds)
        drawKeypoints(ctx, poses)
        drawSkeleton(ctx, poses)

        requestAnimationFrame(processFrame)
    }

    processFrame()
  }

  const startAnalysis = async () => {
      setIsAnalyzing(true)
      try {
          // Analyze A
          if (videoSrcA && videoARef.current && canvasARef.current) {
              Toast.show('正在分析视频 A...')
              await analyzeVideo(videoARef.current, canvasARef.current, logicA.current, setBetaA, setSequenceA)
          }
          
          // Analyze B
          if (videoSrcB && videoBRef.current && canvasBRef.current) {
              Toast.show('正在分析视频 B...')
              await analyzeVideo(videoBRef.current, canvasBRef.current, logicB.current, setBetaB, setSequenceB)
          }
      } catch (e) {
          console.error(e)
          Toast.show('分析出错')
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
        <Grid columns={2} gap={8}>
            {/* Video A Panel */}
            <Grid.Item>
                <Card title="演示视频 (Video A)">
                    <div style={{ position: 'relative', minHeight: 200, background: '#000' }}>
                        {videoSrcA ? (
                            <>
                            <video ref={videoARef} src={videoSrcA} style={{ width: '100%', display: 'none' }} playsInline muted />
                            <canvas ref={canvasARef} style={{ width: '100%' }} />
                            </>
                        ) : (
                            <div style={{ padding: 20, textAlign: 'center', color: '#fff' }}>
                                <input type="file" accept="video/*" onChange={(e) => handleFileChange(e, setVideoSrcA)} />
                            </div>
                        )}
                    </div>
                    <div style={{ maxHeight: 150, overflowY: 'auto', marginTop: 10, fontSize: 12 }}>
                        {betaA.map((line, i) => <div key={i}>{line}</div>)}
                    </div>
                </Card>
            </Grid.Item>

            {/* Video B Panel */}
            <Grid.Item>
                <Card title="尝试视频 (Video B)">
                    <div style={{ position: 'relative', minHeight: 200, background: '#000' }}>
                        {videoSrcB ? (
                             <>
                             <video ref={videoBRef} src={videoSrcB} style={{ width: '100%', display: 'none' }} playsInline muted />
                             <canvas ref={canvasBRef} style={{ width: '100%' }} />
                             </>
                        ) : (
                            <div style={{ padding: 20, textAlign: 'center', color: '#fff' }}>
                                <input type="file" accept="video/*" onChange={(e) => handleFileChange(e, setVideoSrcB)} />
                            </div>
                        )}
                    </div>
                    <div style={{ maxHeight: 150, overflowY: 'auto', marginTop: 10, fontSize: 12 }}>
                         {betaB.map((line, i) => <div key={i}>{line}</div>)}
                    </div>
                </Card>
            </Grid.Item>
        </Grid>

        <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
            <Button block color='primary' onClick={startAnalysis} loading={isAnalyzing} disabled={!videoSrcA && !videoSrcB}>
                开始分析 (Analyze)
            </Button>
            <Button block color='success' onClick={startDiff} disabled={!sequenceA || !sequenceB}>
                生成对比 (Compare)
            </Button>
        </div>

        {/* Diff Result */}
        {diffResult && (
            <Card title="动作差异报告" style={{ marginTop: 20 }}>
                <div style={{ marginBottom: 10 }}>总差异成本: {diffResult.cost}</div>
                <List header='详细对比'>
                    {diffResult.operations.map((op, idx) => (
                        <List.Item key={idx} prefix={
                            op.type === 'match' ? <Tag color='success'>一致</Tag> :
                            op.type === 'substitute' ? <Tag color='warning'>差异</Tag> :
                            op.type === 'delete' ? <Tag color='danger'>冗余</Tag> :
                            <Tag color='primary'>缺失</Tag>
                        }>
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

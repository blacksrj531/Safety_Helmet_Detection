import { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, ShieldCheck, ShieldAlert, Wifi, RefreshCw, Volume2, VolumeX } from 'lucide-react';
import { detectHelmet, initHelmetModel } from './utils/helmetInference';
import { esp32 } from './utils/esp32Client';
import type { DetectionBox, InferenceResult } from './types';
import './App.css';

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [modelReady, setModelReady] = useState(false);
  const [modelStatus, setModelStatus] = useState('Initializing Helmet YOLOv8 Engine...');
  const [isStreaming, setIsStreaming] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user'); // Default to front camera for face/helmet checks

  const [espIp, setEspIp] = useState(esp32.getIP());
  const [espConnected, setEspConnected] = useState(false);
  const [triggerActive, setTriggerActive] = useState(false);

  const [inferenceTime, setInferenceTime] = useState(0);
  const [fps, setFps] = useState(0);
  const [latestDetections, setLatestDetections] = useState<DetectionBox[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Consecutive detection tracking to avoid jitter
  const helmetHitCount = useRef(0);
  const noHelmetHitCount = useRef(0);
  const lastFpsTime = useRef(performance.now());
  const frameCount = useRef(0);

  // AudioContext singleton to prevent Android AudioContext exhaustion
  const audioCtxRef = useRef<AudioContext | null>(null);

  const playAlertSound = useCallback((success: boolean) => {
    if (!soundEnabled) return;
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!audioCtxRef.current && AudioCtxClass) {
        audioCtxRef.current = new AudioCtxClass();
      }
      const audioCtx = audioCtxRef.current;
      if (!audioCtx) return;

      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (success) {
        osc.frequency.setValueAtTime(880, audioCtx.currentTime); // High pitch (A5)
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
      } else {
        osc.frequency.setValueAtTime(320, audioCtx.currentTime); // Low pitch warning
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
      }
    } catch (e) {
      // AudioContext may be blocked before user gesture
    }
  }, [soundEnabled]);

  // Load Model
  useEffect(() => {
    initHelmetModel((msg) => setModelStatus(msg)).then((ok) => {
      if (ok) {
        setModelReady(true);
        setModelStatus('Helmet YOLOv8 Ready (640x640 SIMD)');
      } else {
        setModelStatus('Failed to load neural model.');
      }
    });
  }, []);

  // Poll ESP32 connection status
  const checkESP32 = useCallback(async () => {
    const status = await esp32.checkConnection();
    setEspConnected(status.connected);
    if (status.angle !== undefined) {
      setTriggerActive(status.angle > 0);
    }
  }, []);

  useEffect(() => {
    checkESP32();
    const interval = setInterval(checkESP32, 3000);
    return () => clearInterval(interval);
  }, [checkESP32]);

  // Start Camera
  const startCamera = useCallback(async () => {
    try {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: cameraFacing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsStreaming(true);
      }
    } catch (err) {
      console.error('Camera access error:', err);
      alert('Could not start camera. Please ensure permissions are granted.');
    }
  }, [cameraFacing]);

  useEffect(() => {
    startCamera();
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [startCamera]);

  // Render bounding boxes & trigger ESP32
  const runDetectionLoop = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !modelReady || videoRef.current.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(runDetectionLoop);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const result: InferenceResult = await detectHelmet(video);
    setInferenceTime(result.inferenceTimeMs);
    setLatestDetections(result.detections);

    // Calculate FPS
    frameCount.current += 1;
    const now = performance.now();
    if (now - lastFpsTime.current >= 1000) {
      setFps(Math.round((frameCount.current * 1000) / (now - lastFpsTime.current)));
      frameCount.current = 0;
      lastFpsTime.current = now;
    }

    // Clear Canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const isMirrored = cameraFacing === 'user';

    // Draw Detections
    for (const det of result.detections) {
      const isHelmet = det.classId === 0;
      const strokeColor = isHelmet ? '#10b981' : '#f43f5e'; // Emerald for Helmet, Rose for Without
      const fillColor = isHelmet ? 'rgba(16, 185, 129, 0.18)' : 'rgba(244, 63, 94, 0.18)';

      // Calculate coordinates respecting mirror mode
      const drawX = isMirrored ? (canvas.width - det.x - det.width) : det.x;

      // Bounding Box with sleek rounded look
      ctx.lineWidth = 3;
      ctx.strokeStyle = strokeColor;
      ctx.fillStyle = fillColor;
      ctx.strokeRect(drawX, det.y, det.width, det.height);
      ctx.fillRect(drawX, det.y, det.width, det.height);

      // Label Badge
      const labelText = `${det.label} (${Math.round(det.score * 100)}%)`;
      ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
      const textMetrics = ctx.measureText(labelText);
      const bgW = textMetrics.width + 16;
      const bgH = 26;

      ctx.fillStyle = strokeColor;
      ctx.fillRect(drawX, Math.max(0, det.y - bgH), bgW, bgH);

      ctx.fillStyle = '#ffffff';
      ctx.fillText(labelText, drawX + 8, Math.max(18, det.y - 7));
    }

    // Debounced Hardware Servo Triggering Logic
    if (result.helmetDetected) {
      helmetHitCount.current += 1;
      noHelmetHitCount.current = 0;
    } else {
      noHelmetHitCount.current += 1;
      helmetHitCount.current = 0;
    }

    // Trigger ON if helmet confirmed in 2 consecutive frames
    if (helmetHitCount.current >= 2) {
      if (!triggerActive) {
        setTriggerActive(true);
        playAlertSound(true);
        esp32.trigger(true);
      }
    } else if (noHelmetHitCount.current >= 3) {
      // Trigger OFF if no helmet in 3 frames
      if (triggerActive) {
        setTriggerActive(false);
        playAlertSound(false);
        esp32.trigger(false);
      }
    }

    animFrameRef.current = requestAnimationFrame(runDetectionLoop);
  }, [modelReady, triggerActive, playAlertSound, cameraFacing]);

  useEffect(() => {
    if (modelReady && isStreaming) {
      animFrameRef.current = requestAnimationFrame(runDetectionLoop);
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [modelReady, isStreaming, runDetectionLoop]);

  return (
    <div className="flex flex-col h-screen w-screen bg-neutral-950 text-neutral-100 font-sans select-none overflow-hidden">
      {/* Top Header Bar - Polished Industrial Style */}
      <header className="flex items-center justify-between px-4 py-3 bg-neutral-900/90 backdrop-blur-md border-b border-neutral-800/80 z-20 shadow-lg">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl overflow-hidden border border-amber-500/30 shadow-inner flex-shrink-0 bg-neutral-900 flex items-center justify-center">
            <img src="/app-logo.png" alt="Smart Helmet Monitor" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-sm tracking-wide text-white">Smart Helmet Monitor</h1>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                ESP32 GPIO 18
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 font-medium tracking-tight mt-0.5">{modelStatus}</p>
          </div>
        </div>

        {/* ESP32 Hardware Status Badge & Controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 rounded-xl bg-neutral-800/80 hover:bg-neutral-700/80 border border-neutral-700/50 text-neutral-300 transition-all active:scale-95 shadow-sm"
            title="Toggle Alert Sounds"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-neutral-500" />}
          </button>

          <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs font-semibold border shadow-sm transition-colors ${
            espConnected 
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
              : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
          }`}>
            <span className={`w-2 h-2 rounded-full ${espConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
            <Wifi className="w-3.5 h-3.5" />
            <span>{espConnected ? 'ESP32 Online' : 'ESP32 Offline'}</span>
          </div>
        </div>
      </header>

      {/* Main Viewport & Detection Feed */}
      <main className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{ transform: cameraFacing === 'user' ? 'scaleX(-1)' : 'none' }}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300"
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />

        {/* HUD Overlay: Helmet Switch Status */}
        <div className="absolute top-4 left-4 z-20 flex flex-col space-y-2.5 pointer-events-none">
          <div className={`flex items-center space-x-3 px-3.5 py-2.5 rounded-2xl border backdrop-blur-xl shadow-2xl transition-all duration-300 ${
            triggerActive
              ? 'bg-emerald-950/85 border-emerald-500/50 text-emerald-200'
              : 'bg-neutral-900/85 border-neutral-700/60 text-neutral-300'
          }`}>
            <div className={`p-2 rounded-xl ${triggerActive ? 'bg-emerald-500/20 text-emerald-400 animate-pulse' : 'bg-neutral-800 text-rose-400'}`}>
              {triggerActive ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold tracking-wider text-neutral-400">Micro Servo Switch (Pin 18)</div>
              <div className="text-sm font-black tracking-wide flex items-center gap-1.5 mt-0.5">
                {triggerActive ? (
                  <span className="text-emerald-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    TRIGGER ON (90°)
                  </span>
                ) : (
                  <span className="text-rose-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-400" />
                    TRIGGER OFF (0°)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Real-time Telemetry Pill */}
          <div className="flex items-center space-x-3 px-3.5 py-1.5 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 text-[11px] text-neutral-300 shadow-md">
            <div>FPS: <span className="text-emerald-400 font-mono font-bold">{fps}</span></div>
            <div className="text-neutral-600">|</div>
            <div>Latency: <span className="text-white font-mono font-bold">{inferenceTime}ms</span></div>
            <div className="text-neutral-600">|</div>
            <div>Faces: <span className="text-white font-mono font-bold">{latestDetections.length}</span></div>
          </div>
        </div>

        {/* Quick Flip Camera Button */}
        <button
          onClick={() => setCameraFacing(f => f === 'user' ? 'environment' : 'user')}
          className="absolute bottom-5 right-5 z-20 p-3.5 rounded-2xl bg-neutral-900/85 hover:bg-neutral-800 border border-neutral-700/60 text-white shadow-2xl backdrop-blur-xl transition-all active:scale-90"
          title="Switch Front/Rear Camera"
        >
          <Camera className="w-5 h-5 text-emerald-400" />
        </button>
      </main>

      {/* Bottom Controls & ESP32 Configuration Drawer */}
      <footer className="bg-neutral-900/90 backdrop-blur-md border-t border-neutral-800/80 px-4 py-3 z-20">
        <div className="max-w-xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center space-x-2 flex-1">
            <label className="text-xs font-semibold text-neutral-400 whitespace-nowrap">ESP32 IP:</label>
            <input
              type="text"
              value={espIp}
              onChange={(e) => setEspIp(e.target.value)}
              onBlur={() => esp32.setIP(espIp)}
              className="bg-neutral-950 border border-neutral-700/70 text-xs text-neutral-200 px-2.5 py-1.5 rounded-lg w-full max-w-[130px] font-mono focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all"
              placeholder="192.168.4.1"
            />
            <button
              onClick={() => {
                esp32.setIP(espIp);
                checkESP32();
              }}
              className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700/50 text-neutral-300 transition-all active:scale-95"
              title="Ping ESP32"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Manual Hardware Test Buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                setTriggerActive(true);
                esp32.trigger(true, true);
              }}
              className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white rounded-lg text-xs font-bold shadow-md transition-all"
            >
              Test ON (90°)
            </button>
            <button
              onClick={() => {
                setTriggerActive(false);
                esp32.trigger(false, true);
              }}
              className="px-3.5 py-1.5 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 active:scale-95 text-white rounded-lg text-xs font-bold shadow-md transition-all"
            >
              Test OFF (0°)
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

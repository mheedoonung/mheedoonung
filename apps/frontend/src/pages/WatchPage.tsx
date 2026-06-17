// หน้าเล่นวิดีโอ (เฟส 6) — flow ตาม playback v2:
//   1) POST /playback/start -> ได้ authUrl(set cookie ที่ worker) + fileUrl(<video src>)
//   2) fetch(authUrl, credentials:'include') ให้ worker ตั้ง HttpOnly cookie ก่อนโหลดไฟล์
//   3) <video src=fileUrl> — Range request แนบ cookie อัตโนมัติ (no-cors, ส่ง cookie ข้าม origin ได้)
//   4) heartbeat: POST /playback/refresh ทุก ~ttl/2 -> set cookie ใหม่ (เล่นต่อเนื่อง)
//      ถ้าได้ 409 = บัญชีถูกเปิดจากอีกอุปกรณ์ -> หยุดเล่น + แจ้งผู้ใช้
//   5) ออกจากหน้า -> POST /playback/stop (best-effort)
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import type { PlaybackTokens } from '@mheedoonung/shared';
import { api, ApiClientError } from '../api/client';

type Phase = 'loading' | 'playing' | 'kicked' | 'error';

export function WatchPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [phase, setPhase] = useState<Phase>('loading');
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const aliveRef = useRef<boolean>(true);

  // เรียก worker /__auth (cross-origin) เพื่อให้ worker ตั้ง cookie ก่อนโหลดไฟล์
  async function primeCookie(authUrl: string): Promise<void> {
    await fetch(authUrl, { method: 'GET', credentials: 'include' });
  }

  function clearTimer(): void {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  // ตั้งเวลา refresh รอบถัดไป (อย่างน้อย 5 วินาที)
  function scheduleRefresh(seconds: number): void {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      void doRefresh();
    }, Math.max(5, seconds) * 1000);
  }

  // ต่ออายุ grant + cookie; จัดการกรณีถูกเตะ (409) / หมดสิทธิ์ (403)
  async function doRefresh(): Promise<void> {
    const sid = streamIdRef.current;
    if (!sid || !aliveRef.current) return;
    try {
      const tok = await api.post<PlaybackTokens>('/playback/refresh', { streamId: sid });
      await primeCookie(tok.authUrl);
      if (!aliveRef.current) return;
      scheduleRefresh(tok.refreshInSeconds);
    } catch (e) {
      if (!aliveRef.current) return;
      if (e instanceof ApiClientError && e.status === 409) {
        videoRef.current?.pause();
        setPhase('kicked');
      } else if (e instanceof ApiClientError && e.status === 403) {
        videoRef.current?.pause();
        setMessage('สิทธิ์ใช้งานหมดอายุแล้ว');
        setPhase('error');
      } else {
        // ชั่วคราว/เครือข่าย -> ลองใหม่ในอีก 10 วินาที (cookie ยังไม่หมดทันที)
        scheduleRefresh(10);
      }
    }
  }

  // เริ่มเล่น (ใช้ทั้งตอน mount และปุ่ม "เล่นต่อที่นี่" หลังถูกเตะ)
  async function startPlayback(): Promise<void> {
    setPhase('loading');
    setMessage('');
    try {
      const tok = await api.post<PlaybackTokens>('/playback/start', { slug });
      streamIdRef.current = tok.streamId;
      await primeCookie(tok.authUrl);
      if (!aliveRef.current) return;
      setFileUrl(tok.fileUrl);
      setPhase('playing');
      scheduleRefresh(tok.refreshInSeconds);
    } catch (e) {
      if (!aliveRef.current) return;
      if (e instanceof ApiClientError && e.status === 403) {
        // ยังไม่มีบัตร active -> ไปหน้าเติมบัตร (เก็บหน้านี้ไว้เพื่อเด้งกลับหลังเติมสำเร็จ)
        navigate('/redeem', { state: { from: location }, replace: true });
        return;
      }
      setMessage(
        e instanceof ApiClientError ? e.payload.message ?? e.payload.error : 'ไม่สามารถเริ่มเล่นวิดีโอได้',
      );
      setPhase('error');
    }
  }

  useEffect(() => {
    aliveRef.current = true;
    void startPlayback();
    return () => {
      aliveRef.current = false;
      clearTimer();
      // ปิดสตรีมฝั่ง server (best-effort) เมื่อออกจากหน้า
      const sid = streamIdRef.current;
      if (sid) void api.post('/playback/stop', { streamId: sid }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  return (
    <div style={styles.page}>
      <div style={styles.bar}>
        <Link to="/" style={styles.back}>
          ← กลับ
        </Link>
      </div>

      <div style={styles.stage}>
        {phase === 'loading' && <p style={styles.center}>กำลังเตรียมวิดีโอ...</p>}

        {phase === 'playing' && fileUrl && (
          <video
            ref={videoRef}
            src={fileUrl}
            controls
            autoPlay
            playsInline
            // ตัดปุ่ม Download + remote playback ออกจากเมนู native, ปิด Picture-in-Picture, กันคลิกขวา
            // (เป็น "ตัวกันมือใหม่" — ไม่ได้กัน rip จริง ดูหมายเหตุด้านความปลอดภัย)
            controlsList="nodownload noremoteplayback"
            disablePictureInPicture
            onContextMenu={(e) => e.preventDefault()}
            // ไม่ตั้ง crossOrigin เพื่อให้ส่ง cookie ข้าม origin ไป worker (no-cors media)
            style={styles.video}
            onError={() => setMessage('โหลดวิดีโอมีปัญหา (ตรวจว่า video-worker ทำงานและไฟล์อยู่บน R2)')}
          />
        )}

        {phase === 'kicked' && (
          <div style={styles.overlay}>
            <p style={styles.overlayTitle}>บัญชีนี้ถูกเปิดดูจากอุปกรณ์อื่น</p>
            <p style={styles.overlayNote}>ดูได้ทีละ 1 อุปกรณ์เท่านั้น</p>
            <button type="button" style={styles.btn} onClick={() => void startPlayback()}>
              เล่นต่อที่นี่
            </button>
          </div>
        )}

        {phase === 'error' && (
          <div style={styles.overlay}>
            <p style={styles.overlayTitle}>เล่นวิดีโอไม่ได้</p>
            <p style={styles.overlayNote}>{message || 'เกิดข้อผิดพลาด'}</p>
            <button type="button" style={styles.btn} onClick={() => void startPlayback()}>
              ลองใหม่
            </button>
          </div>
        )}
      </div>

      {/* แจ้งเตือนระดับเบา ๆ ระหว่างเล่น (เช่น video error) */}
      {phase === 'playing' && message && <p style={styles.softError}>{message}</p>}
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#000', color: '#fff', display: 'flex', flexDirection: 'column' as const },
  bar: { padding: '12px 16px' },
  back: { color: '#fff', textDecoration: 'none', fontSize: 15 },
  stage: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative' as const,
  },
  center: { color: '#bbb' },
  video: { width: '100%', maxHeight: '85vh', background: '#000' },
  overlay: { textAlign: 'center' as const, padding: 24 },
  overlayTitle: { fontSize: 20, fontWeight: 700, margin: '0 0 8px' },
  overlayNote: { color: '#bbb', margin: '0 0 16px' },
  btn: {
    padding: '10px 20px',
    background: '#e50914',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 15,
    cursor: 'pointer',
  },
  softError: { color: '#ffb3b3', textAlign: 'center' as const, padding: '8px 16px', fontSize: 13 },
} as const;

// หน้าเล่นวิดีโอ (เฟส 6) — flow ตาม playback v2:
//   1) POST /playback/start -> ได้ authUrl(set cookie ที่ worker) + fileUrl(<video src>)
//   2) fetch(authUrl, credentials:'include') ให้ worker ตั้ง HttpOnly cookie ก่อนโหลดไฟล์
//   3) <video src=fileUrl> — Range request แนบ cookie อัตโนมัติ (no-cors, ส่ง cookie ข้าม origin ได้)
//   4) heartbeat: POST /playback/refresh ทุก ~ttl/2 -> set cookie ใหม่ (เล่นต่อเนื่อง)
//      ถ้าได้ 409 = บัญชีถูกเปิดจากอีกอุปกรณ์ -> หยุดเล่น + แจ้งผู้ใช้
//   5) ออกจากหน้า -> POST /playback/stop (best-effort)
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import { MediaPlayer, MediaProvider, Track, type MediaPlayerInstance } from '@vidstack/react';
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default';
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';
import type { PlaybackTokens } from '@mheedoonung/shared';
import { api, ApiClientError } from '../api/client';

type Phase = 'loading' | 'playing' | 'kicked' | 'error';

export function WatchPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [phase, setPhase] = useState<Phase>('loading');
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  // blob URL ของไฟล์ซับ — เราต้อง fetch ไฟล์ .srt เองด้วย cookie (cross-origin credentialed)
  //   แล้วทำเป็น blob (same-origin) ส่งให้ player เพราะ vidstack อ่าน track ผ่าน fetch ที่ไม่ได้แนบ cookie ให้
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');
  // true เมื่อ autoplay แบบมีเสียงถูกบล็อก -> เล่นต่อแบบ mute -> โชว์ปุ่ม "แตะเพื่อเปิดเสียง"
  const [showUnmute, setShowUnmute] = useState(false);

  const playerRef = useRef<MediaPlayerInstance | null>(null);
  const subtitleBlobRef = useRef<string | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const aliveRef = useRef<boolean>(true);

  // เรียก worker /__auth (cross-origin) เพื่อให้ worker ตั้ง cookie ก่อนโหลดไฟล์
  async function primeCookie(authUrl: string): Promise<void> {
    await fetch(authUrl, { method: 'GET', credentials: 'include' });
  }

  // ปลด blob ซับเก่า (กัน memory leak ตอนเล่นซ้ำ/ออกจากหน้า)
  function revokeSubtitle(): void {
    if (subtitleBlobRef.current) {
      URL.revokeObjectURL(subtitleBlobRef.current);
      subtitleBlobRef.current = null;
    }
  }

  // โหลดไฟล์ซับเองด้วย cookie แล้วทำเป็น blob URL (same-origin) ให้ <Track> ใช้
  //   ทำแบบ best-effort — ถ้าซับโหลดไม่ได้ ก็ยังเล่นวิดีโอต่อได้ (แค่ไม่มีซับ)
  async function loadSubtitle(url: string): Promise<void> {
    try {
      const res = await fetch(url, { method: 'GET', credentials: 'include' });
      if (!res.ok) return;
      const blob = await res.blob();
      if (!aliveRef.current) return;
      revokeSubtitle();
      const objUrl = URL.createObjectURL(blob);
      subtitleBlobRef.current = objUrl;
      setSubtitleUrl(objUrl);
    } catch {
      // เงียบ — ซับเป็น optional
    }
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
        playerRef.current?.pause();
        setPhase('kicked');
      } else if (e instanceof ApiClientError && e.status === 403) {
        playerRef.current?.pause();
        setMessage('สิทธิ์ใช้งานหมดอายุแล้ว');
        setPhase('error');
      } else {
        // ชั่วคราว/เครือข่าย -> ลองใหม่ในอีก 10 วินาที (cookie ยังไม่หมดทันที)
        scheduleRefresh(10);
      }
    }
  }

  // เริ่มเล่น (ใช้ทั้งตอน mount และปุ่ม "เล่นต่อที่นี่" หลังถูกเตะ)
  // ผู้ใช้แตะปุ่มเปิดเสียง (= user gesture) -> เลิก mute + เล่นต่อ + ซ่อนปุ่ม
  function unmute(): void {
    const p = playerRef.current;
    if (p) {
      p.muted = false;
      if (p.volume === 0) p.volume = 1;
      void p.play().catch(() => {});
    }
    setShowUnmute(false);
  }

  async function startPlayback(): Promise<void> {
    setPhase('loading');
    setMessage('');
    setShowUnmute(false);
    try {
      const tok = await api.post<PlaybackTokens>('/playback/start', { slug });
      streamIdRef.current = tok.streamId;
      // ออกจากหน้าระหว่าง /start in-flight: cleanup รันไปแล้วตอน streamId ยัง null
      //   -> stream ที่เพิ่งสร้างจะค้าง (เครื่องอื่นโดน 409) ต้องสั่ง stop เองตรงนี้
      if (!aliveRef.current) {
        void api.post('/playback/stop', { streamId: tok.streamId }).catch(() => {});
        return;
      }
      await primeCookie(tok.authUrl);
      if (!aliveRef.current) {
        void api.post('/playback/stop', { streamId: tok.streamId }).catch(() => {});
        return;
      }
      setFileUrl(tok.fileUrl);
      setPhase('playing');
      // โหลดซับ (ถ้ามี) — cookie ถูกตั้งจาก primeCookie แล้ว ใช้ grant เดียวกันดึงได้
      if (tok.subtitleUrl) void loadSubtitle(tok.subtitleUrl);
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
      revokeSubtitle();
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
        <img src="/mheedoonung.png" alt="หมีดูหนัง" style={styles.barLogo} />
      </div>

      <div style={styles.stage}>
        {phase === 'loading' && <p style={styles.center}>กำลังเตรียมวิดีโอ...</p>}

        {phase === 'playing' && fileUrl && (
          // Vidstack player + DefaultVideoLayout = controls แบบ custom (ไม่มีปุ่ม download / เมนู native ⋮)
          // *สำคัญ*: ไม่ตั้ง crossOrigin เพื่อให้ <video> ภายในส่ง cookie ข้าม origin ไป worker (no-cors media)
          //   หมายเหตุ: เป็น cosmetic เท่านั้น — กัน rip จริงไม่ได้ (ดูดผ่าน devtools/yt-dlp ได้) ต้อง DRM ถึงจะกันจริง
          <MediaPlayer
            ref={playerRef}
            className="mdn-player"
            src={{ src: fileUrl, type: 'video/mp4' }}
            autoPlay
            playsInline
            // เล่นทันทีที่เข้าหน้า: พยายามเล่นแบบมีเสียงก่อน; ถ้า browser บล็อก autoplay (ไม่มี user gesture)
            // -> เล่นต่อแบบ muted อัตโนมัติ (เบราว์เซอร์อนุญาตเสมอ) แล้วให้ผู้ใช้กดเปิดเสียงเองทีหลัง
            onAutoPlayFail={() => {
              const p = playerRef.current;
              if (!p) return;
              p.muted = true;
              void p.play().catch(() => {});
              setShowUnmute(true); // โชว์ปุ่มให้ผู้ใช้แตะเปิดเสียงเอง
            }}
            // ผู้ใช้กดปุ่มลำโพงเองใน control bar -> ถ้ามีเสียงแล้วก็ซ่อนปุ่ม overlay
            onVolumeChange={() => {
              const p = playerRef.current;
              if (p && !p.muted) setShowUnmute(false);
            }}
            onContextMenu={(e) => e.preventDefault()}
            onError={() => setMessage('โหลดวิดีโอมีปัญหา (ตรวจว่า video-worker ทำงานและไฟล์อยู่บน R2)')}
          >
            <MediaProvider />
            {/* ซับแบบ soft (.srt) — vidstack parse SRT ฝั่ง client เองได้ ไม่ต้องแปลงเป็น .vtt
                หมายเหตุ: ต้องเป็นไฟล์แยก (blob) — soft sub ที่ฝังในไฟล์ MP4 เบราว์เซอร์ไม่ render ให้ */}
            {subtitleUrl && (
              <Track
                src={subtitleUrl}
                kind="subtitles"
                type="srt"
                label="ไทย"
                lang="th"
                default
              />
            )}
            <DefaultVideoLayout icons={defaultLayoutIcons} />
          </MediaPlayer>
        )}

        {/* autoplay ถูกบล็อก -> เล่นแบบ mute: ปุ่มให้ผู้ใช้แตะเปิดเสียง (วางบนสุด ไม่ทับ control bar) */}
        {phase === 'playing' && showUnmute && (
          <button type="button" style={styles.unmuteBtn} onClick={unmute}>
            🔊 แตะเพื่อเปิดเสียง
          </button>
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
  page: { height: '100dvh', minHeight: '100vh', background: '#000', color: '#fff', display: 'flex', flexDirection: 'column' as const },
  bar: { padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: '#fff', textDecoration: 'none', fontSize: 15 },
  barLogo: { width: 36, height: 36, objectFit: 'contain' as const },
  stage: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative' as const,
  },
  center: { color: '#bbb' },
  video: { width: '100%', maxWidth: 1100, maxHeight: '90vh', margin: '0 auto', background: '#000' },
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
  unmuteBtn: {
    position: 'absolute' as const,
    top: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 10,
    padding: '10px 18px',
    background: 'rgba(0,0,0,0.7)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.4)',
    borderRadius: 999,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    backdropFilter: 'blur(4px)',
  },
} as const;

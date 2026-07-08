// หน้าเล่นวิดีโอ (เฟส 6) — flow ตาม playback v2:
//   1) POST /playback/start -> ได้ authUrl(set cookie ที่ worker) + fileUrl(<video src>)
//   2) fetch(authUrl, credentials:'include') ให้ worker ตั้ง HttpOnly cookie ก่อนโหลดไฟล์
//   3) <video src=fileUrl> — Range request แนบ cookie อัตโนมัติ (no-cors, ส่ง cookie ข้าม origin ได้)
//   4) heartbeat: POST /playback/refresh ทุก ~ttl/2 -> set cookie ใหม่ (เล่นต่อเนื่อง)
//      ถ้าได้ 409 = บัญชีถูกเปิดจากอีกอุปกรณ์ -> หยุดเล่น + แจ้งผู้ใช้
//   5) ออกจากหน้า -> POST /playback/stop (best-effort)
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import { MediaPlayer, MediaProvider, Track, type MediaPlayerInstance } from '@vidstack/react';
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default';
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';
import type { PlaybackTokens, PublicMovie, MovieListResponse } from '@mheedoonung/shared';
import { api, ApiClientError } from '../api/client';
import { addWatchSeconds } from '../lib/feedbackGate';
import { pickSuggestions, markWatched, recentWatched } from '../lib/suggest';
import { ReportModal } from '../components/ReportModal';

// end screen: จำนวนเรื่องแนะนำ + วินาทีนับถอยหลังก่อน autoplay เรื่องแรก
const SUGGEST_COUNT = 6;
const AUTOPLAY_SECONDS = 10;

type Phase = 'loading' | 'playing' | 'kicked' | 'error';

// ไอคอน fullscreen ของ Vidstack — reuse กับปุ่ม faux-fullscreen เอง (iPhone)
const FsEnterIcon = defaultLayoutIcons.FullscreenButton.Enter;
const FsExitIcon = defaultLayoutIcons.FullscreenButton.Exit;

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
  // iPhone Safari ไม่มี Fullscreen API จริง -> Vidstack ตกไปใช้ native <video> fullscreen ซึ่ง
  //   (1) ไม่ render ซับแบบ overlay ของ Vidstack (2) บังคับแนวนอน -> หนังแนวตั้งเล็กลง.
  //   ตรวจว่าไม่มี FS API แล้วทำ fullscreen เองด้วย CSS (เก็บ player ใน DOM) เพื่อแก้ทั้งสองข้อ.
  //   iPad/desktop/Android มี FS API -> ปล่อยใช้ของเดิม (ซับ+orientation ทำงานปกติ)
  const [reportOpen, setReportOpen] = useState(false);
  // end screen (วิดีโอจบ): แนะนำเรื่องถัดไป + นับถอยหลัง autoplay (null = ยกเลิกแล้ว/ยังไม่เริ่ม)
  const [ended, setEnded] = useState(false);
  const [suggestions, setSuggestions] = useState<PublicMovie[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [noFsApi] = useState(
    () =>
      typeof document !== 'undefined' &&
      !(
        document.fullscreenEnabled ||
        (document as unknown as { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled
      ),
  );
  const [fauxFs, setFauxFs] = useState(false);

  // src ของ player ต้อง memo — ถ้าสร้าง object ใหม่ทุก render vidstack จะมองเป็น source ใหม่
  // แล้ว reload วิดีโอซ้ำ (เจอตอน countdown ของ end screen ติ๊กทุก 1 วิ = reload ทุกวิ)
  const mediaSrc = useMemo(
    () => (fileUrl ? ({ src: fileUrl, type: 'video/mp4' } as const) : null),
    [fileUrl],
  );

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

  // โหลดเรื่องแนะนำสำหรับ end screen — ดึง candidate หลายมุม (แนวเดียวกัน 2 แนวแรก +
  // ยอดนิยม + มาใหม่) แล้วให้ lib/suggest คัด: ตัดเรื่องที่เพิ่งดู + สุ่ม + แนวเดียวกันนำ
  // (แก้ปัญหา "แนะนำแต่เรื่องเดิม" — เดิมดึง popular อย่างเดียวซึ่ง ranking นิ่ง)
  async function loadSuggestions(): Promise<void> {
    try {
      const current = await api.get<PublicMovie>(`/movies/${encodeURIComponent(slug)}`);
      const queries = [
        ...current.genres
          .slice(0, 2)
          .map((g) => `/movies?genre=${encodeURIComponent(g)}&sort=popular&limit=12`),
        '/movies?sort=popular&limit=12',
        '/movies?sort=newest&limit=12',
      ];
      // ยิงขนาน — ตัวไหนพังข้ามตัวนั้น (แนะนำจากเท่าที่ได้)
      const results = await Promise.all(
        queries.map((q) => api.get<MovieListResponse>(q).catch(() => null)),
      );
      const collect = new Map<string, PublicMovie>();
      for (const r of results) if (r) for (const m of r.items) collect.set(m.slug, m);
      if (!aliveRef.current) return;
      setSuggestions(
        pickSuggestions([...collect.values()], slug, current.genres, recentWatched(), SUGGEST_COUNT),
      );
    } catch {
      // เงียบ — end screen ไม่มีเรื่องแนะนำก็ยังมีปุ่มดูอีกครั้ง/กลับหน้าแรก
    }
  }

  // วิดีโอเล่นจบ -> โชว์ end screen + โหลดเรื่องแนะนำ
  function handleEnded(): void {
    setEnded(true);
    void loadSuggestions();
  }

  // ดูอีกครั้ง: ปิด end screen แล้วเล่นซ้ำจากต้น (grant ยังต่ออายุอยู่ตลอดที่เปิดหน้านี้)
  function replay(): void {
    setEnded(false);
    setCountdown(null);
    const p = playerRef.current;
    if (p) {
      p.currentTime = 0;
      void p.play().catch(() => {});
    }
  }

  async function startPlayback(): Promise<void> {
    setPhase('loading');
    setMessage('');
    setShowUnmute(false);
    // เคลียร์ end screen ของเรื่องก่อนหน้า (กรณีกดเรื่องแนะนำ -> slug เปลี่ยน -> เริ่มเรื่องใหม่)
    setEnded(false);
    setSuggestions([]);
    setCountdown(null);
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
      // จำว่าดูเรื่องนี้แล้ว — end screen จะได้ไม่แนะนำเรื่องที่เพิ่งดูวนกลับมา
      markWatched(slug);
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

  // นับเวลาดูสะสมลง localStorage (ขับเกณฑ์เด้งถาม feedback — ดู lib/feedbackGate)
  // ทุก 10 วิ ถ้าวิดีโอกำลังเล่นอยู่ (ไม่ pause) ค่อยบวก
  useEffect(() => {
    const id = window.setInterval(() => {
      // try/catch: getter .paused ของ vidstack โยน TypeError ได้ถ้า player เพิ่งถูก unmount
      // (เช่น phase เปลี่ยนเป็น kicked/error) แต่ ref ยังถือ instance เก่าอยู่
      try {
        const p = playerRef.current;
        if (p && !p.paused) addWatchSeconds(10);
      } catch {
        // เงียบ — รอบถัดไป player ใหม่ mount แล้วนับต่อเอง
      }
    }, 10_000);
    return () => window.clearInterval(id);
  }, []);

  // เริ่มนับถอยหลัง autoplay เมื่อ end screen ขึ้นและมีเรื่องแนะนำแล้ว
  // (กดยกเลิก -> countdown = null -> interval เดินต่อแต่ไม่ลดค่า ไม่ navigate)
  useEffect(() => {
    if (!ended || suggestions.length === 0) return;
    setCountdown(AUTOPLAY_SECONDS);
    const id = window.setInterval(() => {
      setCountdown((c) => (c === null ? null : Math.max(0, c - 1)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [ended, suggestions]);

  // นับถึง 0 -> เล่นเรื่องแรกของรายการแนะนำ (slug เปลี่ยน -> effect [slug] เริ่มเรื่องใหม่เอง)
  useEffect(() => {
    if (countdown === 0 && suggestions[0]) {
      navigate(`/watch/${encodeURIComponent(suggestions[0].slug)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  return (
    <div style={styles.page}>
      {/* navbar ลอยทับวิดีโอ (fixed + พื้นหลังโปร่งใส) -> วิดีโอเต็มจอด้านหลัง
          pointerEvents:none ที่ตัว bar เพื่อให้แตะทะลุไปโดน control ของ player ได้; เปิด auto เฉพาะปุ่ม/โลโก้ */}
      <div style={styles.bar}>
        <Link to="/" style={styles.back}>
          ← กลับ
        </Link>
        <div style={styles.barRight}>
          <button type="button" style={styles.reportBtn} onClick={() => setReportOpen(true)}>
            ⚠️ แจ้งปัญหา
          </button>
          <img src="/mheedoonung.png" alt="หมีดูหนัง" style={styles.barLogo} />
        </div>
      </div>

      {/* modal แจ้งปัญหา — แนบ slug เรื่องที่กำลังดูให้อัตโนมัติ */}
      <ReportModal open={reportOpen} movieSlug={slug} onClose={() => setReportOpen(false)} />

      <div style={styles.stage}>
        {phase === 'loading' && <p style={styles.center}>กำลังเตรียมวิดีโอ...</p>}

        {phase === 'playing' && mediaSrc && (
          // Vidstack player + DefaultVideoLayout = controls แบบ custom (ไม่มีปุ่ม download / เมนู native ⋮)
          // *สำคัญ*: ไม่ตั้ง crossOrigin เพื่อให้ <video> ภายในส่ง cookie ข้าม origin ไป worker (no-cors media)
          //   หมายเหตุ: เป็น cosmetic เท่านั้น — กัน rip จริงไม่ได้ (ดูดผ่าน devtools/yt-dlp ได้) ต้อง DRM ถึงจะกันจริง
          <MediaPlayer
            ref={playerRef}
            className={`mdn-player${fauxFs ? ' mdn-faux-fs' : ''}`}
            src={mediaSrc}
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
            onEnded={handleEnded}
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
            <DefaultVideoLayout
              icons={defaultLayoutIcons}
              // iPhone: แทนปุ่ม fullscreen ของ Vidstack (ที่เรียก native FS) ด้วยปุ่ม faux-FS เอง
              //   วางในแถบ control เดิม -> ซ่อน/โชว์ตาม control, สไตล์เหมือนปุ่มอื่น
              slots={
                noFsApi
                  ? {
                      fullscreenButton: (
                        <button
                          type="button"
                          className="vds-button"
                          aria-label={fauxFs ? 'ออกจากเต็มจอ' : 'เต็มจอ'}
                          onClick={() => setFauxFs((v) => !v)}
                        >
                          {fauxFs ? (
                            <FsExitIcon className="vds-icon" />
                          ) : (
                            <FsEnterIcon className="vds-icon" />
                          )}
                        </button>
                      ),
                    }
                  : undefined
              }
            />
          </MediaPlayer>
        )}

        {/* end screen: วิดีโอจบ -> แนะนำเรื่องถัดไป + นับถอยหลัง autoplay เรื่องแรก */}
        {phase === 'playing' && ended && (
          <div style={styles.endOverlay}>
            <p style={styles.endTitle}>ดูจบแล้ว 🎬</p>
            {suggestions.length > 0 && (
              <>
                <p style={styles.endSub}>
                  {countdown !== null ? (
                    <>
                      กำลังจะเล่น <strong>{suggestions[0]?.title}</strong> ใน {countdown} วินาที
                      <button type="button" style={styles.cancelBtn} onClick={() => setCountdown(null)}>
                        ยกเลิก
                      </button>
                    </>
                  ) : (
                    'เรื่องถัดไปที่น่าจะชอบ'
                  )}
                </p>
                {/* layout กริดอยู่ใน index.css (.mdn-suggest-grid) — ต้องใช้ media query */}
                <div className="mdn-suggest-grid">
                  {suggestions.map((m, i) => (
                    <button
                      key={m.slug}
                      type="button"
                      style={i === 0 && countdown !== null ? styles.suggestCardNext : styles.suggestCard}
                      onClick={() => navigate(`/watch/${encodeURIComponent(m.slug)}`)}
                    >
                      <img src={m.posterUrl} alt={m.title} style={styles.suggestPoster} loading="lazy" />
                      <span style={styles.suggestTitle}>{m.title}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div style={styles.endActions}>
              <button type="button" style={styles.btn} onClick={replay}>
                ↻ ดูอีกครั้ง
              </button>
              <Link to="/" style={styles.endHomeLink}>
                ← กลับหน้าแรก
              </Link>
            </div>
          </div>
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
            <button type="button" style={styles.btnGhost} onClick={() => setReportOpen(true)}>
              แจ้งปัญหานี้
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
  // navbar ลอย (fixed) พื้นหลังโปร่งใส -> วิดีโอเต็มจอด้านหลัง; pointerEvents:none ให้แตะทะลุไป player ได้
  bar: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    // ความสูง = safe-area + 8 + (โลโก้ 36) + 8 ≈ safe+52px -> ใช้ค่านี้ดันแถบ control บนของ player (ดู index.css)
    padding: 'calc(env(safe-area-inset-top, 0px) + 8px) 16px 8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'transparent',
    pointerEvents: 'none' as const,
  },
  // back/logo/ปุ่มแจ้งปัญหา รับ tap เอง (bar เป็น none) + drop shadow ให้อ่านออกบนวิดีโอสว่าง
  back: { color: '#fff', textDecoration: 'none', fontSize: 15, pointerEvents: 'auto' as const, textShadow: '0 1px 3px rgba(0,0,0,0.8)' },
  barRight: { display: 'flex', alignItems: 'center', gap: 12 },
  reportBtn: {
    pointerEvents: 'auto' as const,
    padding: '6px 12px',
    background: 'rgba(0,0,0,0.55)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: 999,
    fontSize: 13,
    cursor: 'pointer',
    backdropFilter: 'blur(4px)',
  },
  barLogo: { width: 36, height: 36, objectFit: 'contain' as const, pointerEvents: 'auto' as const, filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.8))' },
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
  // ปุ่มรองใน overlay (แจ้งปัญหา) — โปร่ง ไม่แย่งเด่นกับปุ่มลองใหม่
  btnGhost: {
    padding: '10px 20px',
    background: 'transparent',
    color: '#bbb',
    border: '1px solid #555',
    borderRadius: 8,
    fontSize: 15,
    cursor: 'pointer',
    marginLeft: 10,
  },
  softError: { color: '#ffb3b3', textAlign: 'center' as const, padding: '8px 16px', fontSize: 13 },
  // ---- end screen (วิดีโอจบ) ----
  endOverlay: {
    position: 'absolute' as const,
    inset: 0,
    zIndex: 15, // ทับ player/control แต่ใต้ navbar (20)
    background: 'rgba(0,0,0,0.88)',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    // *ห้าม* justifyContent:'center' — เนื้อหาสูงกว่าจอ (มือถือ) จะตัดหัวแบบเลื่อนขึ้นไปไม่ถึง
    // ชิดบนแล้วปล่อยให้ scroll ลงแทน (padding บนเผื่อ navbar แล้ว)
    justifyContent: 'flex-start',
    gap: 14,
    padding: 'calc(env(safe-area-inset-top, 0px) + 60px) 20px 24px',
    overflowY: 'auto' as const,
  },
  endTitle: { fontSize: 22, fontWeight: 700, margin: 0 },
  endSub: { color: '#ccc', fontSize: 15, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const, justifyContent: 'center' },
  cancelBtn: {
    padding: '4px 14px',
    background: 'transparent',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.5)',
    borderRadius: 999,
    fontSize: 13,
    cursor: 'pointer',
  },
  // layout ของกริดย้ายไป index.css (.mdn-suggest-grid) — ต้องใช้ media query แยกมือถือ/จอกว้าง
  suggestCard: {
    background: 'transparent',
    border: '2px solid transparent',
    borderRadius: 10,
    padding: 4,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    color: '#eee',
  },
  // เรื่องแรก (กำลังจะ autoplay) — ขอบแดง highlight
  suggestCardNext: {
    background: 'transparent',
    border: '2px solid #e50914',
    borderRadius: 10,
    padding: 4,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    color: '#fff',
  },
  suggestPoster: { width: '100%', aspectRatio: '2 / 3', objectFit: 'cover' as const, borderRadius: 6, display: 'block', background: '#222' },
  // ชื่อเรื่องไทยยาว — จำกัด 2 บรรทัดกันการ์ดสูงไม่เท่ากัน/ดันจอ
  suggestTitle: {
    fontSize: 12,
    lineHeight: 1.3,
    textAlign: 'center' as const,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden' as const,
  },
  endActions: { display: 'flex', alignItems: 'center', gap: 14, marginTop: 4 },
  endHomeLink: { color: '#bbb', textDecoration: 'none', fontSize: 15 },
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

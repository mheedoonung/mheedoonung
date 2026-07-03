// ปุ่ม "ติดตั้งแอป" แบบลอย — เพราะเบราว์เซอร์ไม่เด้ง popup ติดตั้งให้เอง
//   Android/desktop Chrome: จับ event `beforeinstallprompt` แล้วเรียก .prompt() ตอนกดปุ่ม
//   iOS Safari: ไม่มี API ติดตั้ง -> โชว์คำแนะนำ Add to Home Screen เอง
//   ซ่อนทันทีถ้าเปิดในโหมดติดตั้งแล้ว (standalone) หรือผู้ใช้กดปิด
import { useEffect, useState } from 'react';

// event นี้ไม่อยู่ใน lib.dom มาตรฐาน — ประกาศ type เท่าที่ใช้
type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  // ปิดถาวรในแท็บนี้เมื่อผู้ใช้กดปิด หรือเปิดในโหมดติดตั้งแล้ว
  const [dismissed, setDismissed] = useState(
    () => isStandalone() || sessionStorage.getItem('mdn-install-dismissed') === '1',
  );

  useEffect(() => {
    const onBIP = (e: Event) => {
      e.preventDefault(); // กัน mini-infobar ของ Chrome -> เราคุมปุ่มเอง
      setDeferred(e as BIPEvent);
    };
    const onInstalled = () => setDismissed(true);
    window.addEventListener('beforeinstallprompt', onBIP);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // ไม่มีอะไรให้กด: ไม่ใช่ iOS และยังไม่ได้ event ติดตั้ง (เช่น browser ไม่รองรับ) -> ไม่โชว์
  const canShow = !dismissed && (deferred !== null || isIOS());
  if (!canShow) return null;

  function close() {
    sessionStorage.setItem('mdn-install-dismissed', '1');
    setDismissed(true);
  }

  async function onInstall() {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
      setDismissed(true);
    } else {
      setShowIOSHelp((v) => !v); // iOS: ไม่มี API -> โชว์วิธีทำเอง
    }
  }

  return (
    <div style={styles.wrap}>
      {showIOSHelp && (
        <p style={styles.help}>
          กดปุ่ม <strong>แชร์</strong> ด้านล่าง → เลือก <strong>“เพิ่มไปยังหน้าจอโฮม”</strong>
        </p>
      )}
      <div style={styles.bar}>
        <span style={styles.text}>📲 ติดตั้งหมีดูหนังเป็นแอป</span>
        <button type="button" style={styles.install} onClick={() => void onInstall()}>
          ติดตั้ง
        </button>
        <button type="button" style={styles.close} aria-label="ปิด" onClick={close}>
          ✕
        </button>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    position: 'fixed' as const,
    left: '50%',
    bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
    transform: 'translateX(-50%)',
    zIndex: 9999,
    width: 'min(92vw, 420px)',
  },
  help: {
    margin: '0 0 8px',
    padding: '10px 14px',
    background: 'rgba(0,0,0,0.85)',
    color: '#fff',
    borderRadius: 10,
    fontSize: 13,
    textAlign: 'center' as const,
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    background: '#1a1a1a',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 12,
    boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
  },
  text: { color: '#fff', fontSize: 14, flex: 1 },
  install: {
    padding: '8px 16px',
    background: '#e50914',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  close: {
    padding: 6,
    background: 'transparent',
    color: '#aaa',
    border: 'none',
    fontSize: 16,
    cursor: 'pointer',
  },
} as const;

// index.js
import express from 'express';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import cors from 'cors';
import admin from 'firebase-admin';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/* ============================
   Firebase Admin init (multi-project, robust)
   ============================ */
function fixPrivateKey(obj) {
  if (obj?.private_key?.includes('\\n')) {
    obj.private_key = obj.private_key.replace(/\\n/g, '\n');
  }
  return obj;
}
function parseServiceAccount(raw, varName) {
  if (!raw || !String(raw).trim()) {
    throw new Error(`${varName} is empty or undefined`);
  }
  const s = String(raw).trim();
  // Try JSON directly
  try {
    return fixPrivateKey(JSON.parse(s));
  } catch {
    // Try base64 -> JSON
    try {
      const decoded = Buffer.from(s, 'base64').toString('utf8');
      return fixPrivateKey(JSON.parse(decoded));
    } catch {
      const preview = s.slice(0, 80);
      throw new Error(`${varName} is not valid JSON (or base64). Preview: ${preview}…`);
    }
  }
}

const apps = {};
let anyApp = false;

// EFB
if (process.env.SERVICE_ACCOUNT_KEY_EFB) {
  const cred = admin.credential.cert(
    parseServiceAccount(process.env.SERVICE_ACCOUNT_KEY_EFB, 'SERVICE_ACCOUNT_KEY_EFB')
  );
  apps.efb = admin.initializeApp({ credential: cred }, 'efb');
  anyApp = true;
}
// Math Master (chấp nhận SERVICE_ACCOUNT_KEY_MM hoặc SERVICE_ACCOUNT_KEY2)
const MM_ENV = process.env.SERVICE_ACCOUNT_KEY_MM || process.env.SERVICE_ACCOUNT_KEY2;
if (MM_ENV) {
  const cred = admin.credential.cert(
    parseServiceAccount(MM_ENV, MM_ENV === process.env.SERVICE_ACCOUNT_KEY_MM ? 'SERVICE_ACCOUNT_KEY_MM' : 'SERVICE_ACCOUNT_KEY2')
  );
  apps.mathmaster = admin.initializeApp({ credential: cred }, 'mathmaster');
  anyApp = true;
}
// Fallback: nếu chỉ có SERVICE_ACCOUNT_KEY thì dùng cho efb
if (!apps.efb && process.env.SERVICE_ACCOUNT_KEY) {
  const cred = admin.credential.cert(
    parseServiceAccount(process.env.SERVICE_ACCOUNT_KEY, 'SERVICE_ACCOUNT_KEY')
  );
  apps.efb = admin.initializeApp({ credential: cred }, 'efb');
  anyApp = true;
}
if (!anyApp) {
  throw new Error(
    'No Firebase service account env var found. Set one of SERVICE_ACCOUNT_KEY_EFB / SERVICE_ACCOUNT_KEY_MM (/ SERVICE_ACCOUNT_KEY2) or SERVICE_ACCOUNT_KEY.'
  );
}

function getAuthByKey(key) {
  return admin.app(key).auth();
}
function getAuthCandidates(rawAccount) {
  const acc = String(rawAccount || 'efb').toLowerCase();
  const keys = acc === 'mathmaster' ? ['mathmaster', 'efb'] : ['efb', 'mathmaster'];
  const list = [];
  for (const k of keys) {
    try { list.push(getAuthByKey(k)); } catch {}
  }
  return list;
}

/* ============================
   Email helpers (2 accounts)
   ============================ */
function getAccountConfig(rawAccount) {
  const account = String(rawAccount || 'efb').toLowerCase();

  if (account === 'mathmaster') {
    const user = process.env.EMAIL_USER2;
    const pass = process.env.EMAIL_PASS2;
    if (!user || !pass) throw new Error('Missing EMAIL_USER2/EMAIL_PASS2');
    return {
      name: 'mathmaster',
      displayName: 'Math Master',
      user,
      pass,
      from: `Math Master <${user}>`,
      subject: 'Math Master • Mã OTP của bạn',
      theme: {
        primary: '#7C3AED',
        accent:  '#22C55E',
        text:    '#111827',
        muted:   '#6B7280',
        border:  '#E5E7EB',
        bg:      '#F9FAFB',
      },
      support: 'mathmaster396@gmail.com',
    };
  }

  // default: EFB
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) throw new Error('Missing EMAIL_USER/EMAIL_PASS');
  return {
    name: 'efb',
    displayName: 'English For Beginner',
    user,
    pass,
    from: `English For Beginner <${user}>`,
    subject: 'EFB • Mã OTP của bạn',
    theme: {
      primary: '#2563EB',
      accent:  '#F59E0B',
      text:    '#111827',
      muted:   '#6B7280',
      border:  '#E5E7EB',
      bg:      '#F9FAFB',
    },
    support: 'efbenglishforbeginner@gmail.com',
  };
}

function createTransporter(user, pass) {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }, // App Password
  });
}

/* ============================
   OTP store (RAM) + TTL
   ============================ */
const OTP_TTL_MINUTES = 10;
const OTP_TTL_MS = OTP_TTL_MINUTES * 60 * 1000;
const otpStore = new Map(); // key: `${account}:${email}` -> { code, exp }

function setOtp(account, email, code) {
  const key = `${String(account).toLowerCase()}:${String(email).toLowerCase()}`;
  otpStore.set(key, { code: String(code), exp: Date.now() + OTP_TTL_MS });
}
function checkOtp(account, email, code) {
  const key = `${String(account).toLowerCase()}:${String(email).toLowerCase()}`;
  const item = otpStore.get(key);
  if (!item) return { ok: false, reason: 'OTP không tồn tại hoặc đã hết hạn' };
  if (Date.now() > item.exp) {
    otpStore.delete(key);
    return { ok: false, reason: 'OTP đã hết hạn' };
  }
  if (String(code) !== String(item.code)) return { ok: false, reason: 'Mã OTP không đúng' };
  otpStore.delete(key); // one-time
  return { ok: true };
}
function checkOtpAny(email, code) {
  const tries = [
    checkOtp('efb', email, code),
    checkOtp('mathmaster', email, code),
  ];
  if (tries[0].ok || tries[1].ok) return { ok: true };
  return { ok: false, reason: tries[1].reason || tries[0].reason || 'OTP không hợp lệ' };
}

/* ============================
   Email template
   ============================ */
function buildOtpEmail({ otp, cfg, toEmail }) {
  const t = cfg.theme;
  const brand = cfg.displayName;
  const preheader = `${brand}: Mã OTP của bạn là ${otp}. Mã dùng trong ${OTP_TTL_MINUTES} phút. Không chia sẻ mã cho bất kỳ ai.`;

  const html = `<!DOCTYPE html>
<html lang="vi"><head><meta charSet="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${cfg.subject}</title>
<style>body,table,td,a{ -webkit-text-size-adjust:100%; -ms-text-size-adjust:100% }table,td{ mso-table-lspace:0pt; mso-table-rspace:0pt }img{ -ms-interpolation-mode:bicubic }body{ margin:0; padding:0; width:100% !important; background:${t.bg}; }a{ text-decoration:none }</style>
</head>
<body>
<span style="display:none!important;opacity:0;color:transparent;visibility:hidden;height:0;width:0;overflow:hidden;">${preheader}</span>
<table role="presentation" width="100%" style="background:${t.bg};padding:24px 12px;" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center">
  <table role="presentation" width="560" style="background:#fff;border:1px solid ${t.border};border-radius:12px;overflow:hidden;" cellpadding="0" cellspacing="0" border="0">
    <tr><td style="background:${t.primary};padding:20px 24px;">
      <h1 style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:18px;line-height:24px;color:#fff;">${brand}</h1>
    </td></tr>
    <tr><td style="padding:24px;">
      <p style="margin:0 0 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;color:${t.text};">
        Xin chào${toEmail ? `, <strong>${toEmail}</strong>` : ''} 👋
      </p>
      <p style="margin:0 0 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;color:${t.text};">
        Dưới đây là <strong>mã xác thực (OTP)</strong> của bạn. Vui lòng nhập mã này để tiếp tục quá trình xác minh tài khoản.
      </p>
      <table role="presentation" width="100%" style="margin:8px 0 16px;" cellpadding="0" cellspacing="0" border="0">
        <tr><td align="center" style="padding:16px;border:1px dashed ${t.border};border-radius:10px;background:#F3F4F6;">
          <div style="font-family:ui-monospace,Menlo,Monaco,Consolas,'Courier New',monospace;font-size:28px;letter-spacing:8px;color:${t.text};font-weight:700;">${otp}</div>
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:${t.muted};margin-top:8px;">Mã có hiệu lực trong ${OTP_TTL_MINUTES} phút.</div>
        </td></tr>
      </table>
      <p style="margin:0 0 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:${t.muted};">
        Nếu bạn không yêu cầu mã này, hãy bỏ qua email hoặc liên hệ hỗ trợ để được trợ giúp.
      </p>
      <ul style="margin:8px 0 0 18px;padding:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:${t.text};">
        <li>Không chia sẻ mã cho bất kỳ ai.</li>
        <li>Hãy chắc chắn rằng bạn đang thao tác trên ứng dụng/website chính thức của ${brand}.</li>
      </ul>
    </td></tr>
    <tr><td style="padding:16px 24px;border-top:1px solid ${t.border};background:#fafafa;">
      <p style="margin:0 0 6px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${t.muted};">
        Cần hỗ trợ? Liên hệ: <a href="mailto:${cfg.support}" style="color:${t.primary};">${cfg.support}</a>
      </p>
      <p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${t.muted};">© ${new Date().getFullYear()} ${brand}. All rights reserved.</p>
    </td></tr>
  </table>
  <div style="max-width:560px;margin:8px auto 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${t.muted};">
    Bạn nhận được email này vì có yêu cầu xác thực bằng địa chỉ của bạn.
  </div>
</td></tr></table>
</body></html>`;

  const text = [
    `${brand} - Mã OTP của bạn: ${otp}`,
    '',
    `Mã có hiệu lực trong ${OTP_TTL_MINUTES} phút.`,
    'Không chia sẻ mã cho bất kỳ ai.',
    '',
    `Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email hoặc liên hệ: ${cfg.support}`,
    '',
    `© ${new Date().getFullYear()} ${brand}.`,
  ].join('\n');

  return { html, text };
}

/* ============================
   API: Health check
   ============================ */
app.get('/', (_req, res) => res.json({ ok: true }));

/* ============================
   API: Gửi OTP
   ============================ */
app.post('/send-otp', async (req, res) => {
  let { email, account } = req.body || {};
  account = String(account || 'efb').toLowerCase();

  if (!email) return res.status(400).json({ success: false, message: 'Missing email' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    const cfg = getAccountConfig(account);
    console.log('Send OTP:', { email, account: cfg.name, using: cfg.user });

    // save OTP (override previous)
    setOtp(account, email, otp);

    const tpl = buildOtpEmail({ otp, cfg, toEmail: email });
    const transporter = createTransporter(cfg.user, cfg.pass);

    await transporter.sendMail({
      from: cfg.from,
      to: email,
      subject: cfg.subject,
      html: tpl.html,
      text: tpl.text,
      headers: { 'X-Auto-Response-Suppress': 'All' },
    });

    // dev helper
    const payload = { success: true, message: `Đã gửi OTP qua ${cfg.name}` };
    if (String(process.env.RETURN_OTP_IN_RESPONSE).toLowerCase() === 'true') {
      payload.otp = otp;
    }
    return res.json(payload);
  } catch (err) {
    console.error('❌ Lỗi gửi OTP:', err);
    return res.status(500).json({ success: false, message: 'Không gửi được OTP' });
  }
});

/* ============================
   API: Verify OTP (prod)
   ============================ */
app.post('/verify-otp', async (req, res) => {
  let { email, otp, account } = req.body || {};
  account = account ? String(account).toLowerCase() : undefined;

  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Missing email or otp' });
  }

  const result = account ? checkOtp(account, email, otp) : checkOtpAny(email, otp);
  if (!result.ok) {
    return res.status(400).json({ success: false, message: result.reason });
  }
  return res.json({ success: true, message: 'Xác thực OTP thành công' });
});

/* ============================
   API: Reset mật khẩu Firebase
   - chọn project theo `account`
   - nếu không truyền account -> thử cả hai
   ============================ */
app.post('/reset-password', async (req, res) => {
  let { email, newPassword, account } = req.body || {};
  account = account ? String(account).toLowerCase() : undefined;

  if (!email || !newPassword) {
    return res.status(400).json({ success: false, message: 'Missing email or newPassword' });
  }

  const candidates = getAuthCandidates(account);
  if (!candidates.length) {
    return res.status(500).json({ success: false, message: 'Firebase admin chưa được cấu hình' });
  }

  const normalizedEmail = String(email).trim();
  let updated = false;
  let lastErr = null;

  for (const auth of candidates) {
    try {
      const user = await auth.getUserByEmail(normalizedEmail);
      await auth.updateUser(user.uid, { password: newPassword });
      updated = true;
      break;
    } catch (e) {
      lastErr = e;
      // nếu là user-not-found thì thử app tiếp theo
      if (e?.errorInfo?.code !== 'auth/user-not-found' && e?.code !== 'auth/user-not-found') {
        break;
      }
    }
  }

  if (!updated) {
    const code = lastErr?.errorInfo?.code || lastErr?.code;
    if (code === 'auth/user-not-found') {
      return res.status(404).json({ success: false, message: 'Tài khoản không tồn tại trong các dự án đã cấu hình.' });
    }
    return res.status(500).json({ success: false, message: lastErr?.message || 'Update failed' });
  }

  return res.json({ success: true, message: 'Đã cập nhật mật khẩu thành công' });
});

/* ============================
   Start server
   ============================ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});

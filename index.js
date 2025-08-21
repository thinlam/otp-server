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
   Firebase Admin init (1 project)
   ============================ */
if (!process.env.SERVICE_ACCOUNT_KEY) {
  throw new Error('Missing SERVICE_ACCOUNT_KEY in .env');
}

const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);

// Fix xuống dòng private_key (khi để JSON 1 dòng trong .env)
if (serviceAccount.private_key && serviceAccount.private_key.includes('\\n')) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

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
        primary: '#7C3AED',     // tím
        accent: '#22C55E',      // xanh lá
        text: '#111827',
        muted: '#6B7280',
        border: '#E5E7EB',
        bg: '#F9FAFB',
      },
      support: 'support@mathmaster.app',
    };
  }

  // default: efb
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
      primary: '#2563EB',      // xanh dương
      accent: '#F59E0B',       // vàng
      text: '#111827',
      muted: '#6B7280',
      border: '#E5E7EB',
      bg: '#F9FAFB',
    },
    support: 'support@efbenglish.app',
  };
}

function createTransporter(user, pass) {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }, // App Password từ Gmail
  });
}

/* ============================
   Email template chuyên nghiệp
   ============================ */
const OTP_TTL_MINUTES = 10; // chỉ hiển thị trong email (nếu chưa triển khai TTL thực tế)

function buildOtpEmail({ otp, cfg, toEmail }) {
  const t = cfg.theme;
  const brand = cfg.displayName;

  const preheader =
    `${brand}: Mã OTP của bạn là ${otp}. Mã dùng trong ${OTP_TTL_MINUTES} phút. Không chia sẻ mã cho bất kỳ ai.`;

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charSet="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${cfg.subject}</title>
  <style>
    /* Reset cơ bản cho email client */
    body,table,td,a{ -webkit-text-size-adjust:100%; -ms-text-size-adjust:100% }
    table,td{ mso-table-lspace:0pt; mso-table-rspace:0pt }
    img{ -ms-interpolation-mode:bicubic }
    body{ margin:0; padding:0; width:100% !important; background:${t.bg}; }
    a{ text-decoration:none }
  </style>
</head>
<body>
  <!-- Preheader (ẩn) -->
  <span style="display:none!important;opacity:0;color:transparent;visibility:hidden;height:0;width:0;overflow:hidden;">
    ${preheader}
  </span>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${t.bg};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff;border:1px solid ${t.border};border-radius:12px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:${t.primary};padding:20px 24px;">
              <h1 style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:18px;line-height:24px;color:#ffffff;">
                ${brand}
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px;">
              <p style="margin:0 0 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;color:${t.text};">
                Xin chào${toEmail ? `, <strong>${toEmail}</strong>` : ''} 👋
              </p>
              <p style="margin:0 0 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;color:${t.text};">
                Dưới đây là <strong>mã xác thực (OTP)</strong> của bạn. Vui lòng nhập mã này để tiếp tục quá trình xác minh tài khoản.
              </p>

              <!-- OTP Block -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 16px;">
                <tr>
                  <td align="center" style="padding:16px;border:1px dashed ${t.border};border-radius:10px;background:#F3F4F6;">
                    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;
                                font-size:28px;letter-spacing:8px;color:${t.text};font-weight:700;">
                      ${otp}
                    </div>
                    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                                font-size:13px;color:${t.muted};margin-top:8px;">
                      Mã có hiệu lực trong ${OTP_TTL_MINUTES} phút.
                    </div>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:${t.muted};">
                Nếu bạn không yêu cầu mã này, hãy bỏ qua email hoặc liên hệ hỗ trợ để được trợ giúp.
              </p>

              <!-- Tips -->
              <ul style="margin:8px 0 0 18px;padding:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:${t.text};">
                <li>Không chia sẻ mã cho bất kỳ ai.</li>
                <li>Hãy chắc chắn rằng bạn đang thực hiện thao tác trên ứng dụng/website chính thức của ${brand}.</li>
              </ul>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 24px;border-top:1px solid ${t.border};background:#fafafa;">
              <p style="margin:0 0 6px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${t.muted};">
                Cần hỗ trợ? Liên hệ: <a href="mailto:${cfg.support}" style="color:${t.primary};">${cfg.support}</a>
              </p>
              <p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${t.muted};">
                © ${new Date().getFullYear()} ${brand}. All rights reserved.
              </p>
            </td>
          </tr>
        </table>

        <!-- Small note -->
        <div style="max-width:560px;margin:8px auto 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${t.muted};">
          Bạn nhận được email này vì có yêu cầu xác thực bằng địa chỉ của bạn.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;

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
   API: Gửi OTP
   ============================ */
app.post('/send-otp', async (req, res) => {
  let { email, account } = req.body || {};
  account = String(account || 'efb').toLowerCase();

  if (!email) {
    return res.status(400).json({ success: false, message: 'Missing email' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    const cfg = getAccountConfig(account);
    console.log('Send OTP:', { email, account: cfg.name, using: cfg.user });

    const tpl = buildOtpEmail({ otp, cfg, toEmail: email });
    const transporter = createTransporter(cfg.user, cfg.pass);

    await transporter.sendMail({
      from: cfg.from,                 // phải trùng email đang auth
      to: email,
      subject: cfg.subject,           // phân biệt theo brand
      html: tpl.html,
      text: tpl.text,
      headers: {
        'X-Auto-Response-Suppress': 'All',
      },
    });

    // ⚠️ Prod KHÔNG trả OTP về client
    return res.json({ success: true, message: `Đã gửi OTP qua ${cfg.name}` });
  } catch (err) {
    console.error('❌ Lỗi gửi OTP:', err);
    return res.status(500).json({ success: false, message: 'Không gửi được OTP' });
  }
});

/* ============================
   API: Reset mật khẩu Firebase
   ============================ */
app.post('/reset-password', async (req, res) => {
  const { email, newPassword } = req.body || {};
  if (!email || !newPassword) {
    return res.status(400).json({ success: false, message: 'Missing email or newPassword' });
  }

  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(user.uid, { password: newPassword });
    return res.json({ success: true, message: 'Đã cập nhật mật khẩu thành công' });
  } catch (error) {
    console.error('❌ Lỗi cập nhật mật khẩu:', error);
    return res.status(500).json({ success: false, message: error?.message || 'Update failed' });
  }
});

/* ============================
   Start server
   ============================ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});

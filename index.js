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
if (serviceAccount.private_key?.includes('\\n')) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

/* ============================
   Email helpers (2 accounts)
   ============================ */
function getAccountConfig(rawAccount: string | undefined) {
  const account = String(rawAccount || 'efb').toLowerCase();

  if (account === 'mathmaster') {
    const user = process.env.EMAIL_USER2;
    const pass = process.env.EMAIL_PASS2;
    if (!user || !pass) throw new Error('Missing EMAIL_USER2/EMAIL_PASS2');
    return {
      name: 'mathmaster',
      user,
      pass,
      from: `Math Master <${user}>`,
      subject: 'Math Master • Mã OTP của bạn',
    };
  }

  // default: efb
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) throw new Error('Missing EMAIL_USER/EMAIL_PASS');
  return {
    name: 'efb',
    user,
    pass,
    from: `English For Beginner <${user}>`,
    subject: 'EFB • Mã OTP của bạn',
  };
}

function createTransporter(user: string, pass: string) {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

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

    const transporter = createTransporter(cfg.user, cfg.pass);
    await transporter.sendMail({
      from: cfg.from,            // phải trùng email user đã auth
      to: email,
      subject: cfg.subject,      // giúp phân biệt trong inbox
      html: `<p>Mã OTP: <b>${otp}</b></p>`,
    });

    // ⚠️ Prod không trả OTP
    return res.json({ success: true, message: `Đã gửi OTP qua ${cfg.name}` });
  } catch (err: any) {
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
  } catch (error: any) {
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

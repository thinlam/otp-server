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
   Firebase Admin init
   ============================ */
if (!process.env.SERVICE_ACCOUNT_KEY) {
  throw new Error('Missing SERVICE_ACCOUNT_KEY in .env');
}

const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);

// Fix xuống dòng private_key
if (serviceAccount.private_key?.includes('\\n')) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

/* ============================
   Email helpers (2 accounts)
   ============================ */
function getAccountConfig(account = 'efb') {
  if (account === 'mathmaster') {
    return {
      user: process.env.EMAIL_USER2,
      pass: process.env.EMAIL_PASS2,
      fromName: `Math Master <${process.env.EMAIL_USER2}>`,
    };
  }
  return {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    fromName: `English For Beginner <${process.env.EMAIL_USER}>`,
  };
}

function createTransporter({ user, pass }) {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

/* ============================
   API: Gửi OTP
   ============================ */
app.post('/send-otp', async (req, res) => {
  const { email, account = 'efb' } = req.body || {};
  if (!email) return res.status(400).json({ success: false, message: 'Missing email' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    const cfg = getAccountConfig(account);
    const transporter = createTransporter(cfg);

    const mailOptions = {
      from: cfg.fromName,
      to: email,
      subject: 'Mã xác thực OTP của bạn',
      html: `<p>Mã OTP: <b>${otp}</b></p>`,
    };

    console.log(`✅ Gửi OTP đến ${email} bằng ${cfg.user}`);
    await transporter.sendMail(mailOptions);

    // ⚠️ Trong production không nên trả OTP về client
    return res.json({ success: true, message: 'Đã gửi OTP', otp });
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

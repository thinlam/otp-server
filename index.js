import express from 'express';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import cors from 'cors';
import admin from 'firebase-admin';
import bcrypt from 'bcryptjs';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

/* ==============================
   Firebase Admin init (robust)
   ============================== */
function parseServiceAccount() {
  let raw = process.env.SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('Missing SERVICE_ACCOUNT_KEY');

  // Nếu biến môi trường bị bọc nháy, gỡ nháy
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1);
  }

  // Thử decode URI (nếu được set bằng github actions/railway)
  try { raw = decodeURIComponent(raw); } catch {}

  // Có thể là JSON plain hoặc base64
  let jsonStr = raw;
  try {
    // Nếu là base64, decode ra JSON string
    if (!raw.trim().startsWith('{')) {
      jsonStr = Buffer.from(raw, 'base64').toString('utf8');
    }
  } catch {}
  const serviceAccount = JSON.parse(jsonStr);

  // Sửa xuống dòng trong private_key
  if (serviceAccount.private_key && serviceAccount.private_key.includes('\\n')) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  return serviceAccount;
}

const serviceAccount = parseServiceAccount();
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

/* ==============================
   Email transporter (Gmail App Password)
   ============================== */
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // ví dụ: yourname@gmail.com
    pass: process.env.EMAIL_PASS, // App Password 16 ký tự
  },
});

/* ==============================
   Helper
   ============================== */
const OTP_TTL_MS = 60 * 1000; // 1 phút
const RESEND_COOLDOWN_MS = 60 * 1000; // cũng 1 phút

function genOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function otpDocId(email) {
  // Gom otp theo email (1 doc/email) để dễ kiểm soát cooldown/resend
  return Buffer.from(email.trim().toLowerCase()).toString('base64url');
}

/* ==============================
   API: Gửi OTP (1 phút)
   ============================== */
app.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, message: 'Email không hợp lệ' });
    }

    const docId = otpDocId(email);
    const ref = db.collection('otp_codes').doc(docId);
    const snap = await ref.get();

    // Nếu đã có OTP còn hạn => không cho gửi mới (cooldown)
    if (snap.exists) {
      const data = snap.data();
      const now = Date.now();
      if (data?.expiresAt && data.expiresAt.toMillis() > now) {
        const leftMs = data.expiresAt.toMillis() - now;
        // Nếu còn hạn < 60s thì vẫn coi như đang cooldown
        if (leftMs > 0) {
          const leftSec = Math.ceil(leftMs / 1000);
          return res.status(429).json({
            success: false,
            message: `Vui lòng đợi ${leftSec}s trước khi gửi lại.`,
            cooldown: leftSec,
          });
        }
      }
      // Hết hạn thì cho overwrite
    }

    const otp = genOTP();
    const otpHash = await bcrypt.hash(otp, 10);
    const now = Date.now();
    const expiresAt = new Date(now + OTP_TTL_MS);

    await ref.set({
      email: email.trim().toLowerCase(),
      otpHash,
      used: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const mailOptions = {
      from: `English For Beginners <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Mã xác thực OTP của bạn',
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; padding: 20px;">
          <h2 style="color: #6C63FF;">🔐 Xác minh tài khoản EFB</h2>
          <p>Chào bạn,</p>
          <p>Bạn (hoặc ai đó) vừa yêu cầu mã OTP để xác thực tài khoản trên <strong>English For Beginners</strong>.</p>
          <p style="margin: 20px 0; font-size: 18px;">
            Mã xác thực của bạn là:
            <br/>
            <span style="display: inline-block; margin-top: 10px; padding: 12px 24px; background-color: #f4f4f4; border-radius: 8px; font-size: 26px; font-weight: bold; color: #6C63FF;">
              ${otp}
            </span>
          </p>
          <p><strong>Lưu ý:</strong> Mã có hiệu lực trong <strong>1 phút</strong> kể từ lúc gửi.</p>
          <p>Vui lòng không chia sẻ mã này với bất kỳ ai để bảo vệ tài khoản của bạn.</p>
          <p>Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email này.</p>
          <hr style="margin: 30px 0;" />
          <p style="font-size: 14px; color: #999;">
            Trân trọng,<br/>
            Đội ngũ <strong>EFB - English For Beginners</strong>
          </p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    // Không trả OTP về client để tránh lộ
    return res.json({ success: true, message: 'Đã gửi OTP. Hết hạn sau 1 phút.' });
  } catch (err) {
    console.error('❌ Lỗi gửi OTP:', err);
    return res.status(500).json({ success: false, message: 'Không gửi được OTP' });
  }
});

/* ==============================
   API: Xác thực OTP
   ============================== */
app.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Thiếu email hoặc otp' });
    }

    const docId = otpDocId(email);
    const ref = db.collection('otp_codes').doc(docId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(400).json({ success: false, message: 'OTP không tồn tại hoặc đã hết hạn' });
    }
    const data = snap.data();

    // Hết hạn?
    const now = Date.now();
    if (!data?.expiresAt || data.expiresAt.toMillis() <= now) {
      // xoá luôn doc cũ
      await ref.delete().catch(() => {});
      return res.status(400).json({ success: false, message: 'OTP đã hết hạn' });
    }

    // Đã dùng?
    if (data.used) {
      return res.status(400).json({ success: false, message: 'OTP đã được sử dụng' });
    }

    // So khớp OTP
    const ok = await bcrypt.compare(String(otp), data.otpHash || '');
    if (!ok) {
      return res.status(400).json({ success: false, message: 'OTP không đúng' });
    }

    // Thành công: đánh dấu used và xoá (tuỳ chọn). Ở đây xoá luôn cho sạch.
    await ref.delete();

    return res.json({ success: true, message: 'Xác thực OTP thành công' });
  } catch (err) {
    console.error('❌ Lỗi verify OTP:', err);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi xác thực OTP' });
  }
});

/* ==============================
   API: Reset mật khẩu Firebase
   ============================== */
app.post('/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body || {};
    if (!email || !newPassword) {
      return res.status(400).json({ success: false, message: 'Thiếu email hoặc mật khẩu mới' });
    }

    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(user.uid, { password: newPassword });

    return res.json({ success: true, message: 'Đã cập nhật mật khẩu thành công' });
  } catch (error) {
    console.error('❌ Lỗi cập nhật mật khẩu:', error);
    // Nếu email không tồn tại
    if (String(error?.message || '').toLowerCase().includes('no user record')) {
      return res.status(404).json({ success: false, message: 'Email không tồn tại trong hệ thống' });
    }
    return res.status(500).json({ success: false, message: 'Không thể cập nhật mật khẩu' });
  }
});

/* ==============================
   Start server
   ============================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});

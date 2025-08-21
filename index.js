import express from 'express';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import cors from 'cors';
import admin from 'firebase-admin';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// ✅ Load Firebase service account
const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY!);

// ⚠️ Fix lỗi xuống dòng trong private_key
if (serviceAccount.private_key.includes('\\n')) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as any),
});

/* -----------------------------
   Helper chọn Gmail account
----------------------------- */
function getTransporter(account: 'efb' | 'mathmaster') {
  let user = '';
  let pass = '';

  if (account === 'efb') {
    user = process.env.EMAIL_USER!;
    pass = process.env.EMAIL_PASS!;
  } else {
    user = process.env.EMAIL_USER2!;
    pass = process.env.EMAIL_PASS2!;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

/* -----------------------------
   Gửi OTP
----------------------------- */
app.post('/send-otp', async (req, res) => {
  const { email, account = 'efb' } = req.body; // mặc định dùng email efb

  // ✅ Tạo mã OTP 6 chữ số
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  // Chọn account nào để gửi
  const transporter = getTransporter(account);

  const fromName =
    account === 'efb'
      ? `English For Beginner <${process.env.EMAIL_USER}>`
      : `Math Master <${process.env.EMAIL_USER2}>`;

  const mailOptions = {
    from: fromName,
    to: email,
    subject: 'Mã xác thực OTP của bạn',
    html: `<p>Mã OTP: <b>${otp}</b></p>`,
  };

  try {
    console.log(`✅ Đang gửi OTP đến ${email} bằng ${account}...`);
    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'Đã gửi OTP', otp });
  } catch (error: any) {
    console.error('❌ Lỗi gửi OTP:', error);
    res.status(500).json({ success: false, message: 'Không gửi được OTP' });
  }
});

/* -----------------------------
   Reset mật khẩu Firebase
----------------------------- */
app.post('/reset-password', async (req, res) => {
  const { email, newPassword } = req.body;

  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(user.uid, { password: newPassword });

    res.json({ success: true, message: 'Đã cập nhật mật khẩu thành công' });
  } catch (error: any) {
    console.error('❌ Lỗi cập nhật mật khẩu:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 🚀 Khởi động server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});

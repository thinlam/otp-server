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
const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);

// ⚠️ Fix lỗi xuống dòng trong private_key
if (serviceAccount.private_key.includes('\\n')) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// 📨 Gửi OTP
app.post('/send-otp', async (req, res) => {
  const { email } = req.body;

  // ✅ Tạo mã OTP 6 chữ số
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  // ✉️ Cấu hình gửi Gmail
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,     // Gmail bạn
      pass: process.env.EMAIL_PASS,     // Mật khẩu ứng dụng Gmail
    },
  });

  const mailOptions = {
    from: `English For Beginner <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Mã xác thực OTP của bạn',
    html: `
      <p>👋 Xin chào,</p>
      <p>Đây là mã OTP để xác thực tài khoản EFB:</p>
      <h2>${otp}</h2>
      <p>Vui lòng không chia sẻ mã này với bất kỳ ai.</p>
    `,
  };

  try {
    console.log(`✅ Đang gửi OTP đến ${email}...`);
    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'Đã gửi OTP', otp });
  } catch (error) {
    console.error('❌ Lỗi gửi OTP:', error);
    res.status(500).json({ success: false, message: 'Không gửi được OTP' });
  }
});

// 🔐 Reset mật khẩu Firebase
app.post('/reset-password', async (req, res) => {
  const { email, newPassword } = req.body;
  
  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(user.uid, { password: newPassword });

    res.json({ success: true, message: 'Đã cập nhật mật khẩu thành công' });
  } catch (error) {
    console.error('❌ Lỗi cập nhật mật khẩu:', error);
    res.status(500).json({ success: false, message: error.message });
    console.error('❌ Email không hợp lệ:', error.message);
    res.status(404).json({ success: false, message: 'Email không tồn tại trong hệ thống' });
  }
});

// 🚀 Khởi động server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});

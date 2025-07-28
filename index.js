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

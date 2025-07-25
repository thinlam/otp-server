import express from 'express';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

app.post('/send-otp', async (req, res) => {
  const { email } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: `EFB App <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Mã xác thực OTP của bạn',
    text: `Mã OTP của bạn là: ${otp}`,
  };

  try {
    console.log('Đang gửi OTP đến:', email);
    await transporter.sendMail(mailOptions);
    res.json({ success: true, otp });
  } catch (err) {
    console.error('Lỗi gửi OTP:', err);
    res.status(500).json({ success: false, message: 'Lỗi gửi email' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

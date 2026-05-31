const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendPasswordResetEmail = async (to, resetToken) => {
  // In a real application, you would construct a link to your frontend application
  // e.g., const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
  const resetLink = `http://localhost:5173/reset-password?token=${resetToken}`;

  const mailOptions = {
    from: `"Spendly Support" <${process.env.SMTP_USER}>`,
    to,
    subject: 'Password Reset Request',
    text: `You requested a password reset. Please use the following link to reset your password: ${resetLink}\n\nIf you did not request this, please ignore this email.`,
    html: `
      <p>You requested a password reset.</p>
      <p>Please click the link below to reset your password:</p>
      <a href="${resetLink}">Reset Password</a>
      <p>If you did not request this, please ignore this email.</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[emailService] Password reset email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('[emailService] Error sending email:', error);
    throw error;
  }
};

module.exports = {
  sendPasswordResetEmail,
};
